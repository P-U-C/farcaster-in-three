# Architecture

In Three gives the browser one path for reads and writes:

```text
browser
   |
   v
client service
   |
   v
your Snapchain node
   |
   v
Farcaster validators
```

The browser does not use a hosted Farcaster data API. The client reads from your node and sends signed actions back to that same node.

## Reads and writes

**Read:** the client asks your Snapchain node for profiles, follows, casts, reactions, and signer records.

**Write:** the client signs a Farcaster message with its revocable app key and submits it to your node. The node validates the message and relays it to validator peers.

A successful submission means **accepted for relay**, not final inclusion. Reading the message back from synced state confirms that it was included.

## What runs on the server

The normal setup starts three services:

| Service | Job |
| --- | --- |
| Caddy | HTTPS |
| Client | Login, feed, signing, and profile controls |
| Snapchain | Protocol data, validation, and peer relay |

Snapchain's HTTP and gRPC APIs stay private. HTTPS is public. Snapchain gossip uses UDP 3382. SSH is restricted to the operator's detected address.

## Account and app key

Command three can create a disposable account or import an existing test account.

For a new account it:

1. Generates and encrypts a recovery phrase locally.
2. Registers an FID and one storage unit on Optimism.
3. Creates an Ed25519 app key.
4. Signs a scoped, gasless `KEY_ADD` message locally.
5. Saves the exact signed bytes before submission.
6. Sends the message through a private tunnel to your node.
7. Uploads only the app key after authorization is confirmed.

The app key can cast, react, follow, and update public profile metadata. It cannot move funds, transfer custody, or authorize another key.

Production clients should prefer delegated authorization from a trusted wallet. This local custody flow exists for a developer tutorial and should use a test account only.

## Six protocol terms

| Term | Plain meaning |
| --- | --- |
| FID | The numeric ID of a Farcaster account |
| Custody address | The wallet that owns the FID |
| App key | A revocable key used by one client |
| Message | A signed cast, reaction, follow, or profile update |
| Read node | A node that stores data, answers reads, and relays valid writes |
| Storage | The account capacity used by messages |

## Feed and source filters

The reference client builds a chronological feed from the owner's casts and up to 35 followed FIDs. Profile and signer data also come from the owned node.

Signer keys with known app attribution are grouped by app. Unknown keys remain available as exact-key filters. This is a reference feed, not a ranking or moderation service.

## Optional agent path

`client create --with-agent` adds an x402 gateway and deployment service:

- buyers pay USDC on Celo or Base
- writes require payment plus an owner capability
- payment credentials stay outside the client
- the gateway cannot connect directly to Snapchain
- the deployment service cannot connect to the client

The normal setup does not start these services. See [Agent API](AGENT-API.md).

## Packaging boundary

The operator container runs with a read-only root, no Linux capabilities, `no-new-privileges`, no Docker socket, and only the current directory mounted at `/work`.

This repository runs the official digest-pinned Snapchain image. It does not fork or vendor Snapchain.
