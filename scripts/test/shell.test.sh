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

if hcloud_error="$(
  {
    export HCLOUD_TOKEN="fixture-secret-token"
    curl() {
      local body_file=""
      while (( $# > 0 )); do
        case "$1" in
          -o) body_file="$2"; shift 2 ;;
          *) shift ;;
        esac
      done
      printf '%s' '{"error":{"code":"resource_limit_exceeded","message":"volumes size limit exceeded"}}' > "$body_file"
      printf '403'
    }
    hcloud_api POST /volumes '{"size":2048}'
  } 2>&1
)"; then
  fail "Hetzner API helper accepted an HTTP 403"
fi
printf '%s\n' "$hcloud_error" | grep -F 'HTTP 403, resource_limit_exceeded): volumes size limit exceeded' >/dev/null ||
  fail "Hetzner API helper hid the provider error"
if printf '%s\n' "$hcloud_error" | grep -F 'fixture-secret-token' >/dev/null; then
  fail "Hetzner API helper exposed its bearer token"
fi

delete_calls="$(mktemp)"
if ! (
  export HCLOUD_TOKEN="fixture-secret-token"
  export DELETE_CALLS="$delete_calls"
  curl() {
    local calls
    calls="$(wc -l < "$DELETE_CALLS")"
    printf 'call\n' >> "$DELETE_CALLS"
    if (( calls < 2 )); then
      printf '409'
    else
      printf '204'
    fi
  }
  sleep() { :; }
  hcloud_delete_with_retry "/firewalls/33" 3 0
); then
  fail "provider cleanup did not recover from a transient detach conflict"
fi
[[ "$(wc -l < "$delete_calls")" == "3" ]] ||
  fail "provider cleanup did not retry the transient delete"
: > "$delete_calls"
if (
  export HCLOUD_TOKEN="fixture-secret-token"
  export DELETE_CALLS="$delete_calls"
  curl() {
    printf 'call\n' >> "$DELETE_CALLS"
    printf '403'
  }
  sleep() { :; }
  hcloud_delete_with_retry "/firewalls/33" 3 0
) 2>/dev/null; then
  fail "provider cleanup accepted a permanent authorization failure"
fi
[[ "$(wc -l < "$delete_calls")" == "1" ]] ||
  fail "provider cleanup retried a permanent authorization failure"
rm -f "$delete_calls"

volume_create_line="$(grep -n 'hcloud_api POST /volumes ' "$ROOT/scripts/provision.sh" | head -1 | cut -d: -f1)"
ssh_key_create_line="$(grep -n 'hcloud_api POST /ssh_keys ' "$ROOT/scripts/provision.sh" | head -1 | cut -d: -f1)"
[[ -n "$volume_create_line" && -n "$ssh_key_create_line" && "$volume_create_line" -lt "$ssh_key_create_line" ]] ||
  fail "provisioning does not test billable volume quota before cloud SSH-key registration"

proxy_log="$(mktemp)"
(
  SSH_KEY="/tmp/fixture-key"
  SSH_USER="inthree"
  SERVER_IP="203.0.113.10"
  SSH_PROXY_JUMP="fixture-jump"
  export PROXY_LOG="$proxy_log"
  ssh() { printf '<%s>\n' "$@" >> "$PROXY_LOG"; }
  scp() { printf '<%s>\n' "$@" >> "$PROXY_LOG"; }
  remote true
  copy_to "/tmp/source" "/tmp/destination"
  wait_for_ssh 1
)
[[ "$(grep -Fc '<ProxyJump=fixture-jump>' "$proxy_log")" == "3" ]] ||
  fail "SSH proxy is not applied to remote, copy, and readiness operations"
rm -f "$proxy_log"
grep -F -- '--ssh-proxy HOST' "$ROOT/scripts/provision.sh" >/dev/null ||
  fail "provisioning help does not expose the SSH proxy"
grep -F 'SSH_PROXY_JUMP=$SSH_PROXY_JUMP' "$ROOT/scripts/provision.sh" >/dev/null ||
  fail "provisioning does not persist the SSH proxy"

if grep -R -n -E '\bmapfile\b|mktemp --suffix|sha256sum -c' "$ROOT/scripts" --exclude='shell.test.sh' >/dev/null; then
  fail "a GNU-only operator command remains"
fi

entrypoint="$ROOT/deploy/snapchain-entrypoint.sh"
grep -A2 -F '[statsd]' "$entrypoint" | grep -F 'prefix="snapchain"' >/dev/null ||
  fail "Snapchain config omits the required statsd prefix"
grep -F 'IN_THREE_CHECK_CONFIG' "$entrypoint" >/dev/null ||
  fail "Snapchain config cannot be validated by the pinned binary"
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  snapchain_image="$(awk '/^[[:space:]]+image: farcasterxyz\/snapchain:/{print $2; exit}' "$ROOT/deploy/docker-compose.yml")"
  config_check="$(docker run --rm \
    -e IN_THREE_CHECK_CONFIG=1 \
    --entrypoint /bin/bash \
    -v "$entrypoint:/opt/in-three/snapchain-entrypoint.sh:ro" \
    -v "$ROOT/deploy/validators.toml:/opt/in-three/validators.toml:ro" \
    "$snapchain_image" /opt/in-three/snapchain-entrypoint.sh)"
  printf '%s\n' "$config_check" | grep -Fx 'config OK' >/dev/null ||
    fail "pinned Snapchain binary rejected the generated config"
fi

healthcheck="$(awk '/healthcheck:/{inside=1} inside{print} /start_period:/{exit}' "$ROOT/deploy/docker-compose.yml")"
printf '%s\n' "$healthcheck" | grep -F '/usr/bin/bash' >/dev/null ||
  fail "Snapchain healthcheck does not use an executable from the pinned image"
if printf '%s\n' "$healthcheck" | grep -F 'curl' >/dev/null; then
  fail "Snapchain healthcheck still requires curl"
fi

progress_command="$(
  source "$ROOT/scripts/client.sh"
  remote() { printf '%s\n' "$*"; }
  node_bootstrap_progress
)"
printf '%s\n' "$progress_command" | grep -F '$3 " used / " $2 " total"' >/dev/null ||
  fail "client bootstrap progress expands remote disk fields locally"

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
printf '%s\n' "$wait_output" | grep -F 'Client setup will continue automatically' >/dev/null ||
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
grep -F 'MessageType.USER_DATA_ADD' "$ROOT/apps/client/src/setup.ts" >/dev/null ||
  fail "app key cannot maintain public profile metadata"
grep -F 'makeUserDataAdd' "$ROOT/apps/client/src/protocol.ts" >/dev/null ||
  fail "client cannot publish profile metadata"
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
release_version="$(jq -r '.version' "$ROOT/package.json")"
release_fixture="$container_fixture/release"
mkdir -p "$release_fixture"
release_asset="farcaster-in-three-container-${release_version}-linux-${release_arch}.tar.gz"
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
grep -Fx "<puc/farcaster-in-three:${release_version}>" "$DOCKER_CALL_LOG" >/dev/null ||
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
[[ "$package_version" == "$release_version" ]] ||
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
grep -F -- '--recovery-file "$RECOVERY_KIT"' "$ROOT/scripts/client.sh" >/dev/null ||
  fail "client create does not keep generated phrases out of terminal output"
if grep -F 'console.log(mnemonic)' "$ROOT/apps/client/src/setup.ts" >/dev/null; then
  fail "generated recovery phrases are still printed to terminal output"
fi
grep -F 'setup_args+=(--password-file "$password_file")' "$ROOT/scripts/client.sh" >/dev/null ||
  fail "client create does not support agent-safe password input"
grep -F 'AGENT_COMMERCE_ENABLED=' "$ROOT/apps/client/src/setup.ts" >/dev/null ||
  fail "setup does not persist the selected browser or agent mode"

pricing_fixture="$(
  source "$ROOT/scripts/lib/common.sh"
  hcloud_cost_estimate \
    '{"server_types":[{"prices":[{"location":"ash","price_hourly":{"gross":"0.10"},"price_monthly":{"gross":"60.00"}}]}]}' \
    '{"pricing":{"currency":"EUR","primary_ips":[{"type":"ipv4","prices":[{"location":"ash","price_hourly":{"gross":"0.0008"},"price_monthly":{"gross":"0.50"}}]}],"volume":{"price_per_gb_month":{"gross":"0.04"}}}}' \
    "ash" \
    2048
)"
[[ "$(jq -r '.currency' <<<"$pricing_fixture")" == "EUR" ]] ||
  fail "cloud cost estimate lost its currency"
jq -e '
  ((.volumeMonthly - 81.92) | fabs) < 0.000001 and
  ((.totalMonthly - 142.42) | fabs) < 0.000001 and
  ((.totalHourlyEstimate - 0.2373333333) | fabs) < 0.000001 and
  ((.total12Hours - 2.848) | fabs) < 0.000001 and
  ((.total24Hours - 5.696) | fabs) < 0.000001
' <<<"$pricing_fixture" >/dev/null ||
  fail "cloud cost estimate does not include compute, IPv4, and volume"

proof_fixture="$(mktemp -d)"
(
  export IN_THREE_ROOT="$ROOT"
  export IN_THREE_STATE_DIR="$proof_fixture"
  source "$ROOT/scripts/lib/common.sh"
  record_proof_event "provision_started" '{"location":"ash","serverType":"ccx33","volumeGiB":2048}'
  record_proof_event "provision_complete" "$(jq -cn \
    --argjson costEstimate "$pricing_fixture" \
    '{location:"ash",serverType:"ccx33",volumeGiB:2048,costEstimate:$costEstimate}')"
  record_proof_event_once "node_ready" '{"version":"0.14.3","maxBlockDelay":3}'
  record_proof_event_once "node_ready" '{"version":"should-not-duplicate","maxBlockDelay":9}'
  record_proof_event "client_live" '{"fid":37,"keyAddMessageHash":"0x1111111111111111111111111111111111111111","agentCommerce":false}'
  record_proof_event "destroy_complete" '{"providerResourcesDeleted":true}'
)
mkdir -p "$proof_fixture/proof"
jq -n '{
  node:{
    observed:true,
    version:"0.14.3",
    dbApproxBytes:600000000000,
    shardStatus:[{shardId:0,blockDelay:3}],
    disk:{sizeBytes:2000000000000,usedBytes:700000000000,availableBytes:1300000000000,usedPercent:"35%"}
  },
  client:{observed:true,fid:37,keyAddMessageHash:"0x1111111111111111111111111111111111111111"},
  writes:[{event:"message_submitted",at:"2026-10-19T00:00:00.000Z",action:"cast",fid:37,hash:"0x2222222222222222222222222222222222222222"}]
}' > "$proof_fixture/proof/latest.json"
IN_THREE_ROOT="$ROOT" IN_THREE_STATE_DIR="$proof_fixture" IN_THREE_COMMAND="in-three" \
  "$ROOT/scripts/proof.sh" --quiet
[[ "$(jq -r '.release' "$proof_fixture/proof/latest.json")" == "$(jq -r '.version' "$ROOT/package.json")" ]] ||
  fail "proof receipt lost the package release"
[[ "$(jq '[.timeline[] | select(.event == "node_ready")] | length' "$proof_fixture/proof/latest.json")" == "1" ]] ||
  fail "proof lifecycle duplicated a one-time node event"
[[ "$(jq -r '.lifecycle.destroyedAt != null' "$proof_fixture/proof/latest.json")" == "true" ]] ||
  fail "proof receipt did not preserve teardown evidence"
[[ "$(jq -r '.writes[0].hash' "$proof_fixture/proof/latest.json")" == "0x2222222222222222222222222222222222222222" ]] ||
  fail "proof receipt lost accepted message hashes"
grep -F 'Provider quote: ~0.2373 EUR/hour; 142.42 EUR/month gross' "$proof_fixture/proof/report.md" >/dev/null ||
  fail "proof report lost the provider cost estimate"
if grep -R -E 'HCLOUD_TOKEN|SIGNER_PRIVATE_KEY|SERVER_IP=' "$proof_fixture/proof" >/dev/null; then
  fail "proof receipt contains a forbidden secret field"
fi
[[ "$(node -e 'console.log((require("node:fs").statSync(process.argv[1]).mode & 0o777).toString(8))' "$proof_fixture/proof/latest.json")" == "600" ]] ||
  fail "proof receipt is not owner-readable only"
rm -rf "$proof_fixture"
proof_fixture=""

proof_live_fixture="$(mktemp -d)"
mkdir -p "$proof_live_fixture/bin" "$proof_live_fixture/state"
printf '%s\n' 'fixture-key' > "$proof_live_fixture/key"
cat > "$proof_live_fixture/state/config" <<EOF
PROVIDER=hcloud
SERVER_IP=203.0.113.99
SSH_USER=inthree
SSH_KEY=$proof_live_fixture/key
CLIENT_DOMAIN=203-0-113-99.sslip.io
LOCATION=ash
SERVER_TYPE=ccx33
VOLUME_SIZE=2048
EOF
cat > "$proof_live_fixture/bin/ssh" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  *'/v1/info'*)
    printf '%s\n' '{"version":"0.14.3","numShards":2,"dbStats":{"approxSize":600000000000},"shardInfos":[{"shardId":0,"blockDelay":2,"maxBlockHeight":100},{"shardId":1,"blockDelay":4,"maxBlockHeight":200}]}'
    ;;
  *'df -B1'*)
    printf '%s\n' '2000000000000 700000000000 1300000000000 35%'
    ;;
  *'docker compose logs'*)
    printf '%s\n' '{"event":"message_submitted","at":"2026-10-19T00:00:00.000Z","action":"follow","fid":37,"hash":"0x3333333333333333333333333333333333333333","targetFid":3}'
    ;;
  *) exit 0 ;;
esac
EOF
cat > "$proof_live_fixture/bin/curl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$proof_live_fixture/bin/ssh" "$proof_live_fixture/bin/curl"
PATH="$proof_live_fixture/bin:$PATH" \
IN_THREE_ROOT="$ROOT" \
IN_THREE_STATE_DIR="$proof_live_fixture/state" \
IN_THREE_COMMAND="in-three" \
  "$ROOT/scripts/proof.sh" --quiet
[[ "$(jq -r '.node.currentlyReachable' "$proof_live_fixture/state/proof/latest.json")" == "true" ]] ||
  fail "live proof capture did not record owned-node readiness"
[[ "$(jq -r '.node.shardStatus | map(.blockDelay) | max' "$proof_live_fixture/state/proof/latest.json")" == "4" ]] ||
  fail "live proof capture lost shard-delay evidence"
[[ "$(jq -r '.writes[0].action' "$proof_live_fixture/state/proof/latest.json")" == "follow" ]] ||
  fail "live proof capture lost a client write receipt"
if grep -R -F '203.0.113.99' "$proof_live_fixture/state/proof" >/dev/null; then
  fail "live proof capture leaked the server IP"
fi
rm -rf "$proof_live_fixture"
proof_live_fixture=""

grep -F 'IN_THREE_RECEIPT' "$ROOT/apps/client/src/server.ts" >/dev/null ||
  fail "client writes are not recorded for redacted receipts"
grep -F 'aria-pressed={activeReactions.like}' "$ROOT/apps/client/web/App.tsx" >/dev/null ||
  fail "the client cannot remove a like after adding it"
grep -F '>Unfollow</button>' "$ROOT/apps/client/web/App.tsx" >/dev/null ||
  fail "the client has no visible unfollow control"

printf 'ok - generated cloud-init preserves remote variables\n'
printf 'ok - provider cleanup retries asynchronous detach conflicts\n'
printf 'ok - SSH jump hosts cover source detection and every remote operation\n'
printf 'ok - operator scripts avoid reviewed GNU-only commands\n'
printf 'ok - Snapchain config includes required fields and a native validation mode\n'
printf 'ok - Snapchain healthcheck matches the pinned image toolset\n'
printf 'ok - client bootstrap progress preserves remote disk fields\n'
printf 'ok - client create waits and continues after node bootstrap\n'
printf 'ok - deployment separates client, payment, and local agent secrets\n'
printf 'ok - paid deployment recovery never invokes buy twice\n'
printf 'ok - Base buyer pins network, recipient, and spending ceiling\n'
printf 'ok - gasless signer setup and read-node write relay are wired\n'
printf 'ok - container launcher is isolated and credential values stay out of argv\n'
printf 'ok - prebuilt CLI isolates state and skips compilation\n'
printf 'ok - browser-only setup does not depend on agent commerce\n'
printf 'ok - proof receipts are redacted, durable, and include reversible client actions\n'
