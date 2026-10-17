# Source Ledger

Verified on 2026-10-17 UTC.

## Prize

- Original cast: https://farcaster.xyz/balajis.eth/0x50184b62
- Author FID: 37
- Cast hash: `0x50184b62b4c52fd76628713562e1eda3dccaf63d`
- Posted: 2026-10-17 14:47:30 UTC
- Exact seven-day deadline: 2026-10-24 14:47:30 UTC

The cast text refers to tutorials `[1,2,3,4]`, but its public cast payload contains no URL or image embeds. This project therefore treats current official Farcaster and Snapchain materials as primary references.

## Snapchain

- Repository: https://github.com/farcasterxyz/snapchain
- Release: `v0.14.3`
- Release commit: `fc87f2686472598143062a00e1c2b2633b2d87ab`
- Release date: 2026-10-15
- x86-64 image manifest: `sha256:fa9c9de2fb5205680ef8dbfd29e42dd60c889bcaff57589c9bb7a66d59fb9694`
- `validators.toml` SHA-256: `ca9912d2c3fae0ceeea8f921d878f9d844343241679af6f7127bfd84b809aaab`
- License: GPL-3.0
- Node guide: https://snapchain.farcaster.xyz/getting-started
- Node roles: https://snapchain.farcaster.xyz/node-types
- HTTP API: https://snapchain.farcaster.xyz/reference/httpapi/httpapi
- Message submission: https://snapchain.farcaster.xyz/reference/httpapi/message

The exact pinned image was inspected on 2026-10-17: it includes `/usr/bin/bash` and does not include `curl` or `wget`. The Compose health check therefore uses Bash's `/dev/tcp` support and does not depend on a removed HTTP utility.

Resource guidance from the release documentation:

- 4 CPU cores
- 16 GB RAM
- 1.5 TB free storage
- public IP
- HTTP 3381, QUIC gossip 3382, gRPC 3383

This deployment keeps HTTP/gRPC private and publishes gossip. The client runs on the same Docker network, and Snapchain retains outbound peer access.

## Infrastructure pricing

Checked on 2026-10-17:

- Hetzner 2026 price adjustment: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner Cloud volume pricing: https://www.hetzner.com/cloud/
- Ashburn CCX33: $165.99/month before tax
- Volumes: $0.0484/GiB-month; 2,048 GiB is approximately $99.12/month
- Default recurring estimate: approximately $265/month before IPv4, traffic, or tax

The provider console is authoritative because region, tax, and future pricing can differ.

## Protocol and contracts

- Protocol: https://github.com/farcasterxyz/protocol
- Contracts: https://github.com/farcasterxyz/contracts
- IdRegistry: `0x00000000fc6c5f01fc30151999387bb99a9f489b`
- StorageRegistry: `0x00000000fcce7f938e7ae6d3c335bd6a1a7c593d`
- KeyRegistry: `0x00000000fc1237824fb747abde0ff18990e59b7e`
- KeyGateway: `0x00000000fc56947c7e7183f8ca4b62398caadf0b`
- SignedKeyRequestValidator: `0x00000000fc700472606ed4fa22623acf62c60553`
- Chain: OP Mainnet, chain ID 10
- Key type: 1, Ed25519
- Metadata type: 1, SignedKeyRequest
- Default BIP-44 path: `m/44'/60'/0'/0/0`

## SDK

- `@farcaster/hub-nodejs`: 0.17.0, MIT
- `@farcaster/core`: 0.20.0, MIT
- Message builders automatically populate `dataBytes`, which Snapchain requires.
- Official writing guide: https://snapchain.farcaster.xyz/guides/writing-messages

## Validator write endpoints

The mainnet bootstrap validators were probed on 2026-10-17. Three served Snapchain HTTP `/v1/info` without an API key and reported version 0.14.2:

- `http://54.157.62.17:3381`
- `http://107.20.169.236:3381`
- `http://108.132.114.186:3381`

These are configurable defaults, not permanent guarantees. The writer retries transport and 5xx failures and surfaces semantic 4xx rejection immediately.
