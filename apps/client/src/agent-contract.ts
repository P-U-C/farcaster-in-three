import { FARCASTER_CAST_MAX_BYTES } from "./limits.js";

export interface AgentContractOptions {
  origin: string;
  readPrice: string;
  metadataPrice: string;
  writePrice: string;
  deployPrice: string;
  payTo: string;
  operatorPayTo: string;
  royaltyPayTo: string;
  royaltyBps: number;
}

const writeCapabilityNote =
  "Requires an owner-issued Bearer capability in addition to x402 payment.";

export function createAgentManifest(options: AgentContractOptions) {
  const origin = options.origin.replace(/\/$/, "");
  return {
    schemaVersion: "1.0",
    name: "In Three Farcaster client",
    description:
      "One-purchase deployment and paid operation of a sovereign Farcaster client backed by its own Snapchain read node.",
    origin,
    protocol: {
      payment: "x402",
      version: 2,
      networks: ["eip155:42220", "eip155:8453"],
      token: "USDC",
      clients: ["@celo/buy@0.8.3", "@x402/core@2.28.0"],
      facilitators: [
        "https://api.x402.celo.org",
        "https://api.cdp.coinbase.com/platform/v2/x402",
      ],
    },
    discovery: {
      openapi: `${origin}/agent/openapi.json`,
      health: `${origin}/agent/health`,
    },
    authorization: {
      reads: "x402 payment",
      writes: "x402 payment plus owner-issued Bearer capability",
      deployment: "one x402 payment; infrastructure and custody credentials stay buyer-controlled",
    },
    prices: {
      profile: options.metadataPrice,
      feed: options.readPrice,
      sources: options.metadataPrice,
      cast: options.writePrice,
      follow: options.writePrice,
      reaction: options.writePrice,
      deployment: options.deployPrice,
    },
    economics: {
      payTo: options.payTo,
      operatorPayTo: options.operatorPayTo,
      royaltyPayTo: options.royaltyPayTo,
      royaltyBps: options.royaltyBps,
      operatorBps: 10_000 - options.royaltyBps,
      distributorIncentiveBps: 10,
      policy: "immutable 0xSplits V2 contract on each advertised chain",
    },
    safety: [
      "Quote the exact request before payment and enforce a maximum amount.",
      "Do not blindly retry after a paid timeout or ambiguous settlement.",
      "Never expose the cloud token, write capability, wallet key, custody phrase, or payment authorization.",
      "Deployment requires a dedicated buyer-owned Hetzner project; recurring infrastructure is billed separately.",
    ],
  };
}

export function createAgentOpenApi(options: AgentContractOptions) {
  const origin = options.origin.replace(/\/$/, "");
  const paidResponses = {
    "400": { description: "Invalid request; gateway refusals occur before payment where possible" },
    "402": { description: "Payment Required; choose Celo or Base from the x402 v2 offers" },
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
        "Machine interface for deploying, reading, and operating a Farcaster client through an owned Snapchain node.",
    },
    servers: [{ url: origin }],
    paths: {
      "/agent/health": {
        get: {
          summary: "Check the gateway, client, and read node",
          responses: { "200": { description: "Healthy" }, "503": { description: "Unavailable" } },
        },
      },
      "/agent/v1/deployments/preflight": {
        post: {
          summary: "Validate the fixed deployment plan before payment",
          requestBody: jsonBody(deploymentRequestSchema()),
          responses: {
            "200": { description: "Hetzner token and fixed plan validated; no payment occurred" },
            "400": { description: "Invalid deployment request" },
            "502": { description: "Hetzner rejected the token or plan" },
          },
        },
      },
      "/agent/v1/deployments/status": {
        post: {
          summary: "Recover deployment state without paying again",
          requestBody: jsonBody({
            type: "object",
            additionalProperties: false,
            required: ["deploymentId", "hetznerToken"],
            properties: {
              deploymentId: deploymentIdProperty(),
              hetznerToken: hetznerTokenProperty(),
            },
          }),
          responses: {
            "200": { description: "Existing deployment found" },
            "404": { description: "No deployment found for that ID" },
          },
        },
      },
      "/agent/v1/deployments/resume": {
        post: {
          summary: "Resume an entitled deployment without another payment",
          description:
            "Available only when the broker durably recorded the matching paid request.",
          requestBody: jsonBody(deploymentRequestSchema()),
          responses: {
            "200": { description: "Existing idempotent deployment returned" },
            "201": { description: "Entitled Hetzner resources created and Snapchain bootstrap queued" },
            "403": { description: "No matching paid entitlement" },
            "502": { description: "Hetzner rejected the operation" },
          },
        },
      },
      "/agent/v1/deployments": {
        post: {
          summary: "Provision In Three and start Snapchain",
          description:
            "One x402 setup payment. Hetzner infrastructure is billed separately. Reuse the same deploymentId for recovery.",
          security: [{ x402: [] }],
          requestBody: jsonBody(deploymentRequestSchema()),
          responses: {
            "200": { description: "Existing idempotent deployment returned" },
            "201": { description: "Hetzner resources created and Snapchain bootstrap queued" },
            ...paidResponses,
          },
          "x-price": options.deployPrice,
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
              text: {
                type: "string",
                minLength: 1,
                maxLength: FARCASTER_CAST_MAX_BYTES,
                description: `At most ${FARCASTER_CAST_MAX_BYTES} UTF-8 bytes`,
              },
              embedUrl: { type: "string", format: "uri", maxLength: 2048 },
              parentCastId: castIdSchema(),
            },
          }),
          responses: { "201": { description: "Cast accepted for relay by the owned read node" }, "401": { description: "Write capability required" }, ...paidResponses },
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
          responses: { "201": { description: "Link accepted for relay by the owned read node" }, "401": { description: "Write capability required" }, ...paidResponses },
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
          responses: { "201": { description: "Reaction accepted for relay by the owned read node" }, "401": { description: "Write capability required" }, ...paidResponses },
          "x-price": options.writePrice,
        },
      },
    },
    components: {
      securitySchemes: {
        x402: {
          type: "apiKey",
          in: "header",
          name: "PAYMENT-SIGNATURE",
          description: "x402 v2 payment payload. usebuy creates the Celo payload; any conforming x402 v2 client may select Base.",
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
      "402": { description: "Payment Required; choose Celo or Base from the x402 v2 offers" },
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

function deploymentRequestSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["deploymentId", "hetznerToken", "sshPublicKey", "sourceCidr"],
    properties: {
      deploymentId: deploymentIdProperty(),
      hetznerToken: hetznerTokenProperty(),
      sshPublicKey: {
        type: "string",
        pattern: "^ssh-ed25519 ",
        description: "Public key only. The broker never receives the SSH private key.",
      },
      sourceCidr: {
        type: "string",
        description: "One IPv4 or IPv6 CIDR permitted to reach SSH.",
        examples: ["203.0.113.7/32"],
      },
    },
  };
}

function deploymentIdProperty() {
  return {
    type: "string",
    pattern: "^dep-[a-z0-9]{16,59}$",
    description: "Client-generated idempotency key reused for status and recovery.",
  };
}

function hetznerTokenProperty() {
  return {
    type: "string",
    minLength: 20,
    writeOnly: true,
    description:
      "Read/write token for an otherwise empty dedicated Hetzner project. Used in memory, never returned, and represented after payment only by a SHA-256 entitlement binding.",
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
