import {
  CastType,
  FarcasterNetwork,
  makeCastAdd,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  Message,
  NobleEd25519Signer,
  ReactionType,
  type HubAsyncResult,
  type HubMessage,
  type HubSigner,
} from "./farcaster-sdk.js";
import type { AppConfig } from "./config.js";

interface CastInput {
  text: string;
  parentCastId?: { fid: number; hash: string };
  embedUrl?: string;
}

interface ReactionInput {
  type: "like" | "recast";
  targetFid: number;
  targetHash: string;
  remove?: boolean;
}

export class FarcasterWriter {
  private readonly signer: HubSigner;
  private readonly dataOptions;
  private readonly validators: string[];

  constructor(config: AppConfig) {
    this.signer = new NobleEd25519Signer(new Uint8Array(Buffer.from(config.SIGNER_PRIVATE_KEY, "hex")));
    this.dataOptions = {
      fid: config.FID,
      network: FarcasterNetwork.MAINNET,
    };
    this.validators = config.validatorUrls;
  }

  async cast(input: CastInput) {
    const result = await makeCastAdd(
      {
        text: input.text,
        embeds: input.embedUrl ? [{ url: input.embedUrl }] : [],
        embedsDeprecated: [],
        mentions: [],
        mentionsPositions: [],
        type: CastType.CAST,
        ...(input.parentCastId
          ? {
              parentCastId: {
                fid: input.parentCastId.fid,
                hash: new Uint8Array(Buffer.from(input.parentCastId.hash.slice(2), "hex")),
              },
            }
          : {}),
      },
      this.dataOptions,
      this.signer,
    );
    return this.submit(unwrap(result));
  }

  async follow(targetFid: number, remove = false) {
    if (remove) {
      const result = await makeLinkRemove(
        { type: "follow", targetFid },
        this.dataOptions,
        this.signer,
      );
      return this.submit(unwrap(result));
    }
    const result = await makeLinkAdd(
      { type: "follow", targetFid },
      this.dataOptions,
      this.signer,
    );
    return this.submit(unwrap(result));
  }

  async react(input: ReactionInput) {
    const type = input.type === "like" ? ReactionType.LIKE : ReactionType.RECAST;
    const body = {
      type,
      targetCastId: {
        fid: input.targetFid,
        hash: new Uint8Array(Buffer.from(input.targetHash.slice(2), "hex")),
      },
    };
    if (input.remove) {
      const result = await makeReactionRemove(body, this.dataOptions, this.signer);
      return this.submit(unwrap(result));
    }
    const result = await makeReactionAdd(body, this.dataOptions, this.signer);
    return this.submit(unwrap(result));
  }

  private async submit(message: HubMessage) {
    const payload = Message.encode(message).finish();
    const errors: string[] = [];

    for (const validator of this.validators) {
      try {
        const response = await fetch(`${validator}/v1/submitMessage`, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/octet-stream",
          },
          body: Buffer.from(payload),
          signal: AbortSignal.timeout(10_000),
        });

        const text = await response.text();
        if (response.ok) {
          return {
            validator,
            hash: `0x${Buffer.from(message.hash).toString("hex")}`,
            response: text ? JSON.parse(text) : null,
          };
        }

        // A semantic rejection will be identical at every validator.
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Validator rejected the message (HTTP ${response.status}): ${text}`);
        }
        errors.push(`${validator}: HTTP ${response.status}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("Validator rejected")) throw error;
        errors.push(`${validator}: ${message}`);
      }
    }

    throw new Error(`No validator accepted the message. ${errors.join("; ")}`);
  }
}

function unwrap<T>(result: Awaited<HubAsyncResult<T>>): T {
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return result.value;
}
