import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { encodeAbiParameters } from "viem";
import { SnapchainReader } from "../src/snapchain.js";

function json(response: import("node:http").ServerResponse, value: unknown) {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

test("feed data and client attribution come only from the configured read node", async (context) => {
  const requested: string[] = [];
  const metadata = encodeAbiParameters(
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
    [
      {
        requestFid: 99n,
        requestSigner: "0x1111111111111111111111111111111111111111",
        signature: "0x1234",
        deadline: 2_000_000_000n,
      },
    ],
  );
  const metadataBase64 = Buffer.from(metadata.slice(2), "hex").toString("base64");

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    requested.push(url.pathname);
    const fid = Number(url.searchParams.get("fid"));

    if (url.pathname === "/v1/linksByFid") {
      return json(response, {
        messages: [{ data: { linkBody: { type: "follow", targetFid: 2 } } }],
      });
    }
    if (url.pathname === "/v1/castsByFid") {
      return json(response, {
        messages: [
          {
            data: {
              type: "MESSAGE_TYPE_CAST_ADD",
              fid,
              timestamp: fid === 2 ? 200 : 100,
              castAddBody: { text: `cast by ${fid}`, embeds: [] },
            },
            hash: `0x${String(fid).padStart(40, "0")}`,
            signer: `0x${"22".repeat(32)}`,
          },
        ],
      });
    }
    if (url.pathname === "/v1/userDataByFid") {
      return json(response, {
        messages: [
          {
            data: {
              userDataBody: {
                type: "USER_DATA_TYPE_USERNAME",
                value: `user${fid}`,
              },
            },
          },
        ],
      });
    }
    if (url.pathname === "/v1/onChainSignersByFid") {
      return json(response, {
        events: [
          {
            signerEventBody: {
              key: `0x${"22".repeat(32)}`,
              eventType: "SIGNER_EVENT_TYPE_ADD",
              metadataType: 1,
              metadata: metadataBase64,
            },
          },
        ],
      });
    }
    response.statusCode = 404;
    return json(response, {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const reader = new SnapchainReader(`http://127.0.0.1:${port}`);

  const feed = await reader.feed(1);
  assert.equal(feed.length, 2);
  assert.equal(feed[0]?.fid, 2);
  assert.equal(feed[0]?.profile.username, "user2");
  assert.equal(feed[1]?.fid, 1);

  const requestFid = await reader.requestFidForSigner(2, `0x${"22".repeat(32)}`);
  assert.equal(requestFid, 99);
  assert.ok(requested.every((path) => path.startsWith("/v1/")));
});
