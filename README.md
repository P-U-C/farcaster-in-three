# In Three

Run your own Farcaster node and client in three commands.

[Website](https://farcaster.permanentupperclass.com/) | [Latest release](https://github.com/P-U-C/farcaster-in-three/releases/latest) | [Operations](docs/OPERATIONS.md) | [Security](SECURITY.md) | [Agent API](docs/AGENT-API.md)

In Three creates a cloud server, starts a Snapchain read node, and deploys a browser client. The client reads from your node and sends signed writes back to it. The node validates those writes and relays them to Farcaster validators.

No hosted Farcaster data or write API is used.

## Before you start

You need:

- Docker on macOS or Linux
- a Hetzner Cloud token from a new, empty project
- a disposable Farcaster test account with an FID and storage
- time for the initial Snapchain sync, which commonly takes hours
- a budget of roughly $265/month for the default server and 2 TiB volume, before tax, traffic, or provider price changes

> **Use a test account only.** A recovery phrase controls the account. Enter one only into source you have inspected and trust. Never send it through chat or use an account that holds value. Production clients should use delegated wallet authorization.

## Quickstart

Get the small container launcher:

```bash
mkdir in-three-node
cd in-three-node
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.2/in-three-container
chmod +x in-three-container
./in-three-container doctor
```

Then run the three commands:

```bash
./in-three-container provision
./in-three-container node up
./in-three-container client create
```

What happens:

1. `provision` shows the billable plan, asks for `PROVISION`, and creates the server, volume, firewall, and SSH key.
2. `node up` starts Snapchain and returns while the first snapshot continues downloading.
3. `client create` waits for Snapchain, reports progress, creates a gasless app key, and prints the HTTPS client URL.

Command 2 does not ask for the recovery phrase until the node is ready.

## First cast

1. Open the HTTPS URL printed by `client create`.
2. Sign in with the password you created.
3. Select **New cast**, write a test message, and publish it.
4. Refresh until your node returns the cast.
5. Verify the same cast in another Farcaster client.
6. Try a follow, a like, a recast, and the source filters.

The first write response means the node accepted the message for relay. A later read from the synced node confirms inclusion.

## Install choices

### Container launcher

Recommended for most operators. It downloads the correct amd64 or arm64 image from the tagged GitHub release, verifies its SHA-256 file, and loads it into Docker.

The container runs as your user with a read-only root filesystem, dropped capabilities, and no Docker socket mount. State stays in `.state/` in the current directory.

### Prebuilt npm package

The release tarball contains the compiled CLI, server, and browser assets:

```bash
npm install --global https://github.com/P-U-C/farcaster-in-three/releases/download/v0.1.2/farcaster-in-three-0.1.2.tgz
mkdir in-three-node && cd in-three-node
in-three doctor
```

### Source checkout

Use this when reviewing or changing the implementation:

```bash
git clone https://github.com/P-U-C/farcaster-in-three.git
cd farcaster-in-three
./farcaster doctor
```

For package or source installs, replace `./in-three-container` with `in-three` or `./farcaster`.

## What gets deployed

| Part | Purpose |
| --- | --- |
| Hetzner server + 2 TiB volume | Persistent compute and Snapchain data |
| Snapchain read node | Reads protocol state, validates writes, and relays them to validators |
| Browser client | Feed, casts, follows, reactions, and source filters |
| Scoped app key | Signs Farcaster actions; cannot move wallet funds |
| Caddy | HTTPS and password-protected browser access |
| Agent gateway | Optional paid x402 access on Celo and Base |

App-key authorization is gasless. It does not require an Optimism transaction.

## Operations

```bash
./in-three-container node status
./in-three-container node logs
./in-three-container client status
./in-three-container client logs
./in-three-container destroy
```

Run `destroy` when finished, then verify that the resources are gone in the Hetzner console.

Setup is resumable. If signer submission is uncertain, keep `.state/client.env.pending` and rerun `client create`. The command checks node state before resubmitting the exact saved message.

## For agents

Each deployment publishes `/.well-known/agent.json`.

- Paid reads use x402 v2 USDC on Celo or Base.
- Paid writes require both payment and an owner-issued capability.
- Funds settle on the chain the buyer selects; no bridge is required.
- The default revenue split is 95% to the operator and 5% to P-U-C.

See [docs/AGENT-API.md](docs/AGENT-API.md) for discovery, routes, prices, payment examples, and the public agent skill.

## Read more

| Question | Document |
| --- | --- |
| What output should I expect? How do I recover or upgrade? | [Operations](docs/OPERATIONS.md) |
| What talks to what? | [Architecture](docs/ARCHITECTURE.md) |
| How are phrases, app keys, and containers handled? | [Security](SECURITY.md) |
| How do agents discover and pay for the API? | [Agent API](docs/AGENT-API.md) |
| Which Farcaster and Snapchain references does this use? | [Primary sources](docs/SOURCES.md) |
| How can I complete the independent test? | [Voucher runbook](VOUCHER.md) |
| What are the human and agent testing bounties? | [Tester bounty](TESTER-BOUNTY.md) |

## Development

```bash
npm ci
npm run check
npm run build
npm audit --audit-level=moderate
docker build -f Dockerfile.operator -t in-three-operator:test .
docker run --rm in-three-operator:test doctor
node scripts/visual-check.mjs
```

Automated tests cover provisioning templates, setup recovery, gasless signer registration, read-node writes, source filtering, mobile Follow access, x402 payment bounds, production builds, and desktop/mobile rendering.

They do not prove that paid cloud provisioning, a multi-terabyte mainnet sync, and a public cast work end to end. That requires the independent [voucher run](VOUCHER.md).

## License

Original code and documentation are [MIT licensed](LICENSE). The deployment runs Farcaster's GPL-3.0 Snapchain image by immutable digest; that image keeps its upstream license.
