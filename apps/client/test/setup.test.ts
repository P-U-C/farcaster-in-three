import assert from "node:assert/strict";
import test from "node:test";
import { decodeAbiParameters } from "viem";
import { encodeSignedKeyRequestMetadata } from "../src/setup.js";

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
