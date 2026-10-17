# Operations

## One-purchase deployment

```bash
./farcaster deploy --service https://YOUR_BROKER
```

Use a dedicated, otherwise-empty Hetzner project and a read/write token. The command generates the SSH key locally, validates the fixed `ash` / `ccx33` / 2,048 GiB plan, proves cloud write access, prints the x402 quote, and requires `BUY DEPLOY`. Its default payment ceiling is 25 USDC.

The broker fee is paid once. Hetzner charges the buyer separately until teardown. After provisioning, the same command waits for cloud-init, runs node setup, waits through snapshot bootstrap, and opens the local client key ceremony. Pressing Ctrl-C during bootstrap is safe; rerun `./farcaster deploy` and it resumes from `.state/config` without another payment.

Before payment, the command writes a random deployment ID. Immediately before `buy curl`, it also records the broker origin, SSH source CIDR, usebuy.ai account, and `.state/deployment-payment.pending`. On an interrupted response, rerunning checks the free status route. If the broker recorded the paid entitlement but provisioning did not finish, the command uses the free resume route. If neither exists, it stops and requires `buy --account in-three receipts --resolve`; it does not automatically buy again.

Local deployment files:

- `.state/deployment-id`: random idempotency key.
- `.state/deployment-service`: exact broker origin used for the purchase.
- `.state/deployment-source-cidr`: exact firewall input bound to the entitlement.
- `.state/deployment-buy-account`: exact usebuy.ai account authorized for the purchase.
- `.state/deployment-payment.pending`: blocks a second automatic purchase until recovery is resolved.
- `.state/deploy-receipt.txt`: x402 response receipt when returned.
- `.state/config`: Hetzner resource IDs and host connection state after success.

None contains the Hetzner token. Rotate the project token after the host is available, and retain a separate token for teardown.

## Sync

```bash
./farcaster node status
./farcaster node logs
```

The first start downloads a public snapshot, decompresses it to `/srv/in-three/data/rocks`, and catches up from peers. This commonly takes hours. `node up` waits long enough to detect an immediate container failure, then returns success when bootstrap is still running. It does not require the HTTP API to be ready. Avoid restarting during snapshot extraction.

While the API is offline, `node status` reports the container state, snapshot/database sizes, disk use, and recent bootstrap log lines. Rerun it without restarting the node. Once the API responds, a healthy, current node reports shard block delays in single digits; the CLI marks all delays under 30 seconds as ready.

Disk growth is protocol dependent. Alert before free space falls below 15%. The 2 TiB default is a starting point, not a perpetual capacity guarantee.

## Client

```bash
./farcaster client create
./farcaster client status
./farcaster client logs
```

`client create` first checks the local Snapchain API. If bootstrap is incomplete, it remains attached, reports snapshot/database/disk progress every five minutes, and continues automatically when the API responds. It does not request the custody phrase or register a key while waiting. Pressing Ctrl-C only stops the local wait; the remote node keeps bootstrapping and rerunning command 2 is safe.

Before running command 2, create a facilitator key at [x402.celo.org](https://x402.celo.org/) and confirm its settlement balance. The key is entered in a hidden prompt before the custody phrase. On success, the command prints the browser and agent surfaces:

```text
URL           https://203-0-113-10.sslip.io
agent API     https://203-0-113-10.sslip.io/.well-known/agent.json
agent access  .state/agent.env
read path     browser or paid agent -> client service -> your Snapchain node
write path    authorized paid agent -> client service -> validator
```

The public health routes confirm that both browser and agent paths can query the configured read node. Browser routes use the signed session cookie. Agent routes use Celo x402; writes additionally require the capability in `.state/agent.env`. Follow is available in the desktop sidebar and from a dedicated narrow-screen control.

See [AGENT-API.md](AGENT-API.md) for exact buy CLI and MCP requests.

To use your own domain:

1. Point an A record to the server IP.
2. Change `CLIENT_DOMAIN` in `/srv/in-three/.env`.
3. Run `cd /srv/in-three && sudo docker compose up -d caddy`.
4. Confirm the new certificate and then stop using the `sslip.io` hostname.

## Cost

The default Ashburn deployment is approximately **$265/month before IPv4, traffic, or tax** at the rates checked on 2026-10-17:

- CCX33: $165.99/month
- 2,048 GiB volume at $0.0484/GiB-month: about $99.12/month

The provider console is authoritative. Confirm the displayed total before typing `PROVISION` or `BUY DEPLOY`, and use `./farcaster destroy` when the node is no longer needed.

The one-purchase path adds a default 25 USDC broker automation fee. That is a one-time x402 request, not infrastructure credit. The manual three-command path has no broker fee.

Agent API defaults are 0.002 USDC for profile/source metadata, 0.005 USDC for a feed read, and 0.02 USDC for a write. These are receipts to the configured payout address, not infrastructure discounts. Celo's facilitator separately charges its published settlement fee from the operator's facilitator balance. The 402 and facilitator dashboard are authoritative.

## Agent gateway

```bash
curl https://YOUR_CLIENT/.well-known/agent.json
buy quote https://YOUR_CLIENT/agent/v1/feed
buy curl --max-amount 0.005 https://YOUR_CLIENT/agent/v1/feed
```

Runtime files:

- `/srv/in-three/client.env`: Farcaster signer and browser secrets; no buy credentials.
- `/srv/in-three/agent-gateway.env`: facilitator key, payout address, prices, and write capability; no Farcaster signer.
- `/srv/in-three/data/deployer`: mode-0700 paid entitlement records, writable only by the non-root deployer container UID.
- `.state/agent.env`: local public origin and write capability for an authorized agent.

To change prices, edit `BUY_AGENT_READ_PRICE`, `BUY_AGENT_METADATA_PRICE`, `BUY_AGENT_WRITE_PRICE`, or `BUY_DEPLOY_PRICE` in the gateway environment and run `sudo docker compose up -d agent-gateway`. Keep the token symbol USDC.

To rotate write access, replace `AGENT_WRITE_TOKEN` with a new 32-byte base64url value in both the remote gateway environment and local `.state/agent.env`, then restart the gateway. Existing agents stop at 401 before payment.

## Upgrades

Never replace a digest with `latest`.

1. Read the Snapchain release notes and migration guidance.
2. Record the release tag, commit, platform image digest, and validator-manifest SHA-256.
3. Update `deploy/docker-compose.yml`, `scripts/node.sh`, the tutorial, and source ledger together.
4. Run the automated test and visual suites.
5. Start a fresh node or snapshot/backup the existing volume.
6. Verify block delays and API compatibility before declaring the version supported.

Client upgrades rebuild from the local committed lockfile:

```bash
./farcaster client create
```

That command currently registers a new signer. For a UI-only upgrade, copy the source archive and run the remote Compose build manually rather than creating another key.

## Backup and recovery

Snapchain database:

- Rebuildable from a verified public snapshot.
- Large and write-heavy; crash-consistent volume snapshots are preferable to file copies.
- Stop Snapchain before a manual filesystem snapshot when possible.

App key:

- Stored in `/srv/in-three/client.env` after a successful deployment.
- Before broadcast, `.state/client.env.pending` stores the app key, serialized signed registration transaction, locally calculated hash, registration status, facilitator key, and generated agent capability with mode 0600.
- If broadcast returns an error, keep the file: the RPC may have accepted the transaction. Rerun `./farcaster client create`; it validates the saved hash, rebroadcasts the exact signed bytes, and checks the receipt without asking for the phrase or creating a different transaction.
- The serialized custody transaction is removed as soon as registration confirms.
- Recovery and payment metadata are stripped before `client.env` is uploaded to the host.
- The facilitator key and write capability are isolated in `agent-gateway.env`; the gateway receives no Farcaster signer.
- The local pending file is deleted only after both public HTTPS health checks pass, with a best-effort overwrite when `shred` is available.
- Backing up the deployed app key preserves client identity but expands the compromise surface.
- Losing it does not affect custody; register a new signer and revoke the old public key.

Local state:

- `.state/config` identifies cloud resources.
- `.state/deployment-*` files bind an interrupted paid attempt to the original broker, deployment ID, and firewall CIDR; no cloud token is stored.
- `.state/deploy-receipt.txt` stores the returned x402 receipt when available.
- `.state/id_ed25519` operates the host.
- `.state/client.env.pending` may temporarily hold the delegated key, facilitator key, agent capability, and fixed registration transaction during recovery.
- `.state/agent.env` holds the public API origin and owner write capability.
- All are excluded from Git and should be backed up only to an encrypted operator vault.

## Failure modes

| Symptom | First check |
| --- | --- |
| Node API unavailable during first start | `./farcaster node status`; wait while snapshot/database size changes |
| Node container stopped | `./farcaster node logs` |
| Block delay rising | UDP 3382 firewall, peer errors, disk saturation |
| Snapshot loops | Free disk, volume mount, release notes |
| Client 503 health | Snapchain container health and internal DNS |
| Login fails | Correct deployment password; cookie domain/HTTPS |
| Agent read returns 402 | Expected unpaid quote; use buy with an exact maximum |
| Agent write returns 401 | Supply the current owner capability; no payment occurred |
| Facilitator returns 401/402 | Rotate the API key or fund its settlement balance |
| Paid agent request is ambiguous | Do not retry; preserve output and run `buy --account in-three receipts --resolve` |
| Paid deployment interrupted | Keep `.state/deployment-payment.pending`; rerun `./farcaster deploy` to recover or resume without buying again |
| Paid deployment has no entitlement | Do not remove the marker or repay; resolve the receipt and contact the broker with deployment ID and transaction only |
| Hetzner rejects after payment | Correct project quota/token issues, then rerun the free entitled resume path |
| Validator rejects write | FID storage, signer onchain state, clock, text limits |
| TLS pending | A/AAAA resolution, ports 80/443, Caddy logs; keep `.state/client.env.pending` and rerun create |
| Setup interrupted after registration | Keep `.state/client.env.pending`; rerun `./farcaster client create` |
| SSH fails after IP change | Update Hetzner firewall source CIDR in console |

## Teardown

```bash
./farcaster destroy
```

The command deletes the server, data volume, firewall, and generated provider SSH key. Check the provider console for resources labeled `managed-by=in-three`.
