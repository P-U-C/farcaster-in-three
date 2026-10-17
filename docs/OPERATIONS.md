# Operations

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

`client create` first checks the local Snapchain API. If bootstrap is incomplete, it remains attached, reports snapshot/database/disk progress every five minutes, and continues automatically when the API responds. It does not request the custody phrase or register a key while waiting. Pressing Ctrl-C only stops the local wait; the remote node keeps bootstrapping and rerunning command 2 is safe. On success, it prints both paths:

```text
read path     browser -> client service -> your Snapchain node
write path    browser -> client service -> validator
```

The public health route confirms the service can query its configured read node. Authenticated routes expose profile, storage, feed, source filters, and write actions. Follow is available in the desktop sidebar and from a dedicated narrow-screen control.

To use your own domain:

1. Point an A record to the server IP.
2. Change `CLIENT_DOMAIN` in `/srv/in-three/.env`.
3. Run `cd /srv/in-three && sudo docker compose up -d caddy`.
4. Confirm the new certificate and then stop using the `sslip.io` hostname.

## Cost

The default Ashburn deployment is approximately **$265/month before IPv4, traffic, or tax** at the rates checked on 2026-10-17:

- CCX33: $165.99/month
- 2,048 GiB volume at $0.0484/GiB-month: about $99.12/month

The provider console is authoritative. Confirm the displayed total before typing `PROVISION`, and use `./farcaster destroy` when the node is no longer needed.

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
- Before broadcast, `.state/client.env.pending` stores the app key, serialized signed registration transaction, locally calculated hash, and registration status with mode 0600.
- If broadcast returns an error, keep the file: the RPC may have accepted the transaction. Rerun `./farcaster client create`; it validates the saved hash, rebroadcasts the exact signed bytes, and checks the receipt without asking for the phrase or creating a different transaction.
- The serialized custody transaction is removed as soon as registration confirms.
- Recovery metadata is stripped before `client.env` is uploaded to the host.
- The local pending file is securely removed only after the public HTTPS health check passes.
- Backing up the deployed app key preserves client identity but expands the compromise surface.
- Losing it does not affect custody; register a new signer and revoke the old public key.

Local state:

- `.state/config` identifies cloud resources.
- `.state/id_ed25519` operates the host.
- `.state/client.env.pending` may temporarily hold a delegated key during recovery.
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
| Validator rejects write | FID storage, signer onchain state, clock, text limits |
| TLS pending | A/AAAA resolution, ports 80/443, Caddy logs; keep `.state/client.env.pending` and rerun create |
| Setup interrupted after registration | Keep `.state/client.env.pending`; rerun `./farcaster client create` |
| SSH fails after IP change | Update Hetzner firewall source CIDR in console |

## Teardown

```bash
./farcaster destroy
```

The command deletes the server, data volume, firewall, and generated provider SSH key. Check the provider console for resources labeled `managed-by=in-three`.
