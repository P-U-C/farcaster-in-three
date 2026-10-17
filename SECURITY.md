# Security Model

In Three handles a Farcaster custody mnemonic for one local transaction. Treat that boundary as wallet software even though the deployed service retains only a delegated app key.

This project has not received an independent security audit.

## Key hierarchy

| Secret | Location | Authority | Lifetime |
| --- | --- | --- | --- |
| Hetzner token | Operator process | Create/delete cloud resources | Provision/destroy command only |
| Custody mnemonic | Operator process memory | Own FID; register/revoke app keys | Signer ceremony only |
| Ed25519 app key | Local `.state/client.env.pending` during setup; then `/srv/in-three/client.env` | Sign Farcaster messages for one FID | Until revoked |
| Client password | Human memory | Open the web client | User controlled |
| Password hash | Client environment | Verify login | Deployment lifetime |
| Session secret | Client environment | Sign HttpOnly cookies | Deployment lifetime |
| SSH private key | Local `.state/` | Operate the host | Host lifetime |

The setup utility validates the client password and its confirmation before asking for the mnemonic. It reads the mnemonic from a TTY with echo disabled and does not accept it through command arguments, environment variables, files, or HTTP. The utility derives the custody account, signs metadata and one OP transaction locally, then returns. JavaScript strings cannot be guaranteed to be zeroized; the process exit is the final memory boundary.

Immediately before transaction submission, the utility writes an owner-only pending file containing the delegated app key and recovery metadata, never the mnemonic or Ethereum private key. A submitted or confirmed transaction can therefore be resumed after receipt polling, network, build, or TLS failure. That file is removed only after the deployed HTTPS health check succeeds.

## Network exposure

Public:

- 80/TCP and 443/TCP+UDP: Caddy and automatic HTTPS
- 3382/UDP: Snapchain QUIC gossip
- 22/TCP: restricted to the operator's detected CIDR

Private to the host/container network:

- 3381/TCP: Snapchain HTTP
- 3383/TCP: Snapchain gRPC
- 3333/TCP: client application

The client has no route to arbitrary Docker services. Its read network is internal; the Snapchain container has a separate egress network for peers.

## Web controls

- scrypt password hash with random 128-bit salt
- HMAC-SHA256, 30-day HttpOnly, SameSite=Strict session cookie
- Secure cookie in deployed HTTPS mode
- CSP, HSTS, frame denial, MIME sniffing denial, and restrictive permissions policy
- read-only client container with `no-new-privileges`
- no custody key in the container
- Zod validation for all write actions
- semantic 4xx validator failures are not retried against every validator

## Threats and limits

### Compromised client host

An attacker can read the delegated key and publish Farcaster messages until it is revoked. They cannot derive the custody key or sign Ethereum transactions. Revoke the signer immediately, destroy the host, and rebuild with a fresh app key and password.

### Compromised operator machine during setup

An attacker with process-memory, terminal, or keyboard access can steal the mnemonic. This architecture cannot protect a compromised operator. Use a clean, patched machine and close screen-sharing/recording tools before setup.

### Cloud provider

The cloud provider can observe metadata and disk contents, including the delegated app key. It cannot see the mnemonic because registration occurs before upload. For a stronger deployment, replace the environment file with an external HSM/secret manager under your control.

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
3. Preserve container logs and the OP registration/revocation receipts.
4. Destroy the host if compromise is suspected.
5. Provision clean infrastructure and register a new signer.
6. Change the client password and any reused cloud credentials.

Report vulnerabilities privately to the repository owner through GitHub's security advisory feature. Do not include mnemonics, private keys, tokens, or full environment files.
