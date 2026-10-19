# In Three documentation

The [README](../README.md) is the short beginner path. Start there.

Open another page only when you need it:

| I need to... | Read |
| --- | --- |
| Check sync, resume setup, upgrade, or stop a deployment | [Operations](OPERATIONS.md) |
| Understand what runs where | [Architecture](ARCHITECTURE.md) |
| Handle keys and recovery files safely | [Security](../SECURITY.md) |
| Create a redacted run receipt | [Proof](PROOF.md) |
| Add paid agent access with x402 | [Agent API](AGENT-API.md) |
| Review protocol and infrastructure sources | [Source ledger](SOURCES.md) |
| Publish a release | [Publishing](PUBLISHING.md) |
| Validate a clean-machine run | [Independent test](../VOUCHER.md) |

## The normal path

```bash
in-three provision
in-three node up
in-three client create
```

If a command pauses, keep the working directory and rerun that same command. In Three saves recovery state before signed actions.
