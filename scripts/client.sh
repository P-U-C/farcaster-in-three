#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

pending_value() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$PENDING_CLIENT_ENV"
}

escape_compose_env() {
  # Compose interpolates dollars in env_file values; $$ reaches the container as a literal $.
  sed 's/\$/$$/g'
}

write_client_env() {
  local source_env="$1"
  local deployment_env="$2"
  awk '!/^(SIGNER_REGISTRATION_|REVENUE_|AGENT_|BUY_|CDP_)/' "$source_env" |
    escape_compose_env > "$deployment_env"
  chmod 600 "$deployment_env"
}

write_agent_gateway_env() {
  local source_env="$1"
  local gateway_env="$2"
  awk '/^(AGENT_|BUY_|CDP_)/' "$source_env" |
    escape_compose_env > "$gateway_env"
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

node_readiness_remote() {
  local info
  info="$(remote "curl -fsS --max-time 8 http://127.0.0.1:3381/v1/info" 2>/dev/null)" || return 1
  snapchain_readiness_json "$info"
}

start_setup_tunnel() {
  local local_port
  local -a options
  local_port="$(node -e 'const net=require("node:net"); const server=net.createServer(); server.listen(0,"127.0.0.1",()=>{console.log(server.address().port);server.close()})')"
  SETUP_NODE_URL="http://127.0.0.1:$local_port"
  options=(
    -N
    -L "127.0.0.1:$local_port:127.0.0.1:3381"
    -i "$SSH_KEY"
    -o IdentitiesOnly=yes
    -o StrictHostKeyChecking=accept-new
    -o ExitOnForwardFailure=yes
    -o ServerAliveInterval=15
    -o ServerAliveCountMax=3
  )
  [[ -z "$SSH_PROXY_JUMP" ]] || options+=(-o "ProxyJump=$SSH_PROXY_JUMP")

  ssh "${options[@]}" "$SSH_USER@$SERVER_IP" &
  SETUP_TUNNEL_PID=$!

  local attempt
  for ((attempt = 1; attempt <= 20; attempt++)); do
    if curl -fsS --max-time 2 "$SETUP_NODE_URL/v1/info" >/dev/null 2>&1; then
      success "Private setup tunnel to your Snapchain node is ready"
      return
    fi
    kill -0 "$SETUP_TUNNEL_PID" 2>/dev/null ||
      die "SSH setup tunnel exited before Snapchain became reachable"
    sleep 1
  done
  die "could not reach Snapchain through the private setup tunnel"
}

node_bootstrap_progress() {
  local info readiness progress shard expected downloaded

  info="$(remote "curl -fsS --max-time 8 http://127.0.0.1:3381/v1/info" 2>/dev/null || true)"
  if [[ -n "$info" ]] && readiness="$(snapchain_readiness_json "$info" 2>/dev/null)"; then
    snapchain_readiness_lines "$readiness" | sed 's/^/  /'
  else
    progress="$(remote "sudo cat /srv/in-three/data/snapshot-manager/progress.json 2>/dev/null || true")"
    if jq -e 'type == "object"' <<<"$progress" >/dev/null 2>&1; then
      printf '  phase      %s\n' "$(jq -r '.phase // "unknown"' <<<"$progress")"
      shard="$(jq -r '.shard // empty' <<<"$progress")"
      expected="$(jq -r '.expectedChunks // 0' <<<"$progress")"
      if [[ -n "$shard" ]]; then
        printf '  shard      %s\n' "$shard"
        if [[ "$expected" =~ ^[0-9]+$ && "$expected" -gt 0 ]]; then
          downloaded="$(remote "sudo find '/srv/in-three/data/snapshot-manager/work/shard-$shard/chunks' -maxdepth 1 -type f -name 'chunk_*.bin' 2>/dev/null | wc -l" | tr -d ' ')"
          printf '  chunks     %s/%s\n' "$downloaded" "$expected"
        fi
      fi
      printf '  detail     %s\n' "$(jq -r '.detail // ""' <<<"$progress")"
    else
      printf '  phase      waiting for snapshot manager\n'
    fi
  fi
  remote "printf '  database   '; sudo du -sh /srv/in-three/data/rocks 2>/dev/null | awk '{print \$1}' || printf 'not created'; printf '\n  disk       '; df -h /srv/in-three | tail -1 | awk '{print \$3 \" used / \" \$2 \" total\"}'; printf '\n'"
}

run_shard_recovery() {
  "$IN_THREE_ROOT/scripts/node.sh" recover --shard "$1"
}

wait_for_node_ready() {
  local poll_seconds="${IN_THREE_NODE_POLL_SECONDS:-30}"
  local report_seconds="${IN_THREE_NODE_REPORT_SECONDS:-300}"
  local started_at=$SECONDS
  local next_report=$SECONDS
  local readiness recovery_shards missing_shards recovered_missing shard running_id bootstrap_state

  [[ "$poll_seconds" =~ ^[1-9][0-9]*$ ]] ||
    die "IN_THREE_NODE_POLL_SECONDS must be a positive integer"
  [[ "$report_seconds" =~ ^[1-9][0-9]*$ ]] ||
    die "IN_THREE_NODE_REPORT_SECONDS must be a positive integer"

  printf 'Client setup waits for all three Snapchain shards to be within %s seconds.\n' "$SNAPCHAIN_READY_DELAY_SECONDS"
  printf 'No app key is registered and no custody phrase is requested while waiting.\n'
  printf 'Press Ctrl-C to stop waiting; rerunning this command is safe.\n'

  while true; do
    readiness="$(node_readiness_remote 2>/dev/null || true)"
    if [[ -n "$readiness" ]]; then
      if [[ "$(jq -r '.ready' <<<"$readiness")" == "true" ]]; then
        success "All three Snapchain shards are ready; continuing client setup"
        return
      fi

      missing_shards="$(jq -r '.missingShards | map(tostring) | join(" ")' <<<"$readiness")"
      recovered_missing=false
      for shard in $missing_shards; do
        if ! remote "sudo test -s '/srv/in-three/data/rocks/shard-$shard/CURRENT'" >/dev/null 2>&1; then
          if [[ "${IN_THREE_AUTO_RECOVER:-1}" != "1" ]]; then
            die "run $IN_THREE_COMMAND node recover --shard $shard"
          fi
          note "Recovering missing shard $shard before requesting any account secret"
          run_shard_recovery "$shard"
          recovered_missing=true
        fi
      done
      [[ "$recovered_missing" != "true" ]] || continue

      recovery_shards="$(jq -r '.recoveryShards | map(tostring) | join(" ")' <<<"$readiness")"
      if [[ -n "$recovery_shards" ]]; then
        printf '\nA shard missed its snapshot and cannot catch up on a useful timeline.\n'
        snapchain_readiness_lines "$readiness"
        if [[ "${IN_THREE_AUTO_RECOVER:-1}" == "1" ]]; then
          for shard in $recovery_shards; do
            note "Recovering shard $shard before requesting any account secret"
            run_shard_recovery "$shard"
          done
          continue
        fi
        die "run $IN_THREE_COMMAND node recover --shard $(awk '{print $1}' <<<"$recovery_shards")"
      fi
    fi

    running_id="$(remote "cd /srv/in-three && sudo docker compose ps --status running -q snapchain" 2>/dev/null || true)"
    bootstrap_state="$(remote "sudo systemctl is-active in-three-snapshot-bootstrap.service 2>/dev/null || true" | tr -d '\r\n')"
    if [[ -z "$running_id" && "$bootstrap_state" != "active" ]]; then
      remote "sudo tail -n 80 /srv/in-three/data/snapshot-manager/bootstrap.log 2>/dev/null || cd /srv/in-three && sudo docker compose logs --tail=120 snapchain" >&2 || true
      die "Snapchain and its snapshot manager are not running"
    fi

    if (( SECONDS >= next_report )); then
      printf '\nNode progress\n'
      node_bootstrap_progress || printf '  temporarily unavailable\n'
      printf '  elapsed    %dm\n' "$(((SECONDS - started_at) / 60))"
      next_report=$((SECONDS + report_seconds))
    fi
    sleep "$poll_seconds"
  done
}

create_client() {
  local agent_commerce="false"
  local password_file=""
  while (( $# > 0 )); do
    case "$1" in
      --with-agent)
        agent_commerce="true"
        shift
        ;;
      --password-file)
        (( $# >= 2 )) || die "--password-file requires a path"
        password_file="$2"
        shift 2
        ;;
      *) die "usage: $IN_THREE_COMMAND client create [--with-agent] [--password-file PATH]" ;;
    esac
  done
  local requested_agent_commerce="$agent_commerce"
  local saved_agent_commerce
  local -a setup_args

  load_state
  for command in node npm tar scp ssh curl awk jq; do
    require_command "$command"
  done
  record_proof_event_once "client_setup_started" '{}'

  wait_for_node_ready

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
  RECOVERY_KIT="$STATE_DIR/test-account.recovery.json"
  AGENT_ACCESS_ENV="$STATE_DIR/agent.env"
  archive="$(mktemp)"
  client_deploy_env="$(mktemp)"
  agent_gateway_env="$(mktemp)"
  SETUP_TUNNEL_PID=""
  SETUP_NODE_URL=""
  cleanup() {
    if [[ -n "$SETUP_TUNNEL_PID" ]]; then
      kill "$SETUP_TUNNEL_PID" 2>/dev/null || true
      wait "$SETUP_TUNNEL_PID" 2>/dev/null || true
    fi
    rm -f "$archive"
    secure_delete "$client_deploy_env"
    secure_delete "$agent_gateway_env"
  }
  trap cleanup EXIT

  start_setup_tunnel

  if [[ -f "$PENDING_CLIENT_ENV" ]]; then
    chmod 600 "$PENDING_CLIENT_ENV"
    registration_status="$(pending_value SIGNER_REGISTRATION_STATUS)"
    case "$registration_status" in
      confirmed)
        note "Resuming deployment with the confirmed app key in .state/client.env.pending"
        ;;
      signed|submitted)
        note "Checking and resubmitting the saved app-key authorization"
        node "$IN_THREE_ROOT/apps/client/dist/server/setup.js" \
          --recover \
          --output "$PENDING_CLIENT_ENV" \
          --setup-node-url "$SETUP_NODE_URL"
        ;;
      *)
        die "unrecognized setup state at $PENDING_CLIENT_ENV; keep the file until signer state is verified"
        ;;
    esac
  else
    setup_args=(
      --output "$PENDING_CLIENT_ENV"
      --read-node-url "http://snapchain:3381"
      --setup-node-url "$SETUP_NODE_URL"
      --public-origin "https://$CLIENT_DOMAIN"
      --recovery-file "$RECOVERY_KIT"
      --cookie-secure
    )
    if [[ -n "$password_file" ]]; then
      [[ -f "$password_file" ]] || die "client password file not found: $password_file"
      setup_args+=(--password-file "$password_file")
    fi
    if [[ "$agent_commerce" == "true" ]]; then
      setup_args+=(--agent-commerce)
    fi
    node "$IN_THREE_ROOT/apps/client/dist/server/setup.js" "${setup_args[@]}"
  fi

  [[ "$(pending_value SIGNER_REGISTRATION_STATUS)" == "confirmed" ]] ||
    die "app-key registration is not confirmed; rerun $IN_THREE_COMMAND client create"

  saved_agent_commerce="$(pending_value AGENT_COMMERCE_ENABLED)"
  if [[ -z "$saved_agent_commerce" ]] && pending_has_agent_config; then
    saved_agent_commerce="true"
  fi
  case "$saved_agent_commerce" in
    true)
      agent_commerce="true"
      pending_has_agent_config ||
        die "saved agent-commerce setup is incomplete; preserve $PENDING_CLIENT_ENV and rerun client create"
      ;;
    false|"")
      agent_commerce="false"
      [[ "$requested_agent_commerce" != "true" || ! -f "$PENDING_CLIENT_ENV" ]] ||
        die "saved browser-only setup cannot be upgraded in place; finish it, then follow docs/AGENT-API.md"
      ;;
    *) die "invalid AGENT_COMMERCE_ENABLED value in $PENDING_CLIENT_ENV" ;;
  esac

  note "Packaging the exact prebuilt client and dependency lock"
  tar -C "$IN_THREE_ROOT" -czf "$archive" \
    package.json npm-shrinkwrap.json .dockerignore \
    apps/client site/package.json deploy

  copy_to "$archive" /tmp/in-three-source.tar.gz
  write_client_env "$PENDING_CLIENT_ENV" "$client_deploy_env"
  copy_to "$client_deploy_env" /tmp/in-three-client.env
  if [[ "$agent_commerce" == "true" ]]; then
    write_agent_gateway_env "$PENDING_CLIENT_ENV" "$agent_gateway_env"
    copy_to "$agent_gateway_env" /tmp/in-three-agent-gateway.env
  fi

  note "Installing client files with owner-only permissions"
  remote "mkdir -p /srv/in-three/source && rm -rf /srv/in-three/source/*"
  remote "tar -xzf /tmp/in-three-source.tar.gz -C /srv/in-three/source"
  remote "install -m 600 /tmp/in-three-client.env /srv/in-three/client.env"
  if [[ "$agent_commerce" == "true" ]]; then
    remote "install -m 600 /tmp/in-three-agent-gateway.env /srv/in-three/agent-gateway.env"
  else
    remote "rm -f /srv/in-three/agent-gateway.env"
  fi
  remote "rm -f /tmp/in-three-source.tar.gz /tmp/in-three-client.env /tmp/in-three-agent-gateway.env"
  remote "printf '%s\n' 'CLIENT_DOMAIN=$CLIENT_DOMAIN' > /srv/in-three/.env && chmod 600 /srv/in-three/.env"

  if [[ "$agent_commerce" == "true" ]]; then
    note "Preparing owner-only deployment entitlement storage"
    remote "sudo install -d -o 1000 -g 1000 -m 700 /srv/in-three/data/deployer"
    note "Building and starting the browser client and paid agent gateway"
    remote "cd /srv/in-three && sudo docker compose up -d --build client deployer agent-gateway caddy"
  else
    note "Building and starting the browser client"
    remote "cd /srv/in-three && sudo docker compose stop agent-gateway deployer >/dev/null 2>&1 || true; sudo docker compose up -d --build client caddy"
  fi

  local attempt
  for ((attempt = 1; attempt <= 36; attempt++)); do
    if curl -fsS --max-time 8 "https://$CLIENT_DOMAIN/api/health" >/dev/null 2>&1; then
      if [[ "$agent_commerce" == "true" ]] &&
        ! curl -fsS --max-time 8 "https://$CLIENT_DOMAIN/agent/health" >/dev/null 2>&1; then
        sleep 5
        continue
      fi
      success "Browser client is live"
      printf '  URL           https://%s\n' "$CLIENT_DOMAIN"
      if [[ "$agent_commerce" == "true" ]]; then
        write_agent_access_env "$PENDING_CLIENT_ENV" "$AGENT_ACCESS_ENV"
        printf '  agent API     https://%s/.well-known/agent.json\n' "$CLIENT_DOMAIN"
        printf '  agent access  %s\n' "$AGENT_ACCESS_ENV"
        printf '  payment rails Celo USDC + Base USDC\n'
        printf '  settlement    95%% operator + 5%% P-U-C at %s\n' "$(pending_value BUY_PAY_TO)"
      fi
      printf '  read path     browser -> client service -> your Snapchain node\n'
      printf '  write path    authorized client -> your read node -> validator gossip\n'
      if [[ -f "$RECOVERY_KIT" ]]; then
        printf '  recovery kit %s (encrypted locally; never uploaded)\n' "$RECOVERY_KIT"
      else
        printf '  custody key   not stored\n'
      fi
      fid="$(pending_value FID)"
      key_add_hash="$(pending_value SIGNER_REGISTRATION_MESSAGE_HASH)"
      record_proof_event "client_live" "$(jq -cn \
        --arg fid "$fid" \
        --arg keyAddMessageHash "$key_add_hash" \
        --arg agentCommerce "$agent_commerce" \
        '{fid:($fid | tonumber),keyAddMessageHash:$keyAddMessageHash,agentCommerce:($agentCommerce == "true")}')"
      printf '  proof         %s proof\n' "$IN_THREE_COMMAND"
      secure_delete "$PENDING_CLIENT_ENV"
      return
    fi
    sleep 5
  done

  remote "cd /srv/in-three && sudo docker compose logs --tail=100 client caddy agent-gateway deployer" >&2 || true
  printf '\nThe confirmed app key remains at %s.\n' "$PENDING_CLIENT_ENV" >&2
  printf 'Fix the reported deployment issue, then rerun %s client create.\n' "$IN_THREE_COMMAND" >&2
  die "the containers started but HTTPS did not become healthy"
}

profile() {
  local password_file=""
  local recovery_file=""
  local display_name=""
  local bio=""
  local pfp_url=""
  local profile_url=""
  local username=""
  local set_display="false"
  local set_bio="false"
  local set_pfp="false"
  local set_url="false"
  local set_username="false"
  local claim_name="false"

  while (( $# > 0 )); do
    case "$1" in
      --password-file) (( $# >= 2 )) || die "--password-file requires a path"; password_file="$2"; shift 2 ;;
      --recovery-file) (( $# >= 2 )) || die "--recovery-file requires a path"; recovery_file="$2"; shift 2 ;;
      --display-name) (( $# >= 2 )) || die "--display-name requires a value"; display_name="$2"; set_display="true"; shift 2 ;;
      --bio) (( $# >= 2 )) || die "--bio requires a value"; bio="$2"; set_bio="true"; shift 2 ;;
      --pfp-url) (( $# >= 2 )) || die "--pfp-url requires a value"; pfp_url="$2"; set_pfp="true"; shift 2 ;;
      --url) (( $# >= 2 )) || die "--url requires a value"; profile_url="$2"; set_url="true"; shift 2 ;;
      --username) (( $# >= 2 )) || die "--username requires a value"; username="$2"; set_username="true"; shift 2 ;;
      --claim-name) claim_name="true"; shift ;;
      *) die "usage: $IN_THREE_COMMAND client profile --password-file PATH [--display-name TEXT] [--bio TEXT] [--pfp-url HTTPS_URL] [--url HTTPS_URL] [--username NAME [--claim-name --recovery-file PATH]]" ;;
    esac
  done

  [[ -n "$password_file" ]] || die "--password-file is required"
  [[ -f "$password_file" ]] || die "client password file not found: $password_file"
  if [[ "$claim_name" == "true" && "$set_username" != "true" ]]; then
    die "--claim-name requires --username"
  fi
  if [[ "$set_display" != "true" && "$set_bio" != "true" && "$set_pfp" != "true" && "$set_url" != "true" && "$set_username" != "true" ]]; then
    die "provide at least one profile field"
  fi

  load_state
  for command in node curl jq mktemp; do
    require_command "$command"
  done
  if [[ "$claim_name" == "true" ]]; then
    [[ -r "$IN_THREE_ROOT/apps/client/dist/server/profile.js" ]] ||
      die "profile utility is missing; reinstall farcaster-in-three"
  fi

  local cookie_jar login_payload profile_payload me_payload response_payload fid
  cookie_jar="$(mktemp)"
  login_payload="$(mktemp)"
  profile_payload="$(mktemp)"
  me_payload="$(mktemp)"
  response_payload="$(mktemp)"
  cleanup_profile() {
    secure_delete "$cookie_jar"
    secure_delete "$login_payload"
    secure_delete "$profile_payload"
    secure_delete "$me_payload"
    secure_delete "$response_payload"
  }
  trap cleanup_profile EXIT
  chmod 600 "$cookie_jar" "$login_payload" "$profile_payload" "$me_payload" "$response_payload"

  node -e '
    const fs = require("node:fs");
    const raw = fs.readFileSync(process.argv[1], "utf8");
    const password = raw.endsWith("\r\n") ? raw.slice(0, -2) : raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    process.stdout.write(JSON.stringify({ password }));
  ' "$password_file" > "$login_payload"
  curl -fsS --cookie-jar "$cookie_jar" \
    -H "content-type: application/json" \
    --data-binary "@$login_payload" \
    "https://$CLIENT_DOMAIN/api/login" >/dev/null ||
    die "client login failed"
  curl -fsS --cookie "$cookie_jar" "https://$CLIENT_DOMAIN/api/me" > "$me_payload" ||
    die "could not read the deployed profile"
  fid="$(jq -er '.fid | select(type == "number" and . > 0)' "$me_payload")" ||
    die "deployed client returned an invalid FID"

  if [[ "$claim_name" == "true" ]]; then
    recovery_file="${recovery_file:-$STATE_DIR/test-account.recovery.json}"
    [[ -f "$recovery_file" ]] || die "recovery kit not found: $recovery_file"
    node "$IN_THREE_ROOT/apps/client/dist/server/profile.js" \
      --fid "$fid" \
      --username "$username" \
      --recovery-file "$recovery_file" \
      --password-file "$password_file"
  fi

  jq -n \
    --arg displayName "$display_name" \
    --arg bio "$bio" \
    --arg pfpUrl "$pfp_url" \
    --arg url "$profile_url" \
    --arg username "$username" \
    --argjson setDisplay "$set_display" \
    --argjson setBio "$set_bio" \
    --argjson setPfp "$set_pfp" \
    --argjson setUrl "$set_url" \
    --argjson setUsername "$set_username" \
    '{}
      + (if $setDisplay then {displayName:$displayName} else {} end)
      + (if $setBio then {bio:$bio} else {} end)
      + (if $setPfp then {pfpUrl:$pfpUrl} else {} end)
      + (if $setUrl then {url:$url} else {} end)
      + (if $setUsername then {username:$username} else {} end)' > "$profile_payload"

  curl -fsS --cookie "$cookie_jar" \
    -X PATCH \
    -H "content-type: application/json" \
    --data-binary "@$profile_payload" \
    "https://$CLIENT_DOMAIN/api/profile" > "$response_payload" ||
    die "profile update was rejected; no local secret was changed"
  jq '{ok,updates:[.updates[] | {field,hash,relay}]}' "$response_payload"
  success "Profile messages were accepted by your Snapchain node"
  cleanup_profile
  trap - EXIT
}

status() {
  load_state
  printf 'IN THREE / CLIENT STATUS\n\n'
  remote "cd /srv/in-three && sudo docker compose ps client caddy"
  printf '\nURL           https://%s\n' "$CLIENT_DOMAIN"
  curl -fsS --max-time 10 "https://$CLIENT_DOMAIN/api/health" | jq . ||
    die "browser client health check failed"
  if remote "test -f /srv/in-three/agent-gateway.env"; then
    remote "cd /srv/in-three && sudo docker compose ps deployer agent-gateway"
    curl -fsS --max-time 10 "https://$CLIENT_DOMAIN/agent/health" | jq . ||
      die "agent gateway health check failed"
    success "Browser client and paid agent gateway are healthy"
  else
    success "Browser client is healthy"
  fi
}

logs() {
  load_state
  remote "cd /srv/in-three && sudo docker compose logs --tail=200 -f client deployer agent-gateway caddy"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-status}" in
    create) shift; create_client "$@" ;;
    profile) shift; profile "$@" ;;
    status) status ;;
    logs) logs ;;
    *) die "usage: $IN_THREE_COMMAND client {create [--with-agent] [--password-file PATH]|profile --password-file PATH [options]|status|logs}" ;;
  esac
fi
