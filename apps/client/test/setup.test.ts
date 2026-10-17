import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { decodeAbiParameters, keccak256 } from "viem";
import {
  encodeSignedKeyRequestMetadata,
  readHidden,
  readVisible,
  submitSignedRegistration,
  validateFacilitatorApiKey,
} from "../src/setup.js";

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

test("signed key request metadata matches the Farcaster contract tuple", () => {
  const encoded = encodeSignedKeyRequestMetadata({
    requestFid: 37n,
    requestSigner: "0x1111111111111111111111111111111111111111",
    signature: `0x${"ab".repeat(65)}`,
    deadline: 2_000_000_000n,
  });

  const [decoded] = decodeAbiParameters(
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
    encoded,
  );

  assert.equal(decoded.requestFid, 37n);
  assert.equal(decoded.requestSigner, "0x1111111111111111111111111111111111111111");
  assert.equal(decoded.signature, `0x${"ab".repeat(65)}`);
  assert.equal(decoded.deadline, 2_000_000_000n);
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
