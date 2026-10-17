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

printf 'ok - generated cloud-init preserves remote variables\n'
printf 'ok - operator scripts avoid reviewed GNU-only commands\n'
printf 'ok - Snapchain healthcheck matches the pinned image toolset\n'
