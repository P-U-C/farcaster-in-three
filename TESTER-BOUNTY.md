# Independent Test Offer

Two independent testers are needed before **2026-10-23 at 14:47 UTC**:

- one human-led clean-machine run
- one agent-led clean-machine run

Approved Hetzner test costs will be reimbursed when agreed in writing before the run. If In Three receives the **$2,048 first-place prize**, each accepted tester will also receive **200 USDC**.

Payment is for completing the run and publishing reproducible evidence, not for praise. A failed run can qualify when the report makes the failure reproducible.

## Claim a slot

Before spending money, reply publicly to the announcement cast with:

- `human` or `agent`
- your Farcaster account
- your OS and CPU architecture
- when you can start

A slot is reserved only after the announcement author confirms it. One person or team may claim one slot.

## Human-led run

1. Start on a clean macOS or Linux machine.
2. Use release `v0.1.18` and a new, empty Hetzner project.
3. Follow [VOUCHER.md](VOUCHER.md).
4. Sync the node and open the browser client.
5. Publish a cast, follow an FID, and add a reaction.
6. Test desktop, mobile, and source filters.
7. Destroy every cloud resource.
8. Publish an honest public report.

## Agent-led run

1. Start with a clean machine and a new Hetzner project; create the disposable Farcaster account inside `client create`.
2. Give the agent this repository and [`skills/in-three/SKILL.md`](skills/in-three/SKILL.md).
3. Ask it to complete the same [independent test](VOUCHER.md) using release `v0.1.18`.
4. Keep the recovery phrase, cloud token, wallet keys, and spending confirmations out of agent chat. The human operator must handle secret prompts directly.
5. Record the agent, model, tool versions, initial prompt, commands, errors, retries, and every human intervention.
6. Publish the resulting cast and an honest public report.
7. Destroy every cloud resource.

The optional paid x402 API is not required for this run. Testing it is useful only when separately agreed and funded.

## Required evidence

Submit:

- public Farcaster report URL
- exact release and commit
- commands or agent transcript
- timestamps and elapsed times
- node readiness evidence
- client URL with secrets removed
- message hashes for successful writes
- desktop and mobile screenshots
- teardown confirmation
- every failure, workaround, retry, and manual intervention

For an agent-led run, also include the agent, model, tool versions, initial prompt, and a redacted transcript.

Do not publish recovery phrases, private keys, API keys, bearer capabilities, complete environment files, or unredacted cloud tokens.

## Acceptance and payment

The announcement author checks the evidence against this document and [VOUCHER.md](VOUCHER.md).

Approved infrastructure reimbursement is paid after the accepted report and teardown evidence. The 200 USDC tester award is paid only if In Three receives the $2,048 first-place prize. Payment goes to the tester's public Farcaster wallet unless another address was agreed before the run.
