import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PassThrough } from "node:stream";
import test from "node:test";
import { decodeAbiParameters } from "viem";
import {
  encodeSignedKeyRequestMetadata,
  readHidden,
  readVisible,
} from "../src/setup.js";

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
