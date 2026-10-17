# Paid Agent API

In Three exposes the deployed client to agents through Celo's <code>buy</code> stack:

- <code>@celo/buy-gateway</code> returns and settles x402 payment challenges.
- <code>buy curl</code> and the buy MCP server let an agent quote and pay for requests.
- USDC settles on Celo mainnet to the Farcaster custody address used during setup.
- Reads require payment. Writes require payment plus an owner-issued bearer capability.
- The gateway can reach the client service but cannot reach Snapchain directly. It does not receive the Farcaster app key.
- The client cannot read the facilitator key or the bearer capability.

The browser remains password protected and does not pay per request.

The pinned usebuy.ai 0.8.3 stack is pre-1.0 beta software. Start on Celo Sepolia with low balances before exposing a mainnet service, and review the exact dependency release before upgrading.

## Seller setup

Before command 2, create a server-side facilitator key:

1. Open [x402.celo.org](https://x402.celo.org/).
2. Connect the wallet that will fund settlement fees.
3. Create an API key and retain the value shown once.
4. Check the facilitator balance before accepting traffic.

<code>./farcaster client create</code> reads that key in a hidden prompt before asking for the custody phrase. During recoverable setup it resides in owner-only <code>.state/client.env.pending</code>. After both public health checks pass, the pending file is deleted and the deployed key remains only in <code>/srv/in-three/agent-gateway.env</code>. The custody address becomes <code>BUY_PAY_TO</code>; settlement transfers payment directly to that address.

The command creates <code>.state/agent.env</code> with mode 0600:

~~~dotenv
AGENT_PUBLIC_ORIGIN=https://203-0-113-10.sslip.io
AGENT_WRITE_TOKEN=<owner capability>
~~~

Give that file only to agents permitted to publish through the delegated Farcaster signer. A paid read caller does not need it.

## Discovery

Every deployment publishes:

~~~text
GET /.well-known/agent.json
GET /agent/openapi.json
GET /agent/health
~~~

The manifest identifies x402, Celo mainnet, USDC, prices, authorization boundaries, and the OpenAPI document. Health is free. Operational endpoints return <code>402 Payment Required</code> to an unpaid eligible request.

Default prices:

| Operation | Route | Price |
| --- | --- | ---: |
| Profile, storage, signer, node | <code>GET /agent/v1/profile</code> | 0.002 USDC |
| Feed from the owned node | <code>GET /agent/v1/feed</code> | 0.005 USDC |
| Client/source attribution | <code>GET /agent/v1/sources</code> | 0.002 USDC |
| Cast | <code>POST /agent/v1/casts</code> | 0.02 USDC |
| Follow or unfollow | <code>POST /agent/v1/follows</code> | 0.02 USDC |
| Like, recast, or removal | <code>POST /agent/v1/reactions</code> | 0.02 USDC |

Prices are fixed per request, not subscriptions. Change the <code>BUY_AGENT_*_PRICE</code> values in <code>/srv/in-three/agent-gateway.env</code>, then restart <code>agent-gateway</code>. The 402 quote is authoritative.

## Agent installation

Install the exact buyer release and create a dedicated low-balance wallet:

~~~bash
npm install -g @celo/buy@0.8.3
buy setup --name in-three
buy mcp install --client all
~~~

Fund the printed address with USDC on Celo. The buy MCP server exposes discovery, quote, purchase, balance, identity, and receipt tools without giving the model the wallet key.

## Read with buy

Quote the exact request without signing or paying:

~~~bash
buy quote https://YOUR_CLIENT/agent/v1/feed
~~~

Then purchase once with an explicit ceiling:

~~~bash
buy curl --max-amount 0.005 https://YOUR_CLIENT/agent/v1/feed
~~~

For MCP, call <code>buy_pay_quote</code> first and pass its atomic <code>price.atomic</code> unchanged to <code>buy_curl.maxAmount</code>.

## Write with buy

Load the owner capability without printing it:

~~~bash
set -a
. .state/agent.env
set +a
~~~

Quote the exact body and authorization header:

~~~bash
buy quote \
  -X POST \
  -H "Authorization: Bearer $AGENT_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"text":"Posted by my authorized agent through In Three."}' \
  "$AGENT_PUBLIC_ORIGIN/agent/v1/casts"
~~~

After approving the quoted amount, send the identical request with a ceiling:

~~~bash
buy curl --max-amount 0.02 \
  -X POST \
  -H "Authorization: Bearer $AGENT_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"text":"Posted by my authorized agent through In Three."}' \
  "$AGENT_PUBLIC_ORIGIN/agent/v1/casts"
~~~

The gateway checks the bearer capability before returning a payment challenge. A missing or wrong capability receives 401 before payment. It strips the capability before forwarding the paid request to the client.

## Payment safety

Settlement happens before the Farcaster operation reaches the client. Therefore:

- validate the request against OpenAPI before buying;
- preserve stdout, stderr, the settlement transaction, and correlation ID;
- do not blindly retry a timeout, disconnect, 500, or ambiguous response;
- run <code>buy receipts --resolve</code> before considering another payment;
- use a dedicated buyer wallet and an exact <code>--max-amount</code>;
- rotate <code>AGENT_WRITE_TOKEN</code> immediately if it is exposed.

A successful payment is not a guarantee that a validator accepts a semantically invalid Farcaster message. The gateway rejects wrong methods, malformed JSON, oversized bodies, and unexpected top-level fields before payment. The client still performs final schema and protocol validation.

## Catalog listing

Do not request a catalog listing until a public deployment returns a real 402.

1. Confirm an unpaid <code>GET /agent/v1/feed</code> returns 402.
2. Complete one real buy payment and retain its Celo transaction.
3. Open the [Buy catalog listing form](https://github.com/celo-org/buy-skill/issues/new?template=list-your-service.yml).
4. Submit the public origin, paid routes, prices, Celo mainnet, USDC, and the Celo facilitator.
5. Register the origin with any additional index described in [Celo's discovery guide](https://docs.celo.org/build/agents/x402-get-discovered).

The repository does not submit a listing for an undeployed endpoint.

## Automation boundary

The agent API automates Farcaster reads and authorized message publication. It does not automate custody:

- the owner enters the recovery phrase locally;
- the owner confirms the one Optimism signer-registration transaction;
- the owner issues and may revoke the write capability;
- the persistent Snapchain host remains the existing Hetzner deployment.

As of buy 0.8.3, usebuy.ai's hosted CPU machines are one-hour leases renewable only up to 24 hours. They are useful for jobs, not a durable multi-terabyte Snapchain database.
