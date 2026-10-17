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
fixture_deployment_env="$(mktemp)"
trap 'rm -f "$checksum_file" "$pending_env" "$fixture_deployment_env"' EXIT
cat > "$pending_env" <<'EOF'
FID=37
SIGNER_PRIVATE_KEY=delegated-key
SIGNER_REGISTRATION_STATUS=signed
SIGNER_REGISTRATION_TX=0x1234
SIGNER_REGISTRATION_RAW_TX=0xabcd
EOF
(
  source "$ROOT/scripts/client.sh"
  write_deployment_env "$pending_env" "$fixture_deployment_env"
)
grep -F 'SIGNER_PRIVATE_KEY=delegated-key' "$fixture_deployment_env" >/dev/null ||
  fail "deployment environment lost the delegated app key"
if grep -F 'SIGNER_REGISTRATION_' "$fixture_deployment_env" >/dev/null; then
  fail "registration recovery state would be copied to the server"
fi

printf 'ok - generated cloud-init preserves remote variables\n'
printf 'ok - operator scripts avoid reviewed GNU-only commands\n'
printf 'ok - Snapchain healthcheck matches the pinned image toolset\n'
printf 'ok - client create waits and continues after node bootstrap\n'
printf 'ok - deployment excludes local registration recovery state\n'
