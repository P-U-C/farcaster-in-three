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
Agent -> x402 v2 quote/pay -> gateway -> Client service -> Snapchain read node
            Celo or Base         |                         ^
                                 |                         |
                                 |                   full local state
                                 v
                         immutable 95/5 split

Client service
  |
  | Ed25519-signed protobuf write
  v
Farcaster validator ----> mempool ----> consensus ----> read node
```

The read node is authoritative for the client's view. The validator is a delivery endpoint, not a read dependency.

## Paid deployment control plane

```text
Operator machine                         Selected In Three broker                    Buyer Hetzner project

SSH private key stays local
cloud token -> HTTPS preflight --------> deployment service -> create/delete probe -> API
x402 wallet -> 25 USDC on Celo/Base ----> gateway -> immutable 95/5 split
same request body ----------------------> durable entitlement -> provision --------> server + volume + firewall + SSH key
                  <---------------------- resource IDs + public IPv4
SSH ------------------------------------> cloud-init -> mount volume -> Snapchain
custody phrase stays local -> app-key registration -> client deployment
```

The deployment request uses a random client-generated `deploymentId`. The deployer persists that ID, a SHA-256 cloud-token binding, SSH public key, and source CIDR before calling Hetzner. It never stores the cloud token. Status and resume are free, but resume requires all buyer inputs to match that paid entitlement. This lets a dropped paid response continue without issuing another x402 payment.

The broker is still trusted during the request: it sees the dedicated Hetzner token in process memory and can use its permissions. Buyers should use a new, otherwise-empty project and rotate the token after deployment. The SSH private key, Farcaster custody phrase, client password, app signer, and seller facilitator credentials never reach the broker.

Cloud-init writes release files to `/opt/in-three-release`, mounts the attached volume at `/srv/in-three`, copies the release onto that mounted volume, and starts the pinned Snapchain image. Staging outside the mount point is required; files written under `/srv/in-three` before mounting would be hidden by the volume.

## Agent commerce path

Caddy routes <code>/agent/*</code> and <code>/.well-known/agent.json</code> to a separate x402 v2 resource server. An unpaid valid request receives equal USDC offers for Celo and Base. The bundled buy wallet signs the Celo authorization locally; another conforming x402 v2 client may choose Base. The chain-specific facilitator verifies and settles the selected offer before the gateway proxies the request to the client.

The gateway and client are deliberately separate trust domains:

- the gateway has Celo/CDP facilitator credentials, the verified split address, prices, and agent write capability;
- the deployer has the fixed cloud plan, release files, and durable entitlement hashes, but no facilitator or Farcaster signing key;
- the client has the Farcaster app signer, password hash, and session secret;
- neither container receives the other's signing material;
- the gateway reaches the client over `web` and the deployer over the isolated `deployment` network, but has no route to Snapchain;
- only the deployment request sends a buyer-supplied Hetzner token to the deployer, and the gateway does not log request bodies;
- Caddy prevents public callers from bypassing the gateway for <code>/agent/*</code>.

Reads require payment only. Writes first require an exact owner-issued bearer capability, then payment. The bearer check runs before the gateway emits a 402, preventing an unauthorized caller from paying for or reaching a write. The bearer header is stripped before the request reaches the client.

The payment recipient is the same deterministic 0xSplits V2 address on both chains. Its immutable Push split assigns 95% to the local operator and 5% to P-U-C, with a 0.1% permissionless distribution incentive. The gateway recomputes the address and confirms deployed bytecode on both chains before listening. Checkout never bridges; recipients can consolidate distributed treasury funds later without putting bridge risk in front of the purchased action.

The free agent manifest and OpenAPI document publish current routes, networks, prices, economics, schemas, and safety rules. A repository skill gives buy-enabled agents the quote-before-pay and ambiguous-settlement procedure.

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
  -> facilitator credentials validated
BIP-39 phrase
  -> m/44'/60'/0'/0/0 custody/operator account
  -> deterministic 95/5 split planned for Celo and Base
  -> IdRegistry.idOf(address) + Farcaster storage check
  -> random 32-byte Ed25519 secret
  -> SignedKeyRequest EIP-712 metadata
  -> Celo split, Base split, and KeyGateway transactions prepared locally
  -> all signed bytes + local hashes + app key saved owner-only
  -> exact signed split bytes broadcast; existing splits skipped
  -> exact signed app-key bytes broadcast to OP Mainnet
  -> each confirmed transaction removed from recovery state
  -> confirmed secrets uploaded into separate containers
  -> pending file removed after HTTPS health checks
  -> mnemonic discarded with local process
```

Password confirmation and both facilitator validations happen before phrase input, app-key generation, or transaction signing. Every transaction is signed and hashed locally, and its serialized bytes are persisted with the app key before the first broadcast. If an RPC response, receipt poll, or deployment fails, rerunning `client create` validates each local hash, rebroadcasts the same pending bytes, and resumes rather than creating a different split or signer.

The requesting FID in this standalone client is the user's own FID. This creates valid, decodable attribution without a centralized app backend holding a separate app-custody key. The exact Ed25519 public key remains the canonical client-instance identifier.

## Container networks

- `protocol`: internal network shared only by Snapchain and client
- `deployment`: internal network shared only by the agent gateway and deployment service
- `deployer-egress`: Hetzner API egress for the deployment service
- `node-egress`: Snapchain peer/snapshot egress
- `web`: client, agent gateway, and Caddy

The host publishes Caddy and gossip ports. Snapchain HTTP/gRPC and the client origin are not published.

## Upstream boundaries

The repository does not fork or vendor Snapchain. It runs the official GPL-3.0 image by immutable digest and supplies configuration at runtime. Original scripts, client code, and documentation are MIT licensed.
