# Operations

## Sync

```bash
./farcaster node status
./farcaster node logs
```

The first start downloads a public snapshot, decompresses it to `/srv/in-three/data/rocks`, and catches up from peers. Avoid restarting during snapshot extraction. A healthy, current node reports shard block delays in single digits; the CLI marks all delays under 30 seconds as ready.

Disk growth is protocol dependent. Alert before free space falls below 15%. The 2 TiB default is a starting point, not a perpetual capacity guarantee.

## Client

```bash
./farcaster client status
./farcaster client logs
```

The public health route confirms the service can query its configured read node. Authenticated routes expose profile, storage, feed, and write actions.

To use your own domain:

1. Point an A record to the server IP.
2. Change `CLIENT_DOMAIN` in `/srv/in-three/.env`.
3. Run `cd /srv/in-three && sudo docker compose up -d caddy`.
4. Confirm the new certificate and then stop using the `sslip.io` hostname.

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

- Stored in `/srv/in-three/client.env`.
- Backing it up preserves client identity but expands the compromise surface.
- Losing it does not affect custody; register a new signer and revoke the old public key.

Local state:

- `.state/config` identifies cloud resources.
- `.state/id_ed25519` operates the host.
- Both are excluded from Git and should be backed up only to an encrypted operator vault.

## Failure modes

| Symptom | First check |
| --- | --- |
| Node API unavailable | `./farcaster node logs` |
| Block delay rising | UDP 3382 firewall, peer errors, disk saturation |
| Snapshot loops | Free disk, volume mount, release notes |
| Client 503 health | Snapchain container health and internal DNS |
| Login fails | Correct deployment password; cookie domain/HTTPS |
| Validator rejects write | FID storage, signer onchain state, clock, text limits |
| TLS pending | A/AAAA resolution, ports 80/443, Caddy logs |
| SSH fails after IP change | Update Hetzner firewall source CIDR in console |

## Teardown

```bash
./farcaster destroy
```

The command deletes the server, data volume, firewall, and generated provider SSH key. Check the provider console for resources labeled `managed-by=in-three`.
