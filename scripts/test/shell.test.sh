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
trap 'rm -f "$checksum_file" "$pending_env" "$fixture_client_env" "$fixture_gateway_env" "$fixture_access_env"; [[ -z "${deploy_fixture:-}" ]] || rm -rf "$deploy_fixture"' EXIT
cat > "$pending_env" <<'EOF'
FID=37
SIGNER_PRIVATE_KEY=delegated-key
AGENT_PUBLIC_ORIGIN=https://client.example
AGENT_WRITE_TOKEN=agent-capability
BUY_PAY_TO=0x000000000000000000000000000000000000c0Fe
BUY_FACILITATOR_API_KEY=x402_facilitator-secret
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
if grep -E '^(SIGNER_REGISTRATION_|AGENT_|BUY_)' "$fixture_client_env" >/dev/null; then
  fail "payment or recovery secrets would be copied to the client container"
fi
grep -F 'BUY_FACILITATOR_API_KEY=x402_facilitator-secret' "$fixture_gateway_env" >/dev/null ||
  fail "gateway environment lost the facilitator key"
if grep -E '^(SIGNER_PRIVATE_KEY|SIGNER_REGISTRATION_)' "$fixture_gateway_env" >/dev/null; then
  fail "Farcaster signer or recovery state would be copied to the payment container"
fi
grep -F 'AGENT_WRITE_TOKEN=agent-capability' "$fixture_access_env" >/dev/null ||
  fail "local agent access file lost the write capability"
if grep -E '^(SIGNER_|BUY_)' "$fixture_access_env" >/dev/null; then
  fail "local agent access file contains server secrets"
fi

deploy_fixture="$(mktemp -d)"
mkdir -p "$deploy_fixture/.state" "$deploy_fixture/bin" "$deploy_fixture/scripts"
printf '%s\n' 'dep-0123456789abcdef0123456789abcdef' > "$deploy_fixture/.state/deployment-id"
printf '%s\n' 'dep-0123456789abcdef0123456789abcdef' > "$deploy_fixture/.state/deployment-payment.pending"
printf '%s\n' 'https://broker.example' > "$deploy_fixture/.state/deployment-service"
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

printf 'ok - generated cloud-init preserves remote variables\n'
printf 'ok - operator scripts avoid reviewed GNU-only commands\n'
printf 'ok - Snapchain healthcheck matches the pinned image toolset\n'
printf 'ok - client create waits and continues after node bootstrap\n'
printf 'ok - deployment separates client, payment, and local agent secrets\n'
printf 'ok - paid deployment recovery never invokes buy twice\n'
