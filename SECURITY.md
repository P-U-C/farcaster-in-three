# Security Model

In Three performs a developer-only Farcaster key ceremony and may sign Celo/Base revenue-split transactions. Treat the local setup process as wallet software.

This project has not received an independent security audit.

## Non-negotiable phrase rules

- Use an otherwise disposable Farcaster test account.
- Inspect and trust the exact source or signed release before entering a phrase.
- Never paste a phrase into agent chat, a support message, an environment variable, a command argument, a file, or a remote shell.
- Do not reuse a test phrase that controls valuable assets elsewhere.
- Prefer delegated signer authorization through a trusted wallet for any production client.

The setup utility enforces a visible `TEST ACCOUNT` acknowledgement before its hidden phrase prompt. This does not make phrase entry safe; it prevents the tutorial from presenting a powerful primitive as normal consumer onboarding.

JavaScript strings cannot be guaranteed to be zeroized. Process exit is the final memory boundary.

## Secret inventory

| Secret or signed object | Location | Authority | Lifetime |
| --- | --- | --- | --- |
| Hetzner token | Manual path: local process. Paid path: local and selected broker process over HTTPS | Resources in one Hetzner project | Command lifetime; not persisted by In Three |
| Deployment entitlement | Broker data volume | Resume one bound paid deployment | Broker lifetime |
| Test-account phrase | Local setup process memory | Full custody account authority | Key ceremony and optional split signing only |
| Ed25519 app key | Local pending file, then deployed client environment | Scoped casts, reactions, and follows for one FID | Revocable; 90-day sliding TTL |
| Gasless `KEY_ADD` protobuf | Local pending file until confirmation | Authorize that exact app key, scope set, TTL, and nonce | Setup recovery only |
| Celo/Base split transactions | Local pending file until confirmation | Create fixed zero-value 95/5 split contracts | Setup recovery only |
| Browser password | Human memory | Open the web client | User controlled |
| Password hash and session secret | Deployed client environment | Verify login and sign cookies | Deployment lifetime |
| Celo facilitator key | Pending file, then gateway environment | Settle Celo x402 payments | Deployment lifetime |
| Coinbase CDP key | Pending file, then gateway environment | Authenticate Base facilitator requests | Deployment lifetime |
| Agent write capability | Pending file, local `.state/agent.env`, gateway environment | Reach paid Farcaster write routes | Until rotated |
| SSH private key | Local `.state/` | Operate the host | Host lifetime |

## Key ceremony and recovery

Before requesting a phrase, setup:

1. Confirms the browser password twice.
2. Validates both facilitator credentials.
3. Establishes a local SSH tunnel to the operator's read node.
4. Requires the exact `TEST ACCOUNT` acknowledgement.

It derives the custody address locally, resolves the FID, checks storage through the owned node, and creates a fresh Ed25519 key. The custody account signs EIP-712 authorization for a scoped gasless signer. The app key signs the `KEY_ADD` Snapchain message. No Optimism transaction or OP balance is required.

Before submitting the message, setup writes its exact protobuf, protocol hash, SHA-256 checksum, and app key to owner-only `.state/client.env.pending`. If the HTTP result is ambiguous, a rerun checks the node's signer state, verifies the saved bytes, and resubmits only that message. It does not discard the key or create another authorization whose status is unknown.

Celo/Base split creation is separate. When a deterministic split is absent, setup signs the fixed zero-value transaction, computes its hash, and stores the serialized bytes before broadcast. Reruns check receipts and rebroadcast only the saved transaction. The phrase and derived EVM key are never written to disk.

Signed payloads are removed as they confirm. The pending file is removed after browser and agent health checks succeed, with best-effort overwrite where `shred` exists.

## Operator container

The published operator image runs as the invoking UID/GID. The launcher supplies:

- read-only container root
- no Linux capabilities
- `no-new-privileges`
- a no-exec temporary filesystem
- a process limit
- one bind mount: the current working directory at `/work`
- no Docker socket

The image is an isolation and distribution boundary, not a guarantee against a malicious image. Verify the version and provenance, inspect the Dockerfile and launcher, and keep custody tests on a dedicated account.

The container's Base payer key is read through a hidden prompt or a named environment variable and deleted from the Node process environment before payment handling. Use a dedicated, low-balance wallet. Celo usebuy.ai mainnet operation should use the host package and operating-system keychain; this project does not enable its development-only plaintext keystore for mainnet.

## Network exposure

Public:

- 80/TCP and 443/TCP+UDP: Caddy and automatic HTTPS
- 3382/UDP: Snapchain QUIC gossip
- 22/TCP: restricted to the operator's detected CIDR

Private:

- 3381/TCP: Snapchain HTTP
- 3383/TCP: Snapchain gRPC
- 3333/TCP: client
- 3334/TCP: x402 gateway
- 3335/TCP: deployment service

The client reaches Snapchain over an internal network. The gateway cannot reach Snapchain. The deployer cannot reach the client. Facilitator credentials never enter the client environment, and the Farcaster key never enters the gateway or deployer environments.

## Web and API controls

- scrypt password hash with a random 128-bit salt
- HMAC-SHA256, 30-day HttpOnly, SameSite=Strict session cookie
- Secure cookies under deployed HTTPS
- CSP, HSTS, frame denial, MIME-sniffing denial, and restrictive permissions policy
- read-only deployed client container with `no-new-privileges`
- Zod validation for writes
- x402 v2 Celo/Base offers for paid agent routes
- owner capability checked before a write payment challenge
- per-IP, per-payer, and service rate limits
- method, body-size, JSON, and top-level-field checks before payment

## Threats and limits

### Compromised client host

An attacker can take the delegated app key and exercise its allowed Farcaster scopes until expiry or revocation. The deployed host does not have the custody phrase or EVM private key. Revoke the signer, rotate the agent capability and browser secret, destroy the host, and rebuild.

### Compromised operator machine

A process, terminal, clipboard, or keyboard compromise during setup can steal the phrase and payment keys. This design cannot protect a compromised operator machine. Use a clean, patched system and close screen-sharing or recording tools.

### Cloud provider

The provider can observe metadata and disk contents, including the delegated key. It cannot obtain the phrase from this application because the phrase is never uploaded. Stronger deployments should move the app signer into operator-controlled key management.

### Paid deployment broker

The one-payment path sends a dedicated Hetzner token to the chosen broker over HTTPS. A malicious or compromised broker can use that token while handling the request. Use a new empty project, confirm returned resource IDs in Hetzner, and rotate the token immediately after provisioning.

The broker persists only a token hash and request binding. A hash is still sensitive metadata. The SSH private key, phrase, browser password, app key, and facilitator credentials are not part of the request.

x402 settles before provisioning. Payment can therefore succeed while cloud work fails. The durable entitlement and local payment marker provide resume behavior, but they do not remove broker or facilitator risk. Resolve the receipt before paying again.

### Agent gateway and payments

Paid reads are intentionally public to any payer. Paid writes require the owner capability. Exposure of that capability lets a funded caller buy scoped Farcaster actions until rotation.

Payment settles before the client handles the operation. A valid payment can be followed by schema rejection, protocol rejection, or a message that is accepted for relay but never included. Clients must retain the receipt and message hash, check node state, and avoid blind retries after ambiguous responses.

The Celo facilitator key can spend the configured facilitator balance. The CDP key may have broader permissions depending on its account configuration. Use least-privilege, low-balance credentials and rotate them after exposure.

USDC accrues in an immutable 0xSplits contract until permissionless distribution. Contract or chain failure can delay proceeds. The gateway checks the intended address and bytecode before listening, but this project has not independently audited 0xSplits, usebuy.ai, or its own settlement integration.

### Protocol relay

The operator's read node receives every write. It validates and gossips accepted messages to validators. It has no mempool, so an HTTP success is not block finality. A later read from synced state is the confirmation signal.

Messages and signer records are public protocol data. Peers can observe the node's network address and gossip traffic.

### Source attribution

A cast exposes its exact signer key. App attribution can be absent or self-asserted. The UI groups keys only when the unified signer record supplies shared attribution and otherwise presents signer fingerprints.

## Dependency and release policy

- Snapchain and Caddy images are pinned to platform-specific OCI digests.
- The validator manifest is pinned to a release commit and SHA-256.
- npm uses committed matching lock and shrinkwrap files.
- The operator image pins its Node base image by manifest digest and is published for amd64 and arm64 with provenance and an SBOM.
- Tagged releases run checks, package prebuilt assets, publish a SHA-256 file, and exercise an anonymous image pull.
- `npm audit --audit-level=moderate` must pass.
- The Farcaster core bundle expects removed Faker 7 APIs; a narrow compatibility module supplies those names on pinned Faker 10 without exposing a template evaluator.

## Incident response

1. Stop public access to the client.
2. Revoke the affected app signer.
3. Rotate the agent capability and Celo/CDP facilitator credentials.
4. Preserve node logs, message hashes, x402 receipts, and split receipts.
5. Destroy the host if compromise is suspected.
6. Rebuild with a fresh app key and password.
7. Rotate any cloud credential used during the incident.

Report vulnerabilities through GitHub's private security advisory feature. Never include phrases, private keys, tokens, capabilities, or full environment files.
