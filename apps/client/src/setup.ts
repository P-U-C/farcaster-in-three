import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";
import { chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { parseArgs, promisify } from "node:util";
import * as ed from "@noble/ed25519";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  fallback,
  formatEther,
  http,
  keccak256,
  parseEther,
  zeroAddress,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import { generateMnemonic, mnemonicToAccount } from "viem/accounts";
import { base, celo, optimism } from "viem/chains";
import { wordlist } from "@scure/bip39/wordlists/english";
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
const recoveryKitFormat = "in-three-recovery-v1";
const recoveryKitAad = Buffer.from(recoveryKitFormat, "utf8");
const scryptAsync = promisify(scryptCallback);

const idRegistryAbi = [
  {
    type: "function",
    name: "idOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "fid", type: "uint256" }],
  },
] as const;

const idGatewayAbi = [
  {
    type: "function",
    name: "price",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "register",
    stateMutability: "payable",
    inputs: [{ name: "recovery", type: "address" }],
    outputs: [
      { name: "fid", type: "uint256" },
      { name: "overpayment", type: "uint256" },
    ],
  },
] as const;

const MINIMUM_REGISTRATION_GAS_RESERVE = parseEther("0.001");

const GASLESS_SIGNER_TTL_SECONDS = 90 * 24 * 60 * 60;
const GASLESS_SIGNER_SCOPES = [
  MessageType.CAST_ADD,
  MessageType.CAST_REMOVE,
  MessageType.REACTION_ADD,
  MessageType.REACTION_REMOVE,
  MessageType.LINK_ADD,
  MessageType.LINK_REMOVE,
  MessageType.USER_DATA_ADD,
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

export async function readClientPasswordFile(path: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile()) {
    throw new Error(`Client password path is not a regular file: ${path}`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`Client password file must not be accessible by group or others: chmod 600 ${path}`);
  }
  const raw = await readFile(path, "utf8");
  const password = raw.endsWith("\r\n")
    ? raw.slice(0, -2)
    : raw.endsWith("\n")
      ? raw.slice(0, -1)
      : raw;
  if (password.includes("\n") || password.includes("\r")) {
    throw new Error("Client password file must contain exactly one line");
  }
  if (password.length < 12) {
    throw new Error("Client password from file must be at least 12 characters");
  }
  return password;
}

type RecoveryKit = {
  format: typeof recoveryKitFormat;
  kdf: "scrypt";
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export async function writeRecoveryKit(
  path: string,
  mnemonic: string,
  password: string,
): Promise<void> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = (await scryptAsync(password, salt, 32)) as Buffer;
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(recoveryKitAad);
    const ciphertext = Buffer.concat([
      cipher.update(mnemonic, "utf8"),
      cipher.final(),
    ]);
    const kit: RecoveryKit = {
      format: recoveryKitFormat,
      kdf: "scrypt",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    };
    await writeFile(path, `${JSON.stringify(kit)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(path, 0o600);
  } finally {
    key.fill(0);
  }
}

export async function readRecoveryKit(
  path: string,
  password: string,
): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile()) {
    throw new Error(`Recovery kit path is not a regular file: ${path}`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`Recovery kit must not be accessible by group or others: chmod 600 ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isMissingFile(error)) throw error;
    throw new Error(`Recovery kit at ${path} is not valid JSON`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Partial<RecoveryKit>).format !== recoveryKitFormat ||
    (parsed as Partial<RecoveryKit>).kdf !== "scrypt" ||
    typeof (parsed as Partial<RecoveryKit>).salt !== "string" ||
    typeof (parsed as Partial<RecoveryKit>).iv !== "string" ||
    typeof (parsed as Partial<RecoveryKit>).tag !== "string" ||
    typeof (parsed as Partial<RecoveryKit>).ciphertext !== "string"
  ) {
    throw new Error(`Recovery kit at ${path} has an unsupported format`);
  }

  const kit = parsed as RecoveryKit;
  const salt = Buffer.from(kit.salt, "base64");
  const iv = Buffer.from(kit.iv, "base64");
  const tag = Buffer.from(kit.tag, "base64");
  const ciphertext = Buffer.from(kit.ciphertext, "base64");
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
    throw new Error(`Recovery kit at ${path} has invalid encrypted fields`);
  }

  const key = (await scryptAsync(password, salt, 32)) as Buffer;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(recoveryKitAad);
    decipher.setAuthTag(tag);
    const mnemonic = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    mnemonicToAccount(mnemonic, { addressIndex: 0, accountIndex: 0 });
    await chmod(path, 0o600);
    return mnemonic;
  } catch {
    throw new Error(
      `Could not decrypt recovery kit at ${path}; enter the same client password used when it was created`,
    );
  } finally {
    key.fill(0);
  }
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
      "recovery-file": { type: "string" },
      "password-file": { type: "string" },
      "cookie-secure": { type: "boolean", default: false },
      "agent-commerce": { type: "boolean", default: false },
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

  const agentCommerce = values["agent-commerce"];
  printHeader(agentCommerce);
  let password: string;
  if (values["password-file"]) {
    password = await readClientPasswordFile(values["password-file"]);
    console.log(`Client password     read from owner-only file ${values["password-file"]}`);
  } else {
    password = await readHidden(
      "Client password (12+ characters; protects the web interface): ",
    );
    const confirmation = await readHidden("Repeat client password: ");
    if (password !== confirmation) throw new Error("Passwords did not match; no transaction was sent");
  }
  const passwordHash = await hashPassword(password);
  const sessionSecret = randomBytes(32).toString("base64url");
  let facilitatorApiKey: string | undefined;
  let cdpApiKeyId: string | undefined;
  let cdpApiKeySecret: string | undefined;
  if (agentCommerce) {
    facilitatorApiKey = validateFacilitatorApiKey(
      await readHidden(
        "\nCelo x402 facilitator API key (created at https://x402.celo.org): ",
      ),
    );
    cdpApiKeyId = validateCdpApiKeyId(
      await readHidden("Coinbase CDP API key ID (for Base x402 settlement): "),
    );
    cdpApiKeySecret = normalizeCdpApiKeySecret(
      await readHidden("Coinbase CDP API key secret (PEM \\n escapes are accepted): "),
    );
    await validateCdpCredentials(cdpApiKeyId, cdpApiKeySecret);
  }

  const publicOrigin = values["public-origin"];
  if (!publicOrigin?.match(/^https:\/\/[^/]+\/?$/)) {
    throw new Error("--public-origin must be the public HTTPS origin");
  }
  const setupNodeUrl = values["setup-node-url"];
  if (!setupNodeUrl?.match(/^http:\/\/127\.0\.0\.1:[0-9]{1,5}\/?$/)) {
    throw new Error("--setup-node-url must be the local SSH tunnel to your read node");
  }

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

  console.log("\nUse a disposable test account only.");
  console.log("CREATE makes one here. IMPORT uses a test account you already control.");
  console.log("Production clients should request delegated authorization from a trusted wallet.");
  const modeInput = await readVisible("Choose CREATE or IMPORT [CREATE]: ");
  const accountMode = modeInput.trim().toUpperCase() || "CREATE";
  if (!["CREATE", "IMPORT"].includes(accountMode)) {
    throw new Error("Choose CREATE or IMPORT");
  }

  let mnemonic: string;
  let usingRecoveryKit = false;
  if (accountMode === "CREATE") {
    const recoveryFile = values["recovery-file"];
    if (!recoveryFile) {
      throw new Error("--recovery-file is required when creating a test account");
    }
    try {
      mnemonic = await readRecoveryKit(recoveryFile, password);
      usingRecoveryKit = true;
      console.log(`\nResuming from encrypted recovery kit  ${recoveryFile}`);
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      mnemonic = generateMnemonic(wordlist);
      await writeRecoveryKit(recoveryFile, mnemonic, password);
      usingRecoveryKit = true;
      console.log(`\nEncrypted recovery kit  ${recoveryFile}`);
      console.log("Keep this file and your client password private and backed up.");
      console.log("The phrase was not printed and will never be sent to the server.");
    }
  } else {
    console.log("\nImport a disposable test account only.");
    console.log("The phrase is used in memory and is never written to the server.");
    mnemonic = await readHidden("Test-account recovery phrase: ");
  }

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

  let fid = await publicClient.readContract({
    address: CONTRACTS.idRegistry,
    abi: idRegistryAbi,
    functionName: "idOf",
    args: [account.address],
  });

  if (fid === 0n) {
    fid = await registerTestAccount({
      account,
      client: publicClient,
      pendingPath: `${values.output}.fid-registration`,
    });
  } else {
    await unlink(`${values.output}.fid-registration`).catch(() => undefined);
  }

  const paymentPublicClients = {
    celo: createPublicClient({ chain: celo, transport: celoTransport }),
    base: createPublicClient({ chain: base, transport: baseTransport }),
  };
  const paymentWalletClients = {
    celo: createWalletClient({ account, chain: celo, transport: celoTransport }),
    base: createWalletClient({ account, chain: base, transport: baseTransport }),
  };

  console.log(`\nCustody address  ${account.address}`);
  console.log(`Farcaster FID    ${fid}`);
  console.log("Signer cost      gasless");

  await assertStorage(Number(fid), setupNodeUrl);

  let revenueInspection: Awaited<ReturnType<typeof inspectRevenueSplits>> | undefined;
  let preparedRevenue: Record<PaymentChainKey, PreparedRevenueSplit> | undefined;
  if (agentCommerce) {
    const revenuePlan = createRevenueSplitPlan(account.address);
    revenueInspection = await inspectRevenueSplits({
      operatorAddress: account.address,
      publicClients: paymentPublicClients,
    });
    preparedRevenue = {
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
    `AGENT_COMMERCE_ENABLED=${agentCommerce ? "true" : "false"}`,
  ];

  if (agentCommerce) {
    if (
      !revenueInspection ||
      !preparedRevenue ||
      !facilitatorApiKey ||
      !cdpApiKeyId ||
      !cdpApiKeySecret
    ) {
      throw new Error("Agent-commerce setup is incomplete");
    }
    baseEnv.push(
      "AGENT_GATEWAY_PORT=3334",
      "AGENT_CLIENT_UPSTREAM=http://client:3333",
      "AGENT_DEPLOYMENT_UPSTREAM=http://deployer:3335",
      `AGENT_PUBLIC_ORIGIN=${publicOrigin.replace(/\/$/, "")}`,
      `AGENT_WRITE_TOKEN=${randomBytes(32).toString("base64url")}`,
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
    );
  }

  const setupEnv = preparedRevenue
    ? revenueSetupEnv(baseEnv, preparedRevenue)
    : baseEnv;
  const initialSetup = gaslessSetupEnv(
    setupEnv,
    "signed",
    registrationHash,
    registrationPayloadSha256,
    Buffer.from(registrationPayload).toString("base64"),
  );

  console.log("\nOne gasless Snapchain message will authorize the revocable app key.");
  console.log("Signer scopes       casts, reactions, follows, and profile metadata");
  console.log("Signer lifetime     90-day sliding window, refreshed by use");
  if (agentCommerce && revenueInspection && preparedRevenue) {
    const transactionCount = Object.values(preparedRevenue).filter(
      (item) => !item.alreadyDeployed,
    ).length;
    console.log(`Revenue setup       ${transactionCount} Celo/Base transaction${transactionCount === 1 ? "" : "s"}`);
    console.log("Settlement          95% operator / 5% P-U-C");
    console.log(`Payment address     ${revenueInspection.payTo}`);
  }
  const expectedAnswer = agentCommerce ? "ENABLE AND REGISTER" : "REGISTER";
  const answer = await readVisible(`Type ${expectedAnswer} to continue: `);
  if (answer !== expectedAnswer) {
    throw new Error("Setup cancelled; nothing was broadcast");
  }

  await writeSetupFile(values.output, initialSetup, true);
  if (agentCommerce) {
    for (const { key, chain } of PAYMENT_CHAINS) {
      await submitSavedRevenueSplit({
        output: values.output,
        chainKey: key,
        chainName: chain.name,
        client: paymentPublicClients[key],
      });
    }
  }

  await submitSavedGaslessRegistration({
    output: values.output,
    nodeUrl: setupNodeUrl,
  });

  console.log("\nGasless app key confirmed; deployment can continue.");
  console.log(`App-key message     ${registrationHash}`);
  if (agentCommerce) console.log("Payment rails       Celo USDC + Base USDC");
  console.log(
    usingRecoveryKit
      ? "Custody phrase      encrypted locally; never uploaded"
      : "Custody phrase      discarded; it is not present in the output file",
  );
  console.log("Next                deployment continues automatically");
}

type CustodyAccount = ReturnType<typeof mnemonicToAccount>;

export function registrationFundingTarget(
  registrationPrice: bigint,
  gasPrice: bigint,
): bigint {
  const dynamicReserve = gasPrice * 600_000n * 3n;
  const gasReserve =
    dynamicReserve > MINIMUM_REGISTRATION_GAS_RESERVE
      ? dynamicReserve
      : MINIMUM_REGISTRATION_GAS_RESERVE;
  return registrationPrice + gasReserve;
}

export async function submitSavedFidRegistration({
  pendingPath,
  accountAddress,
  client,
}: {
  pendingPath: string;
  accountAddress: string;
  client: RegistrationClient;
}): Promise<Hex> {
  const pending = await readFile(pendingPath, "utf8");
  const savedAddress = envValue(pending, "FID_REGISTRATION_ADDRESS");
  const savedHash = envValue(pending, "FID_REGISTRATION_TX");
  const savedTransaction = envValue(pending, "FID_REGISTRATION_RAW_TX");
  if (
    savedAddress?.toLowerCase() !== accountAddress.toLowerCase() ||
    !savedHash?.match(/^0x[0-9a-fA-F]{64}$/) ||
    !savedTransaction?.match(/^0x(?:[0-9a-fA-F]{2})+$/)
  ) {
    throw new Error(
      `Account-registration recovery data is incomplete at ${pendingPath}`,
    );
  }

  const serializedTransaction = savedTransaction as Hex;
  const transactionHash = keccak256(serializedTransaction);
  if (transactionHash.toLowerCase() !== savedHash.toLowerCase()) {
    throw new Error("Saved account-registration transaction failed its checksum");
  }

  try {
    const rpcHash = await client.sendRawTransaction({ serializedTransaction });
    if (rpcHash.toLowerCase() !== transactionHash.toLowerCase()) {
      throw new Error(`RPC returned an unexpected transaction hash: ${rpcHash}`);
    }
    console.log(`Account transaction  ${transactionHash}`);
  } catch {
    console.error("\nThe broadcast response was inconclusive.");
    console.error(`The exact signed transaction remains in ${pendingPath}.`);
    console.error(`Receipt polling will continue; rerunning ${operatorCommand} client create safely resumes it.`);
  }

  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
      timeout: 300_000,
    });
  } catch (error) {
    console.error(`\nRecovery file        ${pendingPath}`);
    console.error(`Keep it and rerun ${operatorCommand} client create with IMPORT and the saved 12 words.`);
    throw error;
  }
  if (receipt.status !== "success") {
    throw new Error(
      `Account registration reverted; keep ${pendingPath} for diagnosis`,
    );
  }
  return transactionHash;
}

async function registerTestAccount<transport extends Transport>({
  account,
  client,
  pendingPath,
}: {
  account: CustodyAccount;
  client: PublicClient<transport, typeof optimism>;
  pendingPath: string;
}): Promise<bigint> {
  let serializedTransaction: Hex | undefined;
  let transactionHash: Hex | undefined;

  try {
    const pending = await readFile(pendingPath, "utf8");
    const savedAddress = envValue(pending, "FID_REGISTRATION_ADDRESS");
    const savedHash = envValue(pending, "FID_REGISTRATION_TX");
    const savedTransaction = envValue(pending, "FID_REGISTRATION_RAW_TX");
    if (
      savedAddress?.toLowerCase() !== account.address.toLowerCase() ||
      !savedHash?.match(/^0x[0-9a-fA-F]{64}$/) ||
      !savedTransaction?.match(/^0x(?:[0-9a-fA-F]{2})+$/)
    ) {
      throw new Error(
        `Account-registration recovery data is incomplete at ${pendingPath}`,
      );
    }
    serializedTransaction = savedTransaction as Hex;
    transactionHash = keccak256(serializedTransaction);
    if (transactionHash.toLowerCase() !== savedHash.toLowerCase()) {
      throw new Error("Saved account-registration transaction failed its checksum");
    }
    console.log(`\nResuming account registration  ${transactionHash}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  if (!serializedTransaction || !transactionHash) {
    const registrationPrice = await client.readContract({
      address: CONTRACTS.idGateway,
      abi: idGatewayAbi,
      functionName: "price",
    });
    const gasPrice = await client.getGasPrice();
    const requiredBalance = registrationFundingTarget(registrationPrice, gasPrice);

    console.log("\nNEW TEST ACCOUNT");
    console.log(`Address             ${account.address}`);
    console.log("Network             Optimism");
    console.log(`Send at least       ${formatEther(requiredBalance)} ETH`);
    console.log(`Registration price  ${formatEther(registrationPrice)} ETH`);
    console.log(`Gas reserve         ${formatEther(requiredBalance - registrationPrice)} ETH`);
    console.log("Bridge or buy ETH   https://app.optimism.io/bridge/deposit");
    console.log(
      `Check the address   https://optimistic.etherscan.io/address/${account.address}`,
    );
    console.log("\nSend ETH on the Optimism network, not Ethereum mainnet.");

    for (;;) {
      const balance = await client.getBalance({ address: account.address });
      if (balance >= requiredBalance) {
        console.log(`Balance confirmed   ${formatEther(balance)} ETH`);
        break;
      }
      console.log(
        `Current balance     ${formatEther(balance)} ETH (need ${formatEther(requiredBalance - balance)} more)`,
      );
      const check = await readVisible("After funding the address, type CHECK: ");
      if (check !== "CHECK") {
        throw new Error(
          `Setup stopped before account registration; rerun ${operatorCommand} client create and choose IMPORT`,
        );
      }
    }

    console.log("\nThis creates one FID with one storage unit.");
    console.log("Keep this disposable test account's recovery method private.");
    const answer = await readVisible("Type CREATE FID to sign and send the transaction: ");
    if (answer !== "CREATE FID") {
      throw new Error("Setup cancelled before the account transaction was signed");
    }

    const data = encodeFunctionData({
      abi: idGatewayAbi,
      functionName: "register",
      args: [zeroAddress],
    });
    const request = await client.prepareTransactionRequest({
      account,
      chain: optimism,
      to: CONTRACTS.idGateway,
      data,
      value: registrationPrice,
    });
    const { account: _account, chain: _chain, ...signableRequest } = request;
    serializedTransaction = await account.signTransaction(
      signableRequest as Parameters<typeof account.signTransaction>[0],
    );
    transactionHash = keccak256(serializedTransaction);

    await writeSetupFile(
      pendingPath,
      [
        `FID_REGISTRATION_ADDRESS=${account.address}`,
        `FID_REGISTRATION_TX=${transactionHash}`,
        `FID_REGISTRATION_RAW_TX=${serializedTransaction}`,
        "",
      ].join("\n"),
      true,
    );
  }

  await submitSavedFidRegistration({
    pendingPath,
    accountAddress: account.address,
    client,
  });

  const fid = await client.readContract({
    address: CONTRACTS.idRegistry,
    abi: idRegistryAbi,
    functionName: "idOf",
    args: [account.address],
  });
  if (fid === 0n) {
    throw new Error(
      `Registration confirmed but no FID was returned; keep ${pendingPath} and rerun ${operatorCommand} client create`,
    );
  }

  await unlink(pendingPath).catch(() => undefined);
  console.log(`Farcaster account    created as FID ${fid}`);
  return fid;
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

async function assertStorage(
  fid: number,
  nodeUrl: string,
  attempts = 60,
  delayMs = 2_000,
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(
        `${nodeUrl.replace(/\/$/, "")}/v1/storageLimitsByFid?fid=${fid}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (response.ok) {
        const data = (await response.json()) as { units?: number };
        if (data.units && data.units >= 1) {
          console.log(`Storage units     ${data.units}`);
          return;
        }
      }
    } catch {
      // A newly registered account can take a moment to reach the local node.
    }

    if (attempt === 1) {
      console.log("Waiting for the new account and storage to reach your node...");
    }
    if (attempt < attempts) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `FID ${fid} storage is not visible on your node yet. Keep the working directory and rerun ${operatorCommand} client create.`,
  );
}

function printHeader(agentCommerce: boolean) {
  console.log("\nIN THREE / ACCOUNT + APP KEY");
  console.log("Developer build: create or import a disposable test account.");
  console.log("The phrase stays local and is never sent to the server.");
  console.log("Only a scoped, gasless Ed25519 app key is deployed.");
  if (agentCommerce) {
    console.log("Celo and Base facilitator credentials stay in the payment gateway.");
  }
  console.log();
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
