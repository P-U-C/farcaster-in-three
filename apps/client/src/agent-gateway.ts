import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { generateJwt } from "@coinbase/cdp-sdk/auth";
import {
  HTTPFacilitatorClient,
  x402ResourceServer,
  type FacilitatorClient,
  type RouteConfig,
  type RoutesConfig,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/hono";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { createPublicClient, getAddress, http } from "viem";
import { base, celo } from "viem/chains";
import { z } from "zod";
import { createAgentManifest, createAgentOpenApi } from "./agent-contract.js";
import {
  PAYMENT_CHAINS,
  PUC_ROYALTY_ADDRESS,
  PUC_ROYALTY_BPS,
  inspectRevenueSplits,
} from "./revenue.js";

const JSON_FIELDS: Record<string, string[]> = {
  "/agent/v1/casts": ["text", "embedUrl", "parentCastId"],
  "/agent/v1/follows": ["targetFid", "remove"],
  "/agent/v1/reactions": [
    "type",
    "targetFid",
    "targetHash",
    "remove",
  ],
  "/agent/v1/deployments/preflight": [
    "deploymentId",
    "hetznerToken",
    "sshPublicKey",
    "sourceCidr",
  ],
  "/agent/v1/deployments/status": ["deploymentId", "hetznerToken"],
  "/agent/v1/deployments/resume": [
    "deploymentId",
    "hetznerToken",
    "sshPublicKey",
    "sourceCidr",
  ],
  "/agent/v1/deployments": [
    "deploymentId",
    "hetznerToken",
    "sshPublicKey",
    "sourceCidr",
  ],
};

const PAID_GET_PATHS = new Set([
  "/agent/v1/profile",
  "/agent/v1/feed",
  "/agent/v1/sources",
]);

const envSchema = z.object({
  AGENT_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(3334),
  AGENT_CLIENT_UPSTREAM: z.string().url().default("http://client:3333"),
  AGENT_DEPLOYMENT_UPSTREAM: z.string().url().default("http://deployer:3335"),
  AGENT_PUBLIC_ORIGIN: z.string().url(),
  AGENT_WRITE_TOKEN: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
  BUY_OPERATOR_PAY_TO: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  BUY_PAY_TO: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  BUY_ROYALTY_PAY_TO: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default(PUC_ROYALTY_ADDRESS),
  BUY_ROYALTY_BPS: z.coerce.number().int().default(PUC_ROYALTY_BPS),
  BUY_FACILITATOR_URL: z
    .literal("https://api.x402.celo.org")
    .default("https://api.x402.celo.org"),
  BUY_FACILITATOR_API_KEY: z
    .string()
    .max(512)
    .regex(/^x402_[A-Za-z0-9_-]{12,}$/),
  CDP_API_KEY_ID: z.string().min(5).max(256),
  CDP_API_KEY_SECRET_B64: z
    .string()
    .min(40)
    .max(8192)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  BUY_AGENT_READ_PRICE: z.string().default("0.005 USDC"),
  BUY_AGENT_METADATA_PRICE: z.string().default("0.002 USDC"),
  BUY_AGENT_WRITE_PRICE: z.string().default("0.02 USDC"),
  BUY_DEPLOY_PRICE: z.string().default("25 USDC"),
});

export type AgentGatewaySettings = ReturnType<typeof loadAgentGatewaySettings>;

export function loadAgentGatewaySettings(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  const royalty = getAddress(parsed.BUY_ROYALTY_PAY_TO);
  if (royalty.toLowerCase() !== PUC_ROYALTY_ADDRESS.toLowerCase()) {
    throw new Error(
      `BUY_ROYALTY_PAY_TO must be the P-U-C royalty address ${PUC_ROYALTY_ADDRESS}`,
    );
  }
  if (parsed.BUY_ROYALTY_BPS !== PUC_ROYALTY_BPS) {
    throw new Error(`BUY_ROYALTY_BPS must be ${PUC_ROYALTY_BPS}`);
  }

  const cdpApiKeySecret = Buffer.from(
    parsed.CDP_API_KEY_SECRET_B64,
    "base64",
  ).toString("utf8");
  if (cdpApiKeySecret.length < 40) {
    throw new Error("CDP_API_KEY_SECRET_B64 does not contain a valid API key secret");
  }

  return {
    ...parsed,
    CDP_API_KEY_SECRET: cdpApiKeySecret,
    AGENT_CLIENT_UPSTREAM: parsed.AGENT_CLIENT_UPSTREAM.replace(/\/$/, ""),
    AGENT_DEPLOYMENT_UPSTREAM: parsed.AGENT_DEPLOYMENT_UPSTREAM.replace(/\/$/, ""),
    AGENT_PUBLIC_ORIGIN: parsed.AGENT_PUBLIC_ORIGIN.replace(/\/$/, ""),
    BUY_OPERATOR_PAY_TO: getAddress(parsed.BUY_OPERATOR_PAY_TO),
    BUY_PAY_TO: getAddress(parsed.BUY_PAY_TO),
    BUY_ROYALTY_PAY_TO: royalty,
    prices: {
      read: exactUsdc(parsed.BUY_AGENT_READ_PRICE, "BUY_AGENT_READ_PRICE"),
      metadata: exactUsdc(
        parsed.BUY_AGENT_METADATA_PRICE,
        "BUY_AGENT_METADATA_PRICE",
      ),
      write: exactUsdc(parsed.BUY_AGENT_WRITE_PRICE, "BUY_AGENT_WRITE_PRICE"),
      deploy: exactUsdc(parsed.BUY_DEPLOY_PRICE, "BUY_DEPLOY_PRICE"),
    },
  };
}

export function createAgentPaymentRoutes(
  settings: AgentGatewaySettings,
): RoutesConfig {
  return {
    "GET /agent/v1/profile": paidRoute(
      settings,
      settings.prices.metadata,
      "/agent/v1/profile",
    ),
    "GET /agent/v1/feed": paidRoute(
      settings,
      settings.prices.read,
      "/agent/v1/feed",
    ),
    "GET /agent/v1/sources": paidRoute(
      settings,
      settings.prices.metadata,
      "/agent/v1/sources",
    ),
    "POST /agent/v1/casts": paidRoute(
      settings,
      settings.prices.write,
      "/agent/v1/casts",
    ),
    "POST /agent/v1/follows": paidRoute(
      settings,
      settings.prices.write,
      "/agent/v1/follows",
    ),
    "POST /agent/v1/reactions": paidRoute(
      settings,
      settings.prices.write,
      "/agent/v1/reactions",
    ),
    "POST /agent/v1/deployments": paidRoute(
      settings,
      settings.prices.deploy,
      "/agent/v1/deployments",
      true,
    ),
  };
}

export function hasAgentWriteCapability(
  authorization: string | string[] | undefined,
  expectedToken: string,
): boolean {
  if (typeof authorization !== "string") return false;
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/i);
  if (!match?.[1]) return false;

  const supplied = Buffer.from(match[1]);
  const expected = Buffer.from(expectedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function createAgentFacilitators(
  settings: AgentGatewaySettings,
): FacilitatorClient[] {
  const celoHeaders = { "X-API-Key": settings.BUY_FACILITATOR_API_KEY };
  const celoFacilitator = new HTTPFacilitatorClient({
    url: settings.BUY_FACILITATOR_URL,
    createAuthHeaders: async () => ({
      verify: celoHeaders,
      settle: celoHeaders,
      supported: celoHeaders,
    }),
  });
  const cdpUrl = "https://api.cdp.coinbase.com/platform/v2/x402";
  const cdp = new URL(cdpUrl);
  const cdpHeaders = async (operation: "verify" | "settle" | "supported") => {
    const requestMethod = operation === "supported" ? "GET" : "POST";
    const requestPath = `${cdp.pathname}/${operation}`;
    const jwt = await generateJwt({
      apiKeyId: settings.CDP_API_KEY_ID,
      apiKeySecret: settings.CDP_API_KEY_SECRET,
      requestMethod,
      requestHost: cdp.host,
      requestPath,
    });
    return { Authorization: `Bearer ${jwt}` };
  };
  const baseFacilitator = new HTTPFacilitatorClient({
    url: cdpUrl,
    createAuthHeaders: async () => ({
      verify: await cdpHeaders("verify"),
      settle: await cdpHeaders("settle"),
      supported: await cdpHeaders("supported"),
    }),
  });

  return [celoFacilitator, baseFacilitator];
}

export async function assertRevenueRouting(
  settings: AgentGatewaySettings,
): Promise<void> {
  const inspection = await inspectRevenueSplits({
    operatorAddress: settings.BUY_OPERATOR_PAY_TO,
    royaltyAddress: settings.BUY_ROYALTY_PAY_TO,
    publicClients: {
      celo: createPublicClient({ chain: celo, transport: http() }),
      base: createPublicClient({ chain: base, transport: http() }),
    },
  });

  if (inspection.payTo.toLowerCase() !== settings.BUY_PAY_TO.toLowerCase()) {
    throw new Error(
      `BUY_PAY_TO must be the deterministic 95/5 revenue route ${inspection.payTo}`,
    );
  }
  const missing = inspection.chains
    .filter((chain) => !chain.deployed)
    .map((chain) => chain.key);
  if (missing.length > 0) {
    throw new Error(
      `Revenue split is not deployed on: ${missing.join(", ")}. Rerun ./farcaster client create.`,
    );
  }
}

export async function createAgentGateway({
  settings,
  facilitators = createAgentFacilitators(settings),
  initialize = true,
  log = console.log,
}: {
  settings: AgentGatewaySettings;
  facilitators?: FacilitatorClient[];
  initialize?: boolean;
  log?: (line: string) => void;
}) {
  const paymentServer = new x402ResourceServer(facilitators);
  for (const { network } of PAYMENT_CHAINS) {
    paymentServer.register(network, new ExactEvmScheme());
  }

  paymentServer.onAfterSettle(async (context) => {
    log(
      JSON.stringify({
        event: "agent_purchase_complete",
        endpoint: httpPath(context.transportContext),
        payer: context.result.payer,
        amount: context.requirements.amount,
        asset: context.requirements.asset,
        network: context.result.network,
        transaction: context.result.transaction,
        phase: context.phase,
      }),
    );
  });

  if (initialize) await paymentServer.initialize();

  const app = new Hono();
  const limiter = new RequestLimiter();

  app.use("*", securityHeaders());
  app.use("/agent/*", async (context, next) => {
    const source = clientAddress(context);
    if (!limiter.take(source, 120, 60_000)) {
      return context.json({ error: "Rate limit exceeded" }, 429);
    }
    await next();
  });
  app.use("/agent/v1/*", validateAgentRequest());
  app.use("/agent/v1/casts", requireWriteCapability(settings.AGENT_WRITE_TOKEN));
  app.use("/agent/v1/follows", requireWriteCapability(settings.AGENT_WRITE_TOKEN));
  app.use("/agent/v1/reactions", requireWriteCapability(settings.AGENT_WRITE_TOKEN));
  app.use(
    "*",
    paymentMiddleware(
      createAgentPaymentRoutes(settings),
      paymentServer,
      undefined,
      undefined,
      false,
    ),
  );

  const contract = {
    origin: settings.AGENT_PUBLIC_ORIGIN,
    readPrice: settings.BUY_AGENT_READ_PRICE,
    metadataPrice: settings.BUY_AGENT_METADATA_PRICE,
    writePrice: settings.BUY_AGENT_WRITE_PRICE,
    deployPrice: settings.BUY_DEPLOY_PRICE,
    payTo: settings.BUY_PAY_TO,
    operatorPayTo: settings.BUY_OPERATOR_PAY_TO,
    royaltyPayTo: settings.BUY_ROYALTY_PAY_TO,
    royaltyBps: settings.BUY_ROYALTY_BPS,
  };

  app.get("/.well-known/agent.json", (context) =>
    context.json(createAgentManifest(contract)),
  );
  app.get("/agent/openapi.json", (context) =>
    context.json(createAgentOpenApi(contract)),
  );

  app.get("/agent/health", (context) =>
    proxyRequest(context, settings.AGENT_CLIENT_UPSTREAM, 30_000),
  );

  for (const path of [
    "/agent/v1/profile",
    "/agent/v1/feed",
    "/agent/v1/sources",
    "/agent/v1/casts",
    "/agent/v1/follows",
    "/agent/v1/reactions",
  ]) {
    app.all(path, (context) =>
      proxyRequest(context, settings.AGENT_CLIENT_UPSTREAM, 30_000),
    );
  }

  for (const path of [
    "/agent/v1/deployments/preflight",
    "/agent/v1/deployments/status",
    "/agent/v1/deployments/resume",
    "/agent/v1/deployments",
  ]) {
    app.all(path, (context) =>
      proxyRequest(context, settings.AGENT_DEPLOYMENT_UPSTREAM, 120_000),
    );
  }

  app.notFound((context) => context.json({ error: "Not found" }, 404));
  app.onError((error, context) => {
    log(
      JSON.stringify({
        event: "agent_gateway_error",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return context.json({ error: "Agent gateway failed" }, 500);
  });

  const server = createServer(getRequestListener(app.fetch));
  return { app, server, paymentServer };
}

function paidRoute(
  settings: AgentGatewaySettings,
  price: string,
  path: string,
  upfront = false,
): RouteConfig {
  return {
    accepts: PAYMENT_CHAINS.map(({ network }) => ({
      scheme: "exact",
      network,
      payTo: settings.BUY_PAY_TO,
      price: `$${price}`,
      maxTimeoutSeconds: 300,
      extra: {
        assetTransferMethod: "eip3009",
        paymentFlow: upfront ? "upfront" : "authorization",
      },
    })),
    resource: `${settings.AGENT_PUBLIC_ORIGIN}${path}`,
    description: endpointDescription(path),
    mimeType: "application/json",
    serviceName: "In Three",
    tags: path.includes("deployments")
      ? ["farcaster", "deployment", "snapchain"]
      : ["farcaster", "client", "snapchain"],
  };
}

function exactUsdc(raw: string, variable: string): string {
  const match = raw.trim().match(/^(0|[1-9]\d*)(?:\.(\d{1,6}))?\s+USDC$/);
  if (!match) {
    throw new Error(`${variable} must be a decimal USDC price with at most 6 decimals`);
  }
  const normalized = `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}`;
  if (normalized === "0.000000") {
    throw new Error(`${variable} must be a non-zero USDC price`);
  }
  return normalized.replace(/\.?0+$/, "");
}

function validateAgentRequest(): MiddlewareHandler {
  return async (context, next) => {
    const path = context.req.path;
    const method = context.req.method.toUpperCase();

    if (path === "/agent/health" || PAID_GET_PATHS.has(path)) {
      if (method !== "GET") {
        context.header("Allow", "GET");
        return context.json({ error: "Method not allowed" }, 405);
      }
      return next();
    }

    const allowedFields = JSON_FIELDS[path];
    if (!allowedFields) return next();
    if (method !== "POST") {
      context.header("Allow", "POST");
      return context.json({ error: "Method not allowed" }, 405);
    }

    const contentType = context.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return context.json({ error: "Content-Type must be application/json" }, 415);
    }

    const bytes = new Uint8Array(await context.req.raw.clone().arrayBuffer());
    if (bytes.byteLength > 4_096) {
      return context.json({ error: "Request body exceeds 4096 bytes" }, 413);
    }

    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return context.json({ error: "Request body must be valid JSON" }, 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return context.json({ error: "Request body must be a JSON object" }, 400);
    }

    const extras = Object.keys(body).filter(
      (field) => !allowedFields.includes(field),
    );
    if (extras.length > 0) {
      return context.json(
        { error: "Unexpected JSON fields", fields: extras.sort() },
        400,
      );
    }

    await next();
  };
}

function requireWriteCapability(expectedToken: string): MiddlewareHandler {
  return async (context, next) => {
    if (
      !hasAgentWriteCapability(
        context.req.header("authorization"),
        expectedToken,
      )
    ) {
      context.header(
        "WWW-Authenticate",
        'Bearer realm="in-three-agent"',
      );
      return context.json(
        { error: "Owner-issued agent write capability required" },
        401,
      );
    }
    await next();
  };
}

function securityHeaders(): MiddlewareHandler {
  return async (context, next) => {
    await next();
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
  };
}

async function proxyRequest(
  context: Context,
  upstream: string,
  timeoutMs: number,
) {
  const target = new URL(
    `${context.req.path}${new URL(context.req.url).search}`,
    `${upstream}/`,
  );
  const headers = new Headers();
  for (const name of ["accept", "content-type"]) {
    const value = context.req.header(name);
    if (value) headers.set(name, value);
  }

  const method = context.req.method.toUpperCase();
  const response = await fetch(target, {
    method,
    headers,
    ...(method === "GET" || method === "HEAD"
      ? {}
      : { body: await context.req.raw.clone().arrayBuffer() }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const responseHeaders = new Headers();
  for (const name of ["content-type", "content-length", "etag"]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

function endpointDescription(path: string): string {
  const descriptions: Record<string, string> = {
    "/agent/v1/profile":
      "Read this Farcaster client's profile, storage, signer, and owned node state.",
    "/agent/v1/feed":
      "Read a chronological Farcaster feed from this client's own Snapchain node.",
    "/agent/v1/sources":
      "List every observed Farcaster app and exact signer source in the current feed.",
    "/agent/v1/casts":
      "Publish one cast through this client's delegated Farcaster app key.",
    "/agent/v1/follows":
      "Follow or unfollow one Farcaster FID through this client.",
    "/agent/v1/reactions":
      "Add or remove one like or recast through this client.",
    "/agent/v1/deployments/preflight":
      "Validate a fixed In Three plan and its dedicated Hetzner project before payment.",
    "/agent/v1/deployments/status":
      "Recover the Hetzner resources for one client-generated deployment ID.",
    "/agent/v1/deployments/resume":
      "Resume a deployment that already has a durable paid entitlement.",
    "/agent/v1/deployments":
      "Provision the fixed In Three Hetzner plan and start its Snapchain bootstrap.",
  };
  return descriptions[path] ?? "Use this In Three Farcaster client.";
}

function clientAddress(context: Context): string {
  const forwarded = context.req.header("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function httpPath(transportContext: unknown): string | undefined {
  if (
    !transportContext ||
    typeof transportContext !== "object" ||
    !("request" in transportContext)
  ) {
    return undefined;
  }
  const request = (transportContext as { request?: { path?: unknown } }).request;
  return typeof request?.path === "string" ? request.path : undefined;
}

class RequestLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  take(key: string, limit: number, durationMs: number): boolean {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + durationMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const settings = loadAgentGatewaySettings();
  await assertRevenueRouting(settings);
  const { server } = await createAgentGateway({ settings });
  server.listen(settings.AGENT_GATEWAY_PORT, "0.0.0.0", () => {
    console.log(
      `In Three multi-chain agent gateway listening on http://0.0.0.0:${settings.AGENT_GATEWAY_PORT}`,
    );
  });
}
