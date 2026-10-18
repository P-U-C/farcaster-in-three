# Contributing

Changes must preserve the core path: after installation, a new operator can provision compute, start Snapchain, and deploy the browser client with three commands and no hosted Farcaster API.

## Local development

```bash
npm ci
npm run dev:client
npm run dev:site
```

The browser fixture does not require a live node. Build it and run the visual checks with:

```bash
npm run build --workspace @in-three/client
node scripts/visual-check.mjs
```

## Before opening a pull request

```bash
npm run check
npm run build
npm audit --audit-level=moderate
bash -n farcaster scripts/*.sh scripts/lib/common.sh deploy/snapchain-entrypoint.sh
node scripts/verify-package.mjs
```

For interface changes, inspect desktop and mobile screenshots under `/tmp/in-three-*.png` and check for console errors, overflow, and hidden controls.

For distribution changes, test the artifact rather than only the source tree:

```bash
npm pack --ignore-scripts
```

Install that tarball under a temporary npm prefix. Confirm `in-three --version`, `in-three doctor`, help output, state isolation, and the package-only container build.

## Protocol changes

A change to Snapchain version, contract address, message format, validator defaults, resource requirements, or port exposure must update:

- implementation
- automated tests
- README and website
- relevant operations, architecture, or security reference
- [source ledger](docs/SOURCES.md)

Pin image digests. Record the upstream tag, source commit, platform digest, and validator-manifest checksum.

## Keep the default path small

The browser client is the default. Paid agent access belongs behind the explicit `--with-agent` option and in the agent guide.

Do not add analytics, hosted Farcaster read APIs, custody-key upload, hidden write relays, or mandatory payment credentials to the basic setup.

Useful contributions include signer revocation, pagination, durable indexes, source-attribution improvements, additional compute providers, translations, and reproducible clean-machine evidence.
