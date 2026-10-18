import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { parseArgs } from "node:util";
import * as ed from "@noble/ed25519";
import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  keccak256,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { base, celo, optimism } from "viem/chains";
import { hashPassword } from "./auth.js";
import { CONTRACTS, PUBLIC_OP_RPC_URLS } from "./constants.js";
import {
  FarcasterNetwork,
  getFarcasterTime,
  makeKeyAdd,
  makeKeyAddBody,
  Message,
  MessageType,
  NobleEd25519Signer,
  ViemLocalEip712Signer,
} from "./farcaster-sdk.js";
import {
  PAYMENT_CHAINS,
  PUC_ROYALTY_ADDRESS,
  PUC_ROYALTY_BPS,
  createRevenueSplitPlan,
  inspectRevenueSplits,
  prepareRevenueSplitDeployment,
  type PaymentChainKey,
  type PreparedRevenueSplit,
} from "./revenue.js";

const operatorCommand = process.env.IN_THREE_COMMAND ?? "./farcaster";

const idRegistryAbi = [
  {
    type: "function",
    name: "idOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "fid", type: "uint256" }],
  },
] as const;

const GASLESS_SIGNER_TTL_SECONDS = 90 * 24 * 60 * 60;
const GASLESS_SIGNER_SCOPES = [
  MessageType.CAST_ADD,
  MessageType.CAST_REMOVE,
  MessageType.REACTION_ADD,
  MessageType.REACTION_REMOVE,
  MessageType.LINK_ADD,
  MessageType.LINK_REMOVE,
];

function unwrapHub<T>(result: {
  isErr(): boolean;
  _unsafeUnwrap(): T;
  error?: { message?: string } | Error;
}): T {
  if (result.isErr()) {
    const message =
      result.error instanceof Error
        ? result.error.message
        : result.error?.message ?? "Farcaster SDK operation failed";
    throw new Error(message);
  }
  return result._unsafeUnwrap();
}

async function main() {
  const { values } = parseArgs({
    options: {
      output: { type: "string", short: "o" },
      "read-node-url": { type: "string" },
      "setup-node-url": { type: "string" },
      "rpc-url": { type: "string" },
      "celo-rpc-url": { type: "string" },
      "base-rpc-url": { type: "string" },
      "public-origin": { type: "string" },
      "cookie-secure": { type: "boolean", default: false },
      recover: { type: "boolean", default: false },
    },
  });
  if (!values.output) throw new Error("--output is required");
  if (values.recover) {
    await recoverSetup(
      values.output,
      {
        optimism: values["rpc-url"],
        celo: values["celo-rpc-url"],
        base: values["base-rpc-url"],
      },
      values["setup-node-url"],
    );
    return;
  }

  printHeader();
  const password = await readHidden(
    "Client password (12+ characters; protects the web interface): ",
  );
  const confirmation = await readHidden("Repeat client password: ");
  if (password !== confirmation) throw new Error("Passwords did not match; no transaction was sent");
  const passwordHash = await hashPassword(password);
  const sessionSecret = randomBytes(32).toString("base64url");
  const facilitatorApiKey = validateFacilitatorApiKey(
    await readHidden(
      "\nCelo x402 facilitator API key (created at https://x402.celo.org): ",
    ),
  );
  const cdpApiKeyId = validateCdpApiKeyId(
    await readHidden("Coinbase CDP API key ID (for Base x402 settlement): "),
  );
  const cdpApiKeySecret = normalizeCdpApiKeySecret(
    await readHidden("Coinbase CDP API key secret (PEM \\n escapes are accepted): "),
  );
  await validateCdpCredentials(cdpApiKeyId, cdpApiKeySecret);

  const publicOrigin = values["public-origin"];
  if (!publicOrigin?.match(/^https:\/\/[^/]+\/?$/)) {
    throw new Error("--public-origin must be the public HTTPS origin");
  }
  const setupNodeUrl = values["setup-node-url"];
  if (!setupNodeUrl?.match(/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/?$/)) {
    throw new Error("--setup-node-url must be the local SSH tunnel to your read node");
  }

  console.log("\nUse a test Farcaster account only.");
  console.log("A recovery phrase controls the account. Read and trust this source before entering it.");
  console.log("Production clients should request delegated authorization from a wallet instead.");
  const testAccountConfirmation = await readVisible(
    "Type TEST ACCOUNT to acknowledge this developer-only setup: ",
  );
  if (testAccountConfirmation !== "TEST ACCOUNT") {
    throw new Error("Setup cancelled before the custody phrase was requested");
  }

  let mnemonic = await readHidden(
    "\nTest-account recovery phrase (used in memory for signing only): ",
  );
  let account;
  try {
    account = mnemonicToAccount(mnemonic.trim(), {
      addressIndex: 0,
      accountIndex: 0,
    });
  } catch {
    throw new Error("That recovery phrase is not a valid BIP-39 mnemonic");
  }
  mnemonic = "";

  const optimismTransport = fallback(
    values["rpc-url"]
      ? [http(values["rpc-url"])]
      : PUBLIC_OP_RPC_URLS.map((url) => http(url)),
  );
  const celoTransport = http(values["celo-rpc-url"] ?? "https://forno.celo.org");
  const baseTransport = http(values["base-rpc-url"] ?? "https://mainnet.base.org");
  const publicClient = createPublicClient({
    chain: optimism,
    transport: optimismTransport,
  });
  const paymentPublicClients = {
    celo: createPublicClient({ chain: celo, transport: celoTransport }),
    base: createPublicClient({ chain: base, transport: baseTransport }),
  };
  const paymentWalletClients = {
    celo: createWalletClient({ account, chain: celo, transport: celoTransport }),
    base: createWalletClient({ account, chain: base, transport: baseTransport }),
  };

  const fid = await publicClient.readContract({
    address: CONTRACTS.idRegistry,
    abi: idRegistryAbi,
    functionName: "idOf",
    args: [account.address],
  });

  if (fid === 0n) {
    throw new Error(
      `No FID is registered to ${account.address}. Import the custody phrase for an existing Farcaster account.`,
    );
  }

  console.log(`\nCustody address  ${account.address}`);
  console.log(`Farcaster FID    ${fid}`);
  console.log("Signer cost      gasless");

  await assertStorage(Number(fid), setupNodeUrl);

  const revenuePlan = createRevenueSplitPlan(account.address);
  const revenueInspection = await inspectRevenueSplits({
    operatorAddress: account.address,
    publicClients: paymentPublicClients,
  });
  const preparedRevenue: Record<PaymentChainKey, PreparedRevenueSplit> = {
    celo: await prepareRevenueSplitDeployment({
      chain: celo,
      plan: revenuePlan,
      publicClient: paymentPublicClients.celo,
      walletClient: paymentWalletClients.celo,
    }),
    base: await prepareRevenueSplitDeployment({
      chain: base,
      plan: revenuePlan,
      publicClient: paymentPublicClients.base,
      walletClient: paymentWalletClients.base,
    }),
  };
  for (const prepared of Object.values(preparedRevenue)) {
    if (
      prepared.splitAddress.toLowerCase() !==
      revenueInspection.payTo.toLowerCase()
    ) {
      throw new Error("Prepared revenue route does not match its deterministic address");
    }
  }

  const signerPrivateKey = ed.utils.randomPrivateKey();
  const signerPublicKey = await ed.getPublicKeyAsync(signerPrivateKey);
  const key = `0x${Buffer.from(signerPublicKey).toString("hex")}` as Hex;
  const signerState = await readSignerState(setupNodeUrl, Number(fid));
  if (signerState.gaslessSignerCount >= signerState.gaslessSignerLimit) {
    throw new Error(
      `FID ${fid} already has the maximum ${signerState.gaslessSignerLimit} gasless signers`,
    );
  }

  const farcasterTime = unwrapHub(getFarcasterTime());
  const signer = new NobleEd25519Signer(signerPrivateKey);
  const signerBody = unwrapHub(
    await makeKeyAddBody(
      {
        fid,
        key: signerPublicKey,
        scopes: GASLESS_SIGNER_SCOPES,
        ttl: GASLESS_SIGNER_TTL_SECONDS,
        nonce: signerState.currentUserNonce + 1,
        deadline: farcasterTime + 60 * 60,
      },
      new ViemLocalEip712Signer(account),
    ),
  );
  const signerMessage = unwrapHub(
    await makeKeyAdd(
      signerBody,
      { fid: Number(fid), network: FarcasterNetwork.MAINNET },
      signer,
    ),
  );
  const registrationPayload = Message.encode(signerMessage).finish();
  const registrationHash =
    `0x${Buffer.from(signerMessage.hash).toString("hex")}` as Hex;
  const registrationPayloadSha256 = createHash("sha256")
    .update(registrationPayload)
    .digest("hex");

  const signerSecretHex = Buffer.from(signerPrivateKey).toString("hex");
  signerPrivateKey.fill(0);
  const agentWriteToken = randomBytes(32).toString("base64url");
  const baseEnv = [
    "PORT=3333",
    `FID=${fid}`,
    `SIGNER_PRIVATE_KEY=${signerSecretHex}`,
    `SIGNER_PUBLIC_KEY=${key.toLowerCase()}`,
    `PASSWORD_HASH=${passwordHash}`,
    `SESSION_SECRET=${sessionSecret}`,
    `READ_NODE_URL=${values["read-node-url"] ?? "http://snapchain:3381"}`,
    `WRITE_NODE_URL=${values["read-node-url"] ?? "http://snapchain:3381"}`,
    `COOKIE_SECURE=${values["cookie-secure"] ? "true" : "false"}`,
    "AGENT_GATEWAY_PORT=3334",
    "AGENT_CLIENT_UPSTREAM=http://client:3333",
    "AGENT_DEPLOYMENT_UPSTREAM=http://deployer:3335",
    `AGENT_PUBLIC_ORIGIN=${publicOrigin.replace(/\/$/, "")}`,
    `AGENT_WRITE_TOKEN=${agentWriteToken}`,
    `BUY_OPERATOR_PAY_TO=${account.address}`,
    `BUY_PAY_TO=${revenueInspection.payTo}`,
    `BUY_ROYALTY_PAY_TO=${PUC_ROYALTY_ADDRESS}`,
    `BUY_ROYALTY_BPS=${PUC_ROYALTY_BPS}`,
    "BUY_FACILITATOR_URL=https://api.x402.celo.org",
    `BUY_FACILITATOR_API_KEY=${facilitatorApiKey}`,
    `CDP_API_KEY_ID=${cdpApiKeyId}`,
    `CDP_API_KEY_SECRET_B64=${Buffer.from(cdpApiKeySecret, "utf8").toString("base64")}`,
    "BUY_AGENT_READ_PRICE=0.005 USDC",
    "BUY_AGENT_METADATA_PRICE=0.002 USDC",
    "BUY_AGENT_WRITE_PRICE=0.02 USDC",
    "BUY_DEPLOY_PRICE=25 USDC",
  ];

  const initialSetup = gaslessSetupEnv(
    revenueSetupEnv(baseEnv, preparedRevenue),
    "signed",
    registrationHash,
    registrationPayloadSha256,
    Buffer.from(registrationPayload).toString("base64"),
  );

  const transactionCount = Object.values(preparedRevenue).filter(
    (item) => !item.alreadyDeployed,
  ).length;
  console.log(
    `\n${transactionCount} Celo/Base transaction${transactionCount === 1 ? "" : "s"} and one gasless Snapchain message will enable revenue routing and the revocable app key.`,
  );
  console.log("Signer scopes       casts, reactions, and follows only");
  console.log("Signer lifetime     90-day sliding window, refreshed by use");
  console.log("Settlement          95% operator / 5% P-U-C");
  console.log(`Payment address     ${revenueInspection.payTo}`);
  const answer = await readVisible("Type ENABLE AND REGISTER to continue: ");
  if (answer !== "ENABLE AND REGISTER") {
    throw new Error("Setup cancelled; nothing was broadcast");
  }

  await writeSetupFile(values.output, initialSetup, true);
  for (const { key, chain } of PAYMENT_CHAINS) {
    await submitSavedRevenueSplit({
      output: values.output,
      chainKey: key,
      chainName: chain.name,
      client: paymentPublicClients[key],
    });
  }

  await submitSavedGaslessRegistration({
    output: values.output,
    nodeUrl: setupNodeUrl,
  });

  console.log("\nRevenue routes and gasless app key confirmed; deployment can continue.");
  console.log(`App-key message     ${registrationHash}`);
  console.log("Payment rails       Celo USDC + Base USDC");
  console.log("Custody phrase      discarded; it is not present in the output file");
  console.log("Next                deployment continues automatically");
}

type RegistrationStatus = "signed" | "submitted" | "confirmed" | "reverted";
type RevenueStatus =
  | "signed"
  | "submitted"
  | "confirmed"
  | "reverted";

export interface RegistrationClient {
  sendRawTransaction(parameters: { serializedTransaction: Hex }): Promise<Hex>;
  waitForTransactionReceipt(parameters: {
    hash: Hex;
    confirmations: number;
    timeout: number;
  }): Promise<{ status: "success" | "reverted" }>;
}

interface SignerState {
  signers: Array<{ source?: string; key?: string }>;
  gaslessSignerCount: number;
  gaslessSignerLimit: number;
  currentUserNonce: number;
}

export async function readSignerState(
  nodeUrl: string,
  fid: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SignerState> {
  const response = await fetchImpl(
    `${nodeUrl.replace(/\/$/, "")}/v1/signersByFid?fid=${fid}`,
    {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Snapchain signer query returned HTTP ${response.status}`);
  }
  const value = (await response.json()) as Partial<SignerState>;
  if (
    !Array.isArray(value.signers) ||
    !Number.isInteger(value.currentUserNonce) ||
    !Number.isInteger(value.gaslessSignerCount) ||
    !Number.isInteger(value.gaslessSignerLimit)
  ) {
    throw new Error("Snapchain returned an incomplete signer response");
  }
  return value as SignerState;
}

function gaslessSetupEnv(
  baseEnv: string[],
  status: RegistrationStatus,
  messageHash: Hex,
  payloadSha256?: string,
  payloadBase64?: string,
): string {
  return [
    ...baseEnv,
    "SIGNER_REGISTRATION_MODE=gasless",
    `SIGNER_REGISTRATION_STATUS=${status}`,
    `SIGNER_REGISTRATION_MESSAGE_HASH=${messageHash}`,
    ...(payloadSha256
      ? [`SIGNER_REGISTRATION_PAYLOAD_SHA256=${payloadSha256}`]
      : []),
    ...(payloadBase64
      ? [`SIGNER_REGISTRATION_MESSAGE_B64=${payloadBase64}`]
      : []),
    "",
  ].join("\n");
}

export async function submitSavedGaslessRegistration({
  output,
  nodeUrl,
  fetchImpl = fetch,
  pollAttempts = 30,
  pollDelayMs = 2_000,
  sleepImpl = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
}: {
  output: string;
  nodeUrl: string;
  fetchImpl?: typeof fetch;
  pollAttempts?: number;
  pollDelayMs?: number;
  sleepImpl?: (milliseconds: number) => Promise<void>;
}): Promise<Hex> {
  let content = await readFile(output, "utf8");
  const status = envValue(content, "SIGNER_REGISTRATION_STATUS");
  const fid = Number(envValue(content, "FID"));
  const publicKey = envValue(content, "SIGNER_PUBLIC_KEY")?.toLowerCase();
  const messageHash = envValue(content, "SIGNER_REGISTRATION_MESSAGE_HASH") as
    | Hex
    | undefined;

  if (
    !Number.isSafeInteger(fid) ||
    fid < 1 ||
    !publicKey?.match(/^0x[0-9a-f]{64}$/) ||
    !messageHash?.match(/^0x[0-9a-fA-F]{40}$/)
  ) {
    throw new Error(`Gasless signer recovery data is incomplete at ${output}`);
  }
  if (status === "confirmed") return messageHash;

  const signerIsActive = async () => {
    const state = await readSignerState(nodeUrl, fid, fetchImpl);
    return state.signers.some(
      (signer) =>
        signer.source === "SIGNER_SOURCE_GASLESS" &&
        signer.key?.toLowerCase() === publicKey,
    );
  };

  if (await signerIsActive()) {
    await writeSetupFile(
      output,
      patchEnv(content, {
        SIGNER_REGISTRATION_STATUS: "confirmed",
        SIGNER_REGISTRATION_PAYLOAD_SHA256: undefined,
        SIGNER_REGISTRATION_MESSAGE_B64: undefined,
      }),
    );
    return messageHash;
  }

  const payloadBase64 = envValue(content, "SIGNER_REGISTRATION_MESSAGE_B64");
  const savedPayloadSha256 = envValue(
    content,
    "SIGNER_REGISTRATION_PAYLOAD_SHA256",
  );
  if (
    !["signed", "submitted"].includes(status ?? "") ||
    !payloadBase64 ||
    !savedPayloadSha256?.match(/^[0-9a-f]{64}$/)
  ) {
    throw new Error(
      `The exact gasless signer message is missing; keep ${output} for diagnosis`,
    );
  }

  const payload = Buffer.from(payloadBase64, "base64");
  const payloadSha256 = createHash("sha256").update(payload).digest("hex");
  if (payloadSha256 !== savedPayloadSha256) {
    throw new Error("Saved gasless signer message does not match its checksum");
  }
  const message = Message.decode(payload);
  const decodedHash = `0x${Buffer.from(message.hash).toString("hex")}`;
  const decodedSigner = `0x${Buffer.from(message.signer).toString("hex")}`;
  if (
    decodedHash.toLowerCase() !== messageHash.toLowerCase() ||
    decodedSigner.toLowerCase() !== publicKey
  ) {
    throw new Error("Saved gasless signer message does not match its app key");
  }

  let rejection = "";
  try {
    const response = await fetchImpl(
      `${nodeUrl.replace(/\/$/, "")}/v1/submitMessage`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/octet-stream",
        },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      },
    );
    const responseText = await response.text();
    if (response.ok) {
      content = patchEnv(content, {
        SIGNER_REGISTRATION_STATUS: "submitted",
      });
      await writeSetupFile(output, content);
      console.log(`Gasless KEY_ADD accepted for relay  ${messageHash}`);
    } else {
      rejection = `HTTP ${response.status}: ${responseText}`;
    }
  } catch (error) {
    rejection = error instanceof Error ? error.message : String(error);
  }

  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    try {
      if (await signerIsActive()) {
        await writeSetupFile(
          output,
          patchEnv(await readFile(output, "utf8"), {
            SIGNER_REGISTRATION_STATUS: "confirmed",
            SIGNER_REGISTRATION_PAYLOAD_SHA256: undefined,
            SIGNER_REGISTRATION_MESSAGE_B64: undefined,
          }),
        );
        return messageHash;
      }
    } catch {
      // The signed payload remains durable; a later rerun can check again.
    }
    if (attempt < pollAttempts) await sleepImpl(pollDelayMs);
  }

  console.error("\nThe gasless signer is not yet visible on the read node.");
  console.error(`The exact signed message remains in ${output}.`);
  if (rejection) console.error(`Last submission result: ${rejection}`);
  throw new Error(
    `Keep the recovery file and rerun ${operatorCommand} client create before authorizing another key`,
  );
}

function revenueSetupEnv(
  baseEnv: string[],
  prepared: Record<PaymentChainKey, PreparedRevenueSplit>,
): string[] {
  return [
    ...baseEnv,
    ...PAYMENT_CHAINS.flatMap(({ key }) => {
      const transaction = prepared[key];
      const prefix = `REVENUE_${key.toUpperCase()}`;
      if (transaction.alreadyDeployed) {
        return [
          `${prefix}_STATUS=confirmed`,
          `${prefix}_ADDRESS=${transaction.splitAddress}`,
        ];
      }
      if (!transaction.transactionHash || !transaction.serializedTransaction) {
        throw new Error(`Missing signed ${key} revenue transaction`);
      }
      return [
        `${prefix}_STATUS=signed`,
        `${prefix}_ADDRESS=${transaction.splitAddress}`,
        `${prefix}_TX=${transaction.transactionHash}`,
        `${prefix}_RAW_TX=${transaction.serializedTransaction}`,
      ];
    }),
  ];
}

export async function submitSavedRevenueSplit({
  output,
  chainKey,
  chainName,
  client,
}: {
  output: string;
  chainKey: PaymentChainKey;
  chainName: string;
  client: RegistrationClient;
}): Promise<Hex | undefined> {
  let content = await readFile(output, "utf8");
  const prefix = `REVENUE_${chainKey.toUpperCase()}`;
  const status = envValue(content, `${prefix}_STATUS`) as
    | RevenueStatus
    | undefined;
  if (status === "confirmed") return undefined;
  if (status === "reverted") {
    throw new Error(
      `${chainName} revenue split creation reverted; keep ${output} for diagnosis`,
    );
  }

  const savedHash = envValue(content, `${prefix}_TX`);
  const serializedTransaction = envValue(content, `${prefix}_RAW_TX`);
  if (
    !["signed", "submitted"].includes(status ?? "") ||
    !savedHash?.match(/^0x[0-9a-fA-F]{64}$/) ||
    !serializedTransaction?.match(/^0x(?:[0-9a-fA-F]{2})+$/)
  ) {
    throw new Error(
      `${chainName} revenue recovery data is incomplete; keep ${output} for manual recovery`,
    );
  }

  const transactionHash = keccak256(serializedTransaction as Hex);
  if (transactionHash.toLowerCase() !== savedHash.toLowerCase()) {
    throw new Error(
      `${chainName} revenue transaction hash does not match its signed bytes`,
    );
  }

  try {
    const rpcHash = await client.sendRawTransaction({
      serializedTransaction: serializedTransaction as Hex,
    });
    if (rpcHash.toLowerCase() !== transactionHash.toLowerCase()) {
      throw new Error(`RPC returned an unexpected transaction hash: ${rpcHash}`);
    }
    content = patchEnv(content, {
      [`${prefix}_STATUS`]: "submitted",
    });
    await writeSetupFile(output, content);
    console.log(`${chainName} split sent  ${transactionHash}`);
  } catch {
    console.error(`\n${chainName} broadcast response was inconclusive.`);
    console.error(`The exact signed transaction remains in ${output}.`);
  }

  let receipt: { status: "success" | "reverted" };
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
      timeout: 120_000,
    });
  } catch (error) {
    console.error(`\nRecovery file      ${output}`);
    console.error(
      `Keep this file and rerun ${operatorCommand} client create to resume every pending transaction.`,
    );
    throw error;
  }

  if (receipt.status !== "success") {
    await writeSetupFile(
      output,
      patchEnv(await readFile(output, "utf8"), {
        [`${prefix}_STATUS`]: "reverted",
        [`${prefix}_RAW_TX`]: undefined,
      }),
    );
    throw new Error(`${chainName} revenue split creation reverted`);
  }

  await writeSetupFile(
    output,
    patchEnv(await readFile(output, "utf8"), {
      [`${prefix}_STATUS`]: "confirmed",
      [`${prefix}_RAW_TX`]: undefined,
    }),
  );
  return transactionHash;
}

export async function submitSignedRegistration({
  output,
  baseEnv,
  serializedTransaction,
  client,
  createOnly = false,
  expectedHash,
}: {
  output: string;
  baseEnv: string[];
  serializedTransaction: Hex;
  client: RegistrationClient;
  createOnly?: boolean;
  expectedHash?: Hex;
}): Promise<Hex> {
  const transactionHash = keccak256(serializedTransaction);
  if (expectedHash && transactionHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error("Saved registration transaction hash does not match its signed bytes");
  }

  await writeSetupFile(
    output,
    setupEnv(baseEnv, "signed", transactionHash, serializedTransaction),
    createOnly,
  );

  try {
    const rpcHash = await client.sendRawTransaction({ serializedTransaction });
    if (rpcHash.toLowerCase() !== transactionHash.toLowerCase()) {
      throw new Error(`RPC returned an unexpected transaction hash: ${rpcHash}`);
    }
    await writeSetupFile(
      output,
      setupEnv(baseEnv, "submitted", transactionHash, serializedTransaction),
    );
    console.log(`Transaction sent  ${transactionHash}`);
  } catch (error) {
    console.error("\nThe broadcast response was inconclusive.");
    console.error(`The signed transaction and local hash remain in ${output}.`);
    console.error("Receipt polling will continue; rerunning client create safely rebroadcasts the same transaction.");
  }

  let receipt: { status: "success" | "reverted" };
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
      timeout: 120_000,
    });
  } catch (error) {
    console.error(`\nRecovery file      ${output}`);
    console.error(`Keep this file and rerun ${operatorCommand} client create.`);
    console.error("The command will rebroadcast the saved transaction without asking for the phrase again.");
    throw error;
  }

  if (receipt.status !== "success") {
    await writeSetupFile(
      output,
      setupEnv(baseEnv, "reverted", transactionHash),
    );
    throw new Error("Signer registration reverted");
  }

  await writeSetupFile(
    output,
    setupEnv(baseEnv, "confirmed", transactionHash),
  );
  return transactionHash;
}

function setupEnv(
  baseEnv: string[],
  status: RegistrationStatus,
  transactionHash?: Hex,
  serializedTransaction?: Hex,
): string {
  return [
    ...baseEnv,
    `SIGNER_REGISTRATION_STATUS=${status}`,
    ...(transactionHash ? [`SIGNER_REGISTRATION_TX=${transactionHash}`] : []),
    ...(serializedTransaction
      ? [`SIGNER_REGISTRATION_RAW_TX=${serializedTransaction}`]
      : []),
    "",
  ].join("\n");
}

async function writeSetupFile(path: string, content: string, createOnly = false) {
  if (createOnly) {
    await writeFile(path, content, { mode: 0o600, flag: "wx" });
    await chmod(path, 0o600);
    return;
  }

  const temporary = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function envValue(content: string, key: string): string | undefined {
  const prefix = `${key}=`;
  return content
    .split("\n")
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length);
}

function patchEnv(
  content: string,
  updates: Record<string, string | undefined>,
): string {
  const keys = new Set(Object.keys(updates));
  const lines = content
    .split("\n")
    .filter((line) => line && !keys.has(line.split("=", 1)[0] ?? ""));
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

function registrationBaseEnv(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line && !line.startsWith("SIGNER_REGISTRATION_"));
}

async function recoverSetup(
  output: string,
  rpcUrls: {
    optimism?: string;
    celo?: string;
    base?: string;
  },
  setupNodeUrl?: string,
) {
  const content = await readFile(output, "utf8");
  if (envValue(content, "REVENUE_CELO_STATUS")) {
    const paymentClients = {
      celo: createPublicClient({
        chain: celo,
        transport: http(rpcUrls.celo ?? "https://forno.celo.org"),
      }),
      base: createPublicClient({
        chain: base,
        transport: http(rpcUrls.base ?? "https://mainnet.base.org"),
      }),
    };
    for (const { key, chain } of PAYMENT_CHAINS) {
      await submitSavedRevenueSplit({
        output,
        chainKey: key,
        chainName: chain.name,
        client: paymentClients[key],
      });
    }
  }

  const refreshed = await readFile(output, "utf8");
  if (envValue(refreshed, "SIGNER_REGISTRATION_MODE") === "gasless") {
    if (!setupNodeUrl) {
      throw new Error("--setup-node-url is required to recover a gasless signer");
    }
    await submitSavedGaslessRegistration({ output, nodeUrl: setupNodeUrl });
    console.log("Saved gasless app key is confirmed; resuming deployment.");
    return;
  }

  await recoverLegacyRegistration(output, rpcUrls.optimism);
}

async function recoverLegacyRegistration(output: string, rpcUrl?: string) {
  const content = await readFile(output, "utf8");
  const status = envValue(content, "SIGNER_REGISTRATION_STATUS");
  const transactionHash = envValue(content, "SIGNER_REGISTRATION_TX");
  const serializedTransaction = envValue(content, "SIGNER_REGISTRATION_RAW_TX");

  if (status === "confirmed") {
    console.log("Saved app-key registration is already confirmed; resuming deployment.");
    return;
  }
  if (status === "reverted") {
    throw new Error(`The saved registration reverted. Remove ${output} and run setup again.`);
  }
  if (
    !["signed", "submitted"].includes(status ?? "") ||
    !transactionHash?.match(/^0x[0-9a-fA-F]{64}$/)
  ) {
    throw new Error(
      `The saved setup predates recoverable signing. Keep ${output} until you verify the signer state manually.`,
    );
  }

  const transports = rpcUrl ? [http(rpcUrl)] : PUBLIC_OP_RPC_URLS.map((url) => http(url));
  const publicClient = createPublicClient({ chain: optimism, transport: fallback(transports) });

  if (!serializedTransaction?.match(/^0x(?:[0-9a-fA-F]{2})+$/)) {
    if (status !== "submitted") {
      throw new Error(
        `The saved signed transaction is missing. Keep ${output} until you verify the signer state manually.`,
      );
    }
    console.log(`Checking legacy registration ${transactionHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash as Hex,
      confirmations: 1,
      timeout: 120_000,
    });
    const nextStatus = receipt.status === "success" ? "confirmed" : "reverted";
    await writeSetupFile(
      output,
      setupEnv(registrationBaseEnv(content), nextStatus, transactionHash as Hex),
    );
    if (nextStatus === "reverted") {
      throw new Error(`Signer registration reverted. Remove ${output} and run setup again.`);
    }
    console.log("Saved app-key registration is confirmed; resuming deployment.");
    return;
  }

  console.log(`Rebroadcasting saved registration ${transactionHash}`);
  await submitSignedRegistration({
    output,
    baseEnv: registrationBaseEnv(content),
    serializedTransaction: serializedTransaction as Hex,
    expectedHash: transactionHash as Hex,
    client: publicClient,
  });
  console.log("Saved app-key registration is confirmed; resuming deployment.");
}

async function assertStorage(fid: number, nodeUrl: string) {
  const response = await fetch(
    `${nodeUrl.replace(/\/$/, "")}/v1/storageLimitsByFid?fid=${fid}`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) {
    throw new Error(
      `Could not verify storage through your read node (HTTP ${response.status})`,
    );
  }
  const data = (await response.json()) as { units?: number };
  if (!data.units || data.units < 1) {
    throw new Error(
      `FID ${fid} has no active Farcaster storage. Rent storage before creating a client.`,
    );
  }
  console.log(`Storage units     ${data.units}`);
}

function printHeader() {
  console.log("\nIN THREE / APP KEY CEREMONY");
  console.log("Developer build: use a test Farcaster account, never a primary wallet.");
  console.log("The phrase stays in this process and is never sent to the server.");
  console.log("A scoped, gasless Ed25519 app key is stored after setup.");
  console.log("Celo and Base facilitator credentials stay in the payment gateway.\n");
}

export function validateFacilitatorApiKey(input: string): string {
  const value = input.trim();
  if (!/^x402_[A-Za-z0-9_-]{12,}$/.test(value)) {
    throw new Error("Celo facilitator API key must start with x402_");
  }
  return value;
}

export function validateCdpApiKeyId(input: string): string {
  const value = input.trim();
  if (
    !/^(?:[0-9a-fA-F-]{20,}|organizations\/[A-Za-z0-9-]+\/apiKeys\/[A-Za-z0-9-]+)$/.test(
      value,
    )
  ) {
    throw new Error("Coinbase CDP API key ID is not in a recognized format");
  }
  return value;
}

export function normalizeCdpApiKeySecret(input: string): string {
  const value = input.trim().replace(/\\n/g, "\n");
  if (value.length < 40) {
    throw new Error("Coinbase CDP API key secret is too short");
  }
  return value;
}

export async function validateCdpCredentials(
  apiKeyId: string,
  apiKeySecret: string,
): Promise<void> {
  try {
    await generateJwt({
      apiKeyId,
      apiKeySecret,
      requestMethod: "GET",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/x402/supported",
    });
  } catch {
    throw new Error(
      "Coinbase CDP credentials could not sign a request; check the key ID and secret",
    );
  }
}

type TerminalInput = NodeJS.ReadStream;
type TerminalOutput = Pick<NodeJS.WriteStream, "write">;

export function readVisible(
  prompt: string,
  input: TerminalInput = process.stdin,
  output: TerminalOutput = process.stdout,
): Promise<string> {
  output.write(prompt);
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      value += chunk.toString("utf8");
      if (value.includes("\n") || value.includes("\r")) {
        input.off("data", onData);
        input.pause();
        resolve(value.trim());
      }
    };
    input.resume();
    input.on("data", onData);
  });
}

export function readHidden(
  prompt: string,
  input: TerminalInput = process.stdin,
  output: TerminalOutput = process.stdout,
): Promise<string> {
  if (!input.isTTY) {
    throw new Error("Secret input requires an interactive terminal");
  }
  output.write(prompt);

  return new Promise((resolve, reject) => {
    const wasRaw = input.isRaw;
    let value = "";

    input.setRawMode?.(true);
    input.resume();

    const cleanup = () => {
      input.off("data", onData);
      input.setRawMode?.(Boolean(wasRaw));
      input.pause();
      output.write("\n");
    };

    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          reject(new Error("Cancelled"));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          resolve(value);
          return;
        }
        if (byte === 127 || byte === 8) {
          value = value.slice(0, -1);
          continue;
        }
        value += String.fromCharCode(byte);
      }
    };

    input.on("data", onData);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`\nSetup failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
