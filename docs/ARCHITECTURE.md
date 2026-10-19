# Architecture

In Three has one required data path and one optional payment path.

## Browser path

```text
browser
   |
   | HTTPS
   v
client service
   |
   | reads and signed protobuf writes
   v
your Snapchain read node
   |
   | validates and gossips valid writes
   v
Farcaster validators
```

The browser never calls a hosted Farcaster API. The client service reads from the operator's Snapchain node and submits signed messages to that same node.

A read node accepts writes. It validates each message and relays valid messages to validators, but it does not propose blocks. A successful submit response means **accepted for relay**, not **included**. Confirmation is a later read from synced node state.

Public network ports:

- 80/TCP and 443/TCP+UDP for Caddy and HTTPS
- 3382/UDP for Snapchain gossip
- 22/TCP for SSH, restricted to the operator's detected CIDR

Snapchain HTTP on 3381 and gRPC on 3383 remain private.

## What runs on the server

```text
Caddy
  -> browser routes -> client
  -> /agent routes -> agent gateway (optional)

client <-> Snapchain
agent gateway -> client (optional)
agent gateway -> deployment service (optional)
```

The normal setup starts Snapchain, the client, and Caddy. The `--with-agent` setup also starts the gateway and deployment service.

Container networks separate responsibilities:

- `protocol`: Snapchain and client
- `web`: client, optional gateway, and Caddy
- `deployment`: optional gateway and deployer
- `node-egress`: Snapchain peers and snapshots
- `deployer-egress`: Hetzner API

The gateway cannot reach Snapchain directly. The deployer cannot reach the client. The client never receives payment credentials.

## Account and app-key setup

```text
CREATE (default)                    IMPORT
  -> generate phrase locally          -> read test phrase locally
  -> encrypt local recovery kit       -> derive custody address
  -> derive custody address                    |
  -> quote IdGateway price                     |
  -> fund address on Optimism                   |
  -> save + send signed registration            |
  -> create FID + one storage unit              |
                     \__________________________/
                                  |
                     resolve FID on Optimism
                     verify storage on owned node
                     create fresh Ed25519 app key
                     sign scoped gasless KEY_ADD
                     save exact message before submission
                     submit through local tunnel to owned node
                     wait for signer in node state
                     upload only the app key
                     discard plaintext when process exits
```

New-account registration is one Optimism transaction. The generated phrase is stored only in a local, password-encrypted recovery kit; the exact signed transaction bytes are also saved before broadcast so an uncertain RPC response can be resumed. Existing accounts skip that transaction.

The app key is limited to casts, reactions, and follows. It has a 90-day sliding lifetime, and its authorization is a gasless Snapchain message.

If submission is uncertain, setup retains the exact signed message and app key. A rerun checks signer state first and resubmits only the saved bytes. It does not create another key while the first authorization may be live.

This custody path exists for a developer tutorial. Production clients should request delegated authorization from a trusted wallet and should not collect recovery phrases.

## Feed

The reference feed is built without a hosted feed service:

1. Read active follows for the owner.
2. Read recent casts for the owner and up to 35 followed FIDs.
3. Merge and sort by Farcaster time.
4. Resolve profile data from user-data messages.
5. Read signer records for source filtering.

When multiple signer keys have the same app attribution, the UI groups them. Keys without reliable attribution remain available as exact-key controls.

This is a chronological reference feed. A production service would add pagination, moderation, spam controls, durable caches, channel indexes, and ranking.

## Optional agent commerce

With `client create --with-agent`, Caddy exposes `/.well-known/agent.json` and `/agent/*` through a separate x402 gateway.

- Reads require USDC payment.
- Writes require both payment and an owner capability.
- Buyers choose Celo or Base; no bridge runs during checkout.
- Revenue uses the same deterministic 95% operator / 5% P-U-C split on both chains.
- Facilitator credentials stay in the gateway.
- Farcaster signing stays in the client.

The automated deployment service uses a client-generated deployment ID and durable entitlement. It receives a dedicated Hetzner token only for the request and never receives the SSH private key, Farcaster phrase, browser password, or app key.

## Operator container

The local operator image is a packaging boundary. The launcher gives it:

- the caller's UID and GID
- a read-only root filesystem
- no Linux capabilities
- `no-new-privileges`
- a no-exec temporary filesystem
- only the current directory mounted at `/work`
- no Docker socket

Persistent local state remains under `.state/`.

## Upstream boundary

This repository does not fork or vendor Snapchain. It runs the official GPL-3.0 image by immutable digest and supplies configuration at runtime. Original scripts, client code, and documentation are MIT licensed.
