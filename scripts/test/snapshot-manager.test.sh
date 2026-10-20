#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/lib/common.sh
source "$ROOT/scripts/lib/common.sh"

fail() {
  printf 'not ok - %s\n' "$*" >&2
  exit 1
}

ready_fixture='{"shardInfos":[{"shardId":0,"maxHeight":100,"blockDelay":2},{"shardId":1,"maxHeight":200,"blockDelay":3},{"shardId":2,"maxHeight":300,"blockDelay":4}]}'
missing_fixture='{"shardInfos":[{"shardId":0,"maxHeight":100,"blockDelay":2},{"shardId":1,"maxHeight":200,"blockDelay":3}]}'
lagging_fixture='{"shardInfos":[{"shardId":0,"maxHeight":100,"blockDelay":50000000},{"shardId":1,"maxHeight":200,"blockDelay":3},{"shardId":2,"maxHeight":300,"blockDelay":4}]}'
malformed_fixture='{"shardInfos":"not-an-array"}'

readiness="$(snapchain_readiness_json "$ready_fixture")"
[[ "$(jq -r '.ready' <<<"$readiness")" == "true" ]] ||
  fail "all-shard readiness rejected a synced node"
[[ "$(jq '.shards | length' <<<"$readiness")" == "3" ]] ||
  fail "all-shard readiness omitted an expected shard"

readiness="$(snapchain_readiness_json "$missing_fixture")"
[[ "$(jq -c '.missingShards' <<<"$readiness")" == "[2]" ]] ||
  fail "all-shard readiness accepted a missing shard"
[[ "$(jq -r '.ready' <<<"$readiness")" == "false" ]] ||
  fail "missing-shard readiness reported ready"

readiness="$(snapchain_readiness_json "$lagging_fixture")"
[[ "$(jq -c '.recoveryShards' <<<"$readiness")" == "[0]" ]] ||
  fail "catastrophic shard delay did not request recovery"
[[ "$(jq -r '.ready' <<<"$readiness")" == "false" ]] ||
  fail "catastrophic shard delay reported ready"

readiness="$(snapchain_readiness_json "$malformed_fixture")"
[[ "$(jq -c '.missingShards' <<<"$readiness")" == "[0,1,2]" ]] ||
  fail "malformed readiness data was not rejected"

IN_THREE_INFO_JSON="$ready_fixture" "$ROOT/deploy/snapchain-healthcheck.sh" ||
  fail "container healthcheck rejected all-shard readiness"
if IN_THREE_INFO_JSON="$missing_fixture" "$ROOT/deploy/snapchain-healthcheck.sh"; then
  fail "container healthcheck accepted a missing shard"
fi
if IN_THREE_INFO_JSON="$lagging_fixture" "$ROOT/deploy/snapchain-healthcheck.sh"; then
  fail "container healthcheck accepted a lagging shard"
fi
if IN_THREE_INFO_JSON="$malformed_fixture" "$ROOT/deploy/snapchain-healthcheck.sh"; then
  fail "container healthcheck accepted malformed data"
fi

fixture="$(mktemp -d)"
rotation_fixture=""
stale_fixture=""
recovery_fixture=""
trap 'rm -rf "$fixture" "$rotation_fixture" "$stale_fixture" "$recovery_fixture"' EXIT

make_generation() {
  local base="$1"
  local shard="$2"
  local generation="$3"
  local timestamp_ms="$4"
  local payload="$5"
  local source="$base/source-$shard-$generation"
  local parts="$base/parts-$shard-$generation"
  local destination="$base/remote/FARCASTER_NETWORK_MAINNET/$shard/$generation"
  local archive="$base/$shard-$generation.tar"
  local chunks='[]'
  local index=1
  local part name

  mkdir -p "$source/shard-$shard" "$parts" "$destination" "$base/remote/FARCASTER_NETWORK_MAINNET/$shard"
  printf 'MANIFEST-%s-%s\n' "$shard" "$payload" > "$source/shard-$shard/CURRENT"
  printf '%s\n' "$payload" > "$source/shard-$shard/data"
  tar -C "$source" -cf "$archive" "shard-$shard"
  split -b 5120 -d -a 4 "$archive" "$parts/part-"
  for part in "$parts"/part-*; do
    name="$(printf 'chunk_%04d.bin' "$index")"
    gzip -c "$part" > "$destination/$name"
    chunks="$(jq -c --arg name "$name" '. + [$name]' <<<"$chunks")"
    index=$((index + 1))
  done
  jq -n \
    --arg key "FARCASTER_NETWORK_MAINNET/$shard/$generation" \
    --argjson timestamp "$timestamp_ms" \
    --argjson chunks "$chunks" \
    '{key_base:$key,timestamp:$timestamp,chunks:$chunks}' \
    > "$base/remote/FARCASTER_NETWORK_MAINNET/$shard/$generation.json"
}

prepare_root() {
  local base="$1"
  mkdir -p "$base/root/data/rocks" "$base/bin"
  printf 'services: {}\n' > "$base/root/docker-compose.yml"
  cat > "$base/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
exit 0
DOCKER
  chmod +x "$base/bin/docker"
}

now_ms="$(($(date +%s) * 1000))"
prepare_root "$fixture"
for shard in 0 1 2; do
  make_generation "$fixture" "$shard" "stable-$shard" "$now_ms" "stable"
  cp "$fixture/remote/FARCASTER_NETWORK_MAINNET/$shard/stable-$shard.json" \
    "$fixture/remote/FARCASTER_NETWORK_MAINNET/$shard/latest.json"
done

PATH="$fixture/bin:$PATH" \
IN_THREE_ALLOW_NON_ROOT_TEST=1 \
IN_THREE_REMOTE_ROOT="$fixture/root" \
IN_THREE_DATA_DIR="$fixture/root/data" \
SNAPSHOT_BASE_URL="file://$fixture/remote" \
SNAPSHOT_DOWNLOAD_JOBS=2 \
SNAPSHOT_MAX_ATTEMPTS=1 \
IN_THREE_SKIP_DOCKER_START=1 \
  "$ROOT/deploy/snapshot-manager.sh" bootstrap >/dev/null

for shard in 0 1 2; do
  [[ -s "$fixture/root/data/rocks/shard-$shard/CURRENT" ]] ||
    fail "rotation-safe bootstrap omitted shard $shard"
  [[ -s "$fixture/root/data/snapshot-manager/shard-$shard.json" ]] ||
    fail "rotation-safe bootstrap omitted shard $shard's generation receipt"
done
[[ "$(jq -r '.phase' "$fixture/root/data/snapshot-manager/progress.json")" == "complete" ]] ||
  fail "rotation-safe bootstrap did not reach complete"

stale_fixture="$(mktemp -d)"
prepare_root "$stale_fixture"
for shard in 0 1 2; do
  make_generation "$stale_fixture" "$shard" "stale-$shard" 0 "stale"
  cp "$stale_fixture/remote/FARCASTER_NETWORK_MAINNET/$shard/stale-$shard.json" \
    "$stale_fixture/remote/FARCASTER_NETWORK_MAINNET/$shard/latest.json"
done
if PATH="$stale_fixture/bin:$PATH" \
  IN_THREE_ALLOW_NON_ROOT_TEST=1 \
  IN_THREE_REMOTE_ROOT="$stale_fixture/root" \
  IN_THREE_DATA_DIR="$stale_fixture/root/data" \
  SNAPSHOT_BASE_URL="file://$stale_fixture/remote" \
  SNAPSHOT_NOW_SECONDS=1000 \
  SNAPSHOT_MAX_MANIFEST_AGE_SECONDS=100 \
  IN_THREE_SKIP_DOCKER_START=1 \
    "$ROOT/deploy/snapshot-manager.sh" bootstrap >"$stale_fixture/output" 2>&1; then
  fail "snapshot manager accepted stale metadata"
fi
grep -F 'refusing stale bootstrap metadata' "$stale_fixture/output" >/dev/null ||
  fail "stale metadata failure was not explained"

rotation_fixture="$(mktemp -d)"
prepare_root "$rotation_fixture"
for shard in 0 1 2; do
  make_generation "$rotation_fixture" "$shard" "stable-$shard" "$now_ms" "stable"
  cp "$rotation_fixture/remote/FARCASTER_NETWORK_MAINNET/$shard/stable-$shard.json" \
    "$rotation_fixture/remote/FARCASTER_NETWORK_MAINNET/$shard/latest.json"
done
make_generation "$rotation_fixture" 1 "old-1" "$now_ms" "old"
make_generation "$rotation_fixture" 1 "new-1" "$now_ms" "new"
cp "$rotation_fixture/remote/FARCASTER_NETWORK_MAINNET/1/new-1.json" \
  "$rotation_fixture/remote/FARCASTER_NETWORK_MAINNET/1/latest.json"
printf '0\n' > "$rotation_fixture/manifest-calls"
cat > "$rotation_fixture/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
url=""
output=""
while (( $# > 0 )); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    http://*|https://*|file://*) url="$1"; shift ;;
    --max-time|--retry|--retry-delay) shift 2 ;;
    *) shift ;;
  esac
done
[[ -n "$url" ]] || exit 2
path="${url#file://}"
if [[ "$url" == */FARCASTER_NETWORK_MAINNET/1/latest.json ]]; then
  calls="$(cat "$ROTATION_CALLS")"
  printf '%s\n' "$((calls + 1))" > "$ROTATION_CALLS"
  if (( calls == 0 )); then
    path="$ROTATION_ROOT/remote/FARCASTER_NETWORK_MAINNET/1/old-1.json"
  fi
fi
if [[ -n "$output" ]]; then
  cp "$path" "$output"
else
  cat "$path"
fi
CURL
chmod +x "$rotation_fixture/bin/curl"

PATH="$rotation_fixture/bin:$PATH" \
ROTATION_CALLS="$rotation_fixture/manifest-calls" \
ROTATION_ROOT="$rotation_fixture" \
IN_THREE_ALLOW_NON_ROOT_TEST=1 \
IN_THREE_REMOTE_ROOT="$rotation_fixture/root" \
IN_THREE_DATA_DIR="$rotation_fixture/root/data" \
SNAPSHOT_BASE_URL="file://$rotation_fixture/remote" \
SNAPSHOT_DOWNLOAD_JOBS=2 \
SNAPSHOT_MAX_ATTEMPTS=2 \
IN_THREE_SKIP_DOCKER_START=1 \
  "$ROOT/deploy/snapshot-manager.sh" bootstrap >"$rotation_fixture/output" 2>&1

grep -F 'generation rotated after download' "$rotation_fixture/output" >/dev/null ||
  fail "mid-download rotation was not detected"
[[ "$(jq -r '.generation' "$rotation_fixture/root/data/snapshot-manager/shard-1.json")" == "FARCASTER_NETWORK_MAINNET/1/new-1" ]] ||
  fail "mid-download rotation did not install the refreshed generation"
grep -F 'MANIFEST-1-new' "$rotation_fixture/root/data/rocks/shard-1/CURRENT" >/dev/null ||
  fail "mid-download rotation installed stale shard data"

recovery_fixture="$(mktemp -d)"
prepare_root "$recovery_fixture"
make_generation "$recovery_fixture" 2 "recovered-2" "$now_ms" "recovered"
cp "$recovery_fixture/remote/FARCASTER_NETWORK_MAINNET/2/recovered-2.json" \
  "$recovery_fixture/remote/FARCASTER_NETWORK_MAINNET/2/latest.json"
export RECOVERY_STARTED="$recovery_fixture/started"
export RECOVERY_ROOT="$recovery_fixture"
cat > "$recovery_fixture/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$*" == *"start snapchain"* ]]; then
  : > "$RECOVERY_STARTED"
fi
exit 0
DOCKER
cat > "$recovery_fixture/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
url=""
output=""
while (( $# > 0 )); do
  case "$1" in
    --output) output="$2"; shift 2 ;;
    http://*|https://*|file://*) url="$1"; shift ;;
    --max-time|--retry|--retry-delay) shift 2 ;;
    *) shift ;;
  esac
done
if [[ "$url" == "http://127.0.0.1:3381/v1/info" ]]; then
  if [[ -f "$RECOVERY_STARTED" ]]; then
    printf '%s\n' '{"shardInfos":[{"shardId":0,"maxHeight":100,"blockDelay":2},{"shardId":1,"maxHeight":200,"blockDelay":3},{"shardId":2,"maxHeight":3000000,"blockDelay":4}]}'
  else
    printf '%s\n' '{"shardInfos":[{"shardId":0,"maxHeight":100,"blockDelay":2},{"shardId":1,"maxHeight":200,"blockDelay":3}]}'
  fi
  exit
fi
path="${url#file://}"
if [[ -n "$output" ]]; then
  cp "$path" "$output"
else
  cat "$path"
fi
CURL
chmod +x "$recovery_fixture/bin/docker" "$recovery_fixture/bin/curl"

PATH="$recovery_fixture/bin:$PATH" \
IN_THREE_ALLOW_NON_ROOT_TEST=1 \
IN_THREE_REMOTE_ROOT="$recovery_fixture/root" \
IN_THREE_DATA_DIR="$recovery_fixture/root/data" \
SNAPSHOT_BASE_URL="file://$recovery_fixture/remote" \
SNAPSHOT_DOWNLOAD_JOBS=2 \
SNAPSHOT_MAX_ATTEMPTS=1 \
  "$ROOT/deploy/snapshot-manager.sh" recover 2 >"$recovery_fixture/output" 2>&1

grep -F 'MANIFEST-2-recovered' "$recovery_fixture/root/data/rocks/shard-2/CURRENT" >/dev/null ||
  fail "missing-shard recovery did not install the verified generation"
[[ ! -e "$recovery_fixture/root/data/rocks/shard-2.before-in-three-recovery" ]] ||
  fail "successful recovery retained its rollback directory"
[[ "$(jq -r '.phase' "$recovery_fixture/root/data/snapshot-manager/progress.json")" == "complete" ]] ||
  fail "missing-shard recovery did not reach complete"

printf 'ok - readiness requires all three valid low-delay shards\n'
printf 'ok - container health matches operational readiness\n'
printf 'ok - snapshot bootstrap installs immutable per-shard generations\n'
printf 'ok - stale snapshot metadata fails closed\n'
printf 'ok - mid-download snapshot rotation refreshes before install\n'
printf 'ok - missing-shard recovery installs and validates one shard\n'
