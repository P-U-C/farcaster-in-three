# In Three

A three-command developer tutorial for running a Snapchain node and browser client from your own machine. Reads and writes go through your node, with no hosted Farcaster data API.

[Website](https://farcaster.permanentupperclass.com/) | [Live proof](docs/PROOF.md) | [中文教程](https://farcaster.permanentupperclass.com/?lang=zh) | [npm](https://www.npmjs.com/package/farcaster-in-three) | [Docker](https://github.com/orgs/P-U-C/packages/container/package/farcaster-in-three) | [Source](https://github.com/P-U-C/farcaster-in-three)

The website includes a captioned 59-second walkthrough after the three-command quickstart.

## What you need

- a fresh Ubuntu or Debian operator machine; the install below can add Docker
- an Ubuntu node machine with 4 CPU cores, 16 GB RAM, 2 TB free, SSH, and passwordless `sudo`
- up to a day for the first sync

On macOS, install Docker Desktop first. If Docker is already available, the installer leaves it alone. npm and Node.js are not required for this path.

Use a machine you already own. Add `--hetzner` if you want In Three to create one.

You do not need a Farcaster account. It is handled in step 3.

<details>
<summary><strong>Need a Hetzner machine?</strong></summary>

1. [Create a Hetzner account and an empty project](https://console.hetzner.cloud/).
2. In the project, open **Security → API tokens**. Generate a **Read & Write** token and copy it.
3. On your account's **Limits** page, choose **Request change → Limit increase**. Request at least **2,048 GiB** of total Volume storage.
4. Run `./in-three-container provision --hetzner` and paste the token when asked.

Hetzner reviews quota increases manually. See its official [API-token guide](https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/) and [quota guide](https://docs.hetzner.com/cloud/general/faq/#are-there-limits-to-the-number-of-resources-i-can-get).

</details>

## Install

```bash
mkdir in-three-node && cd in-three-node
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.25/in-three-container
chmod +x in-three-container
./in-three-container doctor --install-docker
```

On fresh Ubuntu or Debian, the last line installs and starts Docker. It does not install npm. Continue when the final line says `All checks passed.`

## Run the three

```bash
./in-three-container provision
./in-three-container node up
./in-three-container client create
```

1. **Machine:** enter the SSH address of a machine you own. Use `./in-three-container provision --hetzner` instead to create one.
2. **Snapchain:** starts your node. Leave it running during the first sync.
3. **Client:** creates a test account or connects an existing one, then opens your client.

Keep the `in-three-node` folder. If setup pauses, rerun the same command from that folder.

For a scripted owned-machine setup, place a dedicated key in the working folder:

```bash
cp ~/.ssh/id_ed25519 ./node-key
./in-three-container provision --host ubuntu@203.0.113.10 --ssh-key /work/node-key
```

Add `--domain client.example.com` when the SSH host is not the public client hostname.

## Step 3 handles the Farcaster account

Choose `CREATE`, pick a password, and follow the funding prompt. In Three encrypts the new recovery phrase locally and sends only a revocable app key to the server.

Use a new test account. Never import a wallet that holds value.

When setup finishes, open the printed HTTPS URL and publish a test cast.

## Useful commands

```bash
./in-three-container node status
./in-three-container client status
./in-three-container proof
./in-three-container destroy
```

`node status` checks all three shards. If it prints `RECOVERY REQUIRED`, run the exact `./in-three-container node recover --shard N` command it shows. The recovery keeps healthy shards and verifies a fresh snapshot before a brief restart.

On Hetzner, `destroy` deletes the server and volume. On a machine you own, it stops In Three and keeps the machine and its data.

## Prefer npm?

If Node.js 22+ and npm are already installed:

```bash
npm install --global farcaster-in-three
mkdir in-three-node && cd in-three-node
in-three doctor
```

Run the same three commands with `in-three` instead of `./in-three-container`.

## Help

- [Operations](docs/OPERATIONS.md): sync, recovery, upgrades, and teardown
- [Security](SECURITY.md): keys and recovery files
- [Architecture](docs/ARCHITECTURE.md): read and write paths
- [Proof](docs/PROOF.md): run receipts
- [Agent runbook](https://farcaster.permanentupperclass.com/agent.md): guarded setup for coding agents
- [All documentation](docs/README.md)

## Development

```bash
npm ci
npm run check
npm run build
node scripts/visual-check.mjs
```

Automated checks do not replace a complete mainnet sync, real account registration, public cast, and independent human test.

## License

Original code and documentation are [MIT licensed](LICENSE). Snapchain retains its upstream GPL-3.0 license.
