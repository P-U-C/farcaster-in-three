import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { claimFname, validateFname } from "../src/profile.js";

test("fname validation accepts the In Three name and rejects malformed names", () => {
  assert.equal(validateFname(" In-Three "), "in-three");
  assert.throws(() => validateFname("-in-three"), /1-16 lowercase/);
  assert.throws(() => validateFname("in_three"), /1-16 lowercase/);
  assert.throws(() => validateFname("this-name-is-far-too-long"), /1-16 lowercase/);
});

test("fname claims are availability checked, signed locally, and idempotent", async () => {
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.endsWith("/transfers/current?fid=37")) {
      return new Response('{"error":"Could not resolve current name"}', { status: 404 });
    }
    if (url.endsWith("/transfers/current?name=in-three")) {
      return new Response('{"error":"Could not resolve current name"}', { status: 404 });
    }
    if (url.endsWith("/current-time")) {
      return Response.json({ currentTime: 1_800_000_000 });
    }
    if (url.endsWith("/transfers") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      assert.equal(body.name, "in-three");
      assert.equal(body.from, 0);
      assert.equal(body.to, 37);
      assert.equal(body.fid, 37);
      assert.equal(body.owner, account.address);
      assert.equal(body.timestamp, 1_800_000_000);
      assert.match(String(body.signature), /^0x[0-9a-f]{130}$/);
      return Response.json({ transfer: { username: "in-three", to: 37 } });
    }
    return new Response("unexpected request", { status: 500 });
  }) as typeof fetch;

  assert.deepEqual(
    await claimFname({ username: "in-three", fid: 37, account, fetchImpl }),
    { status: "claimed", username: "in-three" },
  );
  assert.equal(requests.length, 4);

  const idempotentFetch = (async () =>
    Response.json({ transfer: { username: "in-three", to: 37 } })) as typeof fetch;
  assert.deepEqual(
    await claimFname({
      username: "in-three",
      fid: 37,
      account,
      fetchImpl: idempotentFetch,
    }),
    { status: "already-owned", username: "in-three" },
  );
});
