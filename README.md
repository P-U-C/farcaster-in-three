# In Three

Run your own Farcaster node and browser client in three commands.

[Website](https://farcaster.permanentupperclass.com/) | [npm](https://www.npmjs.com/package/farcaster-in-three) | [Docker](https://github.com/orgs/P-U-C/packages/container/package/farcaster-in-three) | [Source](https://github.com/P-U-C/farcaster-in-three)

## Before you start

You need:

- macOS or Linux with Node.js 22+
- a new Hetzner Cloud project with 2,048 GiB of Volume quota
- several hours for the first Snapchain sync
- about $324/month for the default server and storage

You do **not** need a Farcaster account. Command three can create a disposable test account. The script shows the live cloud price before creating anything.

## Install

```bash
npm install --global farcaster-in-three
mkdir in-three-node && cd in-three-node
in-three doctor
```

Continue when the final line says `All checks passed.`

## Run the three

```bash
in-three provision
in-three node up
in-three client create
```

1. `provision` shows the price and creates the server after you approve it.
2. `node up` starts Snapchain. Leave it running while the first snapshot downloads.
3. `client create` waits for the node, creates or imports a test account, and prints your client URL.

Keep the `in-three-node` folder. If setup pauses, rerun the same command from that folder. It resumes from saved state.

## When command three asks

For a new account:

1. Press Enter to choose `CREATE`.
2. Choose a client password.
3. Send the exact amount of ETH shown to the displayed address on **Optimism**.
4. Return to the terminal and follow the two confirmation prompts.

The recovery phrase is encrypted locally and is never printed or uploaded. The server receives a revocable app key that can post, follow, react, and update the public profile. It cannot move funds.

> Use a new test account only. Never import a wallet that holds value.

## Make the first cast

Open the HTTPS URL printed by command three, sign in, and publish a test cast. Read it back in your client to confirm your node has it.

Useful commands:

```bash
in-three node status
in-three client status
in-three proof
in-three destroy
```

Run `destroy` when finished, then confirm the server and volume are gone in Hetzner.

## Prefer Docker?

```bash
mkdir in-three-node && cd in-three-node
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.14/in-three-container
chmod +x in-three-container
./in-three-container doctor
```

Then run the same three commands with `./in-three-container` instead of `in-three`.

## Need more detail?

- [Documentation index](docs/README.md)
- [Operations](docs/OPERATIONS.md): sync, recovery, upgrades, and teardown
- [Security](SECURITY.md): keys, recovery files, and exposure
- [Architecture](docs/ARCHITECTURE.md): how reads and writes move
- [Proof](docs/PROOF.md): run receipts and verification
- [Optional agent API](docs/AGENT-API.md): x402 access using Celo or Base
- [Independent test](VOUCHER.md): clean-machine checklist

## Development

```bash
npm ci
npm run check
npm run build
node scripts/visual-check.mjs
```

Automated checks do not replace a paid cloud deployment, complete mainnet sync, real account registration, and public cast.

## License

Original code and documentation are [MIT licensed](LICENSE). The official Snapchain image retains its upstream GPL-3.0 license.
