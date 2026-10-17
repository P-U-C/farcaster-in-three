#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

SNAPCHAIN_VERSION="0.14.3"
SNAPCHAIN_COMMIT="fc87f2686472598143062a00e1c2b2633b2d87ab"
VALIDATORS_SHA256="ca9912d2c3fae0ceeea8f921d878f9d844343241679af6f7127bfd84b809aaab"

up() {
  load_state
  require_command curl
  require_command sha256sum
  require_command scp
  require_command ssh

  note "Checking the attached data disk"
  available="$(remote "df -B1 --output=avail /srv/in-three | tail -1" | tr -d ' ')"
  [[ "$available" =~ ^[0-9]+$ ]] || die "could not read remote disk capacity"
  (( available >= 1500000000000 )) ||
    die "only $((available / 1000000000)) GB is free; Snapchain requires at least 1.5 TB"

  temp_validators="$(mktemp)"
  trap 'rm -f "$temp_validators"' EXIT
  note "Fetching the pinned validator set from Snapchain $SNAPCHAIN_VERSION"
  curl -fsS --max-time 30     "https://raw.githubusercontent.com/farcasterxyz/snapchain/$SNAPCHAIN_COMMIT/validators.toml"     -o "$temp_validators"
  printf '%s  %s\n' "$VALIDATORS_SHA256" "$temp_validators" | sha256sum -c - >/dev/null ||
    die "validator-set checksum mismatch"

  remote "mkdir -p /srv/in-three/data/rocks /srv/in-three/data/snapshot"
  copy_to "$IN_THREE_ROOT/deploy/docker-compose.yml" /srv/in-three/docker-compose.yml
  copy_to "$IN_THREE_ROOT/deploy/snapchain-entrypoint.sh" /srv/in-three/snapchain-entrypoint.sh
  copy_to "$IN_THREE_ROOT/deploy/Caddyfile" /srv/in-three/Caddyfile
  copy_to "$temp_validators" /srv/in-three/validators.toml
  remote "chmod 755 /srv/in-three/snapchain-entrypoint.sh"

  if ! remote "test -f /srv/in-three/.env"; then
    remote "printf '%s\n' 'CLIENT_DOMAIN=$CLIENT_DOMAIN' > /srv/in-three/.env && chmod 600 /srv/in-three/.env"
  fi

  note "Pulling the digest-pinned Snapchain $SNAPCHAIN_VERSION image"
  remote "cd /srv/in-three && sudo docker compose pull snapchain"
  note "Starting the read node"
  remote "cd /srv/in-three && sudo docker compose up -d snapchain"

  for attempt in $(seq 1 36); do
    if remote "curl -fsS --max-time 5 http://127.0.0.1:3381/v1/info" >/dev/null 2>&1; then
      success "Snapchain is running and beginning synchronization"
      status
      printf '\nThe initial verified snapshot is several hundred GB and normally takes hours.\n'
      printf 'You can continue with: ./farcaster client create\n'
      return
    fi
    sleep 5
  done

  remote "cd /srv/in-three && sudo docker compose logs --tail=80 snapchain" >&2 || true
  die "Snapchain did not expose its health endpoint within three minutes"
}

status() {
  load_state
  printf 'IN THREE / NODE STATUS\n\n'
  remote "cd /srv/in-three && sudo docker compose ps snapchain"
  printf '\n'
  info="$(remote "curl -fsS --max-time 8 http://127.0.0.1:3381/v1/info" 2>/dev/null || true)"
  if [[ -z "$info" ]]; then
    printf 'HTTP API      unavailable\n'
    return 1
  fi
  version="$(jq -r '.version // "unknown"' <<<"$info")"
  printf 'version       %s\n' "$version"
  delays="$(jq -r '[.. | objects | .blockDelay? // empty] | unique | join(", ")' <<<"$info")"
  if [[ -n "$delays" ]]; then
    printf 'block delay   %s seconds\n' "$delays"
    max_delay="$(jq -r '[.. | objects | .blockDelay? // empty] | max // 999999' <<<"$info")"
    if (( max_delay < 30 )); then
      printf 'sync          READY\n'
    else
      printf 'sync          CATCHING UP\n'
    fi
  else
    printf 'sync          API online; block delay not yet reported\n'
  fi
  usage="$(remote "df -h /srv/in-three | tail -1 | awk '{print \$3 \" used / \" \$2}'")"
  printf 'disk          %s\n' "$usage"
}

logs() {
  load_state
  remote "cd /srv/in-three && sudo docker compose logs --tail=200 -f snapchain"
}

case "${1:-status}" in
  up) up ;;
  status) status ;;
  logs) logs ;;
  stop)
    load_state
    remote "cd /srv/in-three && sudo docker compose stop snapchain"
    ;;
  *) die "usage: ./farcaster node {up|status|logs|stop}" ;;
esac
