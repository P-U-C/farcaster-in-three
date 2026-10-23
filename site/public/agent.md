# In Three agent runbook

Use In Three to deploy a Farcaster Snapchain node and browser client in three commands. Reads and signed writes go through the operator's node. No hosted Farcaster data API key is required.

Canonical human tutorial: https://farcaster.permanentupperclass.com/
Source and full Agent Skill: https://github.com/P-U-C/farcaster-in-three/tree/main/skills/in-three
Current release: v0.1.25

## Non-negotiable boundaries

- Never ask for, accept, read, print, or repeat a Farcaster recovery phrase, browser password, cloud token, SSH private key, or payment private key in chat.
- Prefer a suitable Ubuntu machine the operator already controls.
- State the exact recurring cloud cost before provisioning and wait for approval.
- Stop for human approval before cloud spend, account funding, an x402 payment, or any Farcaster write.
- Never post, follow, react, change a profile, or destroy infrastructure without approval for that exact action.
- Preserve the working directory. Resumable state and encrypted recovery material live under `.state/`.

If the operator pastes a secret into chat, stop and tell them to rotate it.

## Requirements

The operator can use a fresh Ubuntu or Debian machine; the install below adds Docker when needed. On macOS, install Docker Desktop first. Node.js and npm are not required.

The Snapchain host needs Ubuntu, 4 CPU cores, 16 GB RAM, 2 TB free disk, SSH, and passwordless sudo. Initial sync can take up to a day.

## Install

```bash
mkdir in-three-node && cd in-three-node
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.25/in-three-container
chmod +x in-three-container
./in-three-container doctor --install-docker
```

Continue only when the final line says `All checks passed.`

## Run the three

For an existing machine:

```bash
./in-three-container provision --host USER@HOST --ssh-key /work/node-key
./in-three-container node up
./in-three-container client create
```

Place the dedicated SSH key in the working directory before the run. Use `./in-three-container provision --hetzner` only when the operator explicitly chooses Hetzner and approves the displayed quote. Never place its API token in chat or command arguments.

Command two starts a detached, resumable snapshot bootstrap. Command three waits for shards 0, 1, and 2 to be near the network tip before requesting any account action.

## Report progress

```bash
./in-three-container node status
```

Report the current phase, shard, chunk count, elapsed time, and disk use. Do not restart a bootstrap that is making progress.

If status prints `RECOVERY REQUIRED`, run only the exact `./in-three-container node recover --shard N` command it displays. Recovery refreshes snapshot metadata, keeps healthy shards, validates the replacement, and performs a brief atomic swap.

## Human account handoff

Command three offers:

- `CREATE`: makes a disposable test account, encrypts its recovery kit locally, and shows the operator the exact Optimism funding requirement.
- `IMPORT`: accepts an existing test-account phrase through hidden local terminal input.

The phrase is never sent to the server. The server receives only a scoped, revocable app key.

For an interactive run, the operator completes `./in-three-container client create` in their own terminal. For approved unattended input, the operator may prepare a one-line owner-only password file and pass `--password-file PATH`. Do not create, read, or transmit the password yourself.

After deployment, give the operator the printed HTTPS URL. Ask before every cast, follow, reaction, or profile change.

## Verify and finish

```bash
./in-three-container proof
./in-three-container node status
./in-three-container client status
```

Inspect `.state/proof/latest.json` and `.state/proof/report.md` before sharing them. They exclude secrets and infrastructure identifiers, but the operator should still review them.

When the operator approves teardown:

```bash
./in-three-container destroy
```

On Hetzner this deletes the managed server and volume. On an existing machine it stops In Three and retains the machine and node data.

## Optional paid agent API

The x402 API is separate from the basic setup. It offers paid reads and authorized writes over Celo and Base, with one-payment deployment support.

Read the contract before quoting or paying:
https://github.com/P-U-C/farcaster-in-three/blob/main/docs/AGENT-API.md

## Detailed references

- Operations: https://github.com/P-U-C/farcaster-in-three/blob/main/docs/OPERATIONS.md
- Security: https://github.com/P-U-C/farcaster-in-three/blob/main/SECURITY.md
- Architecture: https://github.com/P-U-C/farcaster-in-three/blob/main/docs/ARCHITECTURE.md
- Proof: https://github.com/P-U-C/farcaster-in-three/blob/main/docs/PROOF.md
