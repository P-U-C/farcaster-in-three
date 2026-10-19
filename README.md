# In Three

Run your own Farcaster node and browser client in three commands.

[Website](https://farcaster.permanentupperclass.com/) | [npm](https://www.npmjs.com/package/farcaster-in-three) | [Container](https://github.com/orgs/P-U-C/packages/container/package/farcaster-in-three) | [Source](https://github.com/P-U-C/farcaster-in-three)

In Three creates a Hetzner server, starts a Snapchain read node, and deploys a private web client. The client reads from your node and sends signed writes back to it. No hosted Farcaster API is used.

## Quickstart with npm

You need macOS or Linux, Node.js 22 or newer, and a Hetzner Cloud token from a new, empty project with at least 2,048 GiB of total Volume quota.

Install the prebuilt CLI and check your machine:

```bash
npm install --global farcaster-in-three
mkdir in-three-node && cd in-three-node
in-three doctor
```

Then run the three setup commands:

```bash
in-three provision
in-three node up
in-three client create
```

1. **Provision** shows the billable plan, waits for `PROVISION`, then creates the server, volume, firewall, and SSH key.
2. **Node up** starts Snapchain. The initial snapshot keeps downloading on the server.
3. **Client create** waits for the node, creates or imports a disposable test account, adds a gasless app key, deploys the browser client, and prints its HTTPS URL.

Keep using the same working directory. It stores the local state needed to resume setup safely. You can stop `client create` with Ctrl-C and rerun it later; setup checks saved state before repeating a signed action. Agent-led runs can pass an owner-only local secret with `client create --password-file PATH`; the file is never uploaded.

## What you need

You do **not** need a Farcaster account before starting. When `client create` asks, press Enter at `CREATE or IMPORT [CREATE]`. In Three then:

1. Generates a new 12-word test-account phrase locally.
2. Encrypts it with your client password in `.state/test-account.recovery.json`; the phrase is never printed or uploaded.
3. Shows a new address and the amount of ETH to send on Optimism.
4. Signs one local account-registration transaction that creates the FID and one storage unit.
5. Adds the client app key with a gasless Snapchain message.

This account setup stays inside the third command. If you already have a disposable test account, choose `IMPORT` instead.

You also need:

- the quoted amount of ETH on Optimism when creating a new account
- several hours for the first Snapchain sync
- about $324/month for the default server, IPv4, and 2 TiB volume at the live quote observed on 2026-10-19

The CLI shows the current Hetzner plan and waits for confirmation before creating anything.

> **Use a test account only.** The encrypted recovery kit plus your client password controls the account. Keep both private, back them up separately, and never import an account that holds value. Production clients should use wallet-based delegated authorization whenever possible.

## Publish your first cast

1. Open the HTTPS URL printed by `client create`.
2. Sign in with the password created during setup.
3. Select **New cast**, write a test message, and publish it.
4. Refresh until your node returns the cast.
5. Confirm the same cast appears in another Farcaster client.

A successful write means your node accepted the message for relay. Reading it back from the synced node confirms inclusion.

## Useful commands

```bash
in-three node status
in-three node logs
in-three client status
in-three client logs
in-three proof
in-three destroy
```

Run `destroy` when finished, then confirm the server and volume are gone in Hetzner.

## Container install

Use this path if you prefer to run packaged code inside Docker. It requires a running Docker daemon but does not require a global npm install:

```bash
mkdir in-three-node && cd in-three-node
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.13/in-three-container
chmod +x in-three-container
./in-three-container doctor
```

Run the same three commands with `./in-three-container`:

```bash
./in-three-container provision
./in-three-container node up
./in-three-container client create
```

Use a source checkout only when reviewing or changing the implementation:

```bash
git clone https://github.com/P-U-C/farcaster-in-three.git
cd farcaster-in-three
./farcaster doctor
```

## Optional agent access

The normal setup creates only the browser client. To add paid x402 access for agents during initial setup, use:

```bash
in-three client create --with-agent
```

This advanced path also asks for Celo and Coinbase facilitator credentials and configures USDC settlement on Celo and Base. Read the [agent guide](https://github.com/P-U-C/farcaster-in-three/blob/v0.1.13/docs/AGENT-API.md) before choosing it.

## Reference

- [Operations](https://github.com/P-U-C/farcaster-in-three/blob/v0.1.13/docs/OPERATIONS.md): expected output, sync status, recovery, upgrades, and teardown
- [Proof](https://github.com/P-U-C/farcaster-in-three/blob/v0.1.13/docs/PROOF.md): verification status, redacted run receipts, and evidence requirements
- [Architecture](https://github.com/P-U-C/farcaster-in-three/blob/v0.1.13/docs/ARCHITECTURE.md): what runs where and how reads and writes move
- [Security](https://github.com/P-U-C/farcaster-in-three/blob/v0.1.13/SECURITY.md): phrase handling, app keys, secrets, and incident response
- [Agent API](https://github.com/P-U-C/farcaster-in-three/blob/v0.1.13/docs/AGENT-API.md): optional x402 routes, prices, and payment safety
- [Primary sources](https://github.com/P-U-C/farcaster-in-three/blob/v0.1.13/docs/SOURCES.md): pinned Farcaster, Snapchain, and infrastructure references
- [Independent test](https://github.com/P-U-C/farcaster-in-three/blob/v0.1.13/VOUCHER.md): clean-machine validation checklist

## Development

```bash
npm ci
npm run check
npm run build
npm audit --audit-level=moderate
docker build -f Dockerfile.operator -t in-three-operator:test .
docker run --rm in-three-operator:test doctor
node scripts/visual-check.mjs
```

Automated tests do not replace a paid cloud deployment, full mainnet sync, real app-key registration, and public cast. Those require an independent clean-machine run.

## License

Original code and documentation are [MIT licensed](LICENSE). The deployment runs Farcaster's GPL-3.0 Snapchain image by immutable digest; that image keeps its upstream license.
