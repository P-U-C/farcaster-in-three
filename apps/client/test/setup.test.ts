import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  normalizeCdpApiKeySecret,
  readClientPasswordFile,
  readHidden,
  registrationFundingTarget,
  readRecoveryKit,
  readVisible,
  submitSavedFidRegistration,
  submitSavedGaslessRegistration,
  submitSavedRevenueSplit,
  submitSignedRegistration,
  validateCdpApiKeyId,
  validateFacilitatorApiKey,
  writeRecoveryKit,
} from "../src/setup.js";
import {
  FarcasterNetwork,
  getFarcasterTime,
  makeKeyAdd,
  makeKeyAddBody,
  Message,
  MessageType,
  NobleEd25519Signer,
  ViemLocalEip712Signer,
} from "../src/farcaster-sdk.js";

function unwrap<T>(result: { _unsafeUnwrap(): T }): T {
  return result._unsafeUnwrap();
}

async function writeGaslessFixture(output: string) {
  const fid = 37;
  const signer = new NobleEd25519Signer(new Uint8Array(32).fill(7));
  const publicKey = unwrap(await signer.getSignerKey());
  const custody = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const body = unwrap(
    await makeKeyAddBody(
      {
        fid: BigInt(fid),
        key: publicKey,
        scopes: [
          MessageType.CAST_ADD,
          MessageType.CAST_REMOVE,
          MessageType.REACTION_ADD,
          MessageType.REACTION_REMOVE,
          MessageType.LINK_ADD,
          MessageType.LINK_REMOVE,
          MessageType.USER_DATA_ADD,
        ],
        ttl: 90 * 24 * 60 * 60,
        nonce: 1,
        deadline: unwrap(getFarcasterTime()) + 3_600,
      },
      new ViemLocalEip712Signer(custody),
    ),
  );
  const message = unwrap(
    await makeKeyAdd(
      body,
      { fid, network: FarcasterNetwork.MAINNET },
      signer,
    ),
  );
  const payload = Message.encode(message).finish();
  const publicKeyHex = `0x${Buffer.from(publicKey).toString("hex")}`;
  const messageHash = `0x${Buffer.from(message.hash).toString("hex")}`;

  await writeFile(
    output,
    [
      `FID=${fid}`,
      `SIGNER_PRIVATE_KEY=${"07".repeat(32)}`,
      `SIGNER_PUBLIC_KEY=${publicKeyHex}`,
      "SIGNER_REGISTRATION_MODE=gasless",
      "SIGNER_REGISTRATION_STATUS=signed",
      `SIGNER_REGISTRATION_MESSAGE_HASH=${messageHash}`,
      `SIGNER_REGISTRATION_PAYLOAD_SHA256=${createHash("sha256").update(payload).digest("hex")}`,
      `SIGNER_REGISTRATION_MESSAGE_B64=${Buffer.from(payload).toString("base64")}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  return { publicKeyHex, messageHash, payload };
}

test("new account funding includes the protocol price and a gas reserve", () => {
  assert.equal(
    registrationFundingTarget(5_000n, 1n),
    1_000_000_000_005_000n,
  );
  assert.equal(
    registrationFundingTarget(5_000n, 1_000_000_000_000n),
    1_800_000_000_000_005_000n,
  );
});

test("agent password files must be one owner-only line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "in-three-password-"));
  const path = join(directory, "client.password");
  try {
    await writeFile(path, "agent-generated-password\n", { mode: 0o600 });
    assert.equal(await readClientPasswordFile(path), "agent-generated-password");
    await writeFile(path, "first line\nsecond line\n", { mode: 0o600 });
    await assert.rejects(readClientPasswordFile(path), /exactly one line/);
    await chmod(path, 0o644);
    await assert.rejects(readClientPasswordFile(path), /chmod 600/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("generated account recovery is encrypted, owner-only, and resumable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "in-three-recovery-"));
  const path = join(directory, "test-account.recovery.json");
  const mnemonic = "test test test test test test test test test test test junk";
  const password = "correct horse battery staple";

  try {
    await writeRecoveryKit(path, mnemonic, password);
    const raw = await readFile(path, "utf8");
    assert.doesNotMatch(raw, /test test test/);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal(await readRecoveryKit(path, password), mnemonic);
    await assert.rejects(
      readRecoveryKit(path, "a different long password"),
      /same client password/,
    );
    await assert.rejects(
      writeRecoveryKit(path, mnemonic, password),
      (error: NodeJS.ErrnoException) => error.code === "EEXIST",
    );
    await chmod(path, 0o644);
    await assert.rejects(readRecoveryKit(path, password), /chmod 600/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("new account registration preserves signed bytes across an ambiguous broadcast", async () => {
  const directory = await mkdtemp(join(tmpdir(), "in-three-account-"));
  const pendingPath = join(directory, "client.env.pending.fid-registration");
  const accountAddress = "0x1111111111111111111111111111111111111111";
  const serializedTransaction = "0x02beef" as const;
  const transactionHash = keccak256(serializedTransaction);

  try {
    await writeFile(
      pendingPath,
      [
        `FID_REGISTRATION_ADDRESS=${accountAddress}`,
        `FID_REGISTRATION_TX=${transactionHash}`,
        `FID_REGISTRATION_RAW_TX=${serializedTransaction}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    const confirmedHash = await submitSavedFidRegistration({
      pendingPath,
      accountAddress,
      client: {
        async sendRawTransaction() {
          const persistedBeforeBroadcast = await readFile(pendingPath, "utf8");
          assert.match(persistedBeforeBroadcast, /FID_REGISTRATION_RAW_TX=0x02beef/);
          throw new Error("response lost after RPC accepted the transaction");
        },
        async waitForTransactionReceipt({ hash }) {
          assert.equal(hash, transactionHash);
          return { status: "success" as const };
        },
      },
    });

    assert.equal(confirmedHash, transactionHash);
    assert.match(
      await readFile(pendingPath, "utf8"),
      /FID_REGISTRATION_RAW_TX=0x02beef/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("facilitator keys are validated before the custody phrase is requested", () => {
  assert.equal(
    validateFacilitatorApiKey("  x402_test_facilitator_key  "),
    "x402_test_facilitator_key",
  );
  assert.throws(
    () => validateFacilitatorApiKey("not-a-facilitator-key"),
    /must start with x402_/,
  );
});

test("CDP credentials accept resource IDs and escaped PEM newlines", () => {
  assert.equal(
    validateCdpApiKeyId(
      "organizations/11111111-1111-1111-1111-111111111111/apiKeys/22222222-2222-2222-2222-222222222222",
    ),
    "organizations/11111111-1111-1111-1111-111111111111/apiKeys/22222222-2222-2222-2222-222222222222",
  );
  assert.equal(
    normalizeCdpApiKeySecret(
      "-----BEGIN PRIVATE KEY-----\\nlong-enough-test-material\\n-----END PRIVATE KEY-----",
    ),
    "-----BEGIN PRIVATE KEY-----\nlong-enough-test-material\n-----END PRIVATE KEY-----",
  );
  assert.throws(() => validateCdpApiKeyId("short"), /not in a recognized format/);
});

test("terminal input helpers pause stdin after each answer", async () => {
  const visibleInput = new PassThrough() as unknown as NodeJS.ReadStream;
  const visibleOutput = new PassThrough() as unknown as NodeJS.WriteStream;
  const visible = readVisible("Confirm: ", visibleInput, visibleOutput);
  visibleInput.write("REGISTER\n");
  assert.equal(await visible, "REGISTER");
  assert.equal(visibleInput.isPaused(), true);

  const hiddenInput = new PassThrough() as unknown as NodeJS.ReadStream;
  const hiddenOutput = new PassThrough() as unknown as NodeJS.WriteStream;
  const rawModes: boolean[] = [];
  Object.defineProperties(hiddenInput, {
    isTTY: { value: true, configurable: true },
    isRaw: { value: false, writable: true, configurable: true },
    setRawMode: {
      value: (mode: boolean) => {
        rawModes.push(mode);
        return hiddenInput;
      },
      configurable: true,
    },
  });
  const hidden = readHidden("Secret: ", hiddenInput, hiddenOutput);
  hiddenInput.write("correct horse\r");
  assert.equal(await hidden, "correct horse");
  assert.equal(hiddenInput.isPaused(), true);
  assert.deepEqual(rawModes, [true, false]);
});

test("visible input allows a setup subprocess to exit", () => {
  const program = [
    'import { readVisible } from "./src/setup.ts";',
    'const answer = await readVisible("");',
    'if (answer !== "REGISTER") process.exitCode = 2;',
  ].join("\n");
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", program],
    {
      cwd: new URL("../", import.meta.url),
      input: "REGISTER\n",
      timeout: 3_000,
      encoding: "utf8",
    },
  );

  assert.notEqual((result.error as NodeJS.ErrnoException | undefined)?.code, "ETIMEDOUT");
  assert.equal(result.status, 0, result.stderr);
});

test("an uncertain gasless submission confirms from the owned read node", async () => {
  const directory = await mkdtemp(join(tmpdir(), "in-three-gasless-"));
  const output = join(directory, "client.env.pending");

  try {
    const fixture = await writeGaslessFixture(output);
    let signerVisible = false;
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/v1/signersByFid")) {
        return Response.json({
          signers: signerVisible
            ? [{ source: "SIGNER_SOURCE_OFFCHAIN", key: fixture.publicKeyHex }]
            : [],
          gaslessSignerCount: signerVisible ? 1 : 0,
          gaslessSignerLimit: 1000,
          currentUserNonce: signerVisible ? 1 : 0,
        });
      }
      if (url.endsWith("/v1/submitMessage") && init?.method === "POST") {
        assert.deepEqual(Buffer.from(init.body as Uint8Array), Buffer.from(fixture.payload));
        signerVisible = true;
        throw new Error("response lost after relay");
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const messageHash = await submitSavedGaslessRegistration({
      output,
      nodeUrl: "http://127.0.0.1:3381",
      fetchImpl,
      pollAttempts: 1,
      pollDelayMs: 0,
    });
    assert.equal(messageHash, fixture.messageHash);

    const saved = await readFile(output, "utf8");
    assert.match(saved, /SIGNER_REGISTRATION_STATUS=confirmed/);
    assert.doesNotMatch(saved, /SIGNER_REGISTRATION_MESSAGE_B64=/);
    assert.doesNotMatch(saved, /SIGNER_REGISTRATION_PAYLOAD_SHA256=/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unconfirmed gasless submissions preserve the exact signed message", async () => {
  const directory = await mkdtemp(join(tmpdir(), "in-three-gasless-"));
  const output = join(directory, "client.env.pending");

  try {
    await writeGaslessFixture(output);
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/v1/signersByFid")) {
        return Response.json({
          signers: [],
          gaslessSignerCount: 0,
          gaslessSignerLimit: 1000,
          currentUserNonce: 0,
        });
      }
      throw new Error("read node disconnected");
    }) as typeof fetch;

    await assert.rejects(
      submitSavedGaslessRegistration({
        output,
        nodeUrl: "http://127.0.0.1:3381",
        fetchImpl,
        pollAttempts: 1,
        pollDelayMs: 0,
      }),
      /Keep the recovery file/,
    );

    const saved = await readFile(output, "utf8");
    assert.match(saved, /SIGNER_REGISTRATION_STATUS=signed/);
    assert.match(saved, /SIGNER_REGISTRATION_MESSAGE_B64=/);
    assert.match(saved, /SIGNER_PRIVATE_KEY=/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ambiguous revenue broadcasts preserve the exact signed transaction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "in-three-revenue-"));
  const output = join(directory, "client.env.pending");
  const serializedTransaction = "0x02beef" as const;
  const transactionHash = keccak256(serializedTransaction);

  try {
    await writeFile(
      output,
      [
        "FID=37",
        "REVENUE_CELO_STATUS=signed",
        "REVENUE_CELO_ADDRESS=0x1111111111111111111111111111111111111111",
        `REVENUE_CELO_TX=${transactionHash}`,
        `REVENUE_CELO_RAW_TX=${serializedTransaction}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );

    await assert.rejects(
      submitSavedRevenueSplit({
        output,
        chainKey: "celo",
        chainName: "Celo",
        client: {
          async sendRawTransaction() {
            const persistedBeforeBroadcast = await readFile(output, "utf8");
            assert.match(persistedBeforeBroadcast, /REVENUE_CELO_RAW_TX=0x02beef/);
            throw new Error("RPC disconnected after accepting the transaction");
          },
          async waitForTransactionReceipt() {
            throw new Error("receipt timeout");
          },
        },
      }),
      /receipt timeout/,
    );

    const saved = await readFile(output, "utf8");
    assert.match(saved, /REVENUE_CELO_STATUS=signed/);
    assert.match(saved, /REVENUE_CELO_RAW_TX=0x02beef/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("ambiguous registration broadcasts preserve the key and signed transaction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "in-three-registration-"));
  const output = join(directory, "client.env.pending");
  const serializedTransaction = "0x02abcd" as const;
  const transactionHash = keccak256(serializedTransaction);

  try {
    await assert.rejects(
      submitSignedRegistration({
        output,
        baseEnv: ["FID=37", "SIGNER_PRIVATE_KEY=delegated-key"],
        serializedTransaction,
        createOnly: true,
        client: {
          async sendRawTransaction() {
            const persistedBeforeBroadcast = await readFile(output, "utf8");
            assert.match(persistedBeforeBroadcast, /SIGNER_PRIVATE_KEY=delegated-key/);
            assert.match(persistedBeforeBroadcast, /SIGNER_REGISTRATION_RAW_TX=0x02abcd/);
            throw new Error("RPC disconnected after accepting the transaction");
          },
          async waitForTransactionReceipt() {
            throw new Error("receipt timeout");
          },
        },
      }),
      /receipt timeout/,
    );

    const saved = await readFile(output, "utf8");
    assert.match(saved, /SIGNER_PRIVATE_KEY=delegated-key/);
    assert.match(saved, /SIGNER_REGISTRATION_STATUS=signed/);
    assert.match(saved, new RegExp(`SIGNER_REGISTRATION_TX=${transactionHash}`));
    assert.match(saved, /SIGNER_REGISTRATION_RAW_TX=0x02abcd/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an uncertain broadcast can still confirm by its locally calculated hash", async () => {
  const directory = await mkdtemp(join(tmpdir(), "in-three-registration-"));
  const output = join(directory, "client.env.pending");

  try {
    const transactionHash = await submitSignedRegistration({
      output,
      baseEnv: ["FID=37", "SIGNER_PRIVATE_KEY=delegated-key"],
      serializedTransaction: "0x02cafe",
      createOnly: true,
      client: {
        async sendRawTransaction() {
          throw new Error("response lost");
        },
        async waitForTransactionReceipt() {
          return { status: "success" as const };
        },
      },
    });

    assert.equal(transactionHash, keccak256("0x02cafe"));
    const saved = await readFile(output, "utf8");
    assert.match(saved, /SIGNER_REGISTRATION_STATUS=confirmed/);
    assert.doesNotMatch(saved, /SIGNER_REGISTRATION_RAW_TX=/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
