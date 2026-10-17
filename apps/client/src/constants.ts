export const FARCASTER_EPOCH_MS = Date.UTC(2021, 0, 1);

export const CONTRACTS = {
  idRegistry: "0x00000000fc6c5f01fc30151999387bb99a9f489b",
  keyRegistry: "0x00000000fc1237824fb747abde0ff18990e59b7e",
  keyGateway: "0x00000000fc56947c7e7183f8ca4b62398caadf0b",
  signedKeyRequestValidator: "0x00000000fc700472606ed4fa22623acf62c60553",
} as const;

export const DEFAULT_VALIDATORS = [
  "http://54.157.62.17:3381",
  "http://107.20.169.236:3381",
  "http://108.132.114.186:3381",
] as const;

export const PUBLIC_OP_RPC_URLS = [
  "https://mainnet.optimism.io",
  "https://optimism-rpc.publicnode.com",
] as const;

export const KEY_TYPE_ED25519 = 1;
export const METADATA_TYPE_SIGNED_KEY_REQUEST = 1;
