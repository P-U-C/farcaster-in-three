---
name: use-in-three
description: Discover, quote, buy, and safely use an In Three Farcaster agent API through Celo buy. Use for paid feed reads, source inspection, casts, follows, likes, and recasts.
---

# Use an In Three Farcaster client

An In Three deployment exposes a machine-readable API protected by x402 payments on Celo. Use the repository's pinned <code>@celo/buy</code> 0.8.3 release.

## Boundaries

- Fetch <code>/.well-known/agent.json</code> and <code>/agent/openapi.json</code> before constructing a request.
- Quote the exact method, URL, headers, and body before paying.
- Obtain approval for the exact USDC amount unless the user already authorized it.
- Reads need payment. Writes also need the owner-issued <code>AGENT_WRITE_TOKEN</code>.
- Never print, return, log, or file an issue containing that token.
- Never blindly retry a paid timeout, disconnect, 500, or uncertain settlement.
- A write payment can settle before Farcaster rejects the message. Validate against OpenAPI first.

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

A retry creates a new payment authorization and may create a second Farcaster action.
