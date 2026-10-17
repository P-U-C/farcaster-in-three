import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import * as ed from "@noble/ed25519";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  fallback,
  formatEther,
  http,
  keccak256,
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
      "public-origin": { type: "string" },
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
  const facilitatorApiKey = validateFacilitatorApiKey(
    await readHidden(
      "\nCelo x402 facilitator API key (created at https://x402.celo.org): ",
    ),
  );
  const publicOrigin = values["public-origin"];
  if (!publicOrigin?.match(/^https:\/\/[^/]+\/?$/)) {
    throw new Error("--public-origin must be the public HTTPS origin");
  }

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

  const registrationArgs = [
    KEY_TYPE_ED25519,
    key,
    METADATA_TYPE_SIGNED_KEY_REQUEST,
    metadata,
  ] as const;
  await publicClient.simulateContract({
    account,
    address: CONTRACTS.keyGateway,
    abi: keyGatewayAbi,
    functionName: "add",
    args: registrationArgs,
  });
  const registrationData = encodeFunctionData({
    abi: keyGatewayAbi,
    functionName: "add",
    args: registrationArgs,
  });

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
    `VALIDATOR_URLS=${values["validator-urls"] ?? DEFAULT_VALIDATORS.join(",")}`,
    `COOKIE_SECURE=${values["cookie-secure"] ? "true" : "false"}`,
    "AGENT_GATEWAY_PORT=3334",
    "AGENT_CLIENT_UPSTREAM=http://client:3333",
    "AGENT_DEPLOYMENT_UPSTREAM=http://deployer:3335",
    `AGENT_PUBLIC_ORIGIN=${publicOrigin.replace(/\/$/, "")}`,
    `AGENT_WRITE_TOKEN=${agentWriteToken}`,
    `BUY_PAY_TO=${account.address}`,
    "BUY_FACILITATOR_URL=https://api.x402.celo.org",
    `BUY_FACILITATOR_API_KEY=${facilitatorApiKey}`,
    "BUY_AGENT_READ_PRICE=0.005 USDC",
    "BUY_AGENT_METADATA_PRICE=0.002 USDC",
    "BUY_AGENT_WRITE_PRICE=0.02 USDC",
    "BUY_DEPLOY_PRICE=25 USDC",
  ];

  console.log("\nOne Optimism transaction will register this revocable app key.");
  const answer = await readVisible("Type REGISTER to continue: ");
  if (answer !== "REGISTER") {
    throw new Error("Registration cancelled; no transaction was sent");
  }

  const transactionRequest = await walletClient.prepareTransactionRequest({
    account,
    chain: optimism,
    to: CONTRACTS.keyGateway,
    data: registrationData,
  });
  const serializedTransaction = await walletClient.signTransaction(transactionRequest);
  const transactionHash = await submitSignedRegistration({
    output: values.output,
    baseEnv,
    serializedTransaction,
    client: publicClient,
    createOnly: true,
  });

  console.log("\nApp key registered; owner-only recovery file is ready for deployment.");
  console.log(`Receipt            https://optimistic.etherscan.io/tx/${transactionHash}`);
  console.log("Custody phrase     discarded; it is not present in the output file");
  console.log("Next               deployment continues automatically");
}

type RegistrationStatus = "signed" | "submitted" | "confirmed" | "reverted";

export interface RegistrationClient {
  sendRawTransaction(parameters: { serializedTransaction: Hex }): Promise<Hex>;
  waitForTransactionReceipt(parameters: {
    hash: Hex;
    confirmations: number;
    timeout: number;
  }): Promise<{ status: "success" | "reverted" }>;
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
    console.error("Keep this file and rerun ./farcaster client create.");
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

function registrationBaseEnv(content: string): string[] {
  return content
    .split("\n")
    .filter((line) => line && !line.startsWith("SIGNER_REGISTRATION_"));
}

async function recoverRegistration(output: string, rpcUrl?: string) {
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
  console.log("Only a revocable Ed25519 app key will be stored after setup.");
  console.log("The Celo facilitator key enables paid agent requests and stays server-side.\n");
}

export function validateFacilitatorApiKey(input: string): string {
  const value = input.trim();
  if (!/^x402_[A-Za-z0-9_-]{12,}$/.test(value)) {
    throw new Error("Celo facilitator API key must start with x402_");
  }
  return value;
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
