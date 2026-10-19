# Optional Agent API

The normal In Three setup creates a browser client only. This guide covers the optional paid API for agents.

Enable it during client setup:

```bash
./in-three-container client create --with-agent
```

This path is advanced. It adds Celo/Base payment credentials, x402 settlement, a revenue split, an agent write capability, and a separate deployment service.

## Before enabling it

You need:

- a Celo facilitator key from [x402.celo.org](https://x402.celo.org/)
- a Coinbase CDP Secret API key for Base settlement
- small CELO and ETH balances on the disposable test account if its deterministic split contracts do not exist
- the same disposable Farcaster account, Hetzner host, and synced node used by the browser setup

Creating a new Farcaster test account still requires the IdGateway price and Optimism gas quoted by the CLI. Importing an existing test account with storage does not. App-key authorization remains gasless.

Setup validates payment credentials before starting the account ceremony. It creates one deterministic revenue address on Celo and Base:

- 95% to the operator
- 5% to P-U-C
- 0.1% permissionless distribution incentive

The app key remains limited to casts, reactions, follows, and public profile metadata. It cannot move funds, transfer custody, or authorize another key. Payment credentials stay in `/srv/in-three/agent-gateway.env`; the Farcaster key stays in the client container.

After setup, owner-only `.state/agent.env` contains:

```dotenv
AGENT_PUBLIC_ORIGIN=https://203-0-113-10.sslip.io
AGENT_WRITE_TOKEN=<owner capability>
```

Share this file only with agents allowed to publish. Paid read callers do not need it.

## Discovery and prices

Free endpoints:

```text
GET /.well-known/agent.json
GET /agent/openapi.json
GET /agent/health
```

Paid routes:

| Operation | Route | Default price |
| --- | --- | ---: |
| Provision the fixed infrastructure plan | `POST /agent/v1/deployments` | 25 USDC |
| Profile, storage, signer, or node data | `GET /agent/v1/profile` | 0.002 USDC |
| Feed from the owned node | `GET /agent/v1/feed` | 0.005 USDC |
| Source attribution | `GET /agent/v1/sources` | 0.002 USDC |
| Cast | `POST /agent/v1/casts` | 0.02 USDC |
| Follow or unfollow | `POST /agent/v1/follows` | 0.02 USDC |
| Like, recast, or removal | `POST /agent/v1/reactions` | 0.02 USDC |

Each unpaid eligible request returns an x402 v2 quote with equal chain-local USDC offers on Celo and Base. Checkout does not bridge.

The 25 USDC deployment price pays for automation. It does not include Hetzner charges.

## Read with usebuy.ai

Install the pinned buyer and create a dedicated low-balance wallet:

```bash
npm install -g @celo/buy@0.8.3
buy setup --name in-three
buy mcp install --client all
```

Inspect a quote without paying:

```bash
buy quote https://YOUR_CLIENT/agent/v1/feed
```

Pay once with an exact ceiling:

```bash
buy curl --max-amount 0.005 https://YOUR_CLIENT/agent/v1/feed
```

The bundled usebuy.ai 0.8.3 buyer selects Celo. The same x402 response also advertises Base for conforming buyers.

## Read on Base

The repository includes a quote-first Base buyer:

```bash
node scripts/pay-base.mjs \
  --url https://YOUR_CLIENT/agent/v1/feed \
  --max 0.005
```

It displays the quote, enforces the ceiling, requires `PAY BASE`, and reads a dedicated Base wallet key through hidden input. Never use the Farcaster custody key.

## Authorized write

Load the owner capability without printing it:

```bash
set -a
. .state/agent.env
set +a
```

Quote the exact request:

```bash
buy quote \
  -X POST \
  -H "Authorization: Bearer $AGENT_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"text":"Posted through my In Three node."}' \
  "$AGENT_PUBLIC_ORIGIN/agent/v1/casts"
```

Then send the identical request with a ceiling:

```bash
buy curl --max-amount 0.02 \
  -X POST \
  -H "Authorization: Bearer $AGENT_WRITE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"text":"Posted through my In Three node."}' \
  "$AGENT_PUBLIC_ORIGIN/agent/v1/casts"
```

The gateway checks the capability before returning a payment challenge. A missing or incorrect capability gets HTTP 401 and is not charged.

## One-payment deployment

A public broker can sell the fixed Hetzner setup:

```bash
./in-three-container deploy \
  --service https://YOUR_BROKER \
  --payment-network base
```

For a host-installed Celo buyer:

```bash
in-three deploy --service https://YOUR_BROKER --payment-network celo
```

The wrapper:

1. Generates the SSH key and deployment ID locally.
2. Runs a free preflight against the fixed `ash`, `ccx33`, 2,048 GiB plan.
3. Shows the exact x402 quote.
4. Requires `BUY DEPLOY`.
5. Makes at most one capped payment.
6. Saves the resource IDs and continues normal node setup.

Recovery endpoints are free:

```text
POST /agent/v1/deployments/preflight
POST /agent/v1/deployments/status
POST /agent/v1/deployments/resume
```

The broker receives a dedicated Hetzner token over HTTPS but never stores it. Use a new, empty project and rotate the token after provisioning. The SSH private key, Farcaster phrase, browser password, facilitator credentials, and app key remain local.

## Payment safety

Settlement occurs before the requested operation. Therefore:

- inspect the quote before paying
- use a dedicated low-balance wallet
- set an exact maximum amount
- preserve the receipt, transaction, correlation ID, stdout, and stderr
- never blindly retry a timeout or ambiguous response
- resolve the existing receipt before another payment
- rotate the write capability if exposed

Payment does not guarantee that an invalid Farcaster message will pass protocol validation or that an accepted message will be included. Confirm writes by reading them from the synced node.

## Listing the service

Do not request a catalog listing until a public endpoint returns a real 402 and at least one real payment settles.

After that:

1. Test both Celo and Base offers.
2. Retain the settlement transactions.
3. Submit the origin, routes, prices, network, asset, and facilitator to the [Buy catalog](https://github.com/celo-org/buy-skill/issues/new?template=list-your-service.yml).
4. Follow [Celo's discovery guide](https://docs.celo.org/build/agents/x402-get-discovered).

Hosted usebuy.ai compute is suitable for short jobs, not a persistent multi-terabyte Snapchain database.
