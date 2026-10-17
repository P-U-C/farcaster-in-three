# Paid Agent API

In Three exposes the deployed client to agents through Celo's <code>buy</code> stack:

- <code>@celo/buy-gateway</code> returns and settles x402 payment challenges.
- <code>buy curl</code> and the buy MCP server let an agent quote and pay for requests.
- USDC settles on Celo mainnet to the Farcaster custody address used during setup.
- One 25 USDC deployment request can create the fixed buyer-owned Hetzner plan and start Snapchain.
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
| Complete infrastructure provisioning | <code>POST /agent/v1/deployments</code> | 25 USDC once |
| Profile, storage, signer, node | <code>GET /agent/v1/profile</code> | 0.002 USDC |
| Feed from the owned node | <code>GET /agent/v1/feed</code> | 0.005 USDC |
| Client/source attribution | <code>GET /agent/v1/sources</code> | 0.002 USDC |
| Cast | <code>POST /agent/v1/casts</code> | 0.02 USDC |
| Follow or unfollow | <code>POST /agent/v1/follows</code> | 0.02 USDC |
| Like, recast, or removal | <code>POST /agent/v1/reactions</code> | 0.02 USDC |

Prices are fixed per request, not subscriptions. Change the <code>BUY_AGENT_*_PRICE</code> or <code>BUY_DEPLOY_PRICE</code> values in <code>/srv/in-three/agent-gateway.env</code>, then restart <code>agent-gateway</code>. The 402 quote is authoritative.

The deployment price pays the broker for automation. It does not prepay, discount, or resell Hetzner infrastructure.

## Deploy with one purchase

Use the repository wrapper instead of constructing the secret-bearing request by hand:

~~~bash
./farcaster deploy --service https://YOUR_BROKER
~~~

The wrapper:

1. Generates an Ed25519 SSH key and random deployment ID locally.
2. Sends a free preflight that validates the fixed `ash` / `ccx33` / 2,048 GiB plan and proves that the dedicated Hetzner token has write access by creating and deleting a temporary SSH public key.
3. Runs `buy quote` against the exact JSON body.
4. Requires `BUY DEPLOY`, writes a payment-pending marker, and calls `buy curl --max-amount 25` once.
5. Saves the returned provider IDs, waits for cloud-init and Snapchain, then continues into the local key ceremony.

The public deployment API is:

~~~text
POST /agent/v1/deployments/preflight   free
POST /agent/v1/deployments             25 USDC x402
POST /agent/v1/deployments/status      free recovery
POST /agent/v1/deployments/resume      free, matching paid entitlement required
~~~

`deploymentId` is the idempotency key. Before provisioning, the paid route writes a durable record containing the request binding and SHA-256 hash of the cloud token. It does not retain the token. If the paid HTTP response is lost, the wrapper checks status and uses the free resume route only when that record matches. The local marker prevents an automatic second payment.

Use a read/write token from a new, otherwise-empty Hetzner project. The broker receives that token over HTTPS and can exercise its project permissions while handling the request, so the broker is a trust boundary. Rotate the token after the host is available. The broker receives the SSH public key only; the private key stays in `.state/id_ed25519`. It never receives the Farcaster phrase, client password, facilitator key, or app signer.

An x402 settlement can still complete before the paid request reaches the deployer. If the broker has no matching entitlement after an interruption, do not pay again: run `buy --account in-three receipts --resolve` and contact the broker with the deployment ID and settlement transaction. Never send the cloud token.

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
- run <code>buy --account in-three receipts --resolve</code> before considering another payment;
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

The deployment API automates payment, Hetzner provisioning, cloud-init, and Snapchain startup. The operational API automates Farcaster reads and authorized message publication. Neither automates custody:

- the owner enters the recovery phrase locally;
- the owner confirms the one Optimism signer-registration transaction;
- the owner supplies the client password and facilitator key locally;
- the owner issues and may revoke the write capability;
- the buyer owns and pays the persistent Hetzner resources.

As of buy 0.8.3, usebuy.ai's hosted CPU machines are one-hour leases renewable only up to 24 hours. They are useful for jobs, not a durable multi-terabyte Snapchain database.
