import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as ed from "@noble/ed25519";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  fallback,
  formatEther,
  http,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { optimism } from "viem/chains";
import { hashPassword } from "./auth.js";
import {
  CONTRACTS,
  DEFAULT_VALIDATORS,
  KEY_TYPE_ED25519,
  METADATA_TYPE_SIGNED_KEY_REQUEST,
  PUBLIC_OP_RPC_URLS,
} from "./constants.js";

const idRegistryAbi = [
  {
    type: "function",
    name: "idOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "fid", type: "uint256" }],
  },
] as const;

const keyGatewayAbi = [
  {
    type: "function",
    name: "add",
    stateMutability: "nonpayable",
    inputs: [
      { name: "keyType", type: "uint32" },
      { name: "key", type: "bytes" },
      { name: "metadataType", type: "uint8" },
      { name: "metadata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const signedKeyRequestDomain = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: CONTRACTS.signedKeyRequestValidator,
} as const;

const signedKeyRequestTypes = {
  SignedKeyRequest: [
    { name: "requestFid", type: "uint256" },
    { name: "key", type: "bytes" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function encodeSignedKeyRequestMetadata(input: {
  requestFid: bigint;
  requestSigner: Hex;
  signature: Hex;
  deadline: bigint;
}): Hex {
  return encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "requestFid", type: "uint256" },
          { name: "requestSigner", type: "address" },
          { name: "signature", type: "bytes" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    [input],
  );
}

async function main() {
  const { values } = parseArgs({
    options: {
      output: { type: "string", short: "o" },
      "read-node-url": { type: "string" },
      "validator-urls": { type: "string" },
      "rpc-url": { type: "string" },
      "cookie-secure": { type: "boolean", default: false },
      recover: { type: "boolean", default: false },
    },
  });
  if (!values.output) throw new Error("--output is required");
  if (values.recover) {
    await recoverRegistration(values.output, values["rpc-url"]);
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

  let mnemonic = await readHidden(
    "\nCustody recovery phrase (used in memory for this transaction only): ",
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

  const transports = values["rpc-url"]
    ? [http(values["rpc-url"])]
    : PUBLIC_OP_RPC_URLS.map((url) => http(url));
  const transport = fallback(transports);
  const publicClient = createPublicClient({ chain: optimism, transport });
  const walletClient = createWalletClient({ account, chain: optimism, transport });

  const [fid, balance] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.idRegistry,
      abi: idRegistryAbi,
      functionName: "idOf",
      args: [account.address],
    }),
    publicClient.getBalance({ address: account.address }),
  ]);

  if (fid === 0n) {
    throw new Error(
      `No FID is registered to ${account.address}. Import the custody phrase for an existing Farcaster account.`,
    );
  }

  console.log(`\nCustody address  ${account.address}`);
  console.log(`Farcaster FID    ${fid}`);
  console.log(`OP balance       ${formatEther(balance)} ETH`);

  await assertStorage(Number(fid), values["validator-urls"]);

  const signerPrivateKey = ed.utils.randomPrivateKey();
  const signerPublicKey = await ed.getPublicKeyAsync(signerPrivateKey);
  const key = `0x${Buffer.from(signerPublicKey).toString("hex")}` as Hex;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86_400);

  // A self-requested signer is still fully attributable: its metadata points to
  // the owning FID, while the exact public key identifies this client instance.
  const requestSignature = await account.signTypedData({
    domain: signedKeyRequestDomain,
    types: signedKeyRequestTypes,
    primaryType: "SignedKeyRequest",
    message: {
      requestFid: fid,
      key,
      deadline,
    },
  });
  const metadata = encodeSignedKeyRequestMetadata({
    requestFid: fid,
    requestSigner: account.address,
    signature: requestSignature,
    deadline,
  });

  const { request } = await publicClient.simulateContract({
    account,
    address: CONTRACTS.keyGateway,
    abi: keyGatewayAbi,
    functionName: "add",
    args: [
      KEY_TYPE_ED25519,
      key,
      METADATA_TYPE_SIGNED_KEY_REQUEST,
      metadata,
    ],
  });

  const signerSecretHex = Buffer.from(signerPrivateKey).toString("hex");
  signerPrivateKey.fill(0);
  const baseEnv = [
    "PORT=3333",
    `FID=${fid}`,
    `SIGNER_PRIVATE_KEY=${signerSecretHex}`,
    `SIGNER_PUBLIC_KEY=${key.toLowerCase()}`,
    `PASSWORD_HASH=${passwordHash}`,
    `SESSION_SECRET=${sessionSecret}`,
    `READ_NODE_URL=${values["read-node-url"] ?? "http://snapchain:3381"}`,
    `VALIDATOR_URLS=${values["validator-urls"] ?? DEFAULT_VALIDATORS.join(",")}`,
    `COOKIE_SECURE=${values["cookie-secure"] ? "true" : "false"}`,
  ];

  console.log("\nOne Optimism transaction will register this revocable app key.");
  const answer = await readVisible("Type REGISTER to continue: ");
  if (answer !== "REGISTER") {
    throw new Error("Registration cancelled; no transaction was sent");
  }

  await writeSetupFile(values.output, setupEnv(baseEnv, "prepared"), true);
  let transactionHash: Hex | undefined;
  try {
    transactionHash = await walletClient.writeContract(request);
    await writeSetupFile(
      values.output,
      setupEnv(baseEnv, "submitted", transactionHash),
    );
    console.log(`Transaction sent  ${transactionHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
      timeout: 120_000,
    });
    if (receipt.status !== "success") {
      await writeSetupFile(
        values.output,
        setupEnv(baseEnv, "reverted", transactionHash),
      );
      throw new Error("Signer registration reverted");
    }
    await writeSetupFile(
      values.output,
      setupEnv(baseEnv, "confirmed", transactionHash),
    );
  } catch (error) {
    if (!transactionHash) {
      await unlink(values.output).catch(() => undefined);
    } else {
      console.error(`\nRecovery file      ${values.output}`);
      console.error("Keep this file and rerun ./farcaster client create.");
      console.error("The command will check the saved transaction without asking for the phrase again.");
    }
    throw error;
  }

  console.log("\nApp key registered; owner-only recovery file is ready for deployment.");
  console.log(`Receipt            https://optimistic.etherscan.io/tx/${transactionHash}`);
  console.log("Custody phrase     discarded; it is not present in the output file");
  console.log("Next               deployment continues automatically");
}

type RegistrationStatus = "prepared" | "submitted" | "confirmed" | "reverted";

function setupEnv(baseEnv: string[], status: RegistrationStatus, transactionHash?: Hex): string {
  return [
    ...baseEnv,
    `SIGNER_REGISTRATION_STATUS=${status}`,
    ...(transactionHash ? [`SIGNER_REGISTRATION_TX=${transactionHash}`] : []),
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

function replaceEnvValue(content: string, key: string, value: string): string {
  const prefix = `${key}=`;
  const lines = content.split("\n");
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index === -1) lines.push(`${prefix}${value}`);
  else lines[index] = `${prefix}${value}`;
  return `${lines.filter((line, lineIndex) => line.length > 0 || lineIndex < lines.length - 1).join("\n").replace(/\n*$/, "")}\n`;
}

async function recoverRegistration(output: string, rpcUrl?: string) {
  const content = await readFile(output, "utf8");
  const status = envValue(content, "SIGNER_REGISTRATION_STATUS");
  const transactionHash = envValue(content, "SIGNER_REGISTRATION_TX");

  if (status === "confirmed") {
    console.log("Saved app-key registration is already confirmed; resuming deployment.");
    return;
  }
  if (status === "reverted") {
    throw new Error(`The saved registration reverted. Remove ${output} and run setup again.`);
  }
  if (status !== "submitted" || !transactionHash?.match(/^0x[0-9a-fA-F]{64}$/)) {
    throw new Error(`The saved setup has no submitted transaction. Remove ${output} and run setup again.`);
  }

  const transports = rpcUrl ? [http(rpcUrl)] : PUBLIC_OP_RPC_URLS.map((url) => http(url));
  const publicClient = createPublicClient({ chain: optimism, transport: fallback(transports) });
  console.log(`Checking registration ${transactionHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash as Hex,
    confirmations: 1,
    timeout: 120_000,
  });
  if (receipt.status !== "success") {
    await writeSetupFile(
      output,
      replaceEnvValue(content, "SIGNER_REGISTRATION_STATUS", "reverted"),
    );
    throw new Error(`Signer registration reverted. Remove ${output} and run setup again.`);
  }

  await writeSetupFile(
    output,
    replaceEnvValue(content, "SIGNER_REGISTRATION_STATUS", "confirmed"),
  );
  console.log("Saved app-key registration is confirmed; resuming deployment.");
}

async function assertStorage(fid: number, configuredValidators?: string) {
  const urls = configuredValidators
    ? configuredValidators.split(",").map((url) => url.trim())
    : [...DEFAULT_VALIDATORS];

  for (const base of urls) {
    try {
      const response = await fetch(
        `${base.replace(/\/$/, "")}/v1/storageLimitsByFid?fid=${fid}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) continue;
      const data = (await response.json()) as { units?: number };
      if (!data.units || data.units < 1) {
        throw new Error(
          `FID ${fid} has no active Farcaster storage. Rent storage before creating a client.`,
        );
      }
      console.log(`Storage units     ${data.units}`);
      return;
    } catch (error) {
      if (error instanceof Error && error.message.includes("no active")) throw error;
    }
  }

  throw new Error("Could not verify storage against any validator endpoint");
}

function printHeader() {
  console.log("\nIN THREE / APP KEY CEREMONY");
  console.log("The phrase stays in this process and is never sent to the server.");
  console.log("Only a revocable Ed25519 app key will be stored after setup.\n");
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
