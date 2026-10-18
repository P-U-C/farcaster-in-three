# Architecture

## Protocol data plane

```text
Browser ---------------- HTTPS session -----------------+
                                                        |
Agent ----- x402 payment + write capability ------> gateway
                                                        |
                                                        v
                                                 Client service
                                                   /         \
                                      HTTP reads  /           \ signed protobuf writes
                                                 v             v
                                          owned Snapchain read node
                                                 |             |
                                      local state|             | validate + gossip
                                                 v             v
                                              responses    validators
                                                               |
                                                           consensus
                                                               |
                                                     next blocks return
                                                        to read node
```

The client service has one protocol dependency: the operator's Snapchain read node. It reads through that node and posts binary messages to the node's `POST /v1/submitMessage` endpoint.

A read node accepts writes. It validates each message and gossips valid messages to validators, but it has no mempool and does not propose blocks. A successful submit response therefore means **accepted for relay**, not **included in a block**. Confirmation is a later observation of the message in synced node state.

The node's HTTP and gRPC ports are private. Only QUIC gossip, HTTPS, and CIDR-restricted SSH are exposed.

## Paid deployment control plane

```text
Operator machine                  selected broker                    buyer's Hetzner project

SSH keypair generated locally
cloud token -> HTTPS preflight -> deployment service -> API probe
x402 wallet -> Celo/Base USDC -> gateway -> immutable 95/5 split
same bounded request -----------> durable entitlement -> server + volume + firewall
             <------------------- resource IDs + public IPv4

SSH private key ----------------------------------------------------> new host
local client command -> SSH tunnel -> owned node -> gasless app-key relay
test-account phrase remains in the local setup process
```

The request has a random client-generated `deploymentId`. Before provisioning, the broker persists that ID with a SHA-256 token binding, SSH public key, and source CIDR. It never persists the Hetzner token. Free status and resume routes require the original inputs to match the paid entitlement, so a dropped paid response can continue without another x402 payment.

The broker is trusted while it handles the request: it can use the dedicated Hetzner token within that project's permissions. Use a new, otherwise-empty project and rotate the token after provisioning. The broker never receives the SSH private key, Farcaster phrase, browser password, app key, or facilitator credentials.

Cloud-init stages release files under `/opt/in-three-release`, mounts the volume at `/srv/in-three`, copies the release to the mounted volume, and starts the pinned Snapchain image.

## Agent commerce path

Caddy routes `/agent/*` and `/.well-known/agent.json` to a separate x402 v2 gateway. A valid unpaid request receives equal USDC offers on Celo and Base. A conforming buyer chooses one rail. The selected facilitator verifies and settles payment before the gateway proxies the request.

Trust is split by container:

- The gateway has facilitator credentials, route prices, the revenue address, and the agent write capability.
- The deployer has the fixed cloud plan and entitlement store, but no payment or Farcaster signer.
- The client has the delegated Farcaster key, password hash, and session secret.
- The client can reach Snapchain; the gateway cannot.
- Caddy prevents public callers from bypassing the gateway for agent routes.
- Paid reads need payment. Paid writes need the owner capability before the gateway will even return a payment challenge.

The deterministic 0xSplits V2 address is the same on Celo and Base. Its immutable Push split assigns 95% to the operator and 5% to P-U-C, with a 0.1% permissionless distribution incentive. No bridge sits in the request path.

## Feed construction

The reference client does not call a hosted feed API:

1. Query `linksByFid` for active follows.
2. Query recent `castsByFid` for the owner and up to 35 followed FIDs.
3. Merge and sort by Farcaster timestamp.
4. Resolve user-data messages for username, display name, bio, and profile image.
5. Query `signersByFid` for unified onchain and gasless signer records.

Every discovered signer key remains available in the source filter. Keys sharing available app attribution are grouped. If attribution is absent, the UI retains exact-key controls instead of inventing a client name.

This is a chronological reference feed. A production client would add pagination, durable profile caches, moderation, spam controls, channel indexes, and user-selectable ranking.

## Test-account key ceremony

```text
browser password + confirmation
  -> facilitator credentials validated
  -> local SSH tunnel to owned read node
  -> explicit TEST ACCOUNT acknowledgement
test-account BIP-39 phrase
  -> m/44'/60'/0'/0/0 custody address
  -> FID resolved on Optimism; storage checked through owned node
  -> Celo/Base 95/5 split state inspected
fresh Ed25519 app key
  -> casts/reactions/follows scopes
  -> 90-day sliding TTL
  -> next per-FID gasless nonce
custody account
  -> EIP-712 authorization for scoped signer
app key
  -> signed gasless KEY_ADD Snapchain message
  -> exact protobuf + hash + checksum + app key saved owner-only
  -> protobuf submitted through SSH tunnel to owned read node
  -> read node validates and gossips to validators
  -> setup waits for signer in unified node API
  -> only delegated app key uploaded
  -> saved protobuf removed after confirmation
  -> pending file removed after public health checks
  -> phrase discarded with local process exit
```

No Optimism transaction or OP ETH is required. If a deterministic Celo or Base revenue split is absent, setup may separately sign one zero-value contract-creation transaction on that chain; those transactions and local hashes are also saved before broadcast.

If submission produces an uncertain network result, setup preserves the exact gasless message and app key. A rerun checks signer state first, verifies the saved checksum, and resubmits only those bytes. It never creates a replacement key while the first authorization may be live.

This phrase-based ceremony exists to teach the low-level protocol path. Recovery phrases are equivalent to account control and should only be entered into code the tester has inspected and trusts. Real client onboarding should use delegated signer authorization from a trusted wallet and should not collect raw phrases.

## Container boundaries

The operator image is a packaging boundary, not the deployed service. It runs as the host UID/GID with a read-only root filesystem, no Linux capabilities, no Docker socket, and only the current working directory mounted at `/work`. Persistent operator state remains under `.state/`.

The deployed service uses these networks:

- `protocol`: Snapchain and client only
- `deployment`: gateway and deployment service only
- `deployer-egress`: Hetzner API access for the deployment service
- `node-egress`: peer and snapshot access for Snapchain
- `web`: client, gateway, and Caddy

## Upstream boundary

The repository does not fork or vendor Snapchain. It runs the official GPL-3.0 image by immutable digest and supplies configuration at runtime. Original scripts, client code, and documentation are MIT licensed.
