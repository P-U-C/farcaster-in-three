---
name: use-in-three
description: Deploy and safely operate an In Three Farcaster client through Celo buy. Use for one-purchase Hetzner provisioning, paid feed reads, source inspection, casts, follows, likes, and recasts.
---

# Use an In Three Farcaster client

An In Three deployment exposes a machine-readable API protected by x402 payments on Celo. It can also provision another buyer-owned In Three host for one 25 USDC payment. Use the repository's pinned <code>@celo/buy</code> 0.8.3 release.

## Boundaries

- Fetch <code>/.well-known/agent.json</code> and <code>/agent/openapi.json</code> before constructing a request.
- For deployment, state both charges before approval: 25 USDC once to the broker and the recurring Hetzner bill to the buyer.
- Use only a user-selected HTTPS broker and a dedicated, otherwise-empty Hetzner project token.
- Never print or retain the Hetzner token. Do not place it in an MCP argument or chat transcript; pass it through the local hidden prompt or existing environment.
- Never remove <code>.state/deployment-payment.pending</code> or buy again after an ambiguous deployment response.
- Quote the exact method, URL, headers, and body before paying.
- Obtain approval for the exact USDC amount unless the user already authorized it.
- Reads need payment. Writes also need the owner-issued <code>AGENT_WRITE_TOKEN</code>.
- Never print, return, log, or file an issue containing that token.
- Never blindly retry a paid timeout, disconnect, 500, or uncertain settlement.
- A write payment can settle before Farcaster rejects the message. Validate against OpenAPI first.

## Deploy

Prefer the repository wrapper because it owns idempotency, local SSH-key generation, exact-request quoting, and payment recovery:

~~~sh
./farcaster deploy --service https://USER_SELECTED_BROKER
~~~

The command performs a free preflight and displays the plan before payment. Stop at the confirmation unless the user explicitly authorized the displayed 25 USDC ceiling and acknowledged the separate recurring Hetzner cost. Use <code>--yes</code> only when that exact authorization is already present.

The wrapper may remain attached for hours while Snapchain loads its initial snapshot. Report progress from <code>./farcaster node status</code>; do not restart the node during extraction. The final client password, Celo facilitator key, custody phrase, and Optimism registration confirmation require a human at the local terminal. Never ask the user to send those values through chat.

If the command stops after payment, rerun the same command. The saved marker makes it query free status/resume endpoints and prevents automatic repurchase. If it reports no matching entitlement, run <code>buy --account in-three receipts --resolve</code>, preserve the deployment ID and settlement transaction, and stop. Do not pay again.

## Discover

~~~sh
curl --fail --silent --show-error "$AGENT_PUBLIC_ORIGIN/.well-known/agent.json"
curl --fail --silent --show-error "$AGENT_PUBLIC_ORIGIN/agent/openapi.json"
~~~

Use the manifest's current prices. The 402 quote is authoritative.

## Quote

For a read:

~~~sh
buy quote "$AGENT_PUBLIC_ORIGIN/agent/v1/feed"
~~~

For a write, keep the owner capability attached to both quote and purchase:

~~~sh
buy quote -X POST \
  -H "Authorization: Bearer $AGENT_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"text":"hello"}' \
  "$AGENT_PUBLIC_ORIGIN/agent/v1/casts"
~~~

With MCP, call <code>buy_pay_quote</code> with the same URL, method, headers, and body. It does not pay.

## Buy once

Use the decimal quote as the CLI ceiling:

~~~sh
buy curl --max-amount '<quoted USDC amount>' \
  -H "Authorization: Bearer $AGENT_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST --data '{"text":"hello"}' \
  "$AGENT_PUBLIC_ORIGIN/agent/v1/casts"
~~~

For MCP, pass the quote's atomic <code>price.atomic</code> unchanged as <code>buy_curl.maxAmount</code>.

Preserve the response and receipt. Report the operation, amount, token, settlement transaction, Farcaster message hash, and validator when successful.

## Fail safely

- Initial 401: no payment; the write capability is missing or wrong.
- Initial 400, 405, 413, or 429: no payment; correct the request or wait.
- Initial 402: no payment yet; this is the quote.
- Paid response with a settlement receipt: payment occurred even if the Farcaster operation failed.
- Network interruption or settlement uncertainty: do not buy again. Run <code>buy receipts --resolve</code>, inspect the Celo transfer, and report what is known.

A retry creates a new payment authorization and may create a second Farcaster action. Deployment is the exception only through the repository wrapper: its saved marker uses the free status/resume path and does not submit another payment.
