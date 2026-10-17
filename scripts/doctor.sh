#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

failures=0

check_command() {
  if command -v "$1" >/dev/null 2>&1; then
    success "$1"
  else
    printf 'x %s is missing\n' "$1"
    failures=$((failures + 1))
  fi
}

printf 'IN THREE / DOCTOR\n\n'
for command in bash curl jq ssh scp ssh-keygen node npm tar openssl; do
  check_command "$command"
done

if command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1; then
  success "SHA-256"
else
  printf 'x sha256sum or shasum is required\n'
  failures=$((failures + 1))
fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf 0)"
if (( node_major < 22 )); then
  printf 'x Node.js 22+ is required (found %s)\n' "$node_major"
  failures=$((failures + 1))
fi

if [[ -f "$STATE_FILE" ]]; then
  load_state
  printf '\nProvisioned host\n'
  if wait_for_ssh 1; then
    success "SSH $SSH_USER@$SERVER_IP"
    if remote "docker compose version" >/dev/null 2>&1; then
      success "Docker Compose"
    else
      printf 'x Docker Compose is unavailable remotely\n'
      failures=$((failures + 1))
    fi
    if remote "mountpoint -q /srv/in-three" >/dev/null 2>&1; then
      success "data volume mounted"
    else
      printf 'x data volume is not mounted at /srv/in-three\n'
      failures=$((failures + 1))
    fi
  else
    printf 'x SSH connection failed\n'
    failures=$((failures + 1))
  fi
else
  printf '\nNo provisioned host yet. Local prerequisites only.\n'
fi

if (( failures > 0 )); then
  printf '\n%d check(s) failed.\n' "$failures"
  exit 1
fi
printf '\nAll checks passed.\n'
