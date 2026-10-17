#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

pending_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$PENDING_CLIENT_ENV"
}

write_deployment_env() {
  local source_env="$1"
  local deployment_env="$2"
  awk '!/^SIGNER_REGISTRATION_/' "$source_env" > "$deployment_env"
  chmod 600 "$deployment_env"
}

node_api_ready() {
  remote "curl -fsS --max-time 8 http://127.0.0.1:3381/v1/info" >/dev/null 2>&1
}

node_bootstrap_progress() {
  remote "printf '  snapshot  '; du -sh /srv/in-three/data/snapshot 2>/dev/null | awk '{print \$1}' || printf 'not created'; printf '\n  database  '; du -sh /srv/in-three/data/rocks 2>/dev/null | awk '{print \$1}' || printf 'not created'; printf '\n  disk      '; df -h /srv/in-three | tail -1 | awk '{print \$3 " used / " \$2 " total"}'; printf '\n'"
}

wait_for_node_api() {
  local poll_seconds="${IN_THREE_NODE_POLL_SECONDS:-30}"
  local report_seconds="${IN_THREE_NODE_REPORT_SECONDS:-300}"
  local started_at=$SECONDS
  local next_report=$SECONDS
  local running_id

  [[ "$poll_seconds" =~ ^[1-9][0-9]*$ ]] ||
    die "IN_THREE_NODE_POLL_SECONDS must be a positive integer"
  [[ "$report_seconds" =~ ^[1-9][0-9]*$ ]] ||
    die "IN_THREE_NODE_REPORT_SECONDS must be a positive integer"

  if node_api_ready; then
    success "Snapchain HTTP API is online"
    return
  fi

  printf 'Snapchain is still downloading or loading its initial snapshot.\n'
  printf 'Command 2 will continue automatically when the API is online.\n'
  printf 'No app key is registered and no custody phrase is requested while waiting.\n'
  printf 'Press Ctrl-C to stop waiting; rerunning this command is safe.\n'

  while ! node_api_ready; do
    if running_id="$(remote "cd /srv/in-three && sudo docker compose ps --status running -q snapchain" 2>/dev/null)"; then
      if [[ -z "$running_id" ]]; then
        remote "cd /srv/in-three && sudo docker compose logs --tail=120 snapchain" >&2 || true
        die "Snapchain stopped during bootstrap; inspect the logs above"
      fi
    else
      note "Could not reach the server; retrying without changing node state"
    fi

    if (( SECONDS >= next_report )); then
      printf '\nBootstrap progress\n'
      node_bootstrap_progress || printf '  temporarily unavailable\n'
      printf '  elapsed   %dm\n' "$(((SECONDS - started_at) / 60))"
      next_report=$((SECONDS + report_seconds))
    fi
    sleep "$poll_seconds"
  done

  success "Snapchain HTTP API is online; continuing client setup"
}

create_client() {
  load_state
  for command in node npm tar scp ssh curl awk; do
    require_command "$command"
  done

  wait_for_node_api

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
  deploy_env="$(mktemp)"
  cleanup() {
    rm -f "$archive"
    secure_delete "$deploy_env"
  }
  trap cleanup EXIT

  if [[ -f "$PENDING_CLIENT_ENV" ]]; then
    chmod 600 "$PENDING_CLIENT_ENV"
    registration_status="$(pending_value SIGNER_REGISTRATION_STATUS)"
    case "$registration_status" in
      confirmed)
        note "Resuming deployment with the confirmed app key in .state/client.env.pending"
        ;;
      signed|submitted)
        note "Rebroadcasting and checking the saved signer-registration transaction"
        node "$IN_THREE_ROOT/apps/client/dist/server/setup.js" \
          --recover \
          --output "$PENDING_CLIENT_ENV"
        ;;
      *)
        die "unrecognized setup state at $PENDING_CLIENT_ENV; keep the file until signer state is verified"
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
  write_deployment_env "$PENDING_CLIENT_ENV" "$deploy_env"
  copy_to "$deploy_env" /tmp/in-three-client.env

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

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-status}" in
    create) create_client ;;
    status) status ;;
    logs) logs ;;
    *) die "usage: ./farcaster client {create|status|logs}" ;;
  esac
fi
