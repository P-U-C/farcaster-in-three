#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

SNAPCHAIN_VERSION="0.14.3"
VALIDATORS_SHA256="ca9912d2c3fae0ceeea8f921d878f9d844343241679af6f7127bfd84b809aaab"
BOOTSTRAP_UNIT="in-three-snapshot-bootstrap"

node_info() {
  remote "curl -fsS --max-time 8 http://127.0.0.1:3381/v1/info" 2>/dev/null
}

snapshot_unit_state() {
  local unit="$1"
  remote "sudo systemctl is-active '$unit.service' 2>/dev/null || true" | tr -d '\r\n'
}

snapshot_progress() {
  remote "sudo cat /srv/in-three/data/snapshot-manager/progress.json 2>/dev/null || true"
}

snapshot_bootstrap_active() {
  [[ "$(snapshot_unit_state "$BOOTSTRAP_UNIT")" == "active" ]]
}

remote_has_all_shards() {
  remote "sudo test -s /srv/in-three/data/rocks/shard-0/CURRENT && sudo test -s /srv/in-three/data/rocks/shard-1/CURRENT && sudo test -s /srv/in-three/data/rocks/shard-2/CURRENT" >/dev/null 2>&1
}

remote_rocks_empty() {
  [[ -z "$(remote "sudo find /srv/in-three/data/rocks -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null || true")" ]]
}

print_readiness() {
  local readiness="$1"
  snapchain_readiness_lines "$readiness"
  if [[ "$(jq -r '.ready' <<<"$readiness")" == "true" ]]; then
    printf 'sync          READY\n'
  elif [[ "$(jq '(.recoveryShards + .missingShards) | length' <<<"$readiness")" -gt 0 ]]; then
    printf 'sync          RECOVERY REQUIRED\n'
  else
    printf 'sync          CATCHING UP\n'
  fi
}

bootstrap_status() {
  local progress phase shard expected downloaded

  printf '\nContainer\n'
  remote "cd /srv/in-three && sudo docker compose ps snapchain" || true

  progress="$(snapshot_progress)"
  if jq -e 'type == "object"' <<<"$progress" >/dev/null 2>&1; then
    phase="$(jq -r '.phase // "unknown"' <<<"$progress")"
    shard="$(jq -r '.shard // empty' <<<"$progress")"
    expected="$(jq -r '.expectedChunks // 0' <<<"$progress")"
    printf '\nSnapshot manager\n'
    printf 'phase         %s\n' "$phase"
    if [[ -n "$shard" ]]; then
      printf 'shard         %s\n' "$shard"
      if [[ "$phase" == "downloading" && "$expected" =~ ^[0-9]+$ && "$expected" -gt 0 ]]; then
        downloaded="$(remote "sudo find '/srv/in-three/data/snapshot-manager/work/shard-$shard/chunks' -maxdepth 1 -type f -name 'chunk_*.bin' 2>/dev/null | wc -l" | tr -d ' ')"
        printf 'chunks        %s/%s\n' "$downloaded" "$expected"
      fi
    fi
    printf 'detail        %s\n' "$(jq -r '.detail // ""' <<<"$progress")"
  fi

  printf '\nBootstrap data\n'
  remote "printf 'database      '; sudo du -sh /srv/in-three/data/rocks 2>/dev/null | awk '{print \$1}' || printf 'not created'; printf '\nmanager       '; sudo du -sh /srv/in-three/data/snapshot-manager 2>/dev/null | awk '{print \$1}' || printf 'not created'; printf '\ndisk          '; df -h /srv/in-three | tail -1 | awk '{print \$3 \" used / \" \$2 \" total\"}'" || true

  printf '\nRecent bootstrap log lines\n'
  remote "sudo tail -n 12 /srv/in-three/data/snapshot-manager/bootstrap.log 2>/dev/null || true" || true
}

install_node_files() {
  local validator_source="$IN_THREE_ROOT/deploy/validators.toml"
  local actual_sha256

  note "Checking the vendored validator set from Snapchain $SNAPCHAIN_VERSION"
  actual_sha256="$(sha256_file "$validator_source")"
  [[ "$actual_sha256" == "$VALIDATORS_SHA256" ]] || die "validator-set checksum mismatch"

  remote "mkdir -p /srv/in-three/data/rocks /srv/in-three/data/snapshot"
  copy_to "$IN_THREE_ROOT/deploy/docker-compose.yml" /srv/in-three/docker-compose.yml
  copy_to "$IN_THREE_ROOT/deploy/snapchain-entrypoint.sh" /srv/in-three/snapchain-entrypoint.sh
  copy_to "$IN_THREE_ROOT/deploy/snapchain-healthcheck.sh" /srv/in-three/snapchain-healthcheck.sh
  copy_to "$IN_THREE_ROOT/deploy/snapshot-manager.sh" /tmp/in-three-snapshot-manager.sh
  copy_to "$IN_THREE_ROOT/deploy/Caddyfile" /srv/in-three/Caddyfile
  copy_to "$validator_source" /srv/in-three/validators.toml
  remote "chmod 755 /srv/in-three/snapchain-entrypoint.sh /srv/in-three/snapchain-healthcheck.sh; sudo install -o root -g root -m 700 /tmp/in-three-snapshot-manager.sh /srv/in-three/snapshot-manager.sh; rm -f /tmp/in-three-snapshot-manager.sh"

  if ! remote "test -f /srv/in-three/.env"; then
    remote "printf '%s\n' 'CLIENT_DOMAIN=$CLIENT_DOMAIN' > /srv/in-three/.env && chmod 600 /srv/in-three/.env"
  fi
}

start_snapshot_bootstrap() {
  remote "sudo systemctl reset-failed '$BOOTSTRAP_UNIT.service' >/dev/null 2>&1 || true; sudo rm -f /srv/in-three/data/snapshot-manager/bootstrap.log; sudo systemd-run --quiet --collect --unit '$BOOTSTRAP_UNIT' --property Type=oneshot --property TimeoutStartSec=infinity /bin/bash -lc '/srv/in-three/snapshot-manager.sh bootstrap >> /srv/in-three/data/snapshot-manager/bootstrap.log 2>&1'"
}

up() {
  local capacity info readiness recovery_shards running_id

  load_state
  for command in curl jq scp ssh; do
    require_command "$command"
  done
  record_proof_event_once "node_started" "$(jq -cn --arg snapchainVersion "$SNAPCHAIN_VERSION" '{snapchainVersion:$snapchainVersion}')"

  note "Checking the attached data disk"
  capacity="$(remote "df -B1 --output=size /srv/in-three | tail -1" | tr -d ' ')"
  [[ "$capacity" =~ ^[0-9]+$ ]] || die "could not read remote disk capacity"
  (( capacity >= 2000000000000 )) ||
    die "the data disk is only $((capacity / 1000000000)) GB; Snapchain requires at least 2 TB"

  remote "for command in bash curl jq gzip tar sha256sum xargs awk flock systemd-run; do command -v \"\$command\" >/dev/null || { echo \"missing remote command: \$command\" >&2; exit 1; }; done"
  install_node_files

  note "Pulling the digest-pinned Snapchain $SNAPCHAIN_VERSION image"
  remote "cd /srv/in-three && sudo docker compose pull snapchain"

  if snapshot_bootstrap_active; then
    success "Per-shard snapshot bootstrap is already running"
    bootstrap_status
    printf '\nNext: %s client create (waits for all three shards)\n' "$IN_THREE_COMMAND"
    return
  fi

  info="$(node_info || true)"
  if [[ -n "$info" ]]; then
    readiness="$(snapchain_readiness_json "$info")"
    if [[ "$(jq -r '.ready' <<<"$readiness")" == "true" ]]; then
      success "Snapchain is ready on all three shards"
      status
      printf '\nNext: %s client create\n' "$IN_THREE_COMMAND"
      return
    fi
    recovery_shards="$(jq -r '.recoveryShards | map(tostring) | join(" ")' <<<"$readiness")"
    if [[ -n "$recovery_shards" ]]; then
      print_readiness "$readiness"
      printf '\n'
      for shard in $recovery_shards; do
        printf 'Recover shard %s: %s node recover --shard %s\n' "$shard" "$IN_THREE_COMMAND" "$shard"
      done
      die "one or more shards are too far behind for normal catch-up"
    fi
  fi

  if remote_has_all_shards; then
    note "Starting Snapchain from the existing three-shard database"
    remote "cd /srv/in-three && sudo docker compose up -d snapchain"
  elif remote_rocks_empty; then
    note "Starting rotation-safe per-shard snapshot bootstrap"
    start_snapshot_bootstrap
    record_proof_event_once "node_bootstrap_running" "$(jq -cn --arg snapchainVersion "$SNAPCHAIN_VERSION" --arg strategy "per-shard-manifest" '{snapchainVersion:$snapchainVersion,strategy:$strategy}')"
    success "Snapshot bootstrap is running on the server"
    printf 'Each shard gets fresh metadata and is installed atomically.\n'
    printf 'Closing this terminal will not stop it.\n'
    bootstrap_status
    printf '\nCheck progress: %s node status\n' "$IN_THREE_COMMAND"
    printf 'Next: %s client create (waits for all three shards)\n' "$IN_THREE_COMMAND"
    return
  else
    printf 'The database is partial and will not be overwritten automatically.\n' >&2
    for shard in 0 1 2; do
      if ! remote "sudo test -s '/srv/in-three/data/rocks/shard-$shard/CURRENT'" >/dev/null 2>&1; then
        printf 'Recover missing shard %s: %s node recover --shard %s\n' "$shard" "$IN_THREE_COMMAND" "$shard" >&2
      fi
    done
    die "partial Snapchain database detected"
  fi

  for _ in $(seq 1 12); do
    info="$(node_info || true)"
    [[ -z "$info" ]] || break
    sleep 5
  done

  if [[ -z "$info" ]]; then
    running_id="$(remote "cd /srv/in-three && sudo docker compose ps --status running -q snapchain" 2>/dev/null || true)"
    [[ -n "$running_id" ]] || {
      remote "cd /srv/in-three && sudo docker compose logs --tail=120 snapchain" >&2 || true
      die "Snapchain stopped during startup"
    }
    success "Snapchain started; waiting for its HTTP API"
  else
    success "Snapchain HTTP API is online"
  fi
  status
  printf '\nNext: %s client create (waits for all three shards)\n' "$IN_THREE_COMMAND"
}

status() {
  local info readiness version usage progress state running_id

  load_state
  require_command jq
  printf 'IN THREE / NODE STATUS\n\n'
  remote "cd /srv/in-three && sudo docker compose ps snapchain" || true
  printf '\n'

  info="$(node_info || true)"
  if [[ -n "$info" ]]; then
    version="$(jq -r '.version // "unknown"' <<<"$info")"
    readiness="$(snapchain_readiness_json "$info")"
    printf 'version       %s\n' "$version"
    print_readiness "$readiness"
    if [[ "$(jq -r '.ready' <<<"$readiness")" == "true" ]]; then
      record_proof_event_once "node_ready" "$(jq -cn \
        --arg version "$version" \
        --argjson shards "$(jq '.shards' <<<"$readiness")" \
        '{version:$version,shards:$shards,maxBlockDelay:([$shards[].blockDelay] | max)}')"
    elif [[ "$(jq '(.recoveryShards + .missingShards) | length' <<<"$readiness")" -gt 0 ]]; then
      printf '\n'
      jq -r --arg command "$IN_THREE_COMMAND" '(.recoveryShards + .missingShards | unique)[] | "Run: \($command) node recover --shard \(.)"' <<<"$readiness"
    fi
  else
    state="$(snapshot_unit_state "$BOOTSTRAP_UNIT")"
    progress="$(snapshot_progress)"
    if [[ "$state" == "active" ]]; then
      printf 'sync          BOOTSTRAPPING SHARDS\n'
      bootstrap_status
      printf '\nThe server is still working. Rerun this command later; do not restart it.\n'
      return 0
    fi
    if [[ "$(jq -r '.phase // empty' <<<"$progress" 2>/dev/null || true)" == "failed" ]]; then
      bootstrap_status
      die "snapshot bootstrap stopped; inspect the final log lines above"
    fi

    running_id="$(remote "cd /srv/in-three && sudo docker compose ps --status running -q snapchain" 2>/dev/null || true)"
    if [[ -z "$running_id" ]]; then
      bootstrap_status
      die "Snapchain is not running"
    fi
    printf 'sync          API STARTING\n'
    bootstrap_status
  fi

  usage="$(remote "df -h /srv/in-three | tail -1 | awk '{print \$3 \" used / \" \$2 \" total\"}'")"
  printf 'disk          %s\n' "$usage"
}

recover() {
  local shard="" unit state poll_seconds report_seconds next_report progress info readiness

  while (( $# > 0 )); do
    case "$1" in
      --shard)
        (( $# >= 2 )) || die "--shard requires 0, 1, or 2"
        shard="$2"
        shift 2
        ;;
      *) die "usage: $IN_THREE_COMMAND node recover --shard {0|1|2}" ;;
    esac
  done
  [[ "$shard" =~ ^[012]$ ]] || die "--shard must be 0, 1, or 2"

  load_state
  for command in jq scp ssh; do
    require_command "$command"
  done
  install_node_files
  unit="in-three-snapshot-recover-$shard"
  state="$(snapshot_unit_state "$unit")"

  if [[ "$state" != "active" ]]; then
    info="$(node_info || true)"
    if [[ -n "$info" ]]; then
      readiness="$(snapchain_readiness_json "$info")"
      if ! jq -e --argjson shard "$shard" '((.recoveryShards + .missingShards) | index($shard)) != null' <<<"$readiness" >/dev/null; then
        print_readiness "$readiness"
        die "shard $shard is neither missing nor in the catastrophic-delay recovery state"
      fi
    fi
    note "Starting verified recovery for shard $shard"
    remote "sudo systemctl reset-failed '$unit.service' >/dev/null 2>&1 || true; sudo rm -f '/srv/in-three/data/snapshot-manager/recovery-$shard.log'; sudo systemd-run --quiet --collect --unit '$unit' --property Type=oneshot --property TimeoutStartSec=infinity /bin/bash -lc '/srv/in-three/snapshot-manager.sh recover $shard >> /srv/in-three/data/snapshot-manager/recovery-$shard.log 2>&1'"
  else
    note "Resuming observation of the active shard $shard recovery"
  fi

  poll_seconds="${IN_THREE_RECOVERY_POLL_SECONDS:-30}"
  report_seconds="${IN_THREE_RECOVERY_REPORT_SECONDS:-300}"
  next_report=0
  printf 'Recovery continues on the server if this terminal closes.\n'
  while [[ "$(snapshot_unit_state "$unit")" == "active" ]]; do
    if (( SECONDS >= next_report )); then
      progress="$(snapshot_progress)"
      if jq -e 'type == "object"' <<<"$progress" >/dev/null 2>&1; then
        printf '  %-12s %s\n' "$(jq -r '.phase' <<<"$progress")" "$(jq -r '.detail' <<<"$progress")"
      fi
      next_report=$((SECONDS + report_seconds))
    fi
    sleep "$poll_seconds"
  done

  progress="$(snapshot_progress)"
  if [[ "$(jq -r '.phase // empty' <<<"$progress" 2>/dev/null || true)" != "complete" ]]; then
    remote "sudo tail -n 80 '/srv/in-three/data/snapshot-manager/recovery-$shard.log'" >&2 || true
    die "shard $shard recovery did not complete"
  fi

  info="$(node_info || true)"
  [[ -n "$info" ]] || die "shard recovery completed but the Snapchain API is unavailable"
  readiness="$(snapchain_readiness_json "$info")"
  jq -e --argjson shard "$shard" '.shards[] | select(.shardId == $shard) | .recoveryRecommended == false' <<<"$readiness" >/dev/null ||
    die "shard $shard still reports a catastrophic delay after recovery"
  record_proof_event "node_shard_recovered" "$(jq -cn \
    --argjson shard "$shard" \
    --argjson state "$(jq --argjson shard "$shard" '.shards[] | select(.shardId == $shard)' <<<"$readiness")" \
    '{shard:$shard,state:$state}')"
  success "Shard $shard was restored from one verified snapshot generation"
  print_readiness "$readiness"
}

logs() {
  load_state
  if snapshot_bootstrap_active; then
    remote "sudo tail -n 200 -f /srv/in-three/data/snapshot-manager/bootstrap.log"
  else
    remote "cd /srv/in-three && sudo docker compose logs --tail=200 -f snapchain"
  fi
}

case "${1:-status}" in
  up) up ;;
  status) status ;;
  recover) shift; recover "$@" ;;
  logs) logs ;;
  stop)
    load_state
    remote "sudo systemctl stop '$BOOTSTRAP_UNIT.service' in-three-snapshot-recover-{0,1,2}.service >/dev/null 2>&1 || true; cd /srv/in-three && sudo docker compose stop snapchain"
    ;;
  *) die "usage: $IN_THREE_COMMAND node {up|status|recover --shard N|logs|stop}" ;;
esac
