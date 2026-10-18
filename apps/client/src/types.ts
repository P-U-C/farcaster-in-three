export interface SnapchainMessage {
  data?: {
    type?: string;
    fid?: number;
    timestamp?: number;
    castAddBody?: {
      text?: string;
      embeds?: Array<{ url?: string; castId?: { fid?: number; hash?: string } }>;
      parentCastId?: { fid?: number; hash?: string } | null;
      parentUrl?: string | null;
    };
    linkBody?: {
      type?: string;
      targetFid?: number;
    };
    userDataBody?: {
      type?: string;
      value?: string;
    };
  };
  hash?: string;
  signer?: string;
}

export interface MessagePage {
  messages: SnapchainMessage[];
  nextPageToken?: string;
}

export interface Profile {
  fid: number;
  username: string;
  displayName: string;
  bio: string;
  pfpUrl: string | null;
}

export interface FeedCast {
  fid: number;
  hash: string;
  text: string;
  timestamp: string;
  timestampRaw: number;
  signer: string;
  profile: Profile;
  embeds: Array<{ url?: string; castId?: { fid?: number; hash?: string } }>;
  parentCastId: { fid?: number; hash?: string } | null;
}

export interface Source {
  signer: string;
  requestFid: number | null;
  label: string;
  isThisClient: boolean;
}

export interface SignerInfo {
  source?: string;
  key?: string;
  fid?: number;
  requestFid?: number;
  onChainEvent?: {
    signerEventBody?: {
      key?: string;
      eventType?: string;
      metadata?: string;
      metadataType?: number;
    };
  };
}
