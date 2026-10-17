# In Three

**A three-command path from bare compute to a sovereign Farcaster client.**

[Microsite and tutorial](https://farcaster.permanentupperclass.com/) | [Paid agent API](docs/AGENT-API.md) | [Architecture](docs/ARCHITECTURE.md) | [Security model](SECURITY.md) | [Human voucher](VOUCHER.md)

In Three provisions compute, starts a Snapchain read node, registers a delegated Farcaster app key, and deploys a responsive client. Reads come from the node you operate. Signed writes go directly to a validator. The custody phrase is used locally for one Optimism transaction and is never installed on the host.

A running In Three instance can also sell the complete provisioning step through Celo x402. One paid request creates the fixed Hetzner server, volume, firewall, and SSH key, then starts Snapchain. The buyer still owns the cloud account and completes the custody ceremony locally. The deployed client publishes the same paid API for agents: public paid reads and capability-gated paid writes.

![Illustrative In Three client preview using synthetic accounts and casts](site/public/client-preview.webp)

*Illustrative preview. The generated image uses synthetic accounts and casts; a deployed client reads live protocol data from its own node.*

## One-purchase deployment

Install and fund usebuy.ai's pinned buyer, then point the repository at a running In Three broker:

```bash
npm install -g @celo/buy@0.8.3
buy setup --name in-three
./farcaster deploy --service https://YOUR_BROKER
```

The command performs a free cloud-token and plan preflight, shows the x402 quote, and asks for `BUY DEPLOY` before spending. The default ceiling is **25 USDC once** for automation. Hetzner bills the buyer separately for the server, IPv4 address, traffic, tax, and 2 TiB volume until `./farcaster destroy` succeeds.

The command generates the SSH key locally, saves a client-generated deployment ID, buys once, starts Snapchain, waits through snapshot bootstrap, and then opens the same local password, facilitator-key, and custody prompts used by command 2. If the paid response is interrupted, rerun the command: it checks the saved deployment and durable entitlement before it can consider another payment.

Use a new, otherwise-empty Hetzner project with a read/write token, and rotate that token after deployment. The chosen broker receives it over HTTPS for provisioning and keeps only a SHA-256 entitlement binding, not the token. The SSH private key and custody phrase never leave the operator machine.

## Three commands

The manual path remains available and does not send the Hetzner token to a broker. Clone the repository once:

```bash
git clone https://github.com/P-U-C/farcaster-in-three.git
cd farcaster-in-three
```

Then:

```bash
./farcaster provision
./farcaster node up
./farcaster client create
```

The commands are interactive at the boundaries that cost money or grant authority:

- `provision` shows the billable infrastructure plan and requires `PROVISION`.
- `client create` simulates `KeyGateway.add` and requires `REGISTER`.
- `destroy` names the data being deleted and requires `DESTROY`.

## What gets built

| Layer | Implementation | Trust boundary |
| --- | --- | --- |
| Compute | Hetzner CCX host, 2 TiB volume, dedicated SSH key | Manual path keeps the token local; paid path sends it to the selected broker over HTTPS |
| Deployment broker | Fixed-plan Hetzner provisioner behind one 25 USDC x402 request | Persists a token hash and request binding, never the cloud token or SSH private key |
| Read node | Snapchain 0.14.3, image pinned by digest | HTTP/gRPC private; QUIC gossip public |
| Signer | Fresh Ed25519 key registered on OP Mainnet | Custody mnemonic exists only in local process memory |
| Client | React UI + Node service + official Farcaster builders | Stores only the revocable app key |
| Edge | Caddy 2.10.2 with automatic TLS | Password protected, signed HttpOnly session cookie |
| Agent gateway | <code>@celo/buy-gateway</code> 0.8.3, Celo x402, USDC | Facilitator key isolated from the Farcaster signer |
| Writes | Binary protobuf to a live validator endpoint | No hosted Farcaster API key |

The reference client reads a chronological feed from follows and casts, publishes casts, follows FIDs, likes, and recasts. It exposes every discovered signer source, groups keys with the same decoded SignedKeyRequest requester, and retains exact-key controls when attribution is unavailable.

## Requirements

Operator machine:

- Linux or macOS
- Bash, curl, jq, SSH, tar, OpenSSL, Node.js 22+, npm
- `sha256sum` on Linux or `shasum` on macOS
- `@celo/buy` 0.8.3 and a funded Celo USDC buyer wallet for the one-purchase path
- A Hetzner Cloud API token with resource creation permissions
- A Celo x402 facilitator key created at [x402.celo.org](https://x402.celo.org/)

Farcaster account:

- Existing FID and custody recovery phrase
- At least one storage unit
- Enough ETH on Optimism for one signer-registration transaction

Node:

- Public IPv4 address
- 4 or more vCPU
- 16 GiB or more RAM
- At least 1.5 TB free storage

Run `./farcaster doctor` before provisioning.

## Operations

```bash
./farcaster node status
./farcaster node logs
./farcaster client status
./farcaster client logs
./farcaster destroy
```

The initial verified snapshot is several hundred gigabytes and commonly takes hours to download, decompress, and catch up. `node up` treats a running bootstrap as success and returns progress commands instead of timing out. `node status` reports snapshot/database growth until the API is online, then each available shard delay; under 30 seconds is treated as ready. `client create` waits with periodic snapshot and disk progress, then continues automatically. It does not request a phrase or register a signer while waiting.

Before broadcast, setup stores the app key, serialized signed registration transaction, locally calculated hash, facilitator key, and generated agent capability in owner-only `.state/client.env.pending`. If the RPC response is lost or a later step fails, rerun `./farcaster client create`; it safely rebroadcasts those exact bytes and checks the receipt without another custody signature. Serialized custody transaction data is removed after confirmation. The pending file is deleted after both browser and agent health checks pass, with a best-effort overwrite when `shred` is available.

The paid path stores `.state/deployment-id`, `.state/deployment-service`, `.state/deployment-source-cidr`, and `.state/deployment-buy-account` so a rerun uses the identical request and buyer. A payment-pending marker blocks automatic repurchase until the saved deployment or entitlement is recovered. It never stores the Hetzner token.

Command 2 also writes owner-only `.state/agent.env`. Its public origin and bearer capability let an authorized agent buy write actions; paid reads need no bearer capability. See [docs/AGENT-API.md](docs/AGENT-API.md) for deployment, prices, buy CLI/MCP usage, receipts, and listing steps.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for exact output, costs, upgrades, recovery, domain changes, and key incidents.

## Verification

```bash
npm ci
npm run check
npm audit --audit-level=moderate
bash -n farcaster scripts/*.sh scripts/lib/*.sh scripts/test/*.sh deploy/snapchain-entrypoint.sh
docker run --rm -v "$PWD:/mnt:ro" -w /mnt koalaman/shellcheck:stable farcaster scripts/*.sh scripts/lib/*.sh scripts/test/*.sh deploy/snapchain-entrypoint.sh
node scripts/visual-check.mjs
```

The automated suite covers:

- scrypt password verification and signed-session expiry
- Farcaster SignedKeyRequest ABI encoding
- usebuy.ai x402 pricing, discovery, pre-payment write authorization, and the 25 USDC deployment route
- idempotent Hetzner resource creation, write-token preflight, durable entitlement recovery, and no-second-payment shell behavior
- strict separation of client, payment, and local agent secrets
- protobuf cast construction and binary validator submission
- feed assembly and signer attribution through a mock Snapchain HTTP API
- production builds and TypeScript checks
- desktop and mobile browser rendering, narrow-screen Follow access, complete source controls, overflow, and console-error checks
- dependency audit

A local test cannot substitute for a full 1.5 TB mainnet sync. Prize qualification therefore has a separate, non-negotiable [human voucher runbook](VOUCHER.md).

## Repository map

```text
farcaster                 three-command operator entrypoint
scripts/                  provisioning, deployment, status, teardown
deploy/                   pinned Snapchain/Caddy Compose definition
apps/client/src/           auth, node reader, message writer, key ceremony
apps/client/web/           responsive reference client
site/                      public tutorial microsite
skills/in-three/           installable paid-agent operating skill
docs/                      architecture, agent API, operations, source ledger
```

## Security

This is security-conscious reference software, not audited wallet software. Read [SECURITY.md](SECURITY.md) before entering a custody phrase.

The strongest guarantee is architectural: the custody phrase never reaches the provisioned machine. A compromised client host can post as the FID until its app key is revoked, but it cannot sign Ethereum transactions or transfer custody.

## Licensing

All original code and documentation in this repository are MIT licensed.

The deployment runs the official `farcasterxyz/snapchain` image, which is GPL-3.0 licensed. The image is referenced by immutable digest and is not copied into or relicensed by this repository. Caddy and all npm dependencies retain their own licenses.
