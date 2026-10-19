# Security

In Three performs a developer-only Farcaster key ceremony. Treat the local setup process as wallet software.

This project has not received an independent security audit.

## Rules that matter most

- Use a disposable Farcaster test account.
- Inspect and trust the exact release before creating or importing an account.
- Keep the generated encrypted recovery kit and client password private and backed up separately. Never put a phrase in chat, an environment variable, a command argument, or a remote shell.
- Do not reuse a phrase that controls valuable assets.
- Prefer delegated wallet authorization for production clients.
- Keep the working directory and `.state/` private.
- If In Three created cloud resources, destroy them when the test ends.

Setup defaults to `CREATE`, generates a fresh phrase, and writes only a password-encrypted recovery kit to the owner-only local `.state/` directory. It does not print the phrase. `IMPORT` uses hidden terminal input. These controls are not security guarantees. JavaScript strings cannot be reliably zeroized; process exit is the final memory boundary.

## What each key can do

| Item | Where it exists | Authority |
| --- | --- | --- |
| Hetzner token (optional) | Local setup process | Resources in the selected Hetzner project |
| Test-account phrase | Local process memory and AES-256-GCM encrypted recovery kit | Full custody account control |
| Signed FID registration | Local owner-only recovery file until confirmed | Creates one FID and storage unit for the shown address |
| App key | Local recovery file, then client container | Casts, reactions, follows, and public profile metadata for one FID |
| Signed `KEY_ADD` | Local recovery file until confirmed | Authorizes one exact app key |
| Browser password | User memory or optional owner-only local password file | Opens the web client and encrypts the generated-account recovery kit |
| Password hash and session secret | Client container | Login and cookies |
| SSH private key | Local `.state/` | Operates the server |
| Agent write capability | Optional local and gateway state | Reaches paid write routes |
| Facilitator credentials | Optional gateway only | Settles x402 payments |
| Revenue-split transactions | Optional recovery file until confirmed | Creates fixed Celo/Base split contracts |

The recovery phrase is never printed or uploaded. For `CREATE`, it is written only inside an AES-256-GCM recovery kit whose key is derived from the client password with scrypt. The plaintext phrase and derived custody private key exist only in local process memory. Agent-led runs may read the client password from an explicit owner-only file; setup rejects group/world permissions and never uploads that file.

## Account and app-key recovery

For a new account, setup generates the phrase locally, encrypts it into `.state/test-account.recovery.json`, quotes the required Optimism balance, and signs the IdGateway transaction only after explicit confirmation. It saves the exact signed transaction and local hash before broadcasting. If the RPC response is lost, rerunning `client create` with the same password and leaving `CREATE` selected decrypts the kit and resumes the same transaction.

The transaction-recovery file contains the address and signed transaction, never the phrase or custody private key. Once the FID is confirmed, setup deletes that transaction file and waits for the bundled storage unit to appear on the owned node. The encrypted account kit remains local until the operator deliberately removes it.

Before creating the app key, setup confirms the browser password and opens a local SSH tunnel to the owned node. It then:

1. Derives the custody address locally.
2. Resolves the FID.
3. Checks storage through the owned node.
4. Creates a fresh Ed25519 app key.
5. Signs a scoped, gasless `KEY_ADD` message.
6. Saves the exact bytes, hash, checksum, and app key to owner-only recovery state.
7. Submits through the SSH tunnel.
8. Waits for the signer to appear in node state.
9. Uploads only the delegated app key.

If the response is lost, rerunning `client create` checks node state and resubmits the same bytes. It does not discard a potentially live key or authorize another one.

## Local operator container

The launcher runs the published operator image with:

- the invoking UID and GID
- read-only root
- all Linux capabilities dropped
- `no-new-privileges`
- a no-exec temporary filesystem
- a process limit
- one bind mount: the current working directory
- no Docker socket

This reduces the host surface but does not make a malicious image safe. Verify the version, provenance, checksum, Dockerfile, and launcher before handling credentials.

## Server exposure

Public:

- 80/TCP and 443/TCP+UDP: HTTPS
- 3382/UDP: Snapchain gossip
- 22/TCP: SSH; Hetzner setup restricts it to the detected operator CIDR

On an existing machine, the owner is responsible for matching those firewall rules before setup.

Private:

- 3381/TCP: Snapchain HTTP
- 3383/TCP: Snapchain gRPC
- 3333/TCP: client
- 3334/TCP: optional agent gateway
- 3335/TCP: optional deployment service

The client reaches Snapchain on a private container network. Optional payment and deployment services are separated from the Farcaster signer.

## Web controls

The client uses:

- scrypt password hashing with a random salt
- signed, expiring, HttpOnly, SameSite=Strict cookies
- Secure cookies under HTTPS
- CSP, HSTS, frame denial, and MIME-sniffing denial
- read-only containers with `no-new-privileges`
- schema validation and rate limits on writes

## Main failure cases

**Client host compromised:** an attacker can use the delegated app key until it expires or is revoked. Revoke it, rotate browser and optional agent secrets, destroy the host, and rebuild.

**Operator machine compromised:** malware can capture passwords, decrypt the local recovery kit, or read secrets from process memory. In Three cannot protect a compromised host or keyboard.

**Host or cloud provider compromised:** the machine operator can read server disk contents, including the app key, but the phrase is not uploaded.

**Read-node submission succeeds but the cast is absent:** success means accepted for relay, not final inclusion. Wait for sync and read the message back before retrying.

**Optional payment succeeds but the operation fails:** keep the receipt and message hash. Do not pay again until you resolve whether the first request settled.

**Optional deployment broker compromised:** the broker can use the dedicated Hetzner token during the request. Use a new empty project and rotate the token after provisioning.

## Supply chain

- Snapchain, Caddy, and the Node base image are pinned by digest.
- Validator configuration is pinned by commit and checksum.
- npm dependency versions are locked.
- npm releases carry GitHub OIDC provenance.
- Container releases include tested amd64 and arm64 images plus SHA-256 files.
- CI runs typechecks, application tests, shell tests, package verification, Compose validation, container smoke tests, and dependency audit.

## Incident response

1. Stop public access.
2. Revoke the app signer.
3. Rotate the browser secret and any optional facilitator or agent credentials.
4. Preserve logs, message hashes, and payment receipts.
5. Destroy the host if compromise is suspected.
6. Rebuild with a fresh app key and password.
7. If Hetzner was used, rotate its API token.

Report vulnerabilities through GitHub private security advisories. Never include phrases, private keys, tokens, capabilities, or complete environment files.
