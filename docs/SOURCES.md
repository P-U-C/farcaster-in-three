# Source Ledger

This is the evidence behind the implementation, not a setup guide. Start with the [README](../README.md).

Verified on 2026-10-18 UTC. Dates and versions are recorded because the protocol documentation changed shortly before this release.

## Prize

- Original cast: https://farcaster.xyz/balajis.eth/0x50184b62
- Author FID: 37
- Cast hash: `0x50184b62b4c52fd76628713562e1eda3dccaf63d`
- Posted: 2026-10-17 14:47:30 UTC
- Deadline: 2026-10-24 14:47:30 UTC

The cast referred to tutorials `[1,2,3,4]`, but its public payload had no URL or image embeds. This project uses current official Farcaster and Snapchain material as primary evidence.

## Snapchain release

- Repository: https://github.com/farcasterxyz/snapchain
- Release: `v0.14.3`
- Commit: `fc87f2686472598143062a00e1c2b2633b2d87ab`
- Release date: 2026-10-15
- x86-64 image manifest: `sha256:fa9c9de2fb5205680ef8dbfd29e42dd60c889bcaff57589c9bb7a66d59fb9694`
- `validators.toml` SHA-256: `ca9912d2c3fae0ceeea8f921d878f9d844343241679af6f7127bfd84b809aaab`
- License: GPL-3.0
- Getting started: https://snapchain.farcaster.xyz/getting-started
- Node roles: https://snapchain.farcaster.xyz/node-types
- HTTP API: https://snapchain.farcaster.xyz/reference/httpapi/httpapi
- Submit endpoint: https://snapchain.farcaster.xyz/reference/httpapi/message

The pinned image was inspected on 2026-10-17. It has `/usr/bin/bash` and lacks `curl` and `wget`; the health check therefore uses Bash `/dev/tcp`.

Published resource guidance:

- 4 CPU cores
- 16 GB RAM
- 1.5 TB free storage
- public IP
- HTTP 3381
- QUIC gossip 3382
- gRPC 3383

The deployment keeps HTTP/gRPC private and exposes gossip.

## Read-node write behavior

The official node-types documentation was corrected in commit `cd3805...` on 2026-10-09:

- Both validators and read nodes expose `POST /v1/submitMessage`.
- A read node validates an incoming message and gossips it to validators.
- A read node does not maintain a mempool or propose blocks.
- A successful response means accepted for relay, not included in consensus.

In Three therefore uses the owned read node for reads and writes. It does not carry a list of public validator HTTP endpoints. Confirmation requires observing the resulting message in synced node state.

## Gasless app signers

- Official writing guide: https://snapchain.farcaster.xyz/guides/writing-messages
- SDK helper implementation: https://github.com/farcasterxyz/hub-monorepo/pull/2738
- Writing-guide update commit: `fa4ce09...` on 2026-07-30
- `@farcaster/hub-nodejs`: 0.17.0
- `@farcaster/core`: 0.20.0

Current app-key registration uses a gasless `KEY_ADD` Snapchain message:

- the custody account gives EIP-712 authorization;
- the fresh Ed25519 key signs the protocol message;
- scopes constrain allowed message classes;
- TTL uses a sliding window capped at 90 days;
- nonce is per FID;
- `GET /v1/signersByFid` returns unified onchain and gasless signer records.

App-key authorization requires no Optimism transaction or OP ETH. This release scopes the signer to cast add/remove, reaction add/remove, link add/remove, and public profile metadata via user-data add. It does not authorize custody transfer, funds, or key management.

Creating a new test account is separate: it calls IdGateway `register(address recovery)` once on OP Mainnet. The payable registration includes an FID and one storage unit. Setup reads the live `price()`, adds an explicit gas reserve, signs locally, and persists the exact transaction before broadcast.

Onchain registries remain relevant for FID ownership and storage:

- Protocol: https://github.com/farcasterxyz/protocol
- Contracts: https://github.com/farcasterxyz/contracts
- IdGateway: `0x00000000fc25870c6ed6b6c7e41fb078b7656f69`
- IdRegistry: `0x00000000fc6c5f01fc30151999387bb99a9f489b`
- StorageRegistry: `0x00000000fcce7f938e7ae6d3c335bd6a1a7c593d`
- Chain: OP Mainnet, chain ID 10
- Default BIP-44 path used by this developer tutorial: `m/44'/60'/0'/0/0`

Current setup has two independent recovery boundaries: a locally signed IdGateway account-registration transaction for new accounts, and a signed gasless `KEY_ADD` message for app-key authorization. Legacy v0.1.0 KeyGateway recovery remains readable but is not used for new setup.

## Developer custody guidance

A recovery phrase gives full account control. The default path generates one locally for a disposable test account, encrypts it with the client password using scrypt and AES-256-GCM, and stores the kit in the owner-only local `.state/` directory without printing or uploading the phrase. The import path accepts an existing test phrase through hidden terminal input. Testers should inspect and trust the code, protect the recovery kit and password separately, and never use a valuable account. Production client onboarding should use delegated signer authorization through a trusted wallet and should not collect raw phrases.

## Operator image

- Distribution: architecture-specific Docker archives and SHA-256 files attached to each tagged GitHub release
- Local image: `puc/farcaster-in-three:<version>`
- Node base: `node:22.22.0-bookworm-slim`
- Base manifest: `sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94`
- Platforms: linux/amd64 and linux/arm64
- Build definition: `Dockerfile.operator`
- Runtime entrypoint: prebuilt `in-three` package

Tagged builds compile and smoke-test each platform image before publishing its archive and SHA-256 file. The image records the source URL, version, and commit revision. The launcher uses a read-only root, host UID/GID, dropped capabilities, `no-new-privileges`, and no Docker socket.

## Infrastructure and price

Checked on 2026-10-17:

- Hetzner price adjustment: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- Hetzner Cloud: https://www.hetzner.com/cloud/
- API: https://docs.hetzner.cloud/reference/cloud
- Ashburn CCX33: $165.99/month before tax
- Volume: $0.0484/GiB-month
- 2,048 GiB volume: $157.08/month in the live 2026-10-19 quote
- CCX33 server: $165.99/month in the same quote
- Public IPv4: $0.60/month in the same quote
- Default total: $323.67/month gross; about $6.22 for 12 hours or $12.45 for 24 hours at the quoted hourly rate

The provider console is authoritative. Paid-deployment preflight reads the live plan and performs a temporary SSH-key create/delete probe before payment.

## Agent payments

Versions verified on 2026-10-18:

- `@celo/buy@0.8.3`
- `@x402/core@2.28.0`
- `@x402/evm@2.28.0`
- `@x402/hono@2.28.0`
- `@x402/fetch@2.28.0`
- `@coinbase/cdp-sdk@1.59.0`
- x402 specification: https://github.com/x402-foundation/x402
- usebuy.ai source: https://github.com/celo-org/buy-skill
- Buyer docs: https://usebuy.ai/docs
- Celo x402: https://docs.celo.org/build/agents/x402
- Discovery: https://docs.celo.org/build/agents/x402-get-discovered
- Coinbase facilitator: https://docs.cdp.coinbase.com/x402/welcome
- Celo: `eip155:42220`; USDC `0xcebA9300f2b948710d2653dD7B07f33A8B32118C`
- Base: `eip155:8453`; USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

One x402 v2 response can advertise both payment requirements. In Three returns equal Celo and Base offers. The pinned usebuy.ai wallet selects Celo and uses the OS keychain for mainnet. Its file keystore is explicitly development-only and refuses mainnet; the container does not override that rule. The container's one-payment path uses the separate quote-first, capped Base buyer.

Settlement happens before the upstream action, so a paid request may still fail or remain unconfirmed. Receipts must be resolved before retry.

usebuy.ai's hosted CPU product offers short jobs, not a durable multi-terabyte volume. In Three uses x402 for discovery, payment, and access while Snapchain remains on persistent buyer-owned compute.

## Revenue split

Verified on 2026-10-17:

- `@0xsplits/splits-sdk@6.7.0`
- SDK: https://splits.org/protocol/docs/sdk/splits-v2/
- Contracts: https://splits.org/protocol/docs/core/split-v2/
- Chains: https://splits.org/protocol/help/chains/
- Split Factory V2.2 on Celo/Base: `0x6B9118074aB15142d7524E8c4ea8f62A3Bdb98f1`

The same recipient set, immutable owner, Push type, version, and salt produce one deterministic address on both chains. Allocation is 95% operator and 5% P-U-C with a 0.1% permissionless distribution incentive. No bridge runs during purchase.
