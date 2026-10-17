import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { FarcasterWriter } from "../src/protocol.js";

test("cast messages are protobuf encoded and submitted to a validator", async (context) => {
  let received = Buffer.alloc(0);
  let contentType = "";
  const server = createServer((request, response) => {
    contentType = request.headers["content-type"] ?? "";
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      received = Buffer.concat(chunks);
      response.setHeader("content-type", "application/json");
      response.end('{"accepted":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());

  const port = (server.address() as AddressInfo).port;
  const writer = new FarcasterWriter({
    PORT: 3333,
    FID: 37,
    SIGNER_PRIVATE_KEY: "11".repeat(32),
    SIGNER_PUBLIC_KEY: `0x${"22".repeat(32)}`,
    PASSWORD_HASH: "x".repeat(32),
    SESSION_SECRET: "y".repeat(32),
    READ_NODE_URL: "http://127.0.0.1:3381",
    VALIDATOR_URLS: `http://127.0.0.1:${port}`,
    COOKIE_SECURE: "false",
    validatorUrls: [`http://127.0.0.1:${port}`],
    cookieSecure: false,
  });

  const result = await writer.cast({ text: "A cast from my own node." });
  assert.equal(result.validator, `http://127.0.0.1:${port}`);
  assert.match(result.hash, /^0x[0-9a-f]{40}$/);
  assert.equal(contentType, "application/octet-stream");
  assert.ok(received.length > 80);
});
