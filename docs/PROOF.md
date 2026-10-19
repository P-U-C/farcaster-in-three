# Proof

In Three separates automated checks from evidence produced by a real deployment.

## Current status

| Claim | Status |
| --- | --- |
| npm and container packages install and run | Verified |
| Unit, shell, package, Compose, and browser checks | Passing |
| Paid cloud provisioning and teardown | Live audit in progress |
| Complete Snapchain sync and public writes | Live audit in progress |
| Independent clean-machine endorsement | Pending |

Passing tests do not prove that a real node synced or that a cast reached Farcaster.

## Create a run receipt

After testing the client and before teardown:

```bash
in-three proof
```

The command writes:

- `.state/proof/latest.json`: machine-readable result
- `.state/proof/report.md`: public report
- `.state/proof/events.jsonl`: local event timeline

The report may include the release, timestamps, server plan, Snapchain state, FID, app-key authorization hash, action hashes, and teardown result.

It excludes cloud tokens, private keys, recovery phrases, passwords, server IDs, IP addresses, and raw environment files. Inspect it before publishing.

## What complete evidence needs

A complete test report should include:

1. Exact release and installation method.
2. Operating system and machine details.
3. Redacted receipt.
4. Sync time and cloud cost.
5. Public cast created with the deployed client.
6. Results for follow, unfollow, like, remove-like, recast, and remove-recast.
7. Desktop and mobile screenshots.
8. Provider teardown confirmation.
9. Failures, retries, workarounds, and manual steps.

A message hash proves that the node accepted a message for relay. The report must also show that the synced node read it back and another Farcaster client displayed it.

The clean-machine checklist is in [VOUCHER.md](../VOUCHER.md).
