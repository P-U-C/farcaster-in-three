export interface AgentContractOptions {
  origin: string;
  readPrice: string;
  metadataPrice: string;
  writePrice: string;
}

const writeCapabilityNote =
  "Requires an owner-issued Bearer capability in addition to x402 payment.";

export function createAgentManifest(options: AgentContractOptions) {
  const origin = options.origin.replace(/\/$/, "");
  return {
    schemaVersion: "1.0",
    name: "In Three Farcaster client",
    description:
      "Paid agent access to a sovereign Farcaster client backed by its own Snapchain read node.",
    origin,
    protocol: {
      payment: "x402",
      network: "eip155:42220",
      token: "USDC",
      client: "@celo/buy@0.8.3",
      facilitator: "https://api.x402.celo.org",
    },
    discovery: {
      openapi: `${origin}/agent/openapi.json`,
      health: `${origin}/agent/health`,
    },
    authorization: {
      reads: "x402 payment",
      writes: "x402 payment plus owner-issued Bearer capability",
    },
    prices: {
      profile: options.metadataPrice,
      feed: options.readPrice,
      sources: options.metadataPrice,
      cast: options.writePrice,
      follow: options.writePrice,
      reaction: options.writePrice,
    },
    safety: [
      "Quote the exact request before payment and enforce a maximum amount.",
      "Do not blindly retry after a paid timeout or ambiguous settlement.",
      "Never expose the write capability, wallet key, custody phrase, or payment authorization.",
    ],
  };
}

export function createAgentOpenApi(options: AgentContractOptions) {
  const origin = options.origin.replace(/\/$/, "");
  const paidResponses = {
    "400": { description: "Invalid request; gateway refusals occur before payment where possible" },
    "402": { description: "Payment Required; use buy quote or buy curl on Celo" },
    "429": { description: "Rate limit exceeded" },
    "500": { description: "Upstream operation failed; inspect the payment receipt before retrying" },
  };
  const writeSecurity = [{ x402: [], bearerAuth: [] }];

  return {
    openapi: "3.1.0",
    info: {
      title: "In Three agent API",
      version: "1.0.0",
      description:
        "Machine interface for reading and operating one Farcaster account through an owned Snapchain node.",
    },
    servers: [{ url: origin }],
    paths: {
      "/agent/health": {
        get: {
          summary: "Check the gateway, client, and read node",
          responses: { "200": { description: "Healthy" }, "503": { description: "Unavailable" } },
        },
      },
      "/agent/v1/profile": {
        get: paidGet("Read the client account, storage, signer, and node state", options.metadataPrice),
      },
      "/agent/v1/feed": {
        get: paidGet("Read the chronological feed from the owned Snapchain node", options.readPrice),
      },
      "/agent/v1/sources": {
        get: paidGet("Read every observed app and exact signer source", options.metadataPrice),
      },
      "/agent/v1/casts": {
        post: {
          summary: "Publish a cast",
          description: writeCapabilityNote,
          security: writeSecurity,
          requestBody: jsonBody({
            type: "object",
            additionalProperties: false,
            required: ["text"],
            properties: {
              text: { type: "string", minLength: 1, maxLength: 1024 },
              embedUrl: { type: "string", format: "uri", maxLength: 2048 },
              parentCastId: castIdSchema(),
            },
          }),
          responses: { "201": { description: "Cast accepted by a validator" }, "401": { description: "Write capability required" }, ...paidResponses },
          "x-price": options.writePrice,
        },
      },
      "/agent/v1/follows": {
        post: {
          summary: "Follow or unfollow an FID",
          description: writeCapabilityNote,
          security: writeSecurity,
          requestBody: jsonBody({
            type: "object",
            additionalProperties: false,
            required: ["targetFid"],
            properties: {
              targetFid: { type: "integer", minimum: 1 },
              remove: { type: "boolean", default: false },
            },
          }),
          responses: { "201": { description: "Link accepted by a validator" }, "401": { description: "Write capability required" }, ...paidResponses },
          "x-price": options.writePrice,
        },
      },
      "/agent/v1/reactions": {
        post: {
          summary: "Add or remove a like or recast",
          description: writeCapabilityNote,
          security: writeSecurity,
          requestBody: jsonBody({
            type: "object",
            additionalProperties: false,
            required: ["type", "targetFid", "targetHash"],
            properties: {
              type: { type: "string", enum: ["like", "recast"] },
              targetFid: { type: "integer", minimum: 1 },
              targetHash: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
              remove: { type: "boolean", default: false },
            },
          }),
          responses: { "201": { description: "Reaction accepted by a validator" }, "401": { description: "Write capability required" }, ...paidResponses },
          "x-price": options.writePrice,
        },
      },
    },
    components: {
      securitySchemes: {
        x402: {
          type: "apiKey",
          in: "header",
          name: "X-PAYMENT",
          description: "Created automatically by buy curl or the buy MCP server.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Owner-issued write capability stored in .state/agent.env.",
        },
      },
    },
  };
}

function paidGet(summary: string, price: string) {
  return {
    summary,
    security: [{ x402: [] }],
    responses: {
      "200": { description: "Successful response" },
      "402": { description: "Payment Required; use buy quote or buy curl on Celo" },
      "429": { description: "Rate limit exceeded" },
      "500": { description: "Upstream operation failed; inspect the payment receipt before retrying" },
    },
    "x-price": price,
  };
}

function jsonBody(schema: Record<string, unknown>) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

function castIdSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["fid", "hash"],
    properties: {
      fid: { type: "integer", minimum: 1 },
      hash: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
    },
  };
}
