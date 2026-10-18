#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

pending_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$PENDING_CLIENT_ENV"
}

write_client_env() {
  local source_env="$1"
  local deployment_env="$2"
  awk '!/^(SIGNER_REGISTRATION_|REVENUE_|AGENT_|BUY_|CDP_)/' "$source_env" > "$deployment_env"
  chmod 600 "$deployment_env"
}

write_agent_gateway_env() {
  local source_env="$1"
  local gateway_env="$2"
  awk '/^(AGENT_|BUY_|CDP_)/' "$source_env" > "$gateway_env"
  chmod 600 "$gateway_env"
}

write_agent_access_env() {
  local source_env="$1"
  local access_env="$2"
  awk -F= '$1 == "AGENT_PUBLIC_ORIGIN" || $1 == "AGENT_WRITE_TOKEN" { print }' \
    "$source_env" > "$access_env"
  chmod 600 "$access_env"
}

pending_has_agent_config() {
  local key
  for key in \
    AGENT_PUBLIC_ORIGIN \
    AGENT_WRITE_TOKEN \
    BUY_OPERATOR_PAY_TO \
    BUY_PAY_TO \
    BUY_ROYALTY_PAY_TO \
    BUY_ROYALTY_BPS \
    BUY_FACILITATOR_API_KEY \
    CDP_API_KEY_ID \
    CDP_API_KEY_SECRET_B64; do
    [[ -n "$(pending_value "$key")" ]] || return 1
  done
  [[ "$(pending_value REVENUE_CELO_STATUS)" == "confirmed" ]] || return 1
  [[ "$(pending_value REVENUE_BASE_STATUS)" == "confirmed" ]] || return 1
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

  if [[ "${IN_THREE_PREBUILT:-0}" == "1" ]]; then
    [[ -r "$IN_THREE_ROOT/apps/client/dist/server/setup.js" ]] ||
      die "prebuilt setup utility is missing; reinstall farcaster-in-three"
    [[ -r "$IN_THREE_ROOT/apps/client/dist/web/index.html" ]] ||
      die "prebuilt client assets are missing; reinstall farcaster-in-three"
    note "Using the release's prebuilt setup utility and client assets"
  else
    note "Building the local setup utility from source"
    (
      cd "$IN_THREE_ROOT"
      npm ci --silent
      npm run build --workspace @in-three/client --silent
    )
  fi

  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  PENDING_CLIENT_ENV="$STATE_DIR/client.env.pending"
  AGENT_ACCESS_ENV="$STATE_DIR/agent.env"
  archive="$(mktemp)"
  client_deploy_env="$(mktemp)"
  agent_gateway_env="$(mktemp)"
  cleanup() {
    rm -f "$archive"
    secure_delete "$client_deploy_env"
    secure_delete "$agent_gateway_env"
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
      --public-origin "https://$CLIENT_DOMAIN" \
      --cookie-secure
  fi

  [[ "$(pending_value SIGNER_REGISTRATION_STATUS)" == "confirmed" ]] ||
    die "app-key registration is not confirmed; rerun $IN_THREE_COMMAND client create"
  pending_has_agent_config ||
    die "saved setup predates paid agent access; preserve $PENDING_CLIENT_ENV and finish with the release that created it before upgrading"

  note "Packaging the exact prebuilt client and dependency lock"
  tar -C "$IN_THREE_ROOT" -czf "$archive" \
    package.json npm-shrinkwrap.json .dockerignore \
    apps/client site/package.json deploy

  copy_to "$archive" /tmp/in-three-source.tar.gz
  write_client_env "$PENDING_CLIENT_ENV" "$client_deploy_env"
  write_agent_gateway_env "$PENDING_CLIENT_ENV" "$agent_gateway_env"
  copy_to "$client_deploy_env" /tmp/in-three-client.env
  copy_to "$agent_gateway_env" /tmp/in-three-agent-gateway.env

  note "Installing separate client and payment secrets with owner-only permissions"
  remote "mkdir -p /srv/in-three/source && rm -rf /srv/in-three/source/*"
  remote "tar -xzf /tmp/in-three-source.tar.gz -C /srv/in-three/source"
  remote "install -m 600 /tmp/in-three-client.env /srv/in-three/client.env"
  remote "install -m 600 /tmp/in-three-agent-gateway.env /srv/in-three/agent-gateway.env"
  remote "rm -f /tmp/in-three-source.tar.gz /tmp/in-three-client.env /tmp/in-three-agent-gateway.env"
  remote "printf '%s\n' 'CLIENT_DOMAIN=$CLIENT_DOMAIN' > /srv/in-three/.env && chmod 600 /srv/in-three/.env"

  note "Preparing owner-only deployment entitlement storage"
  remote "sudo install -d -o 1000 -g 1000 -m 700 /srv/in-three/data/deployer"

  note "Building and starting the browser client and paid agent gateway"
  remote "cd /srv/in-three && sudo docker compose up -d --build client deployer agent-gateway caddy"

  local attempt
  for ((attempt = 1; attempt <= 36; attempt++)); do
    if curl -fsS --max-time 8 "https://$CLIENT_DOMAIN/api/health" >/dev/null 2>&1 &&
      curl -fsS --max-time 8 "https://$CLIENT_DOMAIN/agent/health" >/dev/null 2>&1; then
      write_agent_access_env "$PENDING_CLIENT_ENV" "$AGENT_ACCESS_ENV"
      success "Client and paid agent gateway are live"
      printf '  URL           https://%s\n' "$CLIENT_DOMAIN"
      printf '  agent API     https://%s/.well-known/agent.json\n' "$CLIENT_DOMAIN"
      printf '  agent access  %s\n' "$AGENT_ACCESS_ENV"
      printf '  payment rails Celo USDC + Base USDC\n'
      printf '  settlement    95%% operator + 5%% P-U-C at %s\n' "$(pending_value BUY_PAY_TO)"
      printf '  read path     browser or paid agent -> client service -> your Snapchain node\n'
      printf '  write path    authorized paid agent -> client service -> validator\n'
      printf '  custody key   not stored\n'
      secure_delete "$PENDING_CLIENT_ENV"
      return
    fi
    sleep 5
  done

  remote "cd /srv/in-three && sudo docker compose logs --tail=100 client deployer agent-gateway caddy" >&2 || true
  printf '\nThe confirmed app key remains at %s.\n' "$PENDING_CLIENT_ENV" >&2
  printf 'Fix the reported deployment issue, then rerun %s client create.\n' "$IN_THREE_COMMAND" >&2
  die "the containers started but HTTPS did not become healthy"
}

status() {
  load_state
  printf 'IN THREE / CLIENT STATUS\n\n'
  remote "cd /srv/in-three && sudo docker compose ps client deployer agent-gateway caddy"
  printf '\nURL           https://%s\n' "$CLIENT_DOMAIN"
  curl -fsS --max-time 10 "https://$CLIENT_DOMAIN/api/health" | jq . ||
    die "browser client health check failed"
  curl -fsS --max-time 10 "https://$CLIENT_DOMAIN/agent/health" | jq . ||
    die "agent gateway health check failed"
  success "Browser client and paid agent gateway are healthy"
}

logs() {
  load_state
  remote "cd /srv/in-three && sudo docker compose logs --tail=200 -f client deployer agent-gateway caddy"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-status}" in
    create) create_client ;;
    status) status ;;
    logs) logs ;;
    *) die "usage: $IN_THREE_COMMAND client {create|status|logs}" ;;
  esac
fi
