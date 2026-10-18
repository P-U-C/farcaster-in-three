# Independent Human Voucher

The prize requires another human to complete the public tutorial, create a read node and client, and endorse the result publicly on Farcaster. This protocol is incomplete until the evidence fields at the bottom contain real public URLs.

The [tester bounty](TESTER-BOUNTY.md) pays for execution and evidence, not praise. Publish an endorsement only if the run warrants one.

## Rules

- Start on a machine that was not used to develop this repository.
- Follow the public tutorial without private help from the author.
- Use your own cloud account and an otherwise disposable Farcaster test account.
- Inspect the launcher, image provenance, and source before entering credentials.
- Never send anyone your phrase, cloud token, app key, facilitator keys, write capability, browser password, or unredacted environment files.
- Do not reuse a phrase that controls valuable assets.
- Record every intervention, failure, and unclear instruction.

## Record

| Item | Value |
| --- | --- |
| Tester Farcaster username | |
| Operator OS and version | |
| Start time, UTC | |
| Release tag | |
| Git commit | |
| OCI manifest digest | |
| Platform image digest | |
| Hetzner region and server type | |
| Snapchain version | |
| First synced time, UTC | |
| Client URL | |
| Test cast URL | |
| Deployment path: manual or paid | |
| Paid deployment chain and transaction, if used | |
| Celo paid-read transaction | |
| Base paid-read transaction | |
| Revenue split address | |

## 1. Clean container install

Start in a new empty directory:

```bash
mkdir in-three-voucher
cd in-three-voucher
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.1/in-three-container
chmod +x in-three-container
./in-three-container --version
./in-three-container doctor
```

Expected:

- Version is `0.1.1`.
- The image is pulled from the versioned GHCR tag.
- The release digest matches the recorded image.
- Doctor passes.
- No source compile runs.
- No `.state/` exists until a stateful command needs it.

Inspect the launcher invocation. It must run as the host UID/GID, mount only the current directory, use a read-only root, drop capabilities, set `no-new-privileges`, and omit the Docker socket.

## 2. Deploy

Test one documented path.

Manual three-command path:

```bash
./in-three-container provision
./in-three-container node up
./in-three-container client create
```

Paid path, when a public broker exists:

```bash
./in-three-container deploy \
  --service https://BROKER \
  --payment-network base
```

For the paid path, record the free preflight, exact quote, 25 USDC ceiling, settlement transaction, resource IDs, and whether any rerun attempted a second payment. Use a new Hetzner project token and rotate it after provisioning.

Expected handoffs:

- Provision prints the server IP, future HTTPS URL, state path, and next command.
- Node up may return while snapshot bootstrap continues. Do not restart during extraction.
- Client create reports snapshot/database/disk progress and continues when the API is online.
- No phrase is requested while Snapchain is bootstrapping.
- Setup requires `TEST ACCOUNT` before the hidden phrase prompt.
- Setup reports a gasless signer, scoped to casts/reactions/follows, with no OP transaction.
- Success prints the browser URL, agent manifest, local agent file, and separate read/write descriptions.

## 3. Verify the node

```bash
./in-three-container node status
```

Pass conditions:

- Snapshot or database size advances during bootstrap.
- The final container is healthy.
- Snapchain matches the pinned version and image digest.
- All reported shard delays are below 30 seconds.
- At least 1.5 TB was free before sync.
- UDP 3382 is reachable.
- HTTP 3381 and gRPC 3383 are not public.

Verify the deployed client points at the local node:

```bash
ssh -i .state/id_ed25519 inthree@"$(. .state/config; printf '%s' "$SERVER_IP")" \
  'cd /srv/in-three && sudo docker compose exec -T client printenv READ_NODE_URL WRITE_NODE_URL'
```

Expected twice: `http://snapchain:3381`.

## 4. Verify the key boundary

Do not paste the phrase into a diagnostic command.

Confirm:

- The phrase is absent from shell history, `.state/`, remote environment files, and logs.
- `.state/client.env.pending` preserved the exact gasless message if setup was interrupted.
- The app signer appears in the owned node's `/v1/signersByFid` response with gasless source, expected scopes, TTL, and public key.
- No Optimism signer-registration transaction was sent.
- Any Celo/Base split receipt targets the documented 0xSplits factory with zero native value.
- Both chains resolve to the documented deterministic 95/5 split.
- The deployed client has an Ed25519 app key, not a mnemonic or EVM private key.

## 5. Exercise the client

- [ ] Sign in on desktop.
- [ ] Sign in on a mobile viewport.
- [ ] Load the feed with no hosted Farcaster API configured.
- [ ] Publish a cast and save its public URL.
- [ ] Read the cast back from the owned node; do not treat relay acceptance alone as confirmation.
- [ ] Follow an FID on desktop.
- [ ] Follow an FID below 1080 px.
- [ ] Like a cast.
- [ ] Recast a cast.
- [ ] Confirm every discovered signer key appears in source controls.
- [ ] Disable one attributed app group and confirm all its keys disappear.
- [ ] Disable one unattributed key and confirm only that source disappears.
- [ ] Re-enable both.

Match the cast signer to the gasless signer record from the node.

## 6. Exercise paid agent access

Use dedicated low-balance payer wallets. Keep `.state/agent.env` private.

- [ ] Fetch `/.well-known/agent.json` and `/agent/openapi.json` without payment.
- [ ] Confirm an unpaid feed request offers equal-price Celo and Base USDC routes.
- [ ] Confirm an unauthorized write returns 401 before a payment challenge.
- [ ] Buy one Celo feed request with an exact maximum.
- [ ] Buy one Base feed request with the repository's capped payer.
- [ ] Record both receipts and confirm responses came from the owned node.
- [ ] Confirm the same deterministic 95/5 split on both chains.
- [ ] Make one authorized paid write.
- [ ] Read its message hash back from the node after relay.
- [ ] Confirm the client environment has no facilitator key or write capability.
- [ ] Confirm the gateway environment has no Farcaster signer.

Do not blindly retry an ambiguous payment. Preserve the receipt. For an interrupted deployment, retain the payment marker and rerun the wrapper; verify that it uses status/resume without another purchase.

## 7. Teardown

After preserving evidence:

```bash
./in-three-container destroy
```

Confirm that the server, volume, firewall, and generated provider SSH key are gone and that no `managed-by=in-three` resource remains.

## Public endorsement

Write the cast in your own words. Link the tutorial, say that you personally completed the run, name one concrete strength, and disclose remaining friction.

A structure, not copy:

> I completed In Three from a clean machine: provisioned the host, synced Snapchain, authorized a gasless test-account signer, and published this cast through my own read node. [Specific observation and friction.] https://farcaster.permanentupperclass.com/

Add public evidence only after completion:

```text
VOUCHER_CAST_URL=
TEST_CAST_URL=
TESTED_COMMIT=
```

Do not claim prize qualification while these fields are blank.
