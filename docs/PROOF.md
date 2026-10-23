# Proof

In Three separates automated checks from evidence produced by a real deployment.

## Current status

| Claim | Status |
| --- | --- |
| npm, container, release, and source packages | Verified |
| Unit, shell, package, Compose, and browser checks | Passing |
| Paid cloud provisioning and full Snapchain sync | Verified |
| Account creation, gasless app key, reads, and public writes | Verified |
| Targeted shard recovery and provider teardown | Verified |
| Independent clean-machine endorsement | Pending |

## Mainnet run

One paid Hetzner deployment ran from public In Three packages on October 19-20, 2026. Problems found during the run were fixed and published through v0.1.24, then rechecked against the same live node.

| | |
| --- | --- |
| Final release | [v0.1.24](https://github.com/P-U-C/farcaster-in-three/tree/v0.1.24) |
| Compute | Hetzner CCX33, Ashburn, 2,048 GiB volume |
| Provider quote | $0.5187/hour gross |
| Compute ready | 2026-10-19 04:30 UTC |
| All three shards ready | 2026-10-20 04:12 UTC |
| Provision-to-ready | 23 h 42 m |
| Client live | 2026-10-20 04:53 UTC |
| Teardown complete | 2026-10-20 11:25 UTC |
| Estimated successful-resource cost | About $16 before provider billing adjustments |
| Snapchain | v0.14.3 |
| Final database | 519.9 GiB |
| Final disk use | 556.3 GiB of 2 TiB |
| Test account | FID 3356243, `@in-three` |

The final pre-teardown receipt observed shards 0, 1, and 2 with delays of 0 seconds, a reachable HTTPS client, the exact app-key authorization, and five accepted write hashes. Provider queries after teardown returned zero managed servers, volumes, firewalls, and SSH keys.

## Public protocol evidence

The owned read node accepted gasless app-key message:

```text
0x71f7b2ed99262160375864d7e638216a50717e8e
```

The final public proof cast is visible in Farcaster:

- [`@in-three` proof cast](https://farcaster.xyz/in-three/0xb1c0ddc1)
- Full hash: `0xb1c0ddc1fa1879c7e8238507645552229424f0c0`

The client also published the approved application reply:

- [Application reply](https://farcaster.xyz/in-three/0x4b07622e)
- Full hash: `0x4b07622e4d3b75bd435ac07da6e1798e53aa5a4e`

The run additionally verified profile writes, a follow of FID 1918, and a like of the application cast. Every final cast was read back from mainnet state; the proof cast also rendered in a clean logged-out browser.

## What the run found

The field run did not pass on the first attempt. It exposed and then verified fixes for:

- cloud quota errors and incomplete rollback;
- route-specific SSH failure;
- missing Snapchain configuration;
- daily snapshot rotation and a catastrophically stale shard;
- false readiness from an available API;
- missing jump-host support in command three;
- bundled setup entrypoints that silently skipped execution;
- gasless signer source handling;
- Docker Compose interpolation of password hashes;
- profile-cache, temporary-file, cast-size, and stale-timestamp defects.

The recovery path replaced only the stale shard, preserved the two healthy shards, validated the replacement before switching, and returned the node to all-shard readiness.

## Honest limits

This was an owner-operated engineering run, not the independent voucher required by the prize. The live machine was remediated in place as defects were found; v0.1.24 has not yet had a second independent zero-to-end deployment after teardown.

The required independent tester and public Farcaster endorsement remain pending. See [VOUCHER.md](../VOUCHER.md).

## Create your receipt

After testing the client and before teardown:

```bash
in-three proof
```

The command writes:

- `.state/proof/latest.json`: machine-readable result
- `.state/proof/report.md`: public report
- `.state/proof/events.jsonl`: local event timeline

The report excludes cloud tokens, private keys, recovery phrases, passwords, server IDs, IP addresses, and raw environment files. Inspect it before publishing.

A message hash proves that the node accepted a message for relay. A complete report must also show that synced state returned the message and another Farcaster client displayed it.
