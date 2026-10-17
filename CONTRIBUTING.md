# Contributing

Changes should preserve the project's central claim: a new operator can reach a working node and client in three commands without a hosted Farcaster data API.

## Development

```bash
npm ci
npm run dev:client
npm run dev:site
```

The client expects configuration documented in `apps/client/src/config.ts`. For a deterministic browser fixture, build the client and run:

```bash
npm run build --workspace @in-three/client
node scripts/visual-check.mjs
```

## Before a pull request

```bash
npm run check
npm run build
npm audit --audit-level=moderate
bash -n farcaster scripts/*.sh scripts/lib/common.sh deploy/snapchain-entrypoint.sh
```

For UI changes, inspect both generated desktop and mobile screenshots under `/tmp/in-three-*.png`.

## Protocol changes

A change to Snapchain version, contract address, message format, validator defaults, resource requirements, or port exposure must update all of:

- implementation
- automated tests
- public tutorial
- `docs/SOURCES.md`
- security or operations notes when relevant

Do not point deployments at floating image tags. Record release tag, source commit, platform image digest, and validator-manifest checksum.

## Scope

Useful contributions include:

- a second compute provider
- signer revocation as a first-class command
- pagination and durable local indexes
- better source-attribution resolution
- translations that preserve command and security semantics
- reproducible full-node integration evidence

Do not add analytics, hosted read APIs, custody-key upload, or hidden write relays.
