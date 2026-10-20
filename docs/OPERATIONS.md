# Operations

Use this page when setup pauses or you need to operate an existing In Three deployment. For the first run, follow the shorter [README](../README.md).

Examples use `in-three`. Docker users can replace it with `./in-three-container`.

## The normal run

```bash
in-three provision
in-three node up
in-three client create
```

Step one asks for an existing SSH host. To create a Hetzner machine instead, run `in-three provision --hetzner`.

For non-interactive setup, choose the target explicitly:

```bash
in-three provision --host ubuntu@203.0.113.10 --ssh-key ~/.ssh/id_ed25519
# or
in-three provision --hetzner
```

An existing machine needs Ubuntu, 4 CPU cores, 16 GB RAM, 2 TB free, a public address, and passwordless `sudo`. In Three installs Docker when it is missing and stores its files under `/srv/in-three`.

Keep the working directory. Its private `.state/` folder contains the SSH key path and the information needed to resume.

Every command is resumable. If one stops, rerun that same command from the same folder.

## Check the node

```bash
in-three node status
in-three node logs
```

Allow up to a day for the first sync. The detached snapshot manager fetches fresh metadata separately for shards 0, 1, and 2. Status shows the active shard, verified chunk count, phase, database size, disk use, and recent progress.

Leave it running. If a snapshot rotates during download, the manager discards that shard's staging data and retries from fresh metadata. It installs a shard only after every chunk, archive path, and final manifest generation pass validation.

`node status` prints every shard. The node is ready only when shard IDs 0, 1, and 2 all have valid heights and delays below 30 seconds.

Investigate before the 2 TiB disk has less than 15% free space.

## Recover one stale shard

Only use recovery when `node status` prints `RECOVERY REQUIRED` and the exact command:

```bash
in-three node recover --shard 0
```

Replace `0` only with the shard number shown. Recovery downloads and verifies a current snapshot while the node keeps serving healthy shards. It then stops Snapchain briefly, swaps only that shard, restarts, validates the result, and rolls back on failure. The operation continues on the server if the terminal closes.

Command three detects the same catastrophic state and runs this recovery automatically before requesting a phrase, password, or payment.

## Finish command three

Run:

```bash
in-three client create
```

Choose:

- `CREATE` for a new disposable test account
- `IMPORT` for an existing test account with storage

For `CREATE`, command three encrypts the generated recovery phrase locally, shows the Optimism address and ETH amount to fund, registers one FID with storage, authorizes a gasless app key, and deploys the client.

The server receives only the app key. It does not receive the recovery phrase.

Check the deployed client with:

```bash
in-three client status
in-three client logs
```

A write response means your node accepted the message for relay. Read the message back from your synced node to confirm inclusion.

## Resume safely

Keep these files if setup is incomplete:

| File | Purpose |
| --- | --- |
| `.state/test-account.recovery.json` | Password-encrypted test-account phrase |
| `.state/client.env.pending.fid-registration` | Exact signed account transaction until confirmed |
| `.state/client.env.pending` | Exact app-key message and delegated key until deployment succeeds |

Rerun `in-three client create` with the same password. The setup checks network state before resubmitting saved bytes.

Do not delete a pending file after an uncertain broadcast. Do not create a second app key until the first attempt is resolved.

## Update the profile

Use the same private password file used during setup:

```bash
in-three client profile \
  --password-file .state/client.password \
  --display-name "In Three" \
  --bio "Farcaster from your own node in three commands." \
  --pfp-url https://farcaster.permanentupperclass.com/profile.png \
  --url https://farcaster.permanentupperclass.com/
```

A newly created FID can claim an available name:

```bash
in-three client profile \
  --password-file .state/client.password \
  --recovery-file .state/test-account.recovery.json \
  --username in-three \
  --claim-name
```

The claim is signed locally. The recovery phrase is never printed or uploaded.

## Save a receipt

After testing the client and before teardown:

```bash
in-three proof
```

The report is written under `.state/proof/`. It excludes tokens, phrases, passwords, private keys, provider resource IDs, IP addresses, and raw environment files. Inspect it before publishing.

See [Proof](PROOF.md) for the evidence standard.

## Optional Hetzner cost

Your own machine adds no In Three infrastructure charge. Its normal hosting, power, and traffic costs still apply.

The default Hetzner Ashburn plan quoted **$323.67/month** on 2026-10-19:

| Resource | Monthly quote |
| --- | ---: |
| CCX33 server | $165.99 |
| 2,048 GiB volume | $157.08 |
| Public IPv4 | $0.60 |

That is about $6.22 for 12 hours or $12.45 for 24 hours before traffic, tax, or price changes. The live quote shown before `PROVISION` is authoritative.

A new test account also needs the IdGateway price and a small Optimism gas reserve. Command three shows the required balance before signing.

## Common problems

| What you see | What to do first |
| --- | --- |
| API is waiting for bootstrap | Run `node status` and leave the node running |
| Snapshot generation rotated | Leave it running; the manager refreshes and retries that shard |
| `RECOVERY REQUIRED` | Run the exact `node recover --shard N` command shown |
| Snapchain stopped | Run `node logs` and check free disk |
| Client returns 503 | Check the node, then run `client logs` |
| Account or app-key setup stopped | Keep `.state/` and rerun `client create` |
| Cast was accepted but is absent | Wait for sync and read it back before retrying |
| HTTPS is pending | Check ports 80/443 and the hostname |
| Login fails | Check the password, HTTPS hostname, and cookie scope |

For direct SSH through a jump host, add `--ssh-proxy user@jump-host` to `provision`. The route is saved for later commands.

Docker users connecting an existing machine must place a dedicated SSH key inside the working folder and pass its container path, such as `--ssh-key /work/node-key`. The launcher intentionally mounts no other host directories.

## Optional features

- [Agent API](AGENT-API.md): x402 access and one-payment deployment
- [Architecture](ARCHITECTURE.md): networks and trust boundaries
- [Security](../SECURITY.md): credentials and incident response
- [Source ledger](SOURCES.md): pinned versions and upstream references

## Upgrade

Do not replace pinned images with `latest`. Review the Snapchain release, update the pinned tag and digest together, run the complete test suite, and verify shard delay after restart.

## Stop

```bash
in-three destroy
```

For Hetzner, this deletes the server, volume, firewall, and generated SSH key. Confirm no resource labeled `managed-by=in-three` remains.

For a machine you own, this stops and removes the In Three containers. It retains the machine, `/srv/in-three` data, local state, and recovery files.
