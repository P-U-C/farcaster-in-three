# Publishing

In Three has two release channels:

- npm: `farcaster-in-three`
- OCI: `ghcr.io/p-u-c/farcaster-in-three`

GitHub release tarballs and checksummed Docker archives remain the offline fallback.

## Release checklist

1. Run the full verification suite.
2. Update every versioned launcher and document together.
3. Commit the release.
4. Tag that commit `vX.Y.Z`.
5. Push the commit and tag.
6. Wait for the release, npm, container, CI, and Pages workflows.
7. Test each public install command without repository credentials.

Never move or replace an existing version tag.

## First npm publication

npm requires one authenticated publication before a trusted publisher can be attached. Bootstrap from an exact, checksummed GitHub release artifact:

```bash
npm login --auth-type=web
gh release download vX.Y.Z --pattern 'farcaster-in-three-X.Y.Z.tgz*'
sha256sum --check farcaster-in-three-X.Y.Z.tgz.sha256
npm publish farcaster-in-three-X.Y.Z.tgz --access public --provenance=false
```

The bootstrap release has no provenance because npm provenance is issued by supported CI systems, not a local shell. Immediately bind later releases to this repository:

```bash
npx --yes npm@12.2.0 trust github farcaster-in-three \
  --file publish-npm.yml \
  --repo P-U-C/farcaster-in-three \
  --allow-publish \
  --yes
```

Complete the npm browser challenge when prompted. Confirm the trust configuration under the package settings, then set publishing access to require 2FA and disallow traditional tokens.

Future tagged releases publish through GitHub OIDC with automatic npm provenance. The workflow uses Node 24 and npm 12.2.0 because trusted publishing requires an OIDC-capable npm CLI.

## Public container

The release workflow pushes architecture images and a combined manifest:

```text
ghcr.io/p-u-c/farcaster-in-three:X.Y.Z-amd64
ghcr.io/p-u-c/farcaster-in-three:X.Y.Z-arm64
ghcr.io/p-u-c/farcaster-in-three:X.Y.Z
ghcr.io/p-u-c/farcaster-in-three:latest
```

GitHub creates container packages as private by default. A P-U-C organization owner must open the package settings once and change **Package visibility** to **Public**. After that, anonymous pulls work for current and future tags.

The image is linked to this repository through its OCI source label.

## Public verification

After publication, test from a logged-out or credential-free shell:

```bash
npm view farcaster-in-three version dist.integrity
npm install --global farcaster-in-three
in-three --version
in-three doctor
```

```bash
docker logout ghcr.io || true
docker pull ghcr.io/p-u-c/farcaster-in-three:X.Y.Z
docker run --rm ghcr.io/p-u-c/farcaster-in-three:X.Y.Z --version
docker run --rm ghcr.io/p-u-c/farcaster-in-three:X.Y.Z doctor
```

Verify that both `linux/amd64` and `linux/arm64` are present:

```bash
docker buildx imagetools inspect ghcr.io/p-u-c/farcaster-in-three:X.Y.Z
```

The website and README should switch to registry commands only after these anonymous checks pass.
