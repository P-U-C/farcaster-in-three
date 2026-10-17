# Architecture

## Data plane

```text
Browser
  |
  | HTTPS + signed session cookie
  v
Caddy ----> Client service
                |
                | HTTP JSON reads
                v
           Snapchain read node <---- QUIC gossip / snapshot ---- Farcaster
                ^
                |
           full local state

Client service
  |
  | Ed25519-signed protobuf write
  v
Farcaster validator ----> mempool ----> consensus ----> read node
```

The read node is authoritative for the client's view. The validator is a delivery endpoint, not a read dependency.

## Why writes bypass the read node

Snapchain accepts `submitMessage` on either role, but behavior differs:

- A validator validates the message, places it in its shard mempool, gossips it, and may propose it.
- A read node validates and gossips the message but has no mempool. If gossip is lost, the message must be resubmitted.

Direct validator submission is therefore the more reliable write path. The client retries network and 5xx failures across a small ordered validator set. It does not retry semantic 4xx rejections.

## Feed construction

The reference client intentionally avoids a hosted feed API:

1. Query `linksByFid` for the owner's active follow links.
2. Query recent `castsByFid` for the owner and up to 35 followed FIDs.
3. Merge and sort by Farcaster timestamp.
4. Resolve user-data messages for display name, username, bio, and HTTPS profile image.
5. Resolve onchain signer events for source attribution.

This is a transparent chronological reference feed, not a ranking engine. A production social client should add pagination, durable profile caches, topic/channel indexes, moderation, spam controls, and user-selectable ranking.

## Key ceremony

```text
BIP-39 phrase
  -> m/44'/60'/0'/0/0 custody account
  -> IdRegistry.idOf(address)
  -> random 32-byte Ed25519 secret
  -> SignedKeyRequest EIP-712 metadata
  -> KeyGateway.add(1, publicKey, 1, metadata)
  -> one OP Mainnet receipt
  -> app secret uploaded over SSH
  -> mnemonic discarded with local process
```

The requesting FID in this standalone client is the user's own FID. This creates valid, decodable attribution without a centralized app backend holding a separate app-custody key. The exact Ed25519 public key remains the canonical client-instance identifier.

## Container networks

- `protocol`: internal network shared only by Snapchain and client
- `node-egress`: Snapchain peer/snapshot egress
- `web`: client and Caddy

The host publishes Caddy and gossip ports. Snapchain HTTP/gRPC and the client origin are not published.

## Upstream boundaries

The repository does not fork or vendor Snapchain. It runs the official GPL-3.0 image by immutable digest and supplies configuration at runtime. Original scripts, client code, and documentation are MIT licensed.
