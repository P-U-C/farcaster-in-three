# Independent Human Voucher

The prize requires at least one other human to complete the tutorial, create a read node and client, and publicly endorse the work on Farcaster. This file is the test protocol. It is not complete until an independent tester signs it with a public cast.

## Tester rules

- Start from a machine that has not been used to develop this repository.
- Follow the public microsite, not private instructions from the author.
- Use your own existing Farcaster account, cloud account, and OP ETH.
- Never send the author your recovery phrase, cloud token, app key, or client password.
- Record failures and confusing language. A voucher is evidence, not a favor.

## Run

Record:

| Item | Value |
| --- | --- |
| Tester Farcaster username | |
| Operator OS and version | |
| Start time, UTC | |
| Git commit | |
| Hetzner region and server type | |
| Snapchain version | |
| First synced time, UTC | |
| Client URL | |
| Test cast URL | |

### 1. Clean checkout

```bash
git clone https://github.com/P-U-C/farcaster-in-three.git
cd farcaster-in-three
git rev-parse HEAD
./farcaster doctor
```

Expected: all local prerequisite checks pass.

### 2. Run the three commands

```bash
./farcaster provision
./farcaster node up
./farcaster client create
```

Record each command's start/end time and any intervention not documented on the site.

Expected handoffs:

- Provision prints the server IP, future HTTPS URL, local state path, and `Next: ./farcaster node up`.
- Node up may print `Snapchain bootstrap is running on the server` and return while the API remains offline. This is expected; use `node status` and do not restart during extraction.
- Client create refuses before the node API is online without requesting the phrase or registering a signer.
- A successful client deployment prints its URL plus separate browser -> client service -> node and browser -> client service -> validator paths.

### 3. Verify the node

```bash
./farcaster node status
```

Pass conditions:

- During bootstrap, the container remains running and snapshot/database size advances between checks.
- Once bootstrapped, the container is healthy.
- Version is the tutorial's pinned version.
- All reported shard delays are below 30 seconds.
- At least 1.5 TB was available before sync.
- Port 3382/UDP is reachable; HTTP 3381 and gRPC 3383 are not public.

From the host, verify the client is reading its local container:

```bash
ssh -i .state/id_ed25519 inthree@"$(. .state/config; printf '%s' "$SERVER_IP")" \
  'cd /srv/in-three && sudo docker compose exec -T client printenv READ_NODE_URL'
```

Expected: `http://snapchain:3381`.

### 4. Verify the key boundary

Do **not** paste the recovery phrase into any diagnostic command.

Check that the custody phrase was not persisted:

- It is absent from shell history.
- It is absent from `.state/`.
- It is absent from `/srv/in-three/client.env`.
- It is absent from client and Snapchain logs.
- The registered signer public key is visible in the OP transaction receipt.
- The client environment contains an Ed25519 app key, not an Ethereum private key or mnemonic.

### 5. Exercise the client

From the HTTPS client:

- [ ] Sign in on desktop.
- [ ] Sign in on mobile.
- [ ] Load the home feed while the public validator read endpoint is unavailable or blocked.
- [ ] Publish a cast and save its public URL.
- [ ] Follow an FID from desktop.
- [ ] Follow an FID from a viewport narrower than 1080px.
- [ ] Like a cast.
- [ ] Recast a cast.
- [ ] Confirm every discovered signer appears in source controls.
- [ ] Toggle an attributed app group and confirm casts from all of its keys disappear.
- [ ] Toggle an unattributed exact signer key and confirm only that source disappears.
- [ ] Re-include both and confirm their casts return.

Check the cast's signer key against the key registered in the OP receipt.

### 6. Teardown test

After preserving required evidence:

```bash
./farcaster destroy
```

Expected: server, volume, firewall, and generated cloud SSH key are deleted. Confirm the Hetzner project has no `managed-by=in-three` resources left.

## Public endorsement

Publish a Farcaster cast in your own words. It should link to the tutorial, state that you personally completed it, and identify at least one concrete strength and any remaining friction.

Suggested structure, not mandatory wording:

> I independently followed In Three from a clean machine. I provisioned the host, synced a Snapchain read node, registered a delegated signer, and posted this cast from the included client. Reads came from my node; the custody phrase never reached the host. [One specific observation.] Tutorial: https://farcaster.permanentupperclass.com/

Add the endorsement URL below in the repository only after it is public:

```text
VOUCHER_CAST_URL=
TEST_CAST_URL=
TESTED_COMMIT=
```

Do not claim prize eligibility before these fields point to real public evidence.
