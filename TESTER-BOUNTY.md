# In Three Field-Test Bounties

Two independent field tests are available before the Farcaster client prize deadline. One qualified human run earns **200 USDC** and one qualified agent-led run earns **200 USDC**.

This bounty pays for careful execution and reproducible evidence. It does not buy praise. A tester must report failures and friction honestly, and nobody is required to publish a positive endorsement.

## Availability

| Track | Reward | Slots | Purpose |
| --- | ---: | ---: | --- |
| Human | 200 USDC | 1 | Complete the clean-machine tutorial and, only if warranted, provide the independent Farcaster voucher |
| Agent | 200 USDC | 1 | Show that an agent can follow the public skill, operate the deployment, and use the x402 client path |

The repository may not reflect a reservation immediately. Do not spend money until the announcement-cast author publicly replies **RESERVED: HUMAN** or **RESERVED: AGENT** to your claim.

## Claim before spending

1. Reply to the announcement cast with `HUMAN` or `AGENT`, your Farcaster username, operator OS, and the cloud region you can use.
2. For the agent track, also name the agent and model and state whether it can run shell commands from a clean workspace.
3. Wait for a public reservation reply from the announcement-cast author.
4. Start within 24 hours of reservation. Submit evidence by **2026-10-23 14:47 UTC**, leaving one day for verification before the prize deadline.
5. Use one track only. Project authors, prior contributors, and anyone who helped build the tutorial cannot claim the human track.

The reward includes the tester's cloud, gas, x402, and other execution costs. Tear the infrastructure down promptly after preserving evidence. A reservation expires if work does not begin within 24 hours or the tester stops reporting progress.

## Human track: 200 USDC

Use a clean machine and follow the public tutorial without private coaching.

1. Pull the versioned OCI release from a new empty working directory. Record its version, manifest/platform digests, release tag, provenance, and underlying commit.
2. Run `./in-three-container doctor` and inspect the launcher's mount, user, capability, and Docker-socket boundaries.
3. Run the three manual commands: `./in-three-container provision`, `./in-three-container node up`, and `./in-three-container client create`.
4. Let Snapchain complete its initial sync. Record elapsed time, storage use, and any undocumented intervention.
5. Use the deployed browser client on desktop and mobile to read the feed, publish a cast, follow an FID, like, recast, and exercise app-level and exact-key source controls.
6. Complete every applicable security and teardown check in [VOUCHER.md](VOUCHER.md).
7. Publish an honest Farcaster report in your own words. Link the tutorial and test cast, name at least one concrete strength, and disclose all material friction.
8. Submit the public report URL and the redacted evidence package described below.

A positive endorsement counts as the prize voucher only if the tester genuinely completed the path and believes the tutorial merits it. A complete, reproducible critical-blocker report can still earn the bounty, but it is not an endorsement and does not satisfy the prize requirement.

## Agent track: 200 USDC

The agent must lead the run from public instructions. Its human operator may provide credentials only through documented local secret prompts and may approve spending, cloud creation, gasless signer authorization, or publication. The human must not paste a recovery phrase or private key into agent chat. Use an otherwise disposable test account; production clients should use delegated wallet authorization instead of raw phrase entry.

1. Start the agent in a clean workspace with the repository URL and [`skills/in-three/SKILL.md`](skills/in-three/SKILL.md).
2. Preserve the initial task prompt, agent/model identity, exact commit, command transcript, and every point where the agent requests human authority.
3. Have the agent run the prerequisite checks and operate the documented deployment. It may use the manual three-command path; if the organizer supplies a live broker URL, use the one-purchase path and verify that resume never charges twice.
4. After the client is live, have the agent discover `/.well-known/agent.json` and `/agent/openapi.json` without payment.
5. Confirm the unpaid response advertises equal x402 v2 offers on Celo and Base to the same split address.
6. Using dedicated low-balance wallets, buy one Celo read and one Base read with explicit ceilings. Preserve both settlement receipts.
7. With the owner-supplied write capability, have the agent buy and publish one cast. Verify its message hash and signer by reading it back from the owned node after relay.
8. Confirm reads came from the owned Snapchain node and that the 95/5 split is deployed as documented.
9. Publish a redacted execution report and link the public cast created through the agent path.

A polished narrative generated after the fact is not sufficient. The evidence must show the agent actually made decisions, ran commands, handled bootstrap state, and used the paid endpoint.

## Evidence package

Publish a GitHub issue, gist, or repository containing:

- Exact tested commit and UTC timestamps
- Operator OS, cloud region, server type, and Snapchain version
- Redacted command or agent transcript
- Node sync evidence and final shard delays
- Public client URL and test-cast URL
- Celo and Base receipts used by the track
- Revenue split address and recipient verification
- Mobile and desktop screenshots for the human track
- Every failure, workaround, and undocumented instruction
- Confirmation that teardown removed billable resources

Never publish a recovery phrase, private key, cloud token, client password, facilitator credential, write capability, session cookie, or unredacted environment file.

## Acceptance and payment

The announcement-cast author validates submissions against this document and [VOUCHER.md](VOUCHER.md). Evidence must be independently reproducible and must not be fabricated, replayed from another tester, or produced by a project contributor.

The accepted claimant supplies a Celo or Base address for 200 USDC. The agent track may nominate an agent-controlled address or its disclosed human operator's address. The payment transaction becomes the public receipt.

## Announcement cast

> $200 USDC HUMAN + $200 USDC AGENT
>
> Two reserved field-test bounties for In Three, the 3-command Farcaster read node + client.
>
> Human: clean-machine run + honest public cast.
> Agent: execute the skill + x402 path with receipts.
>
> Claim before spending:
> https://farcaster.permanentupperclass.com/#verify
