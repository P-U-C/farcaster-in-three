import {
  CastType,
  FarcasterNetwork,
  makeCastAdd,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  makeUserDataAdd,
  Message,
  NobleEd25519Signer,
  ReactionType,
  UserDataType,
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

export interface ProfileInput {
  displayName?: string;
  bio?: string;
  pfpUrl?: string;
  url?: string;
  username?: string;
}

export class FarcasterWriter {
  private readonly signer: HubSigner;
  private readonly fid: number;
  private readonly writeNodeUrl: string;

  constructor(config: AppConfig) {
    this.signer = new NobleEd25519Signer(new Uint8Array(Buffer.from(config.SIGNER_PRIVATE_KEY, "hex")));
    this.fid = config.FID;
    this.writeNodeUrl = config.WRITE_NODE_URL;
  }

  private dataOptions() {
    return {
      fid: this.fid,
      network: FarcasterNetwork.MAINNET,
    };
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
      this.dataOptions(),
      this.signer,
    );
    return this.submit(unwrap(result));
  }

  async follow(targetFid: number, remove = false) {
    if (remove) {
      const result = await makeLinkRemove(
        { type: "follow", targetFid },
        this.dataOptions(),
        this.signer,
      );
      return this.submit(unwrap(result));
    }
    const result = await makeLinkAdd(
      { type: "follow", targetFid },
      this.dataOptions(),
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
      const result = await makeReactionRemove(body, this.dataOptions(), this.signer);
      return this.submit(unwrap(result));
    }
    const result = await makeReactionAdd(body, this.dataOptions(), this.signer);
    return this.submit(unwrap(result));
  }

  async updateProfile(input: ProfileInput) {
    const fields = [
      ["displayName", UserDataType.DISPLAY, input.displayName],
      ["bio", UserDataType.BIO, input.bio],
      ["pfpUrl", UserDataType.PFP, input.pfpUrl],
      ["url", UserDataType.URL, input.url],
      ["username", UserDataType.USERNAME, input.username],
    ] as const;
    const receipts = [];
    for (const [field, type, value] of fields) {
      if (value === undefined) continue;
      const result = await makeUserDataAdd(
        { type, value },
        this.dataOptions(),
        this.signer,
      );
      receipts.push({ field, ...(await this.submit(unwrap(result))) });
    }
    return receipts;
  }

  private async submit(message: HubMessage) {
    const payload = Message.encode(message).finish();
    let response: Response;
    try {
      response = await fetch(`${this.writeNodeUrl}/v1/submitMessage`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/octet-stream",
        },
        body: Buffer.from(payload),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`The read node could not relay the message: ${detail}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `The read node rejected the message (HTTP ${response.status}): ${text}`,
      );
    }

    return {
      node: this.writeNodeUrl,
      relay: "accepted" as const,
      hash: `0x${Buffer.from(message.hash).toString("hex")}`,
      response: text ? JSON.parse(text) : null,
    };
  }
}

function unwrap<T>(result: Awaited<HubAsyncResult<T>>): T {
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return result.value;
}
