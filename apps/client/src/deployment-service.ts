import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z, ZodError } from "zod";

const HETZNER_API = "https://api.hetzner.cloud/v1";
const DEPLOYMENT_PORT = 3335;
const PLAN = {
  location: "ash",
  serverType: "ccx33",
  volumeSizeGiB: 2048,
  image: "ubuntu-24.04",
} as const;

const deploymentIdSchema = z
  .string()
  .min(20)
  .max(63)
  .regex(/^dep-[a-z0-9]+$/);
const hetznerTokenSchema = z.string().min(20).max(512).regex(/^\S+$/);
const sshPublicKeySchema = z
  .string()
  .min(80)
  .max(512)
  .regex(/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?$/);
const sourceCidrSchema = z.string().refine(isCidr, "sourceCidr must be one IPv4 or IPv6 CIDR");

const deploymentRequestSchema = z
  .object({
    deploymentId: deploymentIdSchema,
    hetznerToken: hetznerTokenSchema,
    sshPublicKey: sshPublicKeySchema,
    sourceCidr: sourceCidrSchema,
  })
  .strict();

const deploymentStatusSchema = z
  .object({
    deploymentId: deploymentIdSchema,
    hetznerToken: hetznerTokenSchema,
  })
  .strict();

export type DeploymentRequest = z.infer<typeof deploymentRequestSchema>;

export interface DeploymentReleaseFiles {
  compose: string;
  caddy: string;
  entrypoint: string;
  validators: string;
}

interface DeploymentEntitlement {
  schemaVersion: 1;
  deploymentId: string;
  tokenHash: string;
  sshPublicKey: string;
  sourceCidr: string;
  authorizedAt: string;
}

export interface DeploymentEntitlementStore {
  authorize(input: DeploymentRequest): Promise<void>;
  has(input: { deploymentId: string; hetznerToken: string } | DeploymentRequest): Promise<boolean>;
}

export function createDeploymentApp({
  fetchImpl = fetch,
  releaseFiles,
  entitlementStore = new FileDeploymentEntitlementStore(
    process.env.IN_THREE_DEPLOY_STATE_ROOT ?? "/var/lib/in-three-deployer",
  ),
}: {
  fetchImpl?: typeof fetch;
  releaseFiles?: DeploymentReleaseFiles;
  entitlementStore?: DeploymentEntitlementStore;
} = {}) {
  const app = new Hono();
  const provisioning = new Map<string, Promise<ProvisionResult>>();
  const filesPromise = releaseFiles
    ? Promise.resolve(releaseFiles)
    : loadDeploymentReleaseFiles();

  app.get("/health", (context) =>
    context.json({ ok: true, service: "in-three-deployer", plan: PLAN }),
  );

  app.post("/agent/v1/deployments/preflight", async (context) => {
    const input = deploymentRequestSchema.parse(await context.req.json());
    const client = new HetznerClient(input.hetznerToken, fetchImpl);
    const plan = await client.preflight(input.deploymentId);
    return context.json({
      ok: true,
      deploymentId: input.deploymentId,
      plan,
      billing: {
        deployment: "one x402 payment to the broker",
        infrastructure: "billed separately by Hetzner until destroyed",
      },
      secrets: {
        cloudToken: "used in memory; only its SHA-256 entitlement binding persists after payment",
        sshPrivateKey: "never received",
        custodyPhrase: "never received",
      },
    });
  });

  app.post("/agent/v1/deployments/status", async (context) => {
    const input = deploymentStatusSchema.parse(await context.req.json());
    const client = new HetznerClient(input.hetznerToken, fetchImpl);
    const deployment = await client.findDeployment(input.deploymentId);
    if (!deployment.server) {
      const authorized = await entitlementStore.has(input);
      return context.json(
        {
          ok: false,
          deploymentId: input.deploymentId,
          phase: deployment.hasResources
            ? "partial"
            : authorized
              ? "authorized"
              : "not_found",
          resumable: authorized,
        },
        404,
      );
    }
    return context.json(publicDeployment(input.deploymentId, deployment, false));
  });

  app.post("/agent/v1/deployments/resume", async (context) => {
    const input = deploymentRequestSchema.parse(await context.req.json());
    if (!(await entitlementStore.has(input))) {
      return context.json(
        { error: "No matching paid deployment entitlement" },
        403,
      );
    }
    return provisionResponse(input, fetchImpl, await filesPromise, provisioning);
  });

  app.post("/agent/v1/deployments", async (context) => {
    const input = deploymentRequestSchema.parse(await context.req.json());
    await entitlementStore.authorize(input);
    return provisionResponse(input, fetchImpl, await filesPromise, provisioning);
  });

  app.onError((error, context) => {
    if (error instanceof ZodError) {
      return context.json(
        {
          error: "Invalid deployment request",
          issues: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        400,
      );
    }
    if (error instanceof DeploymentConflictError) {
      return context.json({ error: error.message }, 409);
    }
    if (error instanceof HetznerApiError) {
      return context.json(
        {
          error: "Hetzner rejected the deployment",
          providerStatus: error.status,
          detail: error.message,
        },
        502,
      );
    }
    console.error(
      JSON.stringify({
        event: "deployment_error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return context.json({ error: "Deployment failed" }, 500);
  });

  return app;
}

interface HetznerResource {
  id: number;
  name: string;
}

interface HetznerServer extends HetznerResource {
  status?: string;
  public_net?: { ipv4?: { ip?: string } };
}

interface HetznerVolume extends HetznerResource {
  server?: number | null;
}

interface DeploymentResources {
  server?: HetznerServer;
  volume?: HetznerVolume;
  firewall?: HetznerResource;
  sshKey?: HetznerResource;
  hasResources: boolean;
}

interface ProvisionResult {
  resources: DeploymentResources;
  created: boolean;
}

class HetznerApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

class DeploymentConflictError extends Error {}

export class FileDeploymentEntitlementStore implements DeploymentEntitlementStore {
  constructor(private readonly root: string) {}

  async authorize(input: DeploymentRequest) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(input.deploymentId);
    const record: DeploymentEntitlement = {
      schemaVersion: 1,
      deploymentId: input.deploymentId,
      tokenHash: tokenHash(input.hetznerToken),
      sshPublicKey: input.sshPublicKey,
      sourceCidr: input.sourceCidr,
      authorizedAt: new Date().toISOString(),
    };

    try {
      await writeFile(path, `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      return;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }

    const existing = await this.read(input.deploymentId);
    if (!existing || !entitlementMatches(existing, input)) {
      throw new DeploymentConflictError(
        "Deployment ID is already bound to different buyer inputs",
      );
    }
  }

  async has(input: { deploymentId: string; hetznerToken: string } | DeploymentRequest) {
    const existing = await this.read(input.deploymentId);
    return Boolean(existing && entitlementMatches(existing, input));
  }

  private async read(deploymentId: string) {
    try {
      const value = JSON.parse(
        await readFile(this.path(deploymentId), "utf8"),
      ) as DeploymentEntitlement;
      return value.schemaVersion === 1 ? value : null;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  }

  private path(deploymentId: string) {
    return resolve(this.root, `${deploymentId}.json`);
  }
}

class HetznerClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async preflight(deploymentId: string) {
    const response = await this.request<{
      server_types?: Array<{
        name?: string;
        cores?: number;
        memory?: number;
        prices?: Array<{
          location?: string;
          price_monthly?: { gross?: string };
          price_hourly?: { gross?: string };
        }>;
      }>;
    }>("GET", `/server_types?name=${PLAN.serverType}`);
    const serverType = response.server_types?.find(
      (candidate) => candidate.name === PLAN.serverType,
    );
    if (!serverType) {
      throw new HetznerApiError(400, `Server type ${PLAN.serverType} is unavailable`);
    }
    const price = serverType.prices?.find(
      (candidate) => candidate.location === PLAN.location,
    );
    await this.verifyWriteAccess(deploymentId);
    return {
      ...PLAN,
      cores: serverType.cores,
      memoryGiB: serverType.memory,
      computePrice: price
        ? {
            hourlyGross: price.price_hourly?.gross,
            monthlyGross: price.price_monthly?.gross,
            currency: "EUR",
          }
        : null,
      volumePrice: "provider rate for 2048 GiB; confirm in the Hetzner console",
    };
  }

  private async verifyWriteAccess(deploymentId: string) {
    const suffix = randomBytes(4).toString("hex");
    const response = await this.request<{ ssh_key: HetznerResource }>(
      "POST",
      "/ssh_keys",
      {
        name: `in-three-preflight-${suffix}`,
        public_key: ephemeralSshPublicKey(),
        labels: {
          "managed-by": "in-three-preflight",
          "deployment-id": deploymentId,
        },
      },
    );
    try {
      await this.request("DELETE", `/ssh_keys/${response.ssh_key.id}`);
    } catch (error) {
      throw new HetznerApiError(
        error instanceof HetznerApiError ? error.status : 500,
        "write access succeeded, but the temporary preflight SSH key could not be removed",
      );
    }
  }

  async findDeployment(deploymentId: string): Promise<DeploymentResources> {
    const selector = encodeURIComponent(
      `managed-by=in-three,deployment-id=${deploymentId}`,
    );
    const [servers, volumes, firewalls, sshKeys] = await Promise.all([
      this.request<{ servers?: HetznerServer[] }>(
        "GET",
        `/servers?label_selector=${selector}`,
      ),
      this.request<{ volumes?: HetznerVolume[] }>(
        "GET",
        `/volumes?label_selector=${selector}`,
      ),
      this.request<{ firewalls?: HetznerResource[] }>(
        "GET",
        `/firewalls?label_selector=${selector}`,
      ),
      this.request<{ ssh_keys?: HetznerResource[] }>(
        "GET",
        `/ssh_keys?label_selector=${selector}`,
      ),
    ]);

    const resources = {
      server: servers.servers?.[0],
      volume: volumes.volumes?.[0],
      firewall: firewalls.firewalls?.[0],
      sshKey: sshKeys.ssh_keys?.[0],
      hasResources: false,
    };
    resources.hasResources = Boolean(
      resources.server ||
        resources.volume ||
        resources.firewall ||
        resources.sshKey,
    );
    return resources;
  }

  async provision(
    input: DeploymentRequest,
    releaseFiles: DeploymentReleaseFiles,
  ): Promise<ProvisionResult> {
    const resources = await this.findDeployment(input.deploymentId);
    if (resources.server) {
      await this.attachIfNeeded(resources);
      return { resources, created: false };
    }

    const created: Array<{ type: "servers" | "volumes" | "firewalls" | "ssh_keys"; id: number }> = [];
    const suffix = input.deploymentId.slice(4, 36);
    const name = `in-three-${suffix}`;
    const labels = {
      "managed-by": "in-three",
      "deployment-id": input.deploymentId,
    };

    try {
      if (!resources.sshKey) {
        const response = await this.request<{ ssh_key: HetznerResource }>(
          "POST",
          "/ssh_keys",
          {
            name,
            public_key: input.sshPublicKey,
            labels,
          },
        );
        resources.sshKey = response.ssh_key;
        created.push({ type: "ssh_keys", id: response.ssh_key.id });
      }

      if (!resources.volume) {
        const response = await this.request<{ volume: HetznerVolume }>(
          "POST",
          "/volumes",
          {
            name: `${name}-data`,
            location: PLAN.location,
            size: PLAN.volumeSizeGiB,
            format: "ext4",
            labels,
          },
        );
        resources.volume = response.volume;
        created.push({ type: "volumes", id: response.volume.id });
      }

      if (!resources.firewall) {
        const response = await this.request<{ firewall: HetznerResource }>(
          "POST",
          "/firewalls",
          {
            name,
            labels,
            rules: [
              {
                direction: "in",
                protocol: "tcp",
                port: "22",
                source_ips: [input.sourceCidr],
              },
              {
                direction: "in",
                protocol: "tcp",
                port: "80",
                source_ips: ["0.0.0.0/0", "::/0"],
              },
              {
                direction: "in",
                protocol: "tcp",
                port: "443",
                source_ips: ["0.0.0.0/0", "::/0"],
              },
              {
                direction: "in",
                protocol: "udp",
                port: "443",
                source_ips: ["0.0.0.0/0", "::/0"],
              },
              {
                direction: "in",
                protocol: "udp",
                port: "3382",
                source_ips: ["0.0.0.0/0", "::/0"],
              },
            ],
          },
        );
        resources.firewall = response.firewall;
        created.push({ type: "firewalls", id: response.firewall.id });
      }

      const cloudInit = renderDeploymentCloudInit({
        publicKey: input.sshPublicKey,
        volumeId: resources.volume.id,
        files: releaseFiles,
      });
      const response = await this.request<{ server: HetznerServer }>(
        "POST",
        "/servers",
        {
          name,
          server_type: PLAN.serverType,
          image: PLAN.image,
          location: PLAN.location,
          ssh_keys: [resources.sshKey.id],
          firewalls: [{ firewall: resources.firewall.id }],
          user_data: cloudInit,
          start_after_create: true,
          public_net: { enable_ipv4: true, enable_ipv6: true },
          labels,
        },
      );
      resources.server = response.server;
      created.push({ type: "servers", id: response.server.id });

      await this.attachIfNeeded(resources);
      resources.hasResources = true;
      return { resources, created: true };
    } catch (error) {
      await this.rollback(created);
      throw error;
    }
  }

  private async attachIfNeeded(resources: DeploymentResources) {
    if (!resources.server || !resources.volume || resources.volume.server) return;
    await this.request(
      "POST",
      `/volumes/${resources.volume.id}/actions/attach`,
      { server: resources.server.id, automount: false },
    );
    resources.volume.server = resources.server.id;
  }

  private async rollback(
    created: Array<{ type: "servers" | "volumes" | "firewalls" | "ssh_keys"; id: number }>,
  ) {
    for (const resource of [...created].reverse()) {
      const path = `/${resource.type}/${resource.id}`;
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        try {
          await this.request("DELETE", path);
          break;
        } catch (error) {
          if (error instanceof HetznerApiError && error.status === 404) break;
          if (attempt === 10) break;
          await delay(1_000);
        }
      }
    }
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(`${HETZNER_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HetznerApiError(response.status, providerError(text));
    }
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }
}

async function provisionResponse(
  input: DeploymentRequest,
  fetchImpl: typeof fetch,
  releaseFiles: DeploymentReleaseFiles,
  provisioning: Map<string, Promise<ProvisionResult>>,
) {
  let pending = provisioning.get(input.deploymentId);
  if (!pending) {
    const client = new HetznerClient(input.hetznerToken, fetchImpl);
    pending = (async () => {
      try {
        return await client.provision(input, releaseFiles);
      } finally {
        provisioning.delete(input.deploymentId);
      }
    })();
    provisioning.set(input.deploymentId, pending);
  }
  const deployment = await pending;
  return Response.json(
    publicDeployment(input.deploymentId, deployment.resources, deployment.created),
    { status: deployment.created ? 201 : 200 },
  );
}

function entitlementMatches(
  record: DeploymentEntitlement,
  input: { deploymentId: string; hetznerToken: string } | DeploymentRequest,
) {
  if (
    record.deploymentId !== input.deploymentId ||
    record.tokenHash !== tokenHash(input.hetznerToken)
  ) {
    return false;
  }
  if ("sshPublicKey" in input) {
    return (
      record.sshPublicKey === input.sshPublicKey &&
      record.sourceCidr === input.sourceCidr
    );
  }
  return true;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isNodeError(error: unknown, code: string) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function ephemeralSshPublicKey() {
  const { publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const raw = spki.subarray(spki.length - 32);
  const algorithm = Buffer.from("ssh-ed25519");
  const blob = Buffer.alloc(4 + algorithm.length + 4 + raw.length);
  blob.writeUInt32BE(algorithm.length, 0);
  algorithm.copy(blob, 4);
  blob.writeUInt32BE(raw.length, 4 + algorithm.length);
  raw.copy(blob, 8 + algorithm.length);
  return `ssh-ed25519 ${blob.toString("base64")} in-three-preflight`;
}

function publicDeployment(
  deploymentId: string,
  resources: DeploymentResources,
  created: boolean,
) {
  const serverIp = resources.server?.public_net?.ipv4?.ip;
  if (!resources.server || !resources.volume || !resources.firewall || !resources.sshKey || !serverIp) {
    throw new Error("Hetzner returned incomplete deployment resources");
  }
  return {
    ok: true,
    deploymentId,
    created,
    phase: "bootstrapping",
    server: {
      id: resources.server.id,
      ip: serverIp,
      status: resources.server.status ?? "initializing",
      sshUser: "inthree",
      clientOrigin: `https://${serverIp.replaceAll(".", "-")}.sslip.io`,
    },
    resources: {
      volumeId: resources.volume.id,
      firewallId: resources.firewall.id,
      sshKeyId: resources.sshKey.id,
    },
    plan: PLAN,
    next: "Keep the returned resource IDs, wait for cloud-init, then finish the local key ceremony.",
  };
}

export function renderDeploymentCloudInit({
  publicKey,
  volumeId,
  files,
}: {
  publicKey: string;
  volumeId: number;
  files: DeploymentReleaseFiles;
}) {
  const mountScript = `#!/usr/bin/env bash
set -euo pipefail
device="/dev/disk/by-id/scsi-0HC_Volume_${volumeId}"
for attempt in $(seq 1 120); do
  [[ -b "$device" ]] && break
  sleep 2
done
[[ -b "$device" ]] || { echo "volume device not found" >&2; exit 1; }
mkdir -p /srv/in-three
if ! mountpoint -q /srv/in-three; then
  mount "$device" /srv/in-three
fi
grep -qF "$device /srv/in-three" /etc/fstab ||
  echo "$device /srv/in-three ext4 defaults,nofail 0 2" >> /etc/fstab
mkdir -p /srv/in-three/data/{rocks,snapshot,caddy-data,caddy-config,deployer}
mkdir -p /srv/in-three/source
install -m 0644 /opt/in-three-release/docker-compose.yml /srv/in-three/docker-compose.yml
install -m 0644 /opt/in-three-release/Caddyfile /srv/in-three/Caddyfile
install -m 0755 /opt/in-three-release/snapchain-entrypoint.sh /srv/in-three/snapchain-entrypoint.sh
install -m 0644 /opt/in-three-release/validators.toml /srv/in-three/validators.toml
touch /srv/in-three/client.env /srv/in-three/agent-gateway.env
chmod 600 /srv/in-three/client.env /srv/in-three/agent-gateway.env
chown -R inthree:inthree /srv/in-three
chown 1000:1000 /srv/in-three/data/deployer
chmod 700 /srv/in-three/data/deployer
`;

  const writeFiles = [
    cloudFile(
      "/usr/local/sbin/mount-in-three-volume",
      mountScript,
      "0755",
      "root:root",
    ),
    cloudFile(
      "/opt/in-three-release/docker-compose.yml",
      files.compose,
      "0644",
      "inthree:inthree",
    ),
    cloudFile(
      "/opt/in-three-release/Caddyfile",
      files.caddy,
      "0644",
      "inthree:inthree",
    ),
    cloudFile(
      "/opt/in-three-release/snapchain-entrypoint.sh",
      files.entrypoint,
      "0755",
      "inthree:inthree",
    ),
    cloudFile(
      "/opt/in-three-release/validators.toml",
      files.validators,
      "0644",
      "inthree:inthree",
    ),
  ].join("\n");

  return `#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-v2
  - curl
  - jq
users:
  - default
  - name: inthree
    gecos: In Three operator
    groups: [adm, sudo, docker]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    ssh_authorized_keys:
      - ${JSON.stringify(publicKey)}
write_files:
${writeFiles}
runcmd:
  - [systemctl, enable, --now, docker]
  - [usermod, -aG, docker, inthree]
  - [/usr/local/sbin/mount-in-three-volume]
  - [sh, -c, "cd /srv/in-three && docker compose pull snapchain"]
  - [sh, -c, "cd /srv/in-three && docker compose up -d snapchain"]
  - [sh, -c, "touch /var/lib/cloud/instance/in-three-ready"]
`;
}

function cloudFile(
  path: string,
  content: string,
  permissions: string,
  owner: string,
) {
  return `  - path: ${path}
    owner: ${owner}
    permissions: "${permissions}"
    encoding: b64
    content: ${Buffer.from(content).toString("base64")}`;
}

async function loadDeploymentReleaseFiles(): Promise<DeploymentReleaseFiles> {
  const root = process.env.IN_THREE_DEPLOY_ROOT ?? resolve(process.cwd(), "../../deploy");
  const [compose, caddy, entrypoint, validators] = await Promise.all([
    readFile(resolve(root, "docker-compose.yml"), "utf8"),
    readFile(resolve(root, "Caddyfile"), "utf8"),
    readFile(resolve(root, "snapchain-entrypoint.sh"), "utf8"),
    readFile(resolve(root, "validators.toml"), "utf8"),
  ]);
  return { compose, caddy, entrypoint, validators };
}

function isCidr(value: string) {
  const [address, prefix, extra] = value.split("/");
  if (!address || !prefix || extra !== undefined || !/^\d+$/.test(prefix)) {
    return false;
  }
  const family = isIP(address);
  if (!family) return false;
  const numericPrefix = Number(prefix);
  return numericPrefix >= 0 && numericPrefix <= (family === 4 ? 32 : 128);
}

function providerError(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; details?: { fields?: Array<{ name?: string; messages?: string[] }> } };
    };
    return parsed.error?.message ?? "provider request failed";
  } catch {
    return "provider request failed";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createDeploymentApp();
  serve(
    {
      fetch: app.fetch,
      port: Number(process.env.DEPLOYMENT_PORT ?? DEPLOYMENT_PORT),
      hostname: "0.0.0.0",
    },
    (info) => {
      console.log(
        `In Three deployment service listening on http://0.0.0.0:${info.port}`,
      );
    },
  );
}
