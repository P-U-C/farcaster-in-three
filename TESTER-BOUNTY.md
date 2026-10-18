# Field-Test Bounties

Two independent testing slots are reserved:

- **Human clean-machine test:** 200 USDC
- **Agent-led x402 test:** 200 USDC

Payment is for execution and reproducible evidence, not praise. A failed run can qualify when the report identifies the failure clearly enough to reproduce it.

Evidence is due **2026-10-23 at 14:47 UTC**.

## Claim first

Before spending money, reply publicly to the announcement cast with:

- the track you are claiming
- your Farcaster account
- your OS and CPU architecture
- confirmation that you can start before the deadline

A slot is reserved only after the announcement author confirms it. One person or team may claim one track.

## Human track

1. Start on a clean macOS or Linux machine.
2. Use release `v0.1.4` and a new, empty Hetzner project.
3. Follow [VOUCHER.md](VOUCHER.md).
4. Sync the node, open the browser client, cast, follow, and react.
5. Test desktop and mobile layouts plus source filters.
6. Destroy all cloud resources.
7. Publish the honest public report required by the checklist.

Get written approval before incurring a cost. Reimbursement covers the agreed test infrastructure, not unrelated cloud resources.

## Agent track

1. Start the agent in a clean workspace with the repository and [`skills/in-three/SKILL.md`](skills/in-three/SKILL.md).
2. Record the agent, model, tool versions, prompts, commands, and human interventions.
3. Discover the API through `/.well-known/agent.json` and inspect OpenAPI.
4. Quote before every payment and use exact spending limits.
5. Complete at least one paid read.
6. Complete one authorized paid write with an owner capability.
7. Resolve receipts before retrying any ambiguous result.
8. Publish an honest public report with transaction and message evidence.

Never give an agent the Farcaster custody phrase, a valuable wallet, or an unrestricted cloud token.

## Required evidence

Submit:

- public Farcaster report URL
- exact release and commit
- commands or agent transcript
- timestamps and elapsed times
- node readiness evidence
- client URL with secrets removed
- message hashes for successful writes
- x402 receipt and settlement transaction for agent tests
- screenshots with all secrets redacted
- teardown confirmation
- every failure, workaround, and manual intervention

Do not publish phrases, private keys, API keys, bearer capabilities, complete environment files, or unredacted cloud tokens.

## Payment

The announcement author validates the evidence against this document and [VOUCHER.md](VOUCHER.md). Accepted work is paid in USDC to the tester's public Farcaster wallet unless another address was agreed before work began.
