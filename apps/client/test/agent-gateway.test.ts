import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  createAgentGateway,
  createAgentPaywall,
  hasAgentWriteCapability,
  loadAgentGatewaySettings,
} from "../src/agent-gateway.js";

const token = "agent-capability-token-that-is-long-enough";
const environment: NodeJS.ProcessEnv = {
  AGENT_GATEWAY_PORT: "3334",
  AGENT_CLIENT_UPSTREAM: "http://127.0.0.1:9",
  AGENT_DEPLOYMENT_UPSTREAM: "http://127.0.0.1:9",
  AGENT_PUBLIC_ORIGIN: "https://client.example",
  AGENT_WRITE_TOKEN: token,
  BUY_PAY_TO: "0x000000000000000000000000000000000000c0Fe",
  BUY_FACILITATOR_URL: "https://api.x402.celo.org",
  BUY_FACILITATOR_API_KEY: "x402_test_facilitator_key",
  BUY_AGENT_READ_PRICE: "0.005 USDC",
  BUY_AGENT_METADATA_PRICE: "0.002 USDC",
  BUY_AGENT_WRITE_PRICE: "0.02 USDC",
  BUY_DEPLOY_PRICE: "25 USDC",
};

function settings() {
  return loadAgentGatewaySettings(environment);
}

test("agent paywall prices every operation in USDC and leaves health free", () => {
  const config = createAgentPaywall(settings());
  const byPath = new Map(config.endpoints.map((endpoint) => [endpoint.path, endpoint]));

  assert.equal(byPath.get("/agent/health")?.free, true);
  assert.equal(byPath.get("/agent/v1/profile")?.amount, "2000");
  assert.equal(byPath.get("/agent/v1/feed")?.amount, "5000");
  assert.equal(byPath.get("/agent/v1/casts")?.amount, "20000");
  assert.equal(byPath.get("/agent/v1/deployments")?.amount, "25000000");
  assert.equal(byPath.get("/agent/v1/deployments/preflight")?.free, true);
  assert.equal(byPath.get("/agent/v1/deployments/status")?.free, true);
  assert.equal(byPath.get("/agent/v1/deployments/resume")?.free, true);
  assert.deepEqual(config.tokens, ["USDC"]);
  assert.equal(config.network, "celo");
});

test("write capabilities require an exact bearer token", () => {
  assert.equal(hasAgentWriteCapability(undefined, token), false);
  assert.equal(hasAgentWriteCapability("Bearer wrong-token", token), false);
  assert.equal(hasAgentWriteCapability(`bearer ${token}`, token), true);
});

test("gateway pins the advertised Celo facilitator", () => {
  assert.throws(
    () =>
      loadAgentGatewaySettings({
        ...environment,
        BUY_FACILITATOR_URL: "https://facilitator.example",
      }),
    /BUY_FACILITATOR_URL/,
  );
});

test("gateway exposes discovery, charges reads, and authenticates writes before payment", async () => {
  const { server } = createAgentGateway({ settings: settings(), log: () => undefined });
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
      protocol?: { payment?: string; network?: string };
      authorization?: { writes?: string };
    };
    assert.equal(manifestBody.protocol?.payment, "x402");
    assert.equal(manifestBody.protocol?.network, "eip155:42220");
    assert.match(manifestBody.authorization?.writes ?? "", /Bearer capability/);

    const openapi = await fetch(`${origin}/agent/openapi.json`);
    assert.equal(openapi.status, 200);
    assert.equal(((await openapi.json()) as { openapi?: string }).openapi, "3.1.0");

    const read = await fetch(`${origin}/agent/v1/feed`);
    assert.equal(read.status, 402);

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

    const unauthenticatedWrite = await fetch(`${origin}/agent/v1/casts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    assert.equal(unauthenticatedWrite.status, 401);
    assert.equal(unauthenticatedWrite.headers.get("x-payment"), null);

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
