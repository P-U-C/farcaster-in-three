# Security Model

In Three handles a Farcaster custody mnemonic to prepare one app-key transaction and, when needed, two zero-value revenue-split creation calls. Treat that boundary as wallet software even though the deployed service retains only a delegated app key.

This project has not received an independent security audit.

## Key hierarchy

| Secret | Location | Authority | Lifetime |
| --- | --- | --- | --- |
| Hetzner token | Manual path: operator process. Paid path: operator process and selected broker process over HTTPS | Create/delete resources in one Hetzner project | Provision/destroy command only; never persisted by In Three |
| Deployment entitlement | Broker data volume | SHA-256 token binding, deployment ID, SSH public key, source CIDR; authorizes free resume | Broker lifetime |
| Custody mnemonic | Operator process memory | Full EVM account authority; owns the FID and can register/revoke app keys | Setup ceremony only |
| Ed25519 app key | Local `.state/client.env.pending` during setup; then `/srv/in-three/client.env` | Sign Farcaster messages for one FID | Until revoked |
| Serialized setup transactions | Local `.state/client.env.pending` until each confirmation | Rebroadcast fixed Celo/Base SplitFactory and OP KeyGateway calls | Setup only |
| Client password | Human memory | Open the web client | User controlled |
| Password hash | Client environment | Verify login | Deployment lifetime |
| Session secret | Client environment | Sign HttpOnly cookies | Deployment lifetime |
| Celo facilitator API key | Local `.state/client.env.pending` during setup; then `/srv/in-three/agent-gateway.env` | Ask Celo's facilitator to settle x402 payments | Deployment lifetime |
| Coinbase CDP Secret API key | Local `.state/client.env.pending` during setup; then `/srv/in-three/agent-gateway.env` | Authenticate Base x402 facilitator requests | Deployment lifetime |
| Agent write capability | Local `.state/client.env.pending` during setup; then `.state/agent.env` and the agent gateway environment | Reach paid Farcaster write routes | Until rotated |
| SSH private key | Local `.state/` | Operate the host | Host lifetime |

The setup utility validates the client password and both facilitator credentials before asking for the mnemonic. It reads the mnemonic from a TTY with echo disabled and does not accept it through command arguments, environment variables, files, or HTTP. The utility derives the custody account and prepares fixed, zero-value SplitFactory calls on Celo/Base when their deterministic contracts do not exist, plus one KeyGateway call on Optimism. It prints the transaction count and requires `ENABLE AND REGISTER` before broadcast. JavaScript strings cannot be guaranteed to be zeroized; process exit is the final memory boundary.

Before the first `eth_sendRawTransaction`, the utility signs every required setup transaction locally, calculates each hash, and writes all serialized transactions, hashes, and the delegated app key to an owner-only pending file. It never stores the mnemonic or Ethereum private key. If an RPC accepts a transaction but drops its response, rerunning setup checks receipts and rebroadcasts only the exact pending bytes; it cannot silently construct a replacement. Each serialized transaction is removed after confirmation, and the pending file is removed only after the deployed HTTPS health checks succeed.

## Network exposure

Public:

- 80/TCP and 443/TCP+UDP: Caddy and automatic HTTPS
- 3382/UDP: Snapchain QUIC gossip
- 22/TCP: restricted to the operator's detected CIDR

Private to the host/container network:

- 3381/TCP: Snapchain HTTP
- 3383/TCP: Snapchain gRPC
- 3333/TCP: client application
- 3334/TCP: x402 agent gateway
- 3335/TCP: fixed-plan deployment service

The client has no route to arbitrary Docker services. Its read network is internal; the Snapchain container has a separate egress network for peers. The deployment service is isolated on an internal control-plane network shared only with the agent gateway and uses a separate network for Hetzner API egress. The client and Caddy cannot bypass the gateway to reach it. The gateway cannot reach Snapchain directly. The client environment excludes facilitator credentials, split recovery state, and the agent capability; the gateway environment excludes the Farcaster signer, password hash, and session secret. The deployer has no environment secret: it receives a buyer token only in a bounded request body, calls Hetzner, and persists only a SHA-256 binding.

## Web controls

- scrypt password hash with random 128-bit salt
- HMAC-SHA256, 30-day HttpOnly, SameSite=Strict session cookie
- Secure cookie in deployed HTTPS mode
- CSP, HSTS, frame denial, MIME sniffing denial, and restrictive permissions policy
- read-only client container with `no-new-privileges`
- no custody key in the container
- Zod validation for all write actions
- x402 v2 payment challenges offering Celo and Base USDC for every paid agent operation
- owner bearer capability checked before any write payment challenge
- per-IP, per-payer, and service-level rate limits
- exact HTTP method, body size, JSON, and top-level field restrictions before payment
- semantic 4xx validator failures are not retried against every validator

## Threats and limits

### Compromised client host

An attacker can read the delegated key and publish Farcaster messages until it is revoked. They cannot derive the custody key or sign Ethereum transactions. Revoke the signer immediately, destroy the host, and rebuild with a fresh app key and password.

### Compromised operator machine during setup

An attacker with process-memory, terminal, or keyboard access can steal the mnemonic. This architecture cannot protect a compromised operator. Use a clean, patched machine and close screen-sharing/recording tools before setup.

### Cloud provider

The cloud provider can observe metadata and disk contents, including the delegated app key. It cannot see the mnemonic because registration occurs before upload. For a stronger deployment, replace the environment file with an external HSM/secret manager under your control.

### Paid deployment broker

The one-purchase path deliberately sends a Hetzner token to the selected broker. HTTPS protects it in transit, but the broker can use that token while handling the request. A malicious or compromised broker could create, inspect, or delete resources within the token's project permissions. Use a new, otherwise-empty Hetzner project, create a read/write token only for this deployment, verify the returned resource IDs in the provider console, and rotate the token after provisioning. The manual three-command path keeps the token on the operator machine.

The broker receives only the SSH public key. The private key is generated under local `.state/`; the Farcaster phrase, client password, seller facilitator credentials, and app signer are not part of the deployment request.

Preflight creates and deletes an unbillable temporary SSH key to prove write permission before payment. The paid route persists an entitlement before cloud creation, and `status`/`resume` can continue the same request without another payment. The entitlement stores the SHA-256 token hash, SSH public key, source CIDR, and deployment ID, not the token. Treat the hash as sensitive metadata and protect the broker data volume.

x402 settlement on the buyer-selected chain occurs before the deployer runs. A facilitator or gateway failure can therefore settle payment without producing an entitlement. The local payment marker blocks automatic repurchase. Resolve the buyer receipt and ask the broker to investigate or refund using the deployment ID and settlement transaction; never send the cloud token in support messages.

### Agent gateway and payments

Paid reads are intentionally available to any buyer. Paid writes require the owner-issued bearer capability before the gateway returns a 402, so an unauthorized caller is not charged and cannot reach the signer. Exposure of that capability lets a funded caller buy Farcaster actions until it is rotated.

x402 settles before the paid request reaches the client. A valid payment can therefore be followed by a client or validator rejection. The gateway rejects wrong methods, malformed JSON, oversized bodies, unexpected fields, and rate-limit excesses before payment, but agents must still validate semantic input and must not blindly retry ambiguous paid responses.

The Celo facilitator API key can spend the operator's Celo facilitator balance. The Coinbase CDP key authenticates Base facilitator requests and may carry broader permissions according to its CDP configuration. Neither can sign Farcaster messages; both are isolated in the agent gateway container. Use least-privilege keys and rotate either credential immediately if exposed.

Paid USDC lands at an immutable 0xSplits contract, not directly in either recipient wallet. Distribution is permissionless and charges the configured 0.1% incentive. Until distribution runs, contract risk and chain availability can delay access to proceeds. The gateway recomputes the intended 95/5 address and confirms deployment on both chains before listening, but this project has not independently audited 0xSplits.

The bundled usebuy.ai buyer is pre-1.0 beta software, and this project's x402/CDP/Splits integration has not received an independent security audit. Keep exact lockfile versions, use dedicated low-balance buyer and facilitator accounts, inspect release notes before upgrading, and treat automated tests as evidence of behavior rather than a guarantee of mainnet settlement safety. This release advertises Celo and Base mainnet; neither rail has completed the required live voucher run.

### Public validator

A validator sees signed write messages and the submitter IP. Messages are public protocol data. Reads never use that validator.

### Public DNS

The default HTTPS hostname uses `sslip.io` to resolve the server IP without manual DNS. DNS controls availability, not TLS private keys or Farcaster keys. Use your own domain for long-running operation.

### Source-filter attribution

A cast always exposes an exact signer key. Human client names are inferred from SignedKeyRequest metadata's `requestFid` and can be absent or self-attributed. The UI keeps unknown sources as signer fingerprints rather than inventing attribution.

## Dependency policy

- Snapchain and Caddy images are pinned to platform-specific OCI digests.
- The validator manifest is pinned to a release commit and SHA-256.
- npm uses a committed lockfile.
- `npm audit --audit-level=moderate` must pass.
- The official Farcaster core bundle expects removed Faker 7 APIs. A narrow compatibility module supplies those names on patched Faker 10; no Faker template evaluator is exposed to requests.

## Incident response

1. Take the client offline: `./farcaster client status`, then stop Caddy/client remotely.
2. Revoke the affected signer from the Farcaster account's connected-app management.
3. Rotate the agent write capability plus the Celo and Coinbase CDP facilitator credentials.
4. Preserve container logs, x402 receipts, split-creation receipts, and OP registration/revocation receipts.
5. Destroy the host if compromise is suspected.
6. Provision clean infrastructure and register a new signer.
7. Change the client password and any reused cloud credentials.

Report vulnerabilities privately to the repository owner through GitHub's security advisory feature. Do not include mnemonics, private keys, tokens, or full environment files.
