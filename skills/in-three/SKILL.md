---
name: use-in-three
description: Safely deploy and use an In Three Farcaster node, browser client, or optional x402 agent API.
---

# Use In Three

In Three has two modes:

- **Basic:** provision a server, start Snapchain, and deploy a browser client.
- **Agent commerce:** add paid x402 reads, authorized writes, and one-payment deployment.

Do not introduce payment credentials into the basic path.

## Safety rules

- Never request, accept, print, or store a Farcaster recovery phrase in chat.
- The account ceremony requires a human at the local terminal. It can create a disposable account or import one the human already controls.
- Use a new, empty Hetzner project and a restricted token.
- State the recurring Hetzner cost before provisioning.
- Quote the exact x402 request before paying.
- Use a dedicated low-balance payment wallet and exact spending ceiling.
- Never expose the owner write capability.
- Never retry an ambiguous paid response until its receipt is resolved.
- Preserve the working directory; recovery state lives under `.state/`.

## Install

```bash
mkdir in-three-node && cd in-three-node
curl -fsSLO https://raw.githubusercontent.com/P-U-C/farcaster-in-three/v0.1.6/in-three-container
chmod +x in-three-container
./in-three-container doctor
```

The launcher uses the checksummed release image, runs without a Docker socket mount, and mounts only the working directory.

## Basic deployment

```bash
./in-three-container provision
./in-three-container node up
./in-three-container client create
```

Stop before `provision` unless the user has approved the displayed cloud plan and recurring cost.

The initial Snapchain sync may take hours. Report progress with:

```bash
./in-three-container node status
```

Do not restart the node during snapshot extraction.

The local ceremony needs human input. The default CREATE path quotes and sends one Optimism account-registration transaction; IMPORT skips it when the account already has storage. App-key authorization is gasless.

## Optional paid API

The seller enables agent commerce with:

```bash
./in-three-container client create --with-agent
```

Discover the live contract before building requests:

```bash
curl --fail --silent --show-error "$AGENT_PUBLIC_ORIGIN/.well-known/agent.json"
curl --fail --silent --show-error "$AGENT_PUBLIC_ORIGIN/agent/openapi.json"
```

Treat the manifest and unpaid 402 response as authoritative for routes, networks, assets, and prices.

## Quote before payment

Read:

```bash
buy quote "$AGENT_PUBLIC_ORIGIN/agent/v1/feed"
```

Authorized write:

```bash
buy quote -X POST \
  -H "Authorization: Bearer $AGENT_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"text":"hello"}' \
  "$AGENT_PUBLIC_ORIGIN/agent/v1/casts"
```

With MCP, call `buy_pay_quote` with the same URL, method, headers, and body. It does not pay.

## Pay once

After exact user approval:

```bash
buy curl --max-amount '<quoted USDC amount>' \
  -H "Authorization: Bearer $AGENT_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST --data '{"text":"hello"}' \
  "$AGENT_PUBLIC_ORIGIN/agent/v1/casts"
```

With MCP, pass the quote's atomic amount unchanged to `buy_curl.maxAmount`.

Keep the response, receipt, settlement transaction, Farcaster message hash, and submitting node. A successful submit means accepted for relay until the message appears in synced node state.

## Buy a deployment

```bash
./in-three-container deploy \
  --service https://USER_SELECTED_BROKER \
  --payment-network base
```

The wrapper runs a free preflight, displays the cloud plan and 25 USDC quote, and waits for confirmation. Use `--yes` only when the user already authorized both the exact payment and recurring Hetzner cost.

If the command stops after payment, rerun the identical command. The saved marker uses free status and resume routes. If no matching entitlement is found, resolve the receipt and stop. Do not pay again.

## Interpret failures

- Initial 401: capability missing or wrong; no payment.
- Initial 400, 405, 413, or 429: request rejected before payment.
- Initial 402: quote only; no payment yet.
- Paid response with receipt: payment occurred even if the operation failed.
- Timeout or disconnect after payment: resolve the receipt before any retry.

A retry may create a second payment and a second Farcaster action.
