# Operations

Examples below use the container launcher. For an npm install, replace `./in-three-container` with `in-three`. For a source checkout, use `./farcaster`.

## Install

```bash
mkdir in-three-node
cd in-three-node
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.3/in-three-container
chmod +x in-three-container
./in-three-container doctor
```

On first use, the launcher downloads the matching amd64 or arm64 Docker archive from release `v0.1.3`, verifies its published SHA-256 file, and loads the local image `puc/farcaster-in-three:0.1.3`. It runs that image as your UID/GID and mounts the current directory at `/work`. Keep using this directory. State and the cached image archive remain under `.state/`.

The release page exposes both the archive and checksum for independent verification before handling wallet or cloud credentials.

## Manual deployment

```bash
./in-three-container provision
./in-three-container node up
./in-three-container client create
```

Expected handoffs:

```text
provision      server IP, future HTTPS URL, state path, next command
node up        either API-ready or "bootstrap is running" plus status commands
client create  waits for API, runs local key ceremony, deploys client and gateway
```

The commands are resumable from the working directory. Do not delete `.state/` during a live or uncertain operation.

## One-payment deployment

Inside the container, use a dedicated low-balance Base wallet:

```bash
./in-three-container deploy \
  --service https://YOUR_BROKER \
  --payment-network base
```

The command:

1. Generates an SSH key and deployment ID locally.
2. Proves that the dedicated Hetzner token can create resources.
3. Displays the fixed `ash` / `ccx33` / 2,048 GiB plan.
4. Fetches the exact x402 quote.
5. Requires `BUY DEPLOY` before a payment with a default ceiling of 25 USDC.
6. Persists the returned resource IDs and continues into node and client setup.

Use a new, otherwise-empty Hetzner project. Rotate its token after provisioning and retain a separate token for teardown.

A payment marker is written before purchase. If the response is interrupted, rerun the identical command. It uses free status/resume routes and will not buy again automatically. If no entitlement can be recovered, preserve the marker and receipt, inspect the Base wallet history, and contact the broker with the deployment ID. Do not remove the marker or pay again.

Local paid-deployment files:

- `.state/deployment-id`: idempotency key
- `.state/deployment-service`: broker origin
- `.state/deployment-source-cidr`: SSH firewall input
- `.state/deployment-payment-network`: selected rail
- `.state/deployment-payment.pending`: repurchase block
- `.state/deploy-receipt.txt`: returned x402 receipt
- `.state/config`: resource IDs after success

For Celo, use the host-installed `@celo/buy@0.8.3` package and its OS keychain. The development-only file keystore refuses mainnet and is not enabled in this container.

## Node bootstrap

```bash
./in-three-container node status
./in-three-container node logs
```

The first start downloads and extracts a large public snapshot, then catches up from peers. This commonly takes hours. `node up` checks for immediate failure and returns while healthy bootstrap continues. Do not restart Snapchain during extraction.

Before the API is available, status reports:

- container state
- snapshot size
- database size
- disk use
- recent bootstrap log lines

Once the API responds, status reports shard delay. All shard delays below 30 seconds are marked ready. Alert before free space falls below 15%; 2 TiB is a starting size, not a permanent capacity guarantee.

## Client setup

```bash
./in-three-container client create
./in-three-container client status
./in-three-container client logs
```

`client create` opens a temporary SSH tunnel to the node's private HTTP port. If the API is not ready, it reports progress every five minutes and continues automatically. It does not ask for a phrase while waiting.

Prepare:

- an otherwise disposable Farcaster test account with storage
- a Celo x402 facilitator key
- a Coinbase CDP Secret API key
- small native balances on Celo/Base only if their deterministic split contracts are absent

No OP ETH is required for app-key registration.

Setup validates the browser password and facilitator credentials first. It then prints the phrase safety warning and requires `TEST ACCOUNT`. After local signing it displays:

```text
signer cost    gasless
signer scopes  casts, reactions, and follows only
signer life    90-day sliding window
write path     authorized client -> your read node -> validator gossip
```

The exact gasless `KEY_ADD` protobuf is stored before submission. Setup sends it through the local tunnel, waits for the signer in `/v1/signersByFid`, and uploads only the delegated key.

Successful `POST /v1/submitMessage` means accepted for relay. It is not block inclusion. Confirm the resulting signer or social message by reading it back from the synced node.

After deployment, the command prints:

```text
URL           https://203-0-113-10.sslip.io
agent API     https://203-0-113-10.sslip.io/.well-known/agent.json
agent access  .state/agent.env
read path     browser or paid agent -> client service -> your Snapchain node
write path    authorized client -> your read node -> validator gossip
```

To use your own domain:

1. Point an A record to the server.
2. Change `CLIENT_DOMAIN` in `/srv/in-three/.env`.
3. Run `cd /srv/in-three && sudo docker compose up -d caddy`.
4. Confirm the new certificate before retiring the `sslip.io` hostname.

## Recovery files

`.state/client.env.pending` is owner-only and may temporarily contain:

- delegated app key
- exact gasless `KEY_ADD` protobuf, message hash, and checksum
- exact Celo/Base split transactions and local hashes
- facilitator credentials
- generated agent write capability
- setup statuses

It never contains the phrase or derived EVM private key.

On an uncertain result, keep the file and rerun `client create`. Gasless recovery checks current signer state first, verifies the saved protobuf, and resubmits only those bytes. Split recovery checks receipts and rebroadcasts only the saved transactions. Payloads are removed as they confirm. The file is deleted after both public health checks pass.

Current releases can also recover a pending v0.1.0 Optimism registration transaction. This compatibility path is not used for new signers.

Runtime separation:

- `/srv/in-three/client.env`: app signer and browser secrets
- `/srv/in-three/agent-gateway.env`: facilitator credentials, prices, split data, write capability
- `/srv/in-three/data/deployer`: paid entitlement records
- `.state/agent.env`: local public origin and owner capability

Losing the app key does not affect custody. Authorize a replacement and revoke the old public key.

## Cost

Rates checked on 2026-10-17 put the default Ashburn deployment near **$265/month before IPv4, traffic, and tax**:

- CCX33: $165.99/month
- 2,048 GiB volume at $0.0484/GiB-month: about $99.12/month

The provider console is authoritative. Confirm its displayed total before `PROVISION` or `BUY DEPLOY`.

The broker's default automation price is 25 USDC once. It is not infrastructure credit. Agent defaults are 0.002 USDC for metadata, 0.005 USDC for a feed, and 0.02 USDC for a write. Each payment uses the immutable 95% operator / 5% P-U-C split plus a 0.1% distribution incentive. No bridge runs during checkout.

## Agent gateway

```bash
curl https://YOUR_CLIENT/.well-known/agent.json
buy quote https://YOUR_CLIENT/agent/v1/feed
buy curl --max-amount 0.005 https://YOUR_CLIENT/agent/v1/feed
```

Reads require payment. Writes require the capability in `.state/agent.env` before a payment challenge is returned.

To change prices, edit `BUY_AGENT_READ_PRICE`, `BUY_AGENT_METADATA_PRICE`, `BUY_AGENT_WRITE_PRICE`, or `BUY_DEPLOY_PRICE` in the remote gateway environment and restart `agent-gateway`.

To rotate write access, replace `AGENT_WRITE_TOKEN` in the remote gateway environment and local `.state/agent.env`, then restart the gateway. Old callers stop at HTTP 401 before payment.

See [AGENT-API.md](AGENT-API.md) for request and receipt handling.

## Upgrades

Never replace an image digest with `latest`.

1. Read Snapchain release notes and migrations.
2. Record the tag, commit, image digest, and validator-manifest SHA-256.
3. Update Compose, node script, tutorial, and source ledger together.
4. Run code, package, container, shell, and visual tests.
5. Back up or replace the node volume.
6. Verify API compatibility and shard delay.

`client create` registers a new app key when no pending setup exists. Do not use it as a casual UI-update command.

## Failure guide

| Symptom | First action |
| --- | --- |
| API unavailable during first start | Run `node status`; wait while snapshot/database size changes |
| Node stopped | Read `node logs` |
| Shard delay rises | Check UDP 3382, peer errors, and disk saturation |
| Snapshot loops | Check free disk, volume mount, and release notes |
| Client health is 503 | Check Snapchain health and internal DNS |
| Login fails | Verify password, hostname, and HTTPS cookie scope |
| Agent read is 402 | Expected quote; pay once with an exact maximum |
| Agent write is 401 | Supply the current owner capability; no payment occurred |
| Paid response is ambiguous | Preserve receipt and do not retry blindly |
| Paid deployment was interrupted | Keep payment marker; rerun the same deploy command |
| Read node rejects a message | Check FID storage, signer state/scopes/TTL, clock, and field limits |
| Message was accepted but absent | Wait for sync, then resubmit the same signed bytes if still absent |
| TLS remains pending | Check DNS, ports 80/443, and Caddy logs |
| Setup stopped mid-broadcast | Keep the pending file and rerun `client create` |

## Teardown

```bash
./in-three-container destroy
```

Confirm in Hetzner that no resources labeled `managed-by=in-three` remain.
