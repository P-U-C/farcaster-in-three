import { SplitV2Client } from "@0xsplits/splits-sdk";
import { SplitV2Type } from "@0xsplits/splits-sdk/types";
import {
  getAddress,
  keccak256,
  stringToHex,
  zeroAddress,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { base, celo } from "viem/chains";

export const PUC_ROYALTY_ADDRESS = getAddress(
  "0xd240A74c8766cbe9Fc0ba2B242C089aAE164D5dF",
);
export const PUC_ROYALTY_BPS = 500;
export const OPERATOR_SHARE_BPS = 10_000 - PUC_ROYALTY_BPS;
export const DISTRIBUTOR_INCENTIVE_PERCENT = 0.1;
export const REVENUE_SPLIT_VERSION = "splitV2o2" as const;

export const PAYMENT_CHAINS = [
  { key: "celo", network: "eip155:42220", chain: celo },
  { key: "base", network: "eip155:8453", chain: base },
] as const;

export type PaymentChainKey = (typeof PAYMENT_CHAINS)[number]["key"];

export interface RevenueRecipient {
  address: Address;
  percentAllocation: number;
}

export interface RevenueSplitPlan {
  operator: Address;
  royalty: Address;
  operatorShareBps: number;
  royaltyBps: number;
  distributorIncentivePercent: number;
  recipients: RevenueRecipient[];
  salt: `0x${string}`;
  direct: boolean;
}

export interface RevenueChainPlan {
  key: PaymentChainKey;
  network: (typeof PAYMENT_CHAINS)[number]["network"];
  chainId: number;
  splitAddress: Address;
  deployed: boolean;
}

export function createRevenueSplitPlan(
  operatorAddress: string,
  royaltyAddress: string = PUC_ROYALTY_ADDRESS,
): RevenueSplitPlan {
  const operator = getAddress(operatorAddress);
  const royalty = getAddress(royaltyAddress);
  const direct = operator.toLowerCase() === royalty.toLowerCase();

  const recipients = direct
    ? [{ address: operator, percentAllocation: 100 }]
    : [
        {
          address: operator,
          percentAllocation: OPERATOR_SHARE_BPS / 100,
        },
        {
          address: royalty,
          percentAllocation: PUC_ROYALTY_BPS / 100,
        },
      ].sort((left, right) =>
        left.address.toLowerCase().localeCompare(right.address.toLowerCase()),
      );

  const identity = recipients
    .map(
      (recipient) =>
        `${recipient.address.toLowerCase()}:${Math.round(recipient.percentAllocation * 100)}`,
    )
    .join("|");

  return {
    operator,
    royalty,
    operatorShareBps: direct ? 10_000 : OPERATOR_SHARE_BPS,
    royaltyBps: direct ? 0 : PUC_ROYALTY_BPS,
    distributorIncentivePercent: direct ? 0 : DISTRIBUTOR_INCENTIVE_PERCENT,
    recipients,
    salt: keccak256(stringToHex(`in-three:revenue:v1:${identity}`)),
    direct,
  };
}

export function splitCreationConfig(plan: RevenueSplitPlan, chainId: number) {
  if (plan.direct) {
    throw new Error("A direct revenue route does not need a split contract");
  }

  return {
    recipients: plan.recipients,
    distributorFeePercent: plan.distributorIncentivePercent,
    splitType: SplitV2Type.Push,
    ownerAddress: zeroAddress,
    creatorAddress: zeroAddress,
    salt: plan.salt,
    chainId,
    version: REVENUE_SPLIT_VERSION,
  } as const;
}

export async function inspectRevenueSplits({
  operatorAddress,
  royaltyAddress = PUC_ROYALTY_ADDRESS,
  publicClients,
}: {
  operatorAddress: string;
  royaltyAddress?: string;
  publicClients: Record<PaymentChainKey, PublicClient<Transport, any>>;
}): Promise<{ plan: RevenueSplitPlan; chains: RevenueChainPlan[]; payTo: Address }> {
  const plan = createRevenueSplitPlan(operatorAddress, royaltyAddress);
  if (plan.direct) {
    return {
      plan,
      payTo: plan.operator,
      chains: PAYMENT_CHAINS.map(({ key, network, chain }) => ({
        key,
        network,
        chainId: chain.id,
        splitAddress: plan.operator,
        deployed: true,
      })),
    };
  }

  const chains = await Promise.all(
    PAYMENT_CHAINS.map(async ({ key, network, chain }) => {
      const client = new SplitV2Client({
        chainId: chain.id,
        publicClient: publicClients[key],
      });
      const result = await client.isDeployed(splitCreationConfig(plan, chain.id));
      return {
        key,
        network,
        chainId: chain.id,
        splitAddress: getAddress(result.splitAddress),
        deployed: result.deployed,
      };
    }),
  );

  const [first, ...rest] = chains;
  if (
    !first ||
    rest.some(
      (candidate) =>
        candidate.splitAddress.toLowerCase() !== first.splitAddress.toLowerCase(),
    )
  ) {
    throw new Error("Revenue split address differs between payment chains");
  }

  return { plan, chains, payTo: first.splitAddress };
}

export interface PreparedRevenueSplit {
  splitAddress: Address;
  alreadyDeployed: boolean;
  serializedTransaction?: Hex;
  transactionHash?: Hex;
}

export async function prepareRevenueSplitDeployment({
  chain,
  plan,
  publicClient,
  walletClient,
}: {
  chain: Chain;
  plan: RevenueSplitPlan;
  publicClient: PublicClient<Transport, any>;
  walletClient: WalletClient<Transport, any, Account>;
}): Promise<PreparedRevenueSplit> {
  if (plan.direct) {
    return { splitAddress: plan.operator, alreadyDeployed: true };
  }

  const client = new SplitV2Client({
    chainId: chain.id,
    publicClient,
  });
  const config = splitCreationConfig(plan, chain.id);
  const existing = await client.isDeployed(config);
  if (existing.deployed) {
    return {
      splitAddress: getAddress(existing.splitAddress),
      alreadyDeployed: true,
    };
  }

  const call = await client.callData.createSplit(config);
  const request = await walletClient.prepareTransactionRequest({
    account: walletClient.account,
    chain,
    to: getAddress(call.address),
    data: call.data,
  });
  const feePerGas =
    "maxFeePerGas" in request && typeof request.maxFeePerGas === "bigint"
      ? request.maxFeePerGas
      : "gasPrice" in request && typeof request.gasPrice === "bigint"
        ? request.gasPrice
        : undefined;
  const maximumFee =
    typeof request.gas === "bigint" && feePerGas
      ? request.gas * feePerGas
      : undefined;
  if (maximumFee) {
    const balance = await publicClient.getBalance({
      address: walletClient.account.address,
    });
    if (balance < maximumFee) {
      throw new Error(
        `${chain.name} needs native gas to create the revenue split; fund ${walletClient.account.address}`,
      );
    }
  }

  const serializedTransaction = await walletClient.signTransaction(request);
  return {
    splitAddress: getAddress(existing.splitAddress),
    alreadyDeployed: false,
    serializedTransaction,
    transactionHash: keccak256(serializedTransaction),
  };
}

export async function deployRevenueSplit({
  chain,
  plan,
  publicClient,
  walletClient,
}: {
  chain: Chain;
  plan: RevenueSplitPlan;
  publicClient: PublicClient<Transport, any>;
  walletClient: WalletClient<Transport, any, Account>;
}): Promise<{ splitAddress: Address; transaction?: `0x${string}` }> {
  if (plan.direct) return { splitAddress: plan.operator };

  const client = new SplitV2Client({
    chainId: chain.id,
    publicClient,
    walletClient,
  });
  const config = splitCreationConfig(plan, chain.id);
  const existing = await client.isDeployed(config);
  if (existing.deployed) {
    return { splitAddress: getAddress(existing.splitAddress) };
  }

  const created = await client.createSplit(config);
  return {
    splitAddress: getAddress(created.splitAddress),
    ...(created.event.transactionHash
      ? { transaction: created.event.transactionHash }
      : {}),
  };
}
