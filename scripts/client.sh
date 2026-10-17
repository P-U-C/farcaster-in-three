#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

create_client() {
  load_state
  for command in node npm tar scp ssh curl; do
    require_command "$command"
  done

  note "Building the audited setup utility"
  (
    cd "$IN_THREE_ROOT"
    npm ci --silent
    npm run build --workspace @in-three/client --silent
  )

  secret_file="$(mktemp)"
  archive="$(mktemp --suffix=.tar.gz)"
  cleanup() {
    if command -v shred >/dev/null 2>&1; then
      shred -u "$secret_file" 2>/dev/null || rm -f "$secret_file"
    else
      rm -f "$secret_file"
    fi
    rm -f "$archive"
  }
  trap cleanup EXIT
  rm -f "$secret_file"

  node "$IN_THREE_ROOT/apps/client/dist/server/setup.js"     --output "$secret_file"     --read-node-url "http://snapchain:3381"     --cookie-secure

  note "Packaging the exact client source and lockfile"
  tar -C "$IN_THREE_ROOT" -czf "$archive"     package.json package-lock.json .dockerignore     apps/client site/package.json

  copy_to "$archive" /tmp/in-three-source.tar.gz
  copy_to "$secret_file" /tmp/in-three-client.env

  note "Installing the delegated app key with owner-only permissions"
  remote "mkdir -p /srv/in-three/source && rm -rf /srv/in-three/source/*"
  remote "tar -xzf /tmp/in-three-source.tar.gz -C /srv/in-three/source"
  remote "install -m 600 /tmp/in-three-client.env /srv/in-three/client.env"
  remote "rm -f /tmp/in-three-source.tar.gz /tmp/in-three-client.env"
  remote "printf '%s\n' 'CLIENT_DOMAIN=$CLIENT_DOMAIN' > /srv/in-three/.env && chmod 600 /srv/in-three/.env"

  note "Building and starting the client behind automatic TLS"
  remote "cd /srv/in-three && sudo docker compose up -d --build client caddy"

  for attempt in $(seq 1 36); do
    if curl -fsS --max-time 8 "https://$CLIENT_DOMAIN/api/health" >/dev/null 2>&1; then
      success "Your sovereign client is live"
      printf '  URL           https://%s\n' "$CLIENT_DOMAIN"
      printf '  read path     browser -> client -> your Snapchain node\n'
      printf '  write path    app key -> validator -> Snapchain consensus\n'
      printf '  custody key   not stored\n'
      return
    fi
    sleep 5
  done

  remote "cd /srv/in-three && sudo docker compose logs --tail=100 client caddy" >&2 || true
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
