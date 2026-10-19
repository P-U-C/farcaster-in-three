# Proof

This page separates shipped code from evidence produced by a real deployment.

## Current verification status

| Claim | Status |
| --- | --- |
| npm CLI installs and runs from the public registry | Verified in CI and from a clean anonymous install |
| amd64 and arm64 operator containers run the same release | Verified from public release assets and GHCR |
| Unit, shell, package, Compose, and responsive-browser checks | Passing |
| Paid Hetzner provisioning from the public release | Awaiting a published run receipt |
| Complete Snapchain mainnet sync | Awaiting a published run receipt |
| Gasless app-key registration and a public cast | Awaiting a published run receipt |
| Follow, unfollow, like, remove-like, recast, and remove-recast on mainnet | Awaiting a published run receipt |
| Real provider teardown | Awaiting a published run receipt |
| Independent clean-machine endorsement | Pending |

Automated tests establish implementation behavior. They do not establish that a paid cloud deployment, complete mainnet sync, public write, or teardown succeeded. Those rows remain pending until their receipts exist.

## Machine-generated receipt

Every operational command records a small public-safe lifecycle event under .state/proof/. After the client is live, and again before teardown, run:

~~~bash
in-three proof
~~~

The command writes:

- .state/proof/latest.json for machine verification
- .state/proof/report.md for a public run report
- .state/proof/events.jsonl as the append-only local timeline

The receipt can include:

- exact In Three release
- UTC timestamps for provisioning, node start, node readiness, client deployment, and teardown
- server type, region, and volume size
- Snapchain version, database size, disk use, and shard delays
- FID and gasless KEY_ADD message hash
- message hashes for casts, follows, unfollows, likes, removals, and recasts

It deliberately excludes cloud tokens, private keys, recovery phrases, passwords, server IDs, IP addresses, and raw environment files. Inspect the files before publishing them.

A message hash proves that the owned read node accepted a signed message for relay. A complete public report must also show that the message was read back from synced state and appeared in another Farcaster client.

## Evidence required for the prize

A qualifying independent report should publish:

1. The exact release and installation method.
2. Machine and operating-system details.
3. The redacted receipt.
4. Time and cost from provisioning to a synced node.
5. A public cast created with the deployed client.
6. Results for follow, unfollow, like, remove-like, recast, and remove-recast.
7. Desktop and mobile screenshots.
8. Teardown confirmation from the provider.
9. Every failure, retry, workaround, and manual intervention.

The tester checklist is in [VOUCHER.md](../VOUCHER.md). Until an independent tester publishes that report, the prize requirement is not complete.
