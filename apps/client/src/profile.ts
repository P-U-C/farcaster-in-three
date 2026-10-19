import { parseArgs } from "node:util";
import {
  createPublicClient,
  fallback,
  http,
  type Address,
  type LocalAccount,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { optimism } from "viem/chains";
import { CONTRACTS, PUBLIC_OP_RPC_URLS } from "./constants.js";
import { readClientPasswordFile, readRecoveryKit } from "./setup.js";

const FNAME_API = "https://fnames.farcaster.xyz";
const FNAME_VERIFYING_CONTRACT =
  "0xe3be01d99baa8db9905b33a3ca391238234b79d1" as const;
const fnameDomain = {
  name: "Farcaster name verification",
  version: "1",
  chainId: 1,
  verifyingContract: FNAME_VERIFYING_CONTRACT,
} as const;
const fnameTypes = {
  UserNameProof: [
    { name: "name", type: "string" },
    { name: "timestamp", type: "uint256" },
    { name: "owner", type: "address" },
  ],
} as const;

const idRegistryAbi = [
  {
    type: "function",
    name: "idOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "fid", type: "uint256" }],
  },
] as const;

type FnameAccount = Pick<LocalAccount, "address" | "signTypedData">;

export function validateFname(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,14}[a-z0-9])?$/.test(normalized)) {
    throw new Error("Farcaster names use 1-16 lowercase letters, numbers, or internal hyphens");
  }
  return normalized;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Fname service returned invalid JSON (HTTP ${response.status})`);
  }
}

export async function claimFname({
  username,
  fid,
  account,
  fetchImpl = fetch,
}: {
  username: string;
  fid: number;
  account: FnameAccount;
  fetchImpl?: typeof fetch;
}) {
  const name = validateFname(username);
  const currentResponse = await fetchImpl(
    `${FNAME_API}/transfers/current?fid=${fid}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
  );
  if (currentResponse.ok) {
    const current = (await readJson(currentResponse)) as {
      transfer?: { username?: string };
    };
    if (current.transfer?.username === name) {
      return { status: "already-owned" as const, username: name };
    }
    throw new Error(
      `FID ${fid} already owns @${current.transfer?.username ?? "unknown"}; fname changes are not automatic`,
    );
  }
  if (currentResponse.status !== 404) {
    throw new Error(`Could not inspect the FID's current name (HTTP ${currentResponse.status})`);
  }

  const nameResponse = await fetchImpl(
    `${FNAME_API}/transfers/current?name=${encodeURIComponent(name)}`,
    { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
  );
  if (nameResponse.ok) {
    throw new Error(`@${name} is already registered`);
  }
  if (nameResponse.status !== 404) {
    throw new Error(`Could not inspect @${name} availability (HTTP ${nameResponse.status})`);
  }

  const timeResponse = await fetchImpl(`${FNAME_API}/current-time`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!timeResponse.ok) {
    throw new Error(`Could not read the fname service clock (HTTP ${timeResponse.status})`);
  }
  const timePayload = (await readJson(timeResponse)) as { currentTime?: number };
  if (!Number.isSafeInteger(timePayload.currentTime)) {
    throw new Error("Fname service returned an invalid timestamp");
  }
  const timestamp = timePayload.currentTime as number;
  const signature = await account.signTypedData({
    domain: fnameDomain,
    types: fnameTypes,
    primaryType: "UserNameProof",
    message: {
      name,
      timestamp: BigInt(timestamp),
      owner: account.address,
    },
  });

  const claimResponse = await fetchImpl(`${FNAME_API}/transfers`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      name,
      from: 0,
      to: fid,
      fid,
      owner: account.address,
      timestamp,
      signature,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const claimPayload = (await readJson(claimResponse)) as {
    transfer?: { username?: string; to?: number };
    code?: string;
    error?: string;
  };
  if (
    !claimResponse.ok ||
    claimPayload.transfer?.username !== name ||
    claimPayload.transfer.to !== fid
  ) {
    const detail = claimPayload.code ?? claimPayload.error ?? `HTTP ${claimResponse.status}`;
    throw new Error(`Fname claim failed: ${detail}`);
  }

  return { status: "claimed" as const, username: name };
}

async function main() {
  const { values } = parseArgs({
    options: {
      fid: { type: "string" },
      username: { type: "string" },
      "recovery-file": { type: "string" },
      "password-file": { type: "string" },
    },
  });
  const fid = Number(values.fid);
  if (!Number.isSafeInteger(fid) || fid < 1) {
    throw new Error("--fid must be a positive integer");
  }
  if (!values.username || !values["recovery-file"] || !values["password-file"]) {
    throw new Error(
      "--username, --recovery-file, and --password-file are required",
    );
  }

  const password = await readClientPasswordFile(values["password-file"]);
  let mnemonic = await readRecoveryKit(values["recovery-file"], password);
  const account = mnemonicToAccount(mnemonic.trim(), {
    addressIndex: 0,
    accountIndex: 0,
  });
  mnemonic = "";

  const client = createPublicClient({
    chain: optimism,
    transport: fallback(PUBLIC_OP_RPC_URLS.map((url) => http(url))),
  });
  const ownedFid = await client.readContract({
    address: CONTRACTS.idRegistry,
    abi: idRegistryAbi,
    functionName: "idOf",
    args: [account.address as Address],
  });
  if (ownedFid !== BigInt(fid)) {
    throw new Error(
      `Recovery account owns FID ${ownedFid}, not the deployed client FID ${fid}`,
    );
  }

  const result = await claimFname({
    username: values.username,
    fid,
    account,
  });
  console.log(
    result.status === "claimed"
      ? `Claimed @${result.username} for FID ${fid}`
      : `@${result.username} already belongs to FID ${fid}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      `\nProfile setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
