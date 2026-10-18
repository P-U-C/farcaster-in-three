#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/lib/cloud-init.sh
source "$ROOT/scripts/lib/cloud-init.sh"
# shellcheck source=scripts/lib/common.sh
source "$ROOT/scripts/lib/common.sh"

fail() {
  printf 'not ok - %s\n' "$*" >&2
  exit 1
}

cloud_init="$(render_cloud_init 'ssh-ed25519 AAAATEST generated@test' '424242')"
printf '%s\n' "$cloud_init" | grep -F 'device="/dev/disk/by-id/scsi-0HC_Volume_424242"' >/dev/null ||
  fail "volume ID was not inserted"
# These assertions intentionally match unexpanded remote-shell expressions.
# shellcheck disable=SC2016
printf '%s\n' "$cloud_init" | grep -F '[[ -b "$device" ]] && break' >/dev/null ||
  fail "remote device variable was expanded locally"
# shellcheck disable=SC2016
printf '%s\n' "$cloud_init" | grep -F 'for attempt in $(seq 1 120); do' >/dev/null ||
  fail "remote command substitution was expanded locally"
printf '%s\n' "$cloud_init" | grep -F 'ssh-ed25519 AAAATEST generated@test' >/dev/null ||
  fail "SSH key was not inserted"
printf '%s\n' "$cloud_init" |
  awk '/^    content: \|$/{inside=1; next} /^runcmd:/{inside=0} inside{sub(/^      /, ""); print}' |
  bash -n || fail "generated mount script is not valid Bash"

checksum_file="$(mktemp)"
trap 'rm -f "$checksum_file"' EXIT
printf 'in-three' > "$checksum_file"
[[ "$(sha256_file "$checksum_file")" == "b950ca17fbc859b40bedefcadc05c51383de4926292a2b842370764387987189" ]] ||
  fail "portable SHA-256 helper returned the wrong digest"

if grep -R -n -E '\bmapfile\b|mktemp --suffix|sha256sum -c' "$ROOT/scripts" --exclude='shell.test.sh' >/dev/null; then
  fail "a GNU-only operator command remains"
fi

healthcheck="$(awk '/healthcheck:/{inside=1} inside{print} /start_period:/{exit}' "$ROOT/deploy/docker-compose.yml")"
printf '%s\n' "$healthcheck" | grep -F '/usr/bin/bash' >/dev/null ||
  fail "Snapchain healthcheck does not use an executable from the pinned image"
if printf '%s\n' "$healthcheck" | grep -F 'curl' >/dev/null; then
  fail "Snapchain healthcheck still requires curl"
fi

wait_output="$(
  source "$ROOT/scripts/client.sh"
  api_attempts=0
  remote() {
    case "$*" in
      *"/v1/info"*)
        api_attempts=$((api_attempts + 1))
        (( api_attempts >= 3 ))
        ;;
      *"ps --status running"*)
        printf 'fixture-container-id\n'
        ;;
      *"snapshot"*)
        printf '  snapshot  120G\n  database  8.0K\n  disk      121G used / 2.0T total\n'
        ;;
      *)
        return 1
        ;;
    esac
  }
  sleep() { :; }
  success() { printf 'ready\n'; }
  # These test-only overrides intentionally remain inside the command substitution.
  # shellcheck disable=SC2030
  IN_THREE_NODE_POLL_SECONDS=1
  # shellcheck disable=SC2030
  IN_THREE_NODE_REPORT_SECONDS=1
  wait_for_node_api
  (( api_attempts == 3 ))
)" || fail "client create did not wait and continue when the node API became ready"
printf '%s\n' "$wait_output" | grep -F 'Command 2 will continue automatically' >/dev/null ||
  fail "client wait flow does not explain automatic continuation"
printf '%s\n' "$wait_output" | grep -F 'ready' >/dev/null ||
  fail "client wait flow did not continue after readiness"

pending_env="$(mktemp)"
fixture_client_env="$(mktemp)"
fixture_gateway_env="$(mktemp)"
fixture_access_env="$(mktemp)"
trap 'rm -f "$checksum_file" "$pending_env" "$fixture_client_env" "$fixture_gateway_env" "$fixture_access_env"; [[ -z "${deploy_fixture:-}" ]] || rm -rf "$deploy_fixture"; [[ -z "${container_fixture:-}" ]] || rm -rf "$container_fixture"' EXIT
cat > "$pending_env" <<'EOF'
FID=37
SIGNER_PRIVATE_KEY=delegated-key
AGENT_PUBLIC_ORIGIN=https://client.example
AGENT_WRITE_TOKEN=agent-capability
BUY_OPERATOR_PAY_TO=0x1111111111111111111111111111111111111111
BUY_PAY_TO=0x000000000000000000000000000000000000c0Fe
BUY_ROYALTY_PAY_TO=0xd240A74c8766cbe9Fc0ba2B242C089aAE164D5dF
BUY_ROYALTY_BPS=500
BUY_FACILITATOR_API_KEY=x402_facilitator-secret
CDP_API_KEY_ID=organizations/test/apiKeys/test
CDP_API_KEY_SECRET_B64=dGVzdC1zZWNyZXQtdGhhdC1pcy1sb25nLWVub3VnaC10by1wYXNzLXZhbGlkYXRpb24=
REVENUE_CELO_STATUS=confirmed
REVENUE_BASE_STATUS=confirmed
SIGNER_REGISTRATION_STATUS=signed
SIGNER_REGISTRATION_TX=0x1234
SIGNER_REGISTRATION_RAW_TX=0xabcd
EOF
(
  source "$ROOT/scripts/client.sh"
  PENDING_CLIENT_ENV="$pending_env"
  write_client_env "$pending_env" "$fixture_client_env"
  write_agent_gateway_env "$pending_env" "$fixture_gateway_env"
  write_agent_access_env "$pending_env" "$fixture_access_env"
  pending_has_agent_config
)
grep -F 'SIGNER_PRIVATE_KEY=delegated-key' "$fixture_client_env" >/dev/null ||
  fail "client environment lost the delegated app key"
if grep -E '^(SIGNER_REGISTRATION_|REVENUE_|AGENT_|BUY_|CDP_)' "$fixture_client_env" >/dev/null; then
  fail "payment or recovery secrets would be copied to the client container"
fi
grep -F 'BUY_FACILITATOR_API_KEY=x402_facilitator-secret' "$fixture_gateway_env" >/dev/null ||
  fail "gateway environment lost the Celo facilitator key"
grep -F 'CDP_API_KEY_ID=organizations/test/apiKeys/test' "$fixture_gateway_env" >/dev/null ||
  fail "gateway environment lost the Base facilitator key"
if grep -E '^(SIGNER_PRIVATE_KEY|SIGNER_REGISTRATION_)' "$fixture_gateway_env" >/dev/null; then
  fail "Farcaster signer or recovery state would be copied to the payment container"
fi
grep -F 'AGENT_WRITE_TOKEN=agent-capability' "$fixture_access_env" >/dev/null ||
  fail "local agent access file lost the write capability"
if grep -E '^(SIGNER_|REVENUE_|BUY_|CDP_)' "$fixture_access_env" >/dev/null; then
  fail "local agent access file contains server secrets"
fi

deploy_fixture="$(mktemp -d)"
mkdir -p "$deploy_fixture/.state" "$deploy_fixture/bin" "$deploy_fixture/scripts"
printf '%s\n' 'dep-0123456789abcdef0123456789abcdef' > "$deploy_fixture/.state/deployment-id"
printf '%s\n' 'dep-0123456789abcdef0123456789abcdef' > "$deploy_fixture/.state/deployment-payment.pending"
printf '%s\n' 'https://broker.example' > "$deploy_fixture/.state/deployment-service"
printf '%s\n' 'base' > "$deploy_fixture/.state/deployment-payment-network"
printf '%s\n' '203.0.113.7/32' > "$deploy_fixture/.state/deployment-source-cidr"
printf '%s\n' 'in-three' > "$deploy_fixture/.state/deployment-buy-account"
export BUY_CALL_LOG="$deploy_fixture/buy-calls"
export DEPLOY_RUN_LOG="$deploy_fixture/deploy-runs"

cat > "$deploy_fixture/bin/buy" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$BUY_CALL_LOG"
exit 99
EOF
cat > "$deploy_fixture/bin/ssh" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
cat > "$deploy_fixture/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w|--max-time|-X|-H|--data-binary) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */deployments/status)
    printf '%s\n' '{"ok":false,"phase":"authorized","resumable":true}' > "$output"
    printf '404'
    ;;
  */deployments/resume)
    printf '%s\n' '{"ok":true,"deploymentId":"dep-0123456789abcdef0123456789abcdef","created":true,"server":{"id":44,"ip":"203.0.113.10","status":"initializing","sshUser":"inthree"},"resources":{"volumeId":22,"firewallId":33,"sshKeyId":11}}'
    ;;
  *) exit 97 ;;
esac
EOF
cat > "$deploy_fixture/scripts/node.sh" <<'EOF'
#!/usr/bin/env bash
printf 'node:%s\n' "$*" >> "$DEPLOY_RUN_LOG"
EOF
cat > "$deploy_fixture/scripts/client.sh" <<'EOF'
#!/usr/bin/env bash
printf 'client:%s\n' "$*" >> "$DEPLOY_RUN_LOG"
EOF
chmod +x "$deploy_fixture/bin/"* "$deploy_fixture/scripts/"*

PATH="$deploy_fixture/bin:$PATH" \
IN_THREE_ROOT="$deploy_fixture" \
HCLOUD_TOKEN='dedicated-hetzner-token-long-enough' \
  "$ROOT/scripts/deploy.sh" --yes >/dev/null

[[ ! -s "$BUY_CALL_LOG" ]] || fail "recovery attempted a second buy payment"
# shellcheck disable=SC2016
grep -F 'buy --account "$BUY_ACCOUNT" curl' "$ROOT/scripts/deploy.sh" >/dev/null ||
  fail "paid deployment is not bound to the selected usebuy.ai account"
grep -F 'node:up' "$DEPLOY_RUN_LOG" >/dev/null ||
  fail "recovered deployment did not continue node setup"
grep -F 'client:create' "$DEPLOY_RUN_LOG" >/dev/null ||
  fail "recovered deployment did not continue client setup"
[[ ! -f "$deploy_fixture/.state/deployment-payment.pending" ]] ||
  fail "recovered deployment left the payment marker behind"
grep -F 'DEPLOYMENT_ID=dep-0123456789abcdef0123456789abcdef' \
  "$deploy_fixture/.state/config" >/dev/null ||
  fail "recovered deployment did not persist provider state"

base_help="$(node "$ROOT/scripts/pay-base.mjs" --help)"
printf '%s\n' "$base_help" | grep -F -- '--max USDC' >/dev/null ||
  fail "Base buyer does not advertise its explicit spending ceiling"
grep -F 'candidate.network === BASE_NETWORK' "$ROOT/scripts/pay-base.mjs" >/dev/null ||
  fail "Base buyer does not pin its selected network"
grep -F 'candidate.payTo.toLowerCase() === requirement.payTo.toLowerCase()' \
  "$ROOT/scripts/pay-base.mjs" >/dev/null ||
  fail "Base buyer does not pin the approved recipient"
grep -F -- '--payment-network' "$ROOT/scripts/deploy.sh" >/dev/null ||
  fail "one-purchase deployment does not expose a payment-network choice"
grep -F 'scripts/pay-base.mjs' "$ROOT/scripts/deploy.sh" >/dev/null ||
  fail "one-purchase deployment does not route Base through the guarded buyer"

grep -F 'makeKeyAdd(' "$ROOT/apps/client/src/setup.ts" >/dev/null ||
  fail "setup does not create a gasless KEY_ADD message"
grep -F 'SIGNER_REGISTRATION_MODE=gasless' "$ROOT/apps/client/src/setup.ts" >/dev/null ||
  fail "setup does not persist the gasless signer mode"
grep -F 'this.writeNodeUrl}/v1/submitMessage' "$ROOT/apps/client/src/protocol.ts" >/dev/null ||
  fail "client writes do not enter through the owned read node"
if grep -R -n 'VALIDATOR_URLS' "$ROOT/apps/client/src" "$ROOT/scripts/client.sh" >/dev/null; then
  fail "runtime still exposes direct validator writes"
fi

container_fixture="$(mktemp -d)"
mkdir -p "$container_fixture/bin" "$container_fixture/work"
export DOCKER_CALL_LOG="$container_fixture/docker-call"
cat > "$container_fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == "info" ]]; then
  exit 0
fi
printf '<%s>\n' "$@" >> "$DOCKER_CALL_LOG"
EOF
chmod +x "$container_fixture/bin/docker"
(
  cd "$container_fixture/work"
  PATH="$container_fixture/bin:$PATH" \
  IN_THREE_IMAGE='in-three-operator:test' \
  HCLOUD_TOKEN='must-not-appear-in-argv' \
    "$ROOT/in-three-container" doctor
)
grep -Fx '<in-three-operator:test>' "$DOCKER_CALL_LOG" >/dev/null ||
  fail "container launcher did not select the requested image"
grep -Fx '<--read-only>' "$DOCKER_CALL_LOG" >/dev/null ||
  fail "container launcher did not use a read-only root filesystem"
if ! grep -Fx '<--cap-drop>' "$DOCKER_CALL_LOG" >/dev/null ||
  ! grep -Fx '<ALL>' "$DOCKER_CALL_LOG" >/dev/null; then
  fail "container launcher did not drop Linux capabilities"
fi
grep -Fx "<$(id -u):$(id -g)>" "$DOCKER_CALL_LOG" >/dev/null ||
  fail "container launcher did not preserve the host UID and GID"
grep -Fx "<$container_fixture/work:/work>" "$DOCKER_CALL_LOG" >/dev/null ||
  fail "container launcher did not mount only the operator workspace"
grep -Fx '<HCLOUD_TOKEN>' "$DOCKER_CALL_LOG" >/dev/null ||
  fail "container launcher did not forward the named provider credential"
if grep -F 'must-not-appear-in-argv' "$DOCKER_CALL_LOG" >/dev/null; then
  fail "container launcher exposed a credential value in process arguments"
fi
if grep -F 'docker.sock' "$DOCKER_CALL_LOG" >/dev/null; then
  fail "container launcher mounted the Docker socket"
fi
grep -F 'args+=(--entrypoint buy)' "$ROOT/in-three-container" >/dev/null ||
  fail "container launcher cannot dispatch the bundled usebuy.ai CLI"

case "$(uname -m)" in
  x86_64|amd64) release_arch="amd64" ;;
  arm64|aarch64) release_arch="arm64" ;;
  *) fail "test host has an unsupported architecture" ;;
esac
release_fixture="$container_fixture/release"
mkdir -p "$release_fixture"
release_asset="farcaster-in-three-container-0.1.5-linux-${release_arch}.tar.gz"
printf 'container archive fixture' | gzip > "$release_fixture/$release_asset"
if command -v sha256sum >/dev/null 2>&1; then
  release_checksum="$(sha256sum "$release_fixture/$release_asset" | awk '{print $1}')"
else
  release_checksum="$(shasum -a 256 "$release_fixture/$release_asset" | awk '{print $1}')"
fi
printf '%s  %s\n' "$release_checksum" "$release_asset" > "$release_fixture/${release_asset}.sha256"
export RELEASE_FIXTURE="$release_fixture"
export DOCKER_IMAGE_PRESENT="$container_fixture/image-present"
cat > "$container_fixture/bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=""
url=""
while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output)
      output="$2"
      shift 2
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
cp "$RELEASE_FIXTURE/$(basename "$url")" "$output"
EOF
cat > "$container_fixture/bin/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "info" ]]; then
  exit 0
fi
if [[ "${1:-}" == "image" && "${2:-}" == "inspect" ]]; then
  [[ -f "$DOCKER_IMAGE_PRESENT" ]]
  exit
fi
if [[ "${1:-}" == "load" ]]; then
  cat >/dev/null
  touch "$DOCKER_IMAGE_PRESENT"
  exit
fi
printf '<%s>\n' "$@" >> "$DOCKER_CALL_LOG"
EOF
chmod +x "$container_fixture/bin/curl" "$container_fixture/bin/docker"
: > "$DOCKER_CALL_LOG"
(
  cd "$container_fixture/work"
  PATH="$container_fixture/bin:$PATH" \
  IN_THREE_RELEASE_BASE="file://$release_fixture" \
    "$ROOT/in-three-container" doctor
)
[[ -f "$DOCKER_IMAGE_PRESENT" ]] ||
  fail "container launcher did not load the verified release archive"
[[ -f "$container_fixture/work/.state/container-cache/$release_asset" ]] ||
  fail "container launcher did not retain the versioned release archive"
grep -Fx '<--pull=never>' "$DOCKER_CALL_LOG" >/dev/null ||
  fail "release-asset image can unexpectedly pull from a registry"
grep -Fx '<puc/farcaster-in-three:0.1.5>' "$DOCKER_CALL_LOG" >/dev/null ||
  fail "container launcher did not run the loaded versioned image"

cat > "$container_fixture/bin/in-three" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$container_fixture/bin/in-three"
HOME="$container_fixture/home" \
BUY_HOME="$container_fixture/buy-home" \
IN_THREE_STATE_DIR="$container_fixture" \
PATH="$container_fixture/bin:$PATH" \
  "$ROOT/container-entrypoint" doctor
[[ ! -e "$container_fixture/home" && ! -e "$container_fixture/buy-home" ]] ||
  fail "side-effect-free container commands created state"
HOME="$container_fixture/home" \
BUY_HOME="$container_fixture/buy-home" \
IN_THREE_STATE_DIR="$container_fixture" \
PATH="$container_fixture/bin:$PATH" \
  "$ROOT/container-entrypoint" node status
[[ -d "$container_fixture/home" && -d "$container_fixture/buy-home" ]] ||
  fail "stateful container command did not prepare private homes"
for private_dir in "$container_fixture" "$container_fixture/home" "$container_fixture/buy-home"; do
  [[ "$(node -e 'console.log((require("node:fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$private_dir")" == "700" ]] ||
    fail "container state directory is not private: $private_dir"
done
rm -rf "$container_fixture"
container_fixture=""

package_fixture="$(mktemp -d)"
package_version="$(cd "$package_fixture" && node "$ROOT/bin/in-three.mjs" --version)"
[[ "$package_version" == "0.1.5" ]] ||
  fail "prebuilt CLI does not report the package version"
package_help="$(cd "$package_fixture" && node "$ROOT/bin/in-three.mjs" --help)"
printf '%s\n' "$package_help" | grep -F 'in-three provision' >/dev/null ||
  fail "prebuilt CLI help does not use the installed command"
(
  IN_THREE_STATE_DIR="$package_fixture/.state"
  source "$ROOT/scripts/lib/common.sh"
  [[ "$STATE_DIR" == "$package_fixture/.state" ]]
) || fail "prebuilt CLI state is not isolated from the package installation"
grep -F 'IN_THREE_PREBUILT' "$ROOT/scripts/client.sh" >/dev/null ||
  fail "prebuilt CLI does not skip the source compile"
if grep -F 'npm run build' "$ROOT/apps/client/Dockerfile" >/dev/null; then
  fail "runtime image still compiles the client"
fi
rm -rf "$package_fixture"

node -e '
  const { readFileSync } = require("node:fs");
  const { parse } = require("yaml");
  const compose = parse(readFileSync(process.argv[1], "utf8"));
  if (compose.services.caddy.depends_on?.["agent-gateway"]) process.exit(1);
' "$ROOT/deploy/docker-compose.yml" ||
  fail "browser-only Caddy still requires the optional agent gateway"
grep -F 'setup_args+=(--agent-commerce)' "$ROOT/scripts/client.sh" >/dev/null ||
  fail "client create does not keep agent commerce behind an explicit option"
grep -F 'AGENT_COMMERCE_ENABLED=' "$ROOT/apps/client/src/setup.ts" >/dev/null ||
  fail "setup does not persist the selected browser or agent mode"

printf 'ok - generated cloud-init preserves remote variables\n'
printf 'ok - operator scripts avoid reviewed GNU-only commands\n'
printf 'ok - Snapchain healthcheck matches the pinned image toolset\n'
printf 'ok - client create waits and continues after node bootstrap\n'
printf 'ok - deployment separates client, payment, and local agent secrets\n'
printf 'ok - paid deployment recovery never invokes buy twice\n'
printf 'ok - Base buyer pins network, recipient, and spending ceiling\n'
printf 'ok - gasless signer setup and read-node write relay are wired\n'
printf 'ok - container launcher is isolated and credential values stay out of argv\n'
printf 'ok - prebuilt CLI isolates state and skips compilation\n'
printf 'ok - browser-only setup does not depend on agent commerce\n'
