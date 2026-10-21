# Publishing

A version tag publishes three artifacts:

- npm: `farcaster-in-three`
- OCI: `ghcr.io/p-u-c/farcaster-in-three`
- GitHub release: npm tarball plus checksummed amd64 and arm64 container archives

npm uses GitHub OIDC trusted publishing. GHCR is public.

## Release checklist

1. Choose `X.Y.Z`.
2. Update package versions, `in-three-container`, `Dockerfile.operator`, README, website, voucher, operations guide, agent skill, and public `agent.md` together.
3. Run the full verification suite.
4. Commit the release.
5. Create the signed or annotated tag `vX.Y.Z` on that commit.
6. Push main and the tag.
7. Wait for release, npm, container, CI, and Pages workflows.
8. Test every public artifact without repository credentials.

Never move or replace a published tag.

## Local verification

```bash
npm ci
npm run check
npm run build
npm audit --audit-level=moderate
npm run render:film
node scripts/verify-package.mjs
npm pack --dry-run --ignore-scripts

docker build -f Dockerfile.operator -t in-three-operator:test .
docker run --rm in-three-operator:test --version
docker run --rm in-three-operator:test doctor

node scripts/visual-check.mjs
```

Inspect the generated desktop and mobile screenshots. `npm run render:film` rebuilds the 59-second landscape and vertical films plus the poster from `scripts/video/in-three-film.html`; commit those generated media files with their source.

## Public verification

Use a clean npm prefix:

```bash
PREFIX="$(mktemp -d)"
npm install --global --prefix "$PREFIX" farcaster-in-three@X.Y.Z
"$PREFIX/bin/in-three" --version
"$PREFIX/bin/in-three" doctor
npm view farcaster-in-three@X.Y.Z dist.integrity dist.attestations --json
```

Use an empty Docker configuration so the pull is anonymous:

```bash
DOCKER_CONFIG="$(mktemp -d)" docker pull ghcr.io/p-u-c/farcaster-in-three:X.Y.Z
DOCKER_CONFIG="$(mktemp -d)" docker buildx imagetools inspect ghcr.io/p-u-c/farcaster-in-three:X.Y.Z
docker run --rm ghcr.io/p-u-c/farcaster-in-three:X.Y.Z --version
docker run --rm ghcr.io/p-u-c/farcaster-in-three:X.Y.Z doctor
```

Confirm the manifest contains both `linux/amd64` and `linux/arm64`.

Download both GitHub release archives and compare them with their published SHA-256 files. Finally, load the live website at desktop and mobile widths and verify that its install URL points to the new immutable tag.

## Automation

- `.github/workflows/publish-npm.yml` publishes on `v*` tags with npm provenance.
- `.github/workflows/release.yml` creates release files, architecture images, and the combined GHCR manifest.
- `.github/workflows/pages.yml` publishes the tutorial when site files change on main.
- `.github/workflows/ci.yml` validates main and pull requests.

Manual workflow dispatch exists for recovery. It must target an existing immutable tag whose version matches `package.json`.
