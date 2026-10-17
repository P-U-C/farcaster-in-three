import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createGateway,
  parsePrice,
  type GatewayCompletion,
  type PaywallConfig,
} from "@celo/buy-gateway";
import {
  resolveRemoteFacilitatorFromEnv,
  type RemoteFacilitator,
} from "@celo/buy-facilitator";
import { getAddress } from "viem";
import { z } from "zod";
import { createAgentManifest, createAgentOpenApi } from "./agent-contract.js";

const WRITE_PATHS = new Set([
  "/agent/v1/casts",
  "/agent/v1/follows",
  "/agent/v1/reactions",
]);

const envSchema = z.object({
  AGENT_GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(3334),
  AGENT_CLIENT_UPSTREAM: z.string().url().default("http://client:3333"),
  AGENT_PUBLIC_ORIGIN: z.string().url(),
  AGENT_WRITE_TOKEN: z.string().min(32).max(256).regex(/^[A-Za-z0-9_-]+$/),
  BUY_PAY_TO: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  BUY_FACILITATOR_URL: z
    .literal("https://api.x402.celo.org")
    .default("https://api.x402.celo.org"),
  BUY_FACILITATOR_API_KEY: z
    .string()
    .max(512)
    .regex(/^x402_[A-Za-z0-9_-]{12,}$/),
  BUY_AGENT_READ_PRICE: z.string().default("0.005 USDC"),
  BUY_AGENT_METADATA_PRICE: z.string().default("0.002 USDC"),
  BUY_AGENT_WRITE_PRICE: z.string().default("0.02 USDC"),
});

export type AgentGatewaySettings = ReturnType<typeof loadAgentGatewaySettings>;

export function loadAgentGatewaySettings(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    AGENT_CLIENT_UPSTREAM: parsed.AGENT_CLIENT_UPSTREAM.replace(/\/$/, ""),
    AGENT_PUBLIC_ORIGIN: parsed.AGENT_PUBLIC_ORIGIN.replace(/\/$/, ""),
    BUY_PAY_TO: getAddress(parsed.BUY_PAY_TO),
  };
}

export function createAgentPaywall(settings: AgentGatewaySettings): PaywallConfig {
  const profile = exactUsdc(settings.BUY_AGENT_METADATA_PRICE, "BUY_AGENT_METADATA_PRICE");
  const feed = exactUsdc(settings.BUY_AGENT_READ_PRICE, "BUY_AGENT_READ_PRICE");
  const write = exactUsdc(settings.BUY_AGENT_WRITE_PRICE, "BUY_AGENT_WRITE_PRICE");
  const service = "in-three-client";

  return {
    name: "in-three-agent",
    version: 1,
    network: "celo",
    payTo: settings.BUY_PAY_TO,
    trustProxy: true,
    tokens: ["USDC"],
    rateLimit: { scope: "ip", requestsPerMinute: 120, burst: 30 },
    services: {
      [service]: {
        mode: "proxy",
        upstream: settings.AGENT_CLIENT_UPSTREAM,
        injectHeaders: {},
        forwardHeaders: ["content-type", "accept"],
        timeoutMs: 30_000,
        rateLimit: { scope: "service", requestsPerMinute: 180, burst: 30 },
      },
    },
    endpoints: [
      freeEndpoint("/agent/health", service),
      paidEndpoint("/agent/v1/profile", service, profile, ["GET"], []),
      paidEndpoint("/agent/v1/feed", service, feed, ["GET"], []),
      paidEndpoint("/agent/v1/sources", service, profile, ["GET"], []),
      paidEndpoint("/agent/v1/casts", service, write, ["POST"], [
        "text",
        "embedUrl",
        "parentCastId",
      ]),
      paidEndpoint("/agent/v1/follows", service, write, ["POST"], [
        "targetFid",
        "remove",
      ]),
      paidEndpoint("/agent/v1/reactions", service, write, ["POST"], [
        "type",
        "targetFid",
        "targetHash",
        "remove",
      ]),
    ],
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

export function createAgentGateway({
  settings,
  facilitator,
  log = console.log,
}: {
  settings: AgentGatewaySettings;
  facilitator?: RemoteFacilitator;
  log?: (line: string) => void;
}) {
  const paywall = createAgentPaywall(settings);
  const contract = {
    origin: settings.AGENT_PUBLIC_ORIGIN,
    readPrice: settings.BUY_AGENT_READ_PRICE,
    metadataPrice: settings.BUY_AGENT_METADATA_PRICE,
    writePrice: settings.BUY_AGENT_WRITE_PRICE,
  };
  const gateway = createGateway({
    config: paywall,
    facilitator,
    log,
    onComplete: (event: GatewayCompletion) => {
      log(
        JSON.stringify({
          event: "agent_purchase_complete",
          endpoint: event.endpoint,
          payer: event.payer,
          amount: event.amount,
          currency: event.currency,
          transaction: event.transaction,
          status: event.status,
          delivered: event.delivered,
          correlationId: event.correlationId,
        }),
      );
    },
  });

  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(
        request.url ?? "/",
        settings.AGENT_PUBLIC_ORIGIN,
      ).pathname;

      if (
        request.method === "GET" &&
        pathname === "/.well-known/agent.json"
      ) {
        return sendJson(response, 200, createAgentManifest(contract));
      }
      if (
        request.method === "GET" &&
        pathname === "/agent/openapi.json"
      ) {
        return sendJson(response, 200, createAgentOpenApi(contract));
      }

      if (
        request.method === "POST" &&
        WRITE_PATHS.has(pathname) &&
        !hasAgentWriteCapability(
          request.headers.authorization,
          settings.AGENT_WRITE_TOKEN,
        )
      ) {
        response.setHeader("WWW-Authenticate", 'Bearer realm="in-three-agent"');
        return sendJson(response, 401, {
          error: "Owner-issued agent write capability required",
        });
      }

      await gateway.handler(request, response);
    } catch (error) {
      log(
        JSON.stringify({
          event: "agent_gateway_error",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      if (!response.headersSent) {
        sendJson(response, 500, { error: "Agent gateway failed" });
      } else {
        response.end();
      }
    }
  });

  return { server, usage: gateway.usage };
}

function exactUsdc(raw: string, variable: string) {
  const parsed = parsePrice(raw, variable);
  if (parsed.currency !== "USDC" || parsed.amount === "0") {
    throw new Error(`${variable} must be a non-zero USDC price`);
  }
  return parsed;
}

function freeEndpoint(path: string, service: string): PaywallConfig["endpoints"][number] {
  return {
    path,
    service,
    free: true,
    scheme: "exact",
    amount: "0",
    currency: "USDC",
    description: "Free health check",
    restrictions: { methods: ["GET"] },
    rateLimit: { scope: "ip", requestsPerMinute: 60, burst: 10 },
  };
}

function paidEndpoint(
  path: string,
  service: string,
  price: { amount: string; currency: string },
  methods: string[],
  jsonOnlyFields: string[],
): PaywallConfig["endpoints"][number] {
  const write = methods.includes("POST");
  return {
    path,
    service,
    free: false,
    scheme: "exact",
    amount: price.amount,
    currency: price.currency,
    description: endpointDescription(path),
    restrictions: {
      methods,
      ...(write
        ? {
            json: true,
            maxBodyBytes: 4_096,
            jsonOnlyFields,
          }
        : {}),
    },
    rateLimit: {
      scope: "payer",
      requestsPerMinute: write ? 12 : 60,
      burst: write ? 4 : 20,
    },
  };
}

function endpointDescription(path: string): string {
  const descriptions: Record<string, string> = {
    "/agent/v1/profile": "Read this Farcaster client's profile, storage, signer, and owned node state.",
    "/agent/v1/feed": "Read a chronological Farcaster feed from this client's own Snapchain node.",
    "/agent/v1/sources": "List every observed Farcaster app and exact signer source in the current feed.",
    "/agent/v1/casts": "Publish one cast through this client's delegated Farcaster app key.",
    "/agent/v1/follows": "Follow or unfollow one Farcaster FID through this client.",
    "/agent/v1/reactions": "Add or remove one like or recast through this client.",
  };
  return descriptions[path] ?? "Use this In Three Farcaster client.";
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(payload);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const settings = loadAgentGatewaySettings();
  const remote = resolveRemoteFacilitatorFromEnv(
    {
      BUY_FACILITATOR_URL: settings.BUY_FACILITATOR_URL,
      BUY_FACILITATOR_API_KEY: settings.BUY_FACILITATOR_API_KEY,
    },
    "celo",
  );
  if (!remote) {
    throw new Error("Celo facilitator configuration is required");
  }

  const { server } = createAgentGateway({
    settings,
    facilitator: remote.facilitator,
  });
  server.listen(
    settings.AGENT_GATEWAY_PORT,
    "0.0.0.0",
    () => {
      console.log(
        `In Three agent gateway listening on http://0.0.0.0:${settings.AGENT_GATEWAY_PORT}`,
      );
    },
  );
}
