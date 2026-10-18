export const FARCASTER_EPOCH_MS = Date.UTC(2021, 0, 1);

export const CONTRACTS = {
  idGateway: "0x00000000fc25870c6ed6b6c7e41fb078b7656f69",
  idRegistry: "0x00000000fc6c5f01fc30151999387bb99a9f489b",
} as const;

export const PUBLIC_OP_RPC_URLS = [
  "https://mainnet.optimism.io",
  "https://optimism-rpc.publicnode.com",
] as const;
