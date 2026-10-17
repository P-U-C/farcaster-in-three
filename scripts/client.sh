#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

pending_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$PENDING_CLIENT_ENV"
}

create_client() {
  load_state
  for command in node npm tar scp ssh curl awk; do
    require_command "$command"
  done

  if ! remote "curl -fsS --max-time 8 http://127.0.0.1:3381/v1/info" >/dev/null 2>&1; then
    printf 'Snapchain is still downloading or loading its initial snapshot.\n'
    printf 'No app key has been registered and no custody phrase is needed yet.\n\n'
    printf 'Check progress: ./farcaster node status\n'
    printf 'Then rerun:     ./farcaster client create\n'
    exit 2
  fi

  note "Building the local setup utility"
  (
    cd "$IN_THREE_ROOT"
    npm ci --silent
    npm run build --workspace @in-three/client --silent
  )

  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  PENDING_CLIENT_ENV="$STATE_DIR/client.env.pending"
  archive="$(mktemp)"
  cleanup() {
    rm -f "$archive"
  }
  trap cleanup EXIT

  if [[ -f "$PENDING_CLIENT_ENV" ]]; then
    chmod 600 "$PENDING_CLIENT_ENV"
    registration_status="$(pending_value SIGNER_REGISTRATION_STATUS)"
    case "$registration_status" in
      confirmed)
        note "Resuming deployment with the confirmed app key in .state/client.env.pending"
        ;;
      submitted)
        note "Checking the saved signer-registration transaction"
        node "$IN_THREE_ROOT/apps/client/dist/server/setup.js" \
          --recover \
          --output "$PENDING_CLIENT_ENV"
        ;;
      *)
        die "incomplete setup file at $PENDING_CLIENT_ENV; inspect the last setup error before removing it"
        ;;
    esac
  else
    node "$IN_THREE_ROOT/apps/client/dist/server/setup.js" \
      --output "$PENDING_CLIENT_ENV" \
      --read-node-url "http://snapchain:3381" \
      --cookie-secure
  fi

  [[ "$(pending_value SIGNER_REGISTRATION_STATUS)" == "confirmed" ]] ||
    die "app-key registration is not confirmed; rerun ./farcaster client create"

  note "Packaging the exact client source and lockfile"
  tar -C "$IN_THREE_ROOT" -czf "$archive" \
    package.json package-lock.json .dockerignore \
    apps/client site/package.json

  copy_to "$archive" /tmp/in-three-source.tar.gz
  copy_to "$PENDING_CLIENT_ENV" /tmp/in-three-client.env

  note "Installing the delegated app key with owner-only permissions"
  remote "mkdir -p /srv/in-three/source && rm -rf /srv/in-three/source/*"
  remote "tar -xzf /tmp/in-three-source.tar.gz -C /srv/in-three/source"
  remote "install -m 600 /tmp/in-three-client.env /srv/in-three/client.env"
  remote "rm -f /tmp/in-three-source.tar.gz /tmp/in-three-client.env"
  remote "printf '%s\n' 'CLIENT_DOMAIN=$CLIENT_DOMAIN' > /srv/in-three/.env && chmod 600 /srv/in-three/.env"

  note "Building and starting the client behind automatic TLS"
  remote "cd /srv/in-three && sudo docker compose up -d --build client caddy"

  local attempt
  for ((attempt = 1; attempt <= 36; attempt++)); do
    if curl -fsS --max-time 8 "https://$CLIENT_DOMAIN/api/health" >/dev/null 2>&1; then
      success "Client is live"
      printf '  URL           https://%s\n' "$CLIENT_DOMAIN"
      printf '  read path     browser -> client service -> your Snapchain node\n'
      printf '  write path    browser -> client service -> validator\n'
      printf '  custody key   not stored\n'
      secure_delete "$PENDING_CLIENT_ENV"
      return
    fi
    sleep 5
  done

  remote "cd /srv/in-three && sudo docker compose logs --tail=100 client caddy" >&2 || true
  printf '\nThe confirmed app key remains at %s.\n' "$PENDING_CLIENT_ENV" >&2
  printf 'Fix the reported deployment issue, then rerun ./farcaster client create.\n' >&2
  die "the containers started but HTTPS did not become healthy"
}

status() {
  load_state
  printf 'IN THREE / CLIENT STATUS\n\n'
  remote "cd /srv/in-three && sudo docker compose ps client caddy"
  printf '\nURL           https://%s\n' "$CLIENT_DOMAIN"
  if curl -fsS --max-time 10 "https://$CLIENT_DOMAIN/api/health" | jq .; then
    success "Public HTTPS endpoint is healthy"
  else
    die "client health check failed"
  fi
}

logs() {
  load_state
  remote "cd /srv/in-three && sudo docker compose logs --tail=200 -f client caddy"
}

case "${1:-status}" in
  create) create_client ;;
  status) status ;;
  logs) logs ;;
  *) die "usage: ./farcaster client {create|status|logs}" ;;
esac
