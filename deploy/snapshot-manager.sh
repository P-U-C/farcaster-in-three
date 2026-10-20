#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

MODE="${1:-}"
TARGET_SHARD="${2:-}"
ROOT="${IN_THREE_REMOTE_ROOT:-/srv/in-three}"
DATA_DIR="${IN_THREE_DATA_DIR:-$ROOT/data}"
ROCKS_DIR="$DATA_DIR/rocks"
BUILTIN_SNAPSHOT_DIR="$DATA_DIR/snapshot"
STATE_DIR="$DATA_DIR/snapshot-manager"
WORK_ROOT="$STATE_DIR/work"
PROGRESS_FILE="$STATE_DIR/progress.json"
BASE_URL="${SNAPSHOT_BASE_URL:-https://pub-d352dd8819104a778e20d08888c5a661.r2.dev}"
NETWORK_PATH="${SNAPSHOT_NETWORK_PATH:-FARCASTER_NETWORK_MAINNET}"
DOWNLOAD_JOBS="${SNAPSHOT_DOWNLOAD_JOBS:-8}"
MAX_ATTEMPTS="${SNAPSHOT_MAX_ATTEMPTS:-3}"
MAX_MANIFEST_AGE_SECONDS="${SNAPSHOT_MAX_MANIFEST_AGE_SECONDS:-172800}"
MAX_FUTURE_SKEW_SECONDS="${SNAPSHOT_MAX_FUTURE_SKEW_SECONDS:-300}"
RECOVERY_DELAY_SECONDS="${SNAPCHAIN_RECOVERY_DELAY_SECONDS:-604800}"
RECOVERY_ACCEPT_DELAY_SECONDS="${SNAPSHOT_RECOVERY_ACCEPT_DELAY_SECONDS:-172800}"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

write_progress() {
  local phase="$1"
  local shard="${2:-}"
  local generation="${3:-}"
  local expected="${4:-0}"
  local detail="${5:-}"
  local tmp="$PROGRESS_FILE.tmp"
  jq -n \
    --arg at "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --arg mode "$MODE" \
    --arg phase "$phase" \
    --arg shard "$shard" \
    --arg generation "$generation" \
    --argjson expectedChunks "$expected" \
    --arg detail "$detail" \
    '{
      at:$at,
      mode:$mode,
      phase:$phase,
      shard:(if $shard == "" then null else ($shard | tonumber) end),
      generation:(if $generation == "" then null else $generation end),
      expectedChunks:$expectedChunks,
      detail:$detail
    }' > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$PROGRESS_FILE"
}

on_error() {
  local status="$?"
  write_progress "failed" "$TARGET_SHARD" "" 0 "snapshot manager exited with status $status" || true
  exit "$status"
}

fetch_manifest() {
  local shard="$1"
  curl --fail --silent --show-error --location --max-time 30 \
    "$BASE_URL/$NETWORK_PATH/$shard/latest.json"
}

validate_manifest() {
  local shard="$1"
  local manifest="$2"
  local now_seconds timestamp_ms timestamp_seconds age key chunk_count unique_count

  jq -e '
    type == "object"
      and (.key_base | type == "string" and length > 0)
      and (.timestamp | type == "number")
      and (.chunks | type == "array" and length > 0)
      and all(.chunks[]; type == "string")
  ' <<<"$manifest" >/dev/null || die "shard $shard returned malformed snapshot metadata"

  key="$(jq -r '.key_base' <<<"$manifest")"
  [[ "$key" =~ ^${NETWORK_PATH}/${shard}/[A-Za-z0-9._/-]+$ ]] ||
    die "shard $shard metadata contains an unexpected key path"
  [[ "$key" != *".."* ]] || die "shard $shard metadata key contains parent traversal"

  if jq -e '[.chunks[] | select(test("^chunk_[0-9]{4}\\.bin$") | not)] | length > 0' <<<"$manifest" >/dev/null; then
    die "shard $shard metadata contains an unexpected chunk name"
  fi
  chunk_count="$(jq '.chunks | length' <<<"$manifest")"
  unique_count="$(jq '.chunks | unique | length' <<<"$manifest")"
  [[ "$chunk_count" == "$unique_count" ]] ||
    die "shard $shard metadata contains duplicate chunks"

  now_seconds="${SNAPSHOT_NOW_SECONDS:-$(date +%s)}"
  [[ "$now_seconds" =~ ^[0-9]+$ ]] || die "SNAPSHOT_NOW_SECONDS must be an integer"
  timestamp_ms="$(jq -r '.timestamp | floor' <<<"$manifest")"
  timestamp_seconds=$((timestamp_ms / 1000))
  age=$((now_seconds - timestamp_seconds))
  (( age >= -MAX_FUTURE_SKEW_SECONDS )) ||
    die "shard $shard snapshot timestamp is implausibly far in the future"
  (( age <= MAX_MANIFEST_AGE_SECONDS )) ||
    die "shard $shard snapshot is $age seconds old; refusing stale bootstrap metadata"
}

download_generation() {
  local shard="$1"
  local work="$WORK_ROOT/shard-$shard"
  local download_dir="$work/chunks"
  local extract_dir="$work/extracted"
  local archive="$work/snapshot.tar"
  local metadata="$work/metadata.json"
  local chunk_list="$work/chunks.txt"
  local attempt manifest latest key count checked chunk normalized expected_hash latest_hash

  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    rm -rf "$work"
    mkdir -p "$download_dir" "$extract_dir"

    manifest="$(fetch_manifest "$shard")"
    validate_manifest "$shard" "$manifest"
    key="$(jq -r '.key_base' <<<"$manifest")"
    count="$(jq '.chunks | length' <<<"$manifest")"
    normalized="$(jq -Sc '{key_base,timestamp,chunks}' <<<"$manifest")"
    expected_hash="$(printf '%s\n' "$normalized" | sha256sum | awk '{print $1}')"
    printf '%s\n' "$manifest" > "$metadata"
    jq -r '.chunks[]' "$metadata" > "$chunk_list"
    write_progress "downloading" "$shard" "$key" "$count" "attempt $attempt of $MAX_ATTEMPTS"
    printf 'Shard %s: downloading %s chunks from %s (attempt %s/%s).\n' \
      "$shard" "$count" "$key" "$attempt" "$MAX_ATTEMPTS"

    export BASE_URL key download_dir
    if ! xargs -P "$DOWNLOAD_JOBS" -I '{}' bash -c '
      set -euo pipefail
      name="$1"
      part="$download_dir/$name.part.$$"
      trap '\''rm -f "$part"'\'' EXIT
      curl --fail --silent --show-error --location \
        --retry 5 --retry-all-errors --retry-delay 3 \
        --output "$part" "$BASE_URL/$key/$name"
      mv "$part" "$download_dir/$name"
      trap - EXIT
    ' _ '{}' < "$chunk_list"; then
      printf 'Shard %s: a chunk failed; refreshing its manifest.\n' "$shard" >&2
      continue
    fi

    write_progress "verifying" "$shard" "$key" "$count" "checking every gzip chunk"
    checked=0
    while IFS= read -r chunk; do
      gzip -t "$download_dir/$chunk"
      checked=$((checked + 1))
      if (( checked % 100 == 0 || checked == count )); then
        printf 'Shard %s: verified %s/%s chunks.\n' "$shard" "$checked" "$count"
      fi
    done < "$chunk_list"

    latest="$(fetch_manifest "$shard")"
    validate_manifest "$shard" "$latest"
    latest_hash="$(jq -Sc '{key_base,timestamp,chunks}' <<<"$latest" | sha256sum | awk '{print $1}')"
    if [[ "$latest_hash" != "$expected_hash" ]]; then
      printf 'Shard %s: generation rotated after download; retrying from fresh metadata.\n' "$shard" >&2
      continue
    fi

    write_progress "assembling" "$shard" "$key" "$count" "building the verified tar stream"
    : > "$archive"
    while IFS= read -r chunk; do
      gzip -cd "$download_dir/$chunk" >> "$archive"
    done < "$chunk_list"

    if ! tar -tf "$archive" | awk -v root="shard-$shard" -v prefix="shard-$shard/" '
      /^\// || /(^|\/)\.\.($|\/)/ { bad=1; next }
      $0 != root && index($0, prefix) != 1 { bad=1 }
      END { exit bad }
    '; then
      die "shard $shard archive contains an unexpected path"
    fi
    if tar -tvf "$archive" | awk 'substr($1,1,1) ~ /[lh]/ { bad=1 } END { exit bad }'; then
      :
    else
      die "shard $shard archive contains links"
    fi

    write_progress "extracting" "$shard" "$key" "$count" "extracting away from the live database"
    tar --no-same-owner --no-same-permissions -xf "$archive" -C "$extract_dir"
    [[ -s "$extract_dir/shard-$shard/CURRENT" ]] ||
      die "shard $shard snapshot does not contain a RocksDB CURRENT file"

    PREPARED_SHARD_DIR="$extract_dir/shard-$shard"
    PREPARED_WORK_DIR="$work"
    PREPARED_KEY="$key"
    return 0
  done

  die "shard $shard did not retain one immutable snapshot generation after $MAX_ATTEMPTS attempts"
}

install_prepared_shard() {
  local shard="$1"
  local keep_backup="${2:-false}"
  local destination="$ROCKS_DIR/shard-$shard"
  local backup="$ROCKS_DIR/shard-$shard.before-in-three-recovery"
  local marker="$STATE_DIR/shard-$shard.json"

  rm -rf "$backup"
  if [[ -e "$destination" ]]; then
    mv "$destination" "$backup"
  fi
  mv "$PREPARED_SHARD_DIR" "$destination"
  jq -n \
    --arg installedAt "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --argjson shard "$shard" \
    --arg generation "$PREPARED_KEY" \
    '{installedAt:$installedAt,shard:$shard,generation:$generation}' > "$marker"
  chmod 600 "$marker"

  if [[ "$keep_backup" != "true" ]]; then
    rm -rf "$backup"
  fi
}

bootstrap_all() {
  local shard marker

  cd "$ROOT"
  docker compose stop snapchain >/dev/null 2>&1 || true
  rm -rf "$BUILTIN_SNAPSHOT_DIR"
  mkdir -p "$BUILTIN_SNAPSHOT_DIR"

  for shard in 1 2 0; do
    marker="$STATE_DIR/shard-$shard.json"
    if [[ -s "$ROCKS_DIR/shard-$shard/CURRENT" && -s "$marker" ]]; then
      printf 'Shard %s: verified installation marker found; keeping it.\n' "$shard"
      continue
    fi
    download_generation "$shard"
    write_progress "installing" "$shard" "$PREPARED_KEY" 0 "atomic database swap"
    install_prepared_shard "$shard"
    rm -rf "$PREPARED_WORK_DIR"
    printf 'Shard %s: installed.\n' "$shard"
  done

  write_progress "starting" "" "" 0 "all three shards installed"
  if [[ "${IN_THREE_SKIP_DOCKER_START:-0}" != "1" ]]; then
    docker compose up -d snapchain
  fi
  write_progress "complete" "" "" 0 "all three shards installed; Snapchain started"
}

recovery_precondition() {
  local shard="$1"
  local info match_count delay

  info="$(curl -fsS --max-time 8 http://127.0.0.1:3381/v1/info 2>/dev/null || true)"
  [[ -z "$info" ]] && return 0
  match_count="$(jq -er --argjson shard "$shard" '[.shardInfos[]? | select(.shardId == $shard)] | length' <<<"$info" 2>/dev/null || true)"
  [[ "$match_count" =~ ^[0-9]+$ ]] || die "shard $shard readiness data is malformed"
  (( match_count == 0 )) && return 0
  (( match_count == 1 )) || die "shard $shard appears more than once in readiness data"
  delay="$(jq -er --argjson shard "$shard" '
    .shardInfos[]
    | select(.shardId == $shard)
    | .blockDelay
    | select(type == "number" and . >= 0)
  ' <<<"$info" 2>/dev/null || true)"
  [[ "$delay" =~ ^[0-9]+$ ]] || die "shard $shard readiness data is malformed"
  if (( delay < RECOVERY_DELAY_SECONDS )) && [[ "${SNAPSHOT_RECOVERY_FORCE:-0}" != "1" ]]; then
    die "shard $shard delay is ${delay}s; recovery requires at least ${RECOVERY_DELAY_SECONDS}s or SNAPSHOT_RECOVERY_FORCE=1"
  fi
}

recover_one() {
  local shard="$1"
  local destination="$ROCKS_DIR/shard-$shard"
  local backup="$ROCKS_DIR/shard-$shard.before-in-three-recovery"
  local info=""

  [[ "$shard" =~ ^[0-9]+$ ]] || die "recover requires a numeric shard ID"
  recovery_precondition "$shard"
  download_generation "$shard"

  cd "$ROOT"
  write_progress "stopping" "$shard" "$PREPARED_KEY" 0 "stopping Snapchain for atomic swap"
  docker compose stop snapchain
  install_prepared_shard "$shard" true

  rollback() {
    local status="$?"
    trap - ERR
    printf 'Shard %s failed post-swap readiness; rolling back.\n' "$shard" >&2
    docker compose stop snapchain >/dev/null 2>&1 || true
    rm -rf "$destination"
    if [[ -e "$backup" ]]; then
      mv "$backup" "$destination"
    fi
    docker compose start snapchain >/dev/null || true
    write_progress "failed" "$shard" "$PREPARED_KEY" 0 "post-swap validation failed; previous shard restored" || true
    exit "$status"
  }
  trap rollback ERR

  docker compose start snapchain
  write_progress "validating" "$shard" "$PREPARED_KEY" 0 "waiting for recovered shard state"
  for _ in $(seq 1 120); do
    info="$(curl -fsS --max-time 5 http://127.0.0.1:3381/v1/info 2>/dev/null || true)"
    if jq -e --argjson shard "$shard" --argjson maxDelay "$RECOVERY_ACCEPT_DELAY_SECONDS" '
      [.shardInfos[]? | select(.shardId == $shard)] as $matches
      | ($matches | length) == 1
        and ($matches[0].maxHeight | type == "number")
        and $matches[0].maxHeight > 1000000
        and ($matches[0].blockDelay | type == "number")
        and $matches[0].blockDelay < $maxDelay
    ' <<<"$info" >/dev/null 2>&1; then
      break
    fi
    info=""
    sleep 5
  done
  [[ -n "$info" ]] || false

  trap - ERR
  rm -rf "$backup" "$PREPARED_WORK_DIR"
  write_progress "complete" "$shard" "$PREPARED_KEY" 0 "recovered shard accepted"
  jq -c --argjson shard "$shard" '
    .shardInfos[] | select(.shardId == $shard)
    | {shardId,maxHeight,blockDelay,numMessages,numFidRegistrations}
  ' <<<"$info"
}

if [[ "$EUID" -ne 0 && "${IN_THREE_ALLOW_NON_ROOT_TEST:-0}" != "1" ]]; then
  die "run snapshot-manager as root"
fi
for command in bash curl jq gzip tar sha256sum xargs awk flock docker; do
  require_command "$command"
done
[[ "$DOWNLOAD_JOBS" =~ ^[1-9][0-9]*$ ]] || die "SNAPSHOT_DOWNLOAD_JOBS must be a positive integer"
[[ "$MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || die "SNAPSHOT_MAX_ATTEMPTS must be a positive integer"
[[ -f "$ROOT/docker-compose.yml" ]] || die "missing $ROOT/docker-compose.yml"
mkdir -p "$ROCKS_DIR" "$BUILTIN_SNAPSHOT_DIR" "$STATE_DIR" "$WORK_ROOT"
chmod 700 "$STATE_DIR" "$WORK_ROOT"
exec 9>"$STATE_DIR/manager.lock"
flock -n 9 || die "another snapshot operation is already running"
trap on_error ERR

case "$MODE" in
  bootstrap)
    TARGET_SHARD=""
    bootstrap_all
    ;;
  recover)
    [[ -n "$TARGET_SHARD" ]] || die "usage: snapshot-manager.sh recover SHARD"
    recover_one "$TARGET_SHARD"
    ;;
  *)
    die "usage: snapshot-manager.sh {bootstrap|recover SHARD}"
    ;;
esac
