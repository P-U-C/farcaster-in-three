# Operations

This is the reference for running and repairing In Three. Start with the shorter [README](../README.md).

Examples use the container launcher. With npm, replace `./in-three-container` with `in-three`. From source, use `./farcaster`.

## Normal setup

Install once:

```bash
mkdir in-three-node
cd in-three-node
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.4/in-three-container
chmod +x in-three-container
./in-three-container doctor
```

Then run:

```bash
./in-three-container provision
./in-three-container node up
./in-three-container client create
```

Keep the working directory. Its owner-only `.state/` directory contains the SSH key, resource IDs, recovery state, and cached operator image.

Expected handoff after each command:

```text
provision      server IP, client hostname, local state path, next command
node up        API-ready status or bootstrap progress and status commands
client create  waits for Snapchain, registers an app key, prints HTTPS URL
```

Every command is resumable. Do not delete `.state/` while an operation is incomplete or uncertain.

## Node sync

The first start downloads and extracts a large snapshot, then catches up from peers. This normally takes hours.

```bash
./in-three-container node status
./in-three-container node logs
```

Before the API is ready, status shows the container state, snapshot size, database size, disk use, and recent logs. Once ready, it shows shard delay. Delays below 30 seconds are treated as synced.

Do not restart Snapchain while it is extracting the snapshot. Investigate before free disk falls below 15%; 2 TiB is a starting size, not a permanent guarantee.

## Browser client

The default command deploys only the browser client:

```bash
./in-three-container client create
```

It asks for:

1. A browser password.
2. Confirmation that this is a disposable test account.
3. The test account recovery phrase through hidden terminal input.
4. Final confirmation before submitting a gasless app-key message.

No OP ETH or Optimism transaction is required.

The phrase stays in the local setup process. The server receives only the revocable app key. That key can cast, follow, and react; it cannot move wallet funds.

When setup finishes:

```text
URL           https://203-0-113-10.sslip.io
read path     browser -> client service -> your Snapchain node
write path    browser -> client service -> your node -> validator gossip
custody key   not stored
```

Check it later with:

```bash
./in-three-container client status
./in-three-container client logs
```

A successful `POST /v1/submitMessage` means the node accepted the message for relay. Read it back from the synced node to confirm inclusion.

## Optional paid agent access

Use this only when you want the x402 API:

```bash
./in-three-container client create --with-agent
```

In addition to the normal client inputs, this asks for a Celo x402 facilitator key and Coinbase CDP credentials. It configures Celo/Base USDC payment routes and deploys the separate gateway and deployment service.

Choosing the normal browser setup avoids all payment credentials. To add agent commerce later, rerun with `--with-agent`; it creates a replacement app key, so revoke the previous key after confirming the new deployment.

See [AGENT-API.md](AGENT-API.md) for prices, routes, capabilities, receipts, and the one-payment deployment service.

## Recovery

During app-key setup, `.state/client.env.pending` may temporarily contain:

- the delegated app key
- the exact signed gasless `KEY_ADD` message, hash, and checksum
- optional Celo/Base split transactions
- optional facilitator credentials and agent capability

It never contains the recovery phrase or derived custody private key.

If setup stops after signing, keep the file and rerun the same `client create` command. Recovery checks current node state before resubmitting the exact saved bytes. Confirmed payloads are removed, and the file is deleted after the deployed service passes health checks.

Losing the app key does not affect custody. Authorize a replacement and revoke the old key.

## Cost

The default Ashburn plan was about **$265/month** when checked on 2026-10-17:

| Resource | Approximate monthly cost |
| --- | ---: |
| CCX33 server | $165.99 |
| 2,048 GiB volume | $99.12 |

IPv4, traffic, tax, and provider price changes are extra. The Hetzner console is authoritative. Read the displayed total before typing `PROVISION`.

Optional agent prices default to 0.002 USDC for metadata, 0.005 USDC for a feed, and 0.02 USDC for a write. The automated deployment purchase is 25 USDC and does not include cloud costs.

## Custom domain

The default hostname uses `sslip.io`. To use your own domain:

1. Point an A record to the server.
2. Change `CLIENT_DOMAIN` in `/srv/in-three/.env`.
3. Run `cd /srv/in-three && sudo docker compose up -d caddy`.
4. Confirm HTTPS works before retiring the old hostname.

## Failure guide

| Symptom | First action |
| --- | --- |
| Node API unavailable on first start | Run `node status`; wait while snapshot or database size changes |
| Snapchain stopped | Run `node logs` and check disk space |
| Shard delay keeps rising | Check UDP 3382, peer errors, CPU, and disk saturation |
| Client health is 503 | Check Snapchain health, then `client logs` |
| Login fails | Check password, hostname, HTTPS, and cookie scope |
| Message accepted but absent | Wait for sync, then retry the same signed action |
| TLS remains pending | Check DNS and ports 80/443 |
| Setup stopped after signing | Keep the pending file and rerun `client create` |
| Agent read returns 402 | This is the payment quote |
| Agent write returns 401 | Supply the owner capability; no payment occurred |
| Paid result is ambiguous | Preserve the receipt and do not retry blindly |

## Upgrade

Do not replace pinned images with `latest`.

1. Read the Snapchain release notes.
2. Record the release tag, image digest, and validator-manifest checksum.
3. Update Compose, scripts, tutorial, and [source ledger](SOURCES.md) together.
4. Run package, container, shell, application, and visual checks.
5. Back up or replace the node volume.
6. Verify API compatibility and shard delay.

## Teardown

```bash
./in-three-container destroy
```

Then confirm in Hetzner that no server, volume, firewall, or IP labeled `managed-by=in-three` remains.
