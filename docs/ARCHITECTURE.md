# Architecture

## Data plane

```text
Browser
  |
  | HTTPS + signed session cookie
  v
Caddy ------------------------------> Client service
  ^                                       |
  |                                       | HTTP JSON reads
  |                                       v
Agent -> buy quote/pay -> x402 gateway -> Client service -> Snapchain read node
                              |                              ^
                              |                              |
                              |                        full local state
                              |
                         Celo settlement

Client service
  |
  | Ed25519-signed protobuf write
  v
Farcaster validator ----> mempool ----> consensus ----> read node
```

The read node is authoritative for the client's view. The validator is a delivery endpoint, not a read dependency.

## Agent commerce path

Caddy routes <code>/agent/*</code> and <code>/.well-known/agent.json</code> to a separate process built from <code>@celo/buy-gateway</code>. An unpaid valid request receives an x402 quote in USDC on Celo. The agent's buy wallet signs the authorization locally; Celo's hosted facilitator verifies and settles it, then the gateway proxies the request to the client.

The gateway and client are deliberately separate trust domains:

- the gateway has the Celo facilitator key, payout address, prices, and agent write capability;
- the client has the Farcaster app signer, password hash, and session secret;
- neither container receives the other's signing material;
- the gateway can reach the client over the web network but has no route to Snapchain;
- Caddy prevents public callers from bypassing the gateway for <code>/agent/*</code>.

Reads require payment only. Writes first require an exact owner-issued bearer capability, then payment. The bearer check runs before the gateway emits a 402, preventing an unauthorized caller from paying for or reaching a write. The bearer header is stripped before the request reaches the client.

The free agent manifest and OpenAPI document publish current routes, prices, schemas, and safety rules. A repository skill gives buy-enabled agents the quote-before-pay and ambiguous-settlement procedure.

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

Every discovered signer key remains available to the filter UI. Keys with the same decoded SignedKeyRequest `requestFid` are grouped into one attributed app control; unattributed keys retain independent exact-key controls.

This is a transparent chronological reference feed, not a ranking engine. A production social client should add pagination, durable profile caches, topic/channel indexes, moderation, spam controls, and user-selectable ranking.

## Key ceremony

```text
Client password + confirmation
  -> scrypt hash and session secret
BIP-39 phrase
  -> m/44'/60'/0'/0/0 custody account
  -> IdRegistry.idOf(address)
  -> random 32-byte Ed25519 secret
  -> SignedKeyRequest EIP-712 metadata
  -> simulated KeyGateway.add(1, publicKey, 1, metadata)
  -> prepared OP transaction signed locally
  -> serialized transaction + local hash + app key saved owner-only
  -> exact signed bytes broadcast to OP Mainnet
  -> one OP Mainnet receipt
  -> recovery transaction removed; confirmed app secret uploaded over SSH
  -> pending file removed after HTTPS health check
  -> mnemonic discarded with local process
```

Password confirmation happens before phrase input, app-key generation, or transaction signing. The transaction is signed and hashed locally, and its serialized bytes are persisted with the app key before broadcast. If the RPC response, receipt polling, or deployment fails, rerunning `client create` validates the local hash, rebroadcasts the same transaction, and resumes rather than registering another key.

The requesting FID in this standalone client is the user's own FID. This creates valid, decodable attribution without a centralized app backend holding a separate app-custody key. The exact Ed25519 public key remains the canonical client-instance identifier.

## Container networks

- `protocol`: internal network shared only by Snapchain and client
- `node-egress`: Snapchain peer/snapshot egress
- `web`: client, agent gateway, and Caddy

The host publishes Caddy and gossip ports. Snapchain HTTP/gRPC and the client origin are not published.

## Upstream boundaries

The repository does not fork or vendor Snapchain. It runs the official GPL-3.0 image by immutable digest and supplies configuration at runtime. Original scripts, client code, and documentation are MIT licensed.
