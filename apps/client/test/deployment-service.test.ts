import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createDeploymentApp,
  FileDeploymentEntitlementStore,
  renderDeploymentCloudInit,
  type DeploymentEntitlementStore,
  type DeploymentReleaseFiles,
  type DeploymentRequest,
} from "../src/deployment-service.js";

const token = "hetzner-project-token-that-is-long-enough";
const deploymentId = "dep-0123456789abcdef0123456789abcdef";
const sshPublicKey = `ssh-ed25519 ${Buffer.alloc(51, 7).toString("base64")} paid-deploy@test`;
const requestBody = {
  deploymentId,
  hetznerToken: token,
  sshPublicKey,
  sourceCidr: "203.0.113.7/32",
};
const releaseFiles: DeploymentReleaseFiles = {
  compose: 'services:\n  snapchain:\n    image: "farcasterxyz/snapchain:test"\n',
  caddy: "{$CLIENT_DOMAIN} { reverse_proxy client:3333 }\n",
  entrypoint: "#!/usr/bin/env bash\nexec /usr/local/bin/snapchain\n",
  validators: "[[consensus.validator_sets]]\neffective_at = 0\n",
};

function memoryEntitlements(): DeploymentEntitlementStore {
  const entries = new Map<string, DeploymentRequest>();
  return {
    async authorize(input) {
      const existing = entries.get(input.deploymentId);
      if (
        existing &&
        (existing.hetznerToken !== input.hetznerToken ||
          existing.sshPublicKey !== input.sshPublicKey ||
          existing.sourceCidr !== input.sourceCidr)
      ) {
        throw new Error("conflict");
      }
      entries.set(input.deploymentId, input);
    },
    async has(input) {
      const existing = entries.get(input.deploymentId);
      if (!existing || existing.hetznerToken !== input.hetznerToken) return false;
      return !("sshPublicKey" in input) ||
        (existing.sshPublicKey === input.sshPublicKey &&
          existing.sourceCidr === input.sourceCidr);
    },
  };
}

test("deployment preflight validates the fixed plan without returning the cloud token", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const app = createDeploymentApp({
    releaseFiles,
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (method === "POST" && url.endsWith("/ssh_keys")) {
        return Response.json({ ssh_key: { id: 91, name: "preflight" } });
      }
      if (method === "DELETE" && url.endsWith("/ssh_keys/91")) {
        return new Response(null, { status: 204 });
      }
      return Response.json({
        server_types: [
          {
            name: "ccx33",
            cores: 8,
            memory: 32,
            prices: [
              {
                location: "ash",
                price_hourly: { gross: "0.40" },
                price_monthly: { gross: "265.00" },
              },
            ],
          },
        ],
      });
    },
  });

  const response = await app.request("/agent/v1/deployments/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.doesNotMatch(body, new RegExp(token));
  assert.match(body, /"serverType":"ccx33"/);
  assert.match(body, /"volumeSizeGiB":2048/);
  assert.equal(requests[0]?.authorization, `Bearer ${token}`);
  assert.equal(requests.length, 3);
  assert.match(requests[1]?.url ?? "", /\/ssh_keys$/);
  assert.match(requests[2]?.url ?? "", /\/ssh_keys\/91$/);
});

test("one deployment request creates the fixed resources and is idempotent", async () => {
  const state: {
    server?: Record<string, unknown>;
    volume?: Record<string, unknown>;
    firewall?: Record<string, unknown>;
    sshKey?: Record<string, unknown>;
  } = {};
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];

  const fetchImpl: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    const body = init?.body
      ? JSON.parse(String(init.body)) as Record<string, unknown>
      : undefined;
    calls.push({ method, url, body });

    if (method === "GET" && url.includes("/servers?")) {
      return Response.json({ servers: state.server ? [state.server] : [] });
    }
    if (method === "GET" && url.includes("/volumes?")) {
      return Response.json({ volumes: state.volume ? [state.volume] : [] });
    }
    if (method === "GET" && url.includes("/firewalls?")) {
      return Response.json({ firewalls: state.firewall ? [state.firewall] : [] });
    }
    if (method === "GET" && url.includes("/ssh_keys?")) {
      return Response.json({ ssh_keys: state.sshKey ? [state.sshKey] : [] });
    }
    if (method === "POST" && url.endsWith("/ssh_keys")) {
      state.sshKey = { id: 11, name: "in-three-01234567" };
      return Response.json({ ssh_key: state.sshKey });
    }
    if (method === "POST" && url.endsWith("/volumes")) {
      state.volume = { id: 22, name: "in-three-01234567-data", server: null };
      return Response.json({ volume: state.volume });
    }
    if (method === "POST" && url.endsWith("/firewalls")) {
      state.firewall = { id: 33, name: "in-three-01234567" };
      return Response.json({ firewall: state.firewall });
    }
    if (method === "POST" && url.endsWith("/servers")) {
      state.server = {
        id: 44,
        name: "in-three-01234567",
        status: "initializing",
        public_net: { ipv4: { ip: "203.0.113.10" } },
      };
      return Response.json({ server: state.server });
    }
    if (method === "POST" && url.endsWith("/volumes/22/actions/attach")) {
      if (state.volume) state.volume.server = 44;
      return Response.json({ action: { status: "running" } });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const entitlementStore = memoryEntitlements();
  const app = createDeploymentApp({ releaseFiles, fetchImpl, entitlementStore });
  const unauthorizedResume = await app.request("/agent/v1/deployments/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  assert.equal(unauthorizedResume.status, 403);

  const paidRequest = () => app.request("/agent/v1/deployments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const [first, concurrent] = await Promise.all([paidRequest(), paidRequest()]);
  assert.equal(first.status, 201);
  assert.equal(concurrent.status, 201);
  const firstBody = await first.json() as {
    created?: boolean;
    server?: { ip?: string };
    resources?: { volumeId?: number };
  };
  assert.equal(firstBody.created, true);
  assert.equal(firstBody.server?.ip, "203.0.113.10");
  assert.equal(firstBody.resources?.volumeId, 22);

  const serverCreate = calls.find(
    (call) => call.method === "POST" && call.url.endsWith("/servers"),
  );
  assert.equal(serverCreate?.body?.server_type, "ccx33");
  assert.equal(serverCreate?.body?.location, "ash");
  assert.match(String(serverCreate?.body?.user_data), /in-three-ready/);
  assert.doesNotMatch(JSON.stringify(serverCreate?.body), new RegExp(token));

  const createCallsBeforeRetry = calls.filter(
    (call) =>
      call.method === "POST" &&
      ["/ssh_keys", "/volumes", "/firewalls", "/servers"].some((suffix) =>
        call.url.endsWith(suffix),
      ),
  ).length;
  assert.equal(createCallsBeforeRetry, 4);
  const second = await app.request("/agent/v1/deployments/resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  assert.equal(second.status, 200);
  assert.equal((await second.json() as { created?: boolean }).created, false);
  const createCallsAfterRetry = calls.filter(
    (call) =>
      call.method === "POST" &&
      ["/ssh_keys", "/volumes", "/firewalls", "/servers"].some((suffix) =>
        call.url.endsWith(suffix),
      ),
  ).length;
  assert.equal(createCallsAfterRetry, createCallsBeforeRetry);
});

test("paid deployment entitlements persist without retaining the cloud token", async () => {
  const root = await mkdtemp(join(tmpdir(), "in-three-entitlement-"));
  try {
    const store = new FileDeploymentEntitlementStore(root);
    await store.authorize(requestBody);
    assert.equal(
      await store.has({ deploymentId, hetznerToken: token }),
      true,
    );
    assert.equal(
      await store.has({ ...requestBody, sourceCidr: "198.51.100.4/32" }),
      false,
    );
    const [filename] = await readdir(root);
    assert.ok(filename);
    const persisted = await readFile(join(root, filename), "utf8");
    assert.doesNotMatch(persisted, new RegExp(token));
    assert.match(persisted, /"tokenHash":"[a-f0-9]{64}"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generated cloud-init starts Snapchain and preserves remote shell variables", () => {
  const cloudInit = renderDeploymentCloudInit({
    publicKey: sshPublicKey,
    volumeId: 424242,
    files: releaseFiles,
  });
  assert.match(cloudInit, /docker compose up -d snapchain/);
  assert.match(cloudInit, /touch \/var\/lib\/cloud\/instance\/in-three-ready/);

  const mountFile = extractCloudFile(
    cloudInit,
    "/usr/local/sbin/mount-in-three-volume",
  );
  assert.match(mountFile, /scsi-0HC_Volume_424242/);
  assert.match(mountFile, /\[\[ -b "\$device" \]\]/);
  assert.match(
    mountFile,
    /install -m 0644 \/opt\/in-three-release\/docker-compose.yml/,
  );
  assert.match(mountFile, /chown 1000:1000 \/srv\/in-three\/data\/deployer/);

  const compose = extractCloudFile(
    cloudInit,
    "/opt/in-three-release/docker-compose.yml",
  );
  assert.equal(compose, releaseFiles.compose);
});

function extractCloudFile(cloudInit: string, path: string) {
  const escaped = path.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const match = cloudInit.match(
    new RegExp(
      `path: ${escaped}\\n(?:.*\\n){3}    content: ([A-Za-z0-9+/=]+)`,
    ),
  );
  assert.ok(match?.[1], `missing cloud-init file ${path}`);
  return Buffer.from(match[1], "base64").toString("utf8");
}
