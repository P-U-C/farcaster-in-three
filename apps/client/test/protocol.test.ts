import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { Message, UserDataType } from "../src/farcaster-sdk.js";
import { FarcasterWriter } from "../src/protocol.js";

test("cast messages are protobuf encoded and relayed through the owned read node", async (context) => {
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
    READ_NODE_URL: `http://127.0.0.1:${port}`,
    WRITE_NODE_URL: `http://127.0.0.1:${port}`,
    COOKIE_SECURE: "false",
    cookieSecure: false,
  });

  const result = await writer.cast({ text: "A cast from my own node." });
  assert.equal(result.node, `http://127.0.0.1:${port}`);
  assert.equal(result.relay, "accepted");
  assert.match(result.hash, /^0x[0-9a-f]{40}$/);
  assert.equal(contentType, "application/octet-stream");
  assert.ok(received.length > 80);
});

test("profile updates use scoped user-data messages through the owned node", async (context) => {
  const received: Buffer[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      received.push(Buffer.concat(chunks));
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
    READ_NODE_URL: `http://127.0.0.1:${port}`,
    WRITE_NODE_URL: `http://127.0.0.1:${port}`,
    COOKIE_SECURE: "false",
    cookieSecure: false,
  });

  const receipts = await writer.updateProfile({
    displayName: "In Three",
    bio: "Farcaster from your own node.",
    pfpUrl: "https://farcaster.permanentupperclass.com/profile.png",
    username: "in-three",
  });

  assert.deepEqual(
    receipts.map(({ field }) => field),
    ["displayName", "bio", "pfpUrl", "username"],
  );
  assert.equal(received.length, 4);
  assert.deepEqual(
    received.map((payload) => Message.decode(payload).data?.userDataBody?.type),
    [UserDataType.DISPLAY, UserDataType.BIO, UserDataType.PFP, UserDataType.USERNAME],
  );
});
