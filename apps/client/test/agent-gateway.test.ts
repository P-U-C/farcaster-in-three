import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import type { FacilitatorClient } from "@x402/core/server";
import {
  createAgentGateway,
  createAgentPaymentRoutes,
  hasAgentWriteCapability,
  loadAgentGatewaySettings,
} from "../src/agent-gateway.js";
import { PUC_ROYALTY_ADDRESS } from "../src/revenue.js";

const token = "agent-capability-token-that-is-long-enough";
const payTo = "0x000000000000000000000000000000000000c0Fe";
const environment: NodeJS.ProcessEnv = {
  AGENT_GATEWAY_PORT: "3334",
  AGENT_CLIENT_UPSTREAM: "http://127.0.0.1:9",
  AGENT_DEPLOYMENT_UPSTREAM: "http://127.0.0.1:9",
  AGENT_PUBLIC_ORIGIN: "https://client.example",
  AGENT_WRITE_TOKEN: token,
  BUY_OPERATOR_PAY_TO: "0x1111111111111111111111111111111111111111",
  BUY_PAY_TO: payTo,
  BUY_ROYALTY_PAY_TO: PUC_ROYALTY_ADDRESS,
  BUY_ROYALTY_BPS: "500",
  BUY_FACILITATOR_URL: "https://api.x402.celo.org",
  BUY_FACILITATOR_API_KEY: "x402_test_facilitator_key",
  CDP_API_KEY_ID: "organizations/test/apiKeys/test",
  CDP_API_KEY_SECRET_B64: Buffer.from(
    "test-secret-that-is-long-enough-to-pass-validation",
  ).toString("base64"),
  BUY_AGENT_READ_PRICE: "0.005 USDC",
  BUY_AGENT_METADATA_PRICE: "0.002 USDC",
  BUY_AGENT_WRITE_PRICE: "0.02 USDC",
  BUY_DEPLOY_PRICE: "25 USDC",
};

const facilitator: FacilitatorClient = {
  async getSupported() {
    return {
      kinds: [
        { x402Version: 2, scheme: "exact", network: "eip155:42220" },
        { x402Version: 2, scheme: "exact", network: "eip155:8453" },
      ],
      extensions: [],
      signers: {},
    };
  },
  async verify() {
    throw new Error("verify should not run for an unpaid test request");
  },
  async settle() {
    throw new Error("settle should not run for an unpaid test request");
  },
};

function settings() {
  return loadAgentGatewaySettings(environment);
}

test("every paid route offers the same USDC price on Celo and Base", () => {
  const routes = createAgentPaymentRoutes(settings()) as Record<
    string,
    { accepts: Array<{ network: string; payTo: string; price: string; extra?: Record<string, unknown> }> }
  >;

  assert.equal(routes["GET /agent/v1/profile"]?.accepts[0]?.price, "$0.002");
  assert.equal(routes["GET /agent/v1/feed"]?.accepts[0]?.price, "$0.005");
  assert.equal(routes["POST /agent/v1/casts"]?.accepts[0]?.price, "$0.02");
  assert.equal(routes["POST /agent/v1/deployments"]?.accepts[0]?.price, "$25");

  for (const route of Object.values(routes)) {
    assert.deepEqual(
      route.accepts.map((option) => option.network),
      ["eip155:42220", "eip155:8453"],
    );
    assert.ok(route.accepts.every((option) => option.payTo === payTo));
  }

  assert.ok(
    routes["POST /agent/v1/deployments"]?.accepts.every(
      (option) => option.extra?.paymentFlow === "upfront",
    ),
  );
});

test("write capabilities require an exact bearer token", () => {
  assert.equal(hasAgentWriteCapability(undefined, token), false);
  assert.equal(hasAgentWriteCapability("Bearer wrong-token", token), false);
  assert.equal(hasAgentWriteCapability(`bearer ${token}`, token), true);
});

test("gateway pins the Celo facilitator and P-U-C royalty policy", () => {
  assert.throws(
    () =>
      loadAgentGatewaySettings({
        ...environment,
        BUY_FACILITATOR_URL: "https://facilitator.example",
      }),
    /BUY_FACILITATOR_URL/,
  );
  assert.throws(
    () =>
      loadAgentGatewaySettings({
        ...environment,
        BUY_ROYALTY_BPS: "600",
      }),
    /BUY_ROYALTY_BPS must be 500/,
  );
  assert.throws(
    () =>
      loadAgentGatewaySettings({
        ...environment,
        BUY_ROYALTY_PAY_TO: "0x2222222222222222222222222222222222222222",
      }),
    /P-U-C royalty address/,
  );
});

test("gateway advertises both rails and authenticates writes before payment", async () => {
  const { server } = await createAgentGateway({
    settings: settings(),
    facilitators: [facilitator],
    log: () => undefined,
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  try {
    const manifest = await fetch(`${origin}/.well-known/agent.json`);
    assert.equal(manifest.status, 200);
    const manifestBody = (await manifest.json()) as {
      protocol?: { payment?: string; networks?: string[] };
      authorization?: { writes?: string };
      economics?: { royaltyBps?: number };
    };
    assert.equal(manifestBody.protocol?.payment, "x402");
    assert.deepEqual(manifestBody.protocol?.networks, [
      "eip155:42220",
      "eip155:8453",
    ]);
    assert.equal(manifestBody.economics?.royaltyBps, 500);
    assert.match(manifestBody.authorization?.writes ?? "", /Bearer capability/);

    const openapi = await fetch(`${origin}/agent/openapi.json`);
    assert.equal(openapi.status, 200);
    assert.equal(((await openapi.json()) as { openapi?: string }).openapi, "3.1.0");

    const read = await fetch(`${origin}/agent/v1/feed`);
    assert.equal(read.status, 402);
    assert.deepEqual(paymentNetworks(read), [
      "eip155:42220",
      "eip155:8453",
    ]);

    const deployment = await fetch(`${origin}/agent/v1/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deploymentId: "dep-0123456789abcdef0123456789abcdef",
        hetznerToken: "dedicated-hetzner-token-long-enough",
        sshPublicKey: `ssh-ed25519 ${Buffer.alloc(51, 7).toString("base64")}`,
        sourceCidr: "203.0.113.7/32",
      }),
    });
    assert.equal(deployment.status, 402);
    assert.deepEqual(paymentNetworks(deployment), [
      "eip155:42220",
      "eip155:8453",
    ]);

    const unauthenticatedWrite = await fetch(`${origin}/agent/v1/casts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(unauthenticatedWrite.status, 401);
    assert.equal(unauthenticatedWrite.headers.get("payment-required"), null);

    const quotedWrite = await fetch(`${origin}/agent/v1/casts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(quotedWrite.status, 402);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

function paymentNetworks(response: Response): string[] {
  const encoded = response.headers.get("payment-required");
  assert.ok(encoded, "missing PAYMENT-REQUIRED header");
  const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    accepts?: Array<{ network?: string }>;
  };
  return decoded.accepts?.map((option) => option.network ?? "") ?? [];
}
