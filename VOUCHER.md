# Independent Test

This checklist is for the person validating In Three from a clean machine. It is not a request for a positive review. Report what happened, including failures.

The test costs real money. Read the estimated cost, agree on reimbursement before starting, and destroy the resources when finished.

## Rules

- Use a clean macOS or Linux machine.
- Use a new, empty Hetzner project.
- Create a disposable Farcaster account inside `client create`, or import an existing test account with an FID and storage.
- Never send the recovery phrase to the project author.
- Keep screenshots free of tokens, keys, phrases, capabilities, and complete environment files.
- Record the exact release, commands, timings, and errors.
- Do not use an existing project contributor as the independent tester.

For an agent-led run, give the agent [`skills/in-three/SKILL.md`](skills/in-three/SKILL.md). Use owner-only secret files where supported; the human operator must approve spending and keep phrases, tokens, passwords, and private keys out of agent chat. Record every human intervention.

## Test record

Fill this in as you work:

```text
Tester:
Run type: human-led/agent-led
Farcaster account path (created/imported) and FID:
Machine and OS:
CPU architecture:
Docker version:
Agent, model, and tool versions (if applicable):
Human interventions (if applicable):
In Three release:
Started at (UTC):
Finished at (UTC):
Server plan:
Volume size:
Approximate cloud cost:
Node reached synced state: yes/no
Client opened: yes/no
Cast published: yes/no
Follow worked: yes/no
Reaction worked: yes/no
Resources destroyed: yes/no
Public report URL:
```

## 1. Install

```bash
mkdir in-three-test
cd in-three-test
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.8/in-three-container
chmod +x in-three-container
./in-three-container doctor
```

Record the output. Confirm the downloaded launcher contains `VERSION="0.1.8"`.

The first operational command downloads the matching public amd64 or arm64 container release and checks its SHA-256 before loading it.

## 2. Run the three commands

```bash
./in-three-container provision
./in-three-container node up
./in-three-container client create
```

During provisioning:

- verify the displayed region, server, volume, and monthly estimate
- confirm no resource exists before the `PROVISION` prompt
- record the server IP and generated client hostname after success

During node startup:

- confirm the node uses no hosted Farcaster API key
- run `node status` periodically
- record snapshot size, database size, disk use, and time until ready
- do not restart during snapshot extraction

During client setup:

- confirm no phrase is requested before the node is ready
- confirm the password is entered twice before any signed action
- read the test-account warning
- choose CREATE, save the generated words privately, and record the quoted Optimism amount
- confirm the locally signed FID registration survives interruption, if recovery testing was agreed
- confirm setup reports one account transaction and a separate gasless app-key authorization
- record the final HTTPS URL

## 3. Exercise the client

From both desktop and mobile:

1. Sign in.
2. Load the feed.
3. Publish a cast.
4. Read the cast back from the owned node.
5. Confirm it appears in another Farcaster client.
6. Follow and unfollow an FID.
7. Like, remove the like, recast, and remove the recast.
8. Check that every discovered source key appears in filters.
9. Check grouped app toggles and exact-key toggles.
10. Confirm there is no horizontal overflow or hidden Follow control.

Record message hashes and screenshots without secrets.

A successful submit response means accepted for relay. Reading the message back from synced state is the confirmation.

## 4. Capture the receipt

```bash
./in-three-container proof
```

Inspect `.state/proof/latest.json` and `.state/proof/report.md`. Confirm they contain the release, plan, node metrics, FID, gasless app-key hash, and every accepted write hash. Confirm they do not contain the cloud token, phrase, private keys, password, server IDs, or IP address.

Keep these files for the public report. The destroy command updates the same receipt with teardown evidence.

## 5. Check the boundaries

On the server, confirm:

```bash
sudo ss -lntup
cd /srv/in-three
sudo docker compose ps
sudo docker compose config
```

Expected:

- Snapchain HTTP and gRPC bind only to loopback
- gossip uses UDP 3382
- SSH is CIDR restricted
- browser traffic uses HTTPS
- only the client, Snapchain, and Caddy run in the normal setup
- the custody phrase is absent from server files and container environments
- the app key is present only in the client environment

Do not publish raw command output containing secrets.

## 6. Test recovery

Choose one safe interruption before final deployment, such as stopping `client create` while it waits for Snapchain. Rerun the same command and confirm it resumes.

If an interruption occurs after signing, preserve `.state/client.env.pending`. Confirm the rerun checks existing signer state and does not ask you to authorize another key blindly.

## 7. Destroy everything

```bash
./in-three-container destroy
```

Then inspect the Hetzner project and confirm the server, volume, firewall, SSH key, and related IP resources are gone. Open `.state/proof/report.md` again and confirm it now includes the teardown timestamp.

## Public report

Publish an honest Farcaster cast that includes:

- release tested
- OS and architecture
- whether the full node and client setup completed
- whether the cast, follow, reaction, mobile, and filter tests worked
- one concrete strength
- every material problem
- a link to the tutorial or repository

A useful report is specific. Do not claim success for steps you did not run.
