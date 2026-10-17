import { decodeAbiParameters, type Hex } from "viem";
import { FARCASTER_EPOCH_MS } from "./constants.js";
import type {
  FeedCast,
  MessagePage,
  OnChainSignerEvent,
  Profile,
  SnapchainMessage,
} from "./types.js";

const REQUEST_TIMEOUT_MS = 8_000;

async function requestJson<T>(baseUrl: string, path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Snapchain ${path} returned HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

function encodeQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
}

export class SnapchainReader {
  readonly baseUrl: string;
  private readonly profileCache = new Map<number, { value: Profile; expiresAt: number }>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  info(): Promise<Record<string, unknown>> {
    return requestJson(this.baseUrl, "/v1/info");
  }

  storage(fid: number): Promise<Record<string, unknown>> {
    return requestJson(this.baseUrl, `/v1/storageLimitsByFid?fid=${fid}`);
  }

  links(fid: number, pageSize = 50): Promise<MessagePage> {
    return requestJson(
      this.baseUrl,
      `/v1/linksByFid?${encodeQuery({ fid, pageSize })}`,
    );
  }

  casts(fid: number, pageSize = 20): Promise<MessagePage> {
    return requestJson(
      this.baseUrl,
      `/v1/castsByFid?${encodeQuery({ fid, pageSize, reverse: "true" })}`,
    );
  }

  userData(fid: number): Promise<MessagePage> {
    return requestJson(this.baseUrl, `/v1/userDataByFid?fid=${fid}`);
  }

  signerEvents(fid: number): Promise<{ events: OnChainSignerEvent[] }> {
    return requestJson(this.baseUrl, `/v1/onChainSignersByFid?fid=${fid}`);
  }

  async profile(fid: number): Promise<Profile> {
    const cached = this.profileCache.get(fid);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const page = await this.userData(fid);
    const fields = new Map<string, string>();
    for (const message of page.messages) {
      const body = message.data?.userDataBody;
      if (body?.type && body.value) fields.set(body.type, body.value);
    }

    const profile: Profile = {
      fid,
      username: fields.get("USER_DATA_TYPE_USERNAME") ?? `fid:${fid}`,
      displayName:
        fields.get("USER_DATA_TYPE_DISPLAY") ??
        fields.get("USER_DATA_TYPE_USERNAME") ??
        `FID ${fid}`,
      bio: fields.get("USER_DATA_TYPE_BIO") ?? "",
      pfpUrl: safeImageUrl(fields.get("USER_DATA_TYPE_PFP")),
    };
    this.profileCache.set(fid, { value: profile, expiresAt: Date.now() + 300_000 });
    return profile;
  }

  async feed(ownerFid: number): Promise<FeedCast[]> {
    const links = await this.links(ownerFid, 50);
    const followed = links.messages
      .filter((message) => message.data?.linkBody?.type === "follow")
      .map((message) => message.data?.linkBody?.targetFid)
      .filter((fid): fid is number => typeof fid === "number");

    const fids = [...new Set([ownerFid, ...followed])].slice(0, 36);
    const batches: MessagePage[] = [];
    for (let offset = 0; offset < fids.length; offset += 6) {
      const slice = fids.slice(offset, offset + 6);
      batches.push(...(await Promise.all(slice.map((fid) => this.casts(fid, 8)))));
    }

    const messages = batches
      .flatMap((page) => page.messages)
      .filter(isCastAdd)
      .sort((a, b) => (b.data?.timestamp ?? 0) - (a.data?.timestamp ?? 0))
      .slice(0, 80);

    const profiles = new Map<number, Profile>();
    const authorFids = [...new Set(messages.map((message) => message.data?.fid).filter(
      (fid): fid is number => typeof fid === "number",
    ))];
    await Promise.all(
      authorFids.map(async (fid) => {
        profiles.set(fid, await this.profile(fid));
      }),
    );

    return messages.map((message) => {
      const fid = message.data?.fid as number;
      const body = message.data?.castAddBody;
      const rawTimestamp = message.data?.timestamp ?? 0;
      return {
        fid,
        hash: message.hash ?? "",
        text: body?.text ?? "",
        timestamp: new Date(FARCASTER_EPOCH_MS + rawTimestamp * 1000).toISOString(),
        timestampRaw: rawTimestamp,
        signer: (message.signer ?? "").toLowerCase(),
        profile: profiles.get(fid) ?? fallbackProfile(fid),
        embeds: body?.embeds ?? [],
        parentCastId: body?.parentCastId ?? null,
      };
    });
  }

  async requestFidForSigner(fid: number, signer: string): Promise<number | null> {
    const { events } = await this.signerEvents(fid);
    const normalized = signer.toLowerCase();
    const event = [...events]
      .reverse()
      .find(
        (candidate) =>
          candidate.signerEventBody?.key?.toLowerCase() === normalized &&
          candidate.signerEventBody.eventType === "SIGNER_EVENT_TYPE_ADD" &&
          candidate.signerEventBody.metadataType === 1,
      );
    const metadata = event?.signerEventBody?.metadata;
    if (!metadata) return null;

    try {
      const bytes = metadata.startsWith("0x")
        ? metadata
        : (`0x${Buffer.from(metadata, "base64").toString("hex")}` as Hex);
      const [decoded] = decodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "requestFid", type: "uint256" },
              { name: "requestSigner", type: "address" },
              { name: "signature", type: "bytes" },
              { name: "deadline", type: "uint256" },
            ],
          },
        ],
        bytes as Hex,
      );
      return Number(decoded.requestFid);
    } catch {
      return null;
    }
  }
}

function isCastAdd(message: SnapchainMessage): boolean {
  return (
    message.data?.type === "MESSAGE_TYPE_CAST_ADD" &&
    typeof message.data.fid === "number" &&
    Boolean(message.hash)
  );
}

function safeImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function fallbackProfile(fid: number): Profile {
  return {
    fid,
    username: `fid:${fid}`,
    displayName: `FID ${fid}`,
    bio: "",
    pfpUrl: null,
  };
}
