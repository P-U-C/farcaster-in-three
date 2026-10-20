#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

quiet=false
case "${1:-}" in
  "") ;;
  --quiet) quiet=true ;;
  -h|--help)
    cat <<EOF
Usage: $IN_THREE_COMMAND proof

Capture a redacted JSON receipt and Markdown report in .state/proof/.
No cloud tokens, keys, server IDs, IP addresses, passwords, or recovery
phrases are included.
EOF
    exit 0
    ;;
  *) die "usage: $IN_THREE_COMMAND proof" ;;
esac

require_command jq
mkdir -p "$PROOF_DIR"
chmod 700 "$PROOF_DIR"

release="$(in_three_release)"
generated_at="$(utc_now)"
if [[ -s "$PROOF_EVENTS_FILE" ]]; then
  events_json="$(jq -s 'sort_by(.at)' "$PROOF_EVENTS_FILE")"
else
  events_json='[]'
fi
if [[ -s "$PROOF_JSON_FILE" ]] && jq -e . "$PROOF_JSON_FILE" >/dev/null 2>&1; then
  previous_json="$(cat "$PROOF_JSON_FILE")"
else
  previous_json='{}'
fi

provision_json="$(jq -c '
  ([.[] | select(.event == "provision_complete")] | last | .details) // {}
' <<<"$events_json")"
client_event_json="$(jq -c '
  ([.[] | select(.event == "client_live")] | last | .details) // {}
' <<<"$events_json")"
lifecycle_json="$(jq -c '
  def first_at($name): [.[] | select(.event == $name)] | first | .at // null;
  def last_at($name): [.[] | select(.event == $name)] | last | .at // null;
  {
    provisionStartedAt: first_at("provision_started"),
    provisionedAt: last_at("provision_complete"),
    nodeStartedAt: first_at("node_started"),
    nodeReadyAt: first_at("node_ready"),
    clientLiveAt: last_at("client_live"),
    destroyStartedAt: last_at("destroy_started"),
    destroyedAt: last_at("destroy_complete")
  }
' <<<"$events_json")"

node_json="$(jq -c '.node // {observed:false}' <<<"$previous_json")"
client_json="$(jq -c '.client // {observed:false}' <<<"$previous_json")"
writes_json="$(jq -c '.writes // []' <<<"$previous_json")"
live_state=false

if [[ -f "$STATE_FILE" ]]; then
  live_state=true
  load_state

  info="$(remote "curl -fsS --max-time 10 http://127.0.0.1:3381/v1/info" 2>/dev/null || true)"
  if [[ -n "$info" ]] && jq -e 'type == "object"' <<<"$info" >/dev/null 2>&1; then
    readiness="$(snapchain_readiness_json "$info" 2>/dev/null || true)"
    node_json="$(jq -c \
      --arg at "$generated_at" \
      --argjson readiness "${readiness:-null}" \
      '{
        observed:true,
        observedAt:$at,
        currentlyReachable:true,
        operationallyReady:($readiness.ready // false),
        expectedShards:[0,1,2],
        missingShards:($readiness.missingShards // [0,1,2]),
        recoveryShards:($readiness.recoveryShards // []),
        version:(.version // "unknown"),
        numShards:(.numShards // null),
        dbApproxBytes:(.dbStats.approxSize // null),
        shardStatus:[
          (.shardInfos // [])[] |
          {
            shardId:(.shardId // null),
            blockDelay:(.blockDelay // null),
            maxBlockHeight:(.maxHeight // .maxBlockHeight // null)
          }
        ]
      }' <<<"$info")"

    disk_line="$(remote "df -B1 --output=size,used,avail,pcent /srv/in-three | tail -1" 2>/dev/null || true)"
    read -r disk_size disk_used disk_available disk_percent <<<"$disk_line"
    if [[ "${disk_size:-}" =~ ^[0-9]+$ ]] &&
      [[ "${disk_used:-}" =~ ^[0-9]+$ ]] &&
      [[ "${disk_available:-}" =~ ^[0-9]+$ ]]; then
      node_json="$(jq -c         --argjson size "$disk_size"         --argjson used "$disk_used"         --argjson available "$disk_available"         --arg percent "${disk_percent:-unknown}"         '. + {disk:{sizeBytes:$size,usedBytes:$used,availableBytes:$available,usedPercent:$percent}}'         <<<"$node_json")"
    fi
  else
    node_json="$(jq -c --arg at "$generated_at" '
      . + {lastCheckedAt:$at,currentlyReachable:false}
    ' <<<"$node_json")"
  fi

  if curl -fsS --max-time 10 "https://$CLIENT_DOMAIN/api/health" >/dev/null 2>&1; then
    client_json="$(jq -cn       --arg at "$generated_at"       --argjson details "$client_event_json"       '{
        observed:true,
        observedAt:$at,
        currentlyReachable:true,
        urlRedacted:"https://<server>.sslip.io",
        fid:($details.fid // null),
        keyAddMessageHash:($details.keyAddMessageHash // null)
      }')"
  else
    client_json="$(jq -c --arg at "$generated_at" '
      . + {lastCheckedAt:$at,currentlyReachable:false}
    ' <<<"$client_json")"
  fi

  raw_writes="$(
    remote "cd /srv/in-three && sudo docker compose logs --no-color client 2>/dev/null | sed -n 's/^.*IN_THREE_RECEIPT //p'"       2>/dev/null || true
  )"
  if [[ -n "$raw_writes" ]]; then
    captured_writes="$(
      printf '%s\n' "$raw_writes" |
        jq -R 'fromjson?' |
        jq -s 'map(select(
          (.event == "message_submitted") and
          (.hash | type == "string") and
          (.action | type == "string")
        ))'
    )"
    writes_json="$(jq -cn       --argjson previous "$writes_json"       --argjson captured "$captured_writes"       '$previous + $captured | unique_by(.action + ":" + .hash) | sort_by(.at)')"
  fi
fi

receipt_tmp="$(mktemp "$PROOF_DIR/latest.XXXXXX")"
jq -n   --arg generatedAt "$generated_at"   --arg release "$release"   --arg source "https://github.com/P-U-C/farcaster-in-three/tree/v$release"   --argjson liveState "$live_state"   --argjson events "$events_json"   --argjson lifecycle "$lifecycle_json"   --argjson infrastructure "$provision_json"   --argjson node "$node_json"   --argjson client "$client_json"   --argjson writes "$writes_json"   '{
    schemaVersion:1,
    generatedAt:$generatedAt,
    release:$release,
    source:$source,
    liveStateAvailable:$liveState,
    lifecycle:$lifecycle,
    infrastructure:$infrastructure,
    node:$node,
    client:$client,
    writes:$writes,
    timeline:$events,
    interpretation:{
      nodeReady:"Shard IDs 0, 1, and 2 must each exist, report valid heights, and have blockDelay below 30 seconds.",
      writeReceipt:"A message hash proves the owned node accepted a signed message for relay; reading it back proves inclusion.",
      redaction:"Cloud tokens, private keys, recovery phrases, passwords, server IDs, IP addresses, and raw environment files are excluded."
    }
  }' > "$receipt_tmp"
chmod 600 "$receipt_tmp"
mv "$receipt_tmp" "$PROOF_JSON_FILE"

value_or_pending() {
  local filter="$1"
  local value
  value="$(jq -r "$filter // empty" "$PROOF_JSON_FILE")"
  if [[ -n "$value" && "$value" != "null" ]]; then
    printf '%s' "$value"
  else
    printf 'not recorded'
  fi
}

format_gib() {
  local bytes="$1"
  if [[ "$bytes" =~ ^[0-9]+$ ]]; then
    awk -v bytes="$bytes" 'BEGIN { printf "%.1f GiB", bytes / 1073741824 }'
  else
    printf 'not recorded'
  fi
}

server_type="$(value_or_pending '.infrastructure.serverType')"
location="$(value_or_pending '.infrastructure.location')"
volume_gib="$(value_or_pending '.infrastructure.volumeGiB')"
cost_hourly="$(value_or_pending '.infrastructure.costEstimate.totalHourlyEstimate')"
cost_monthly="$(value_or_pending '.infrastructure.costEstimate.totalMonthly')"
cost_currency="$(value_or_pending '.infrastructure.costEstimate.currency')"
provisioned_at="$(value_or_pending '.lifecycle.provisionedAt')"
node_ready_at="$(value_or_pending '.lifecycle.nodeReadyAt')"
client_live_at="$(value_or_pending '.lifecycle.clientLiveAt')"
destroyed_at="$(value_or_pending '.lifecycle.destroyedAt')"
node_version="$(value_or_pending '.node.version')"
db_bytes="$(jq -r '.node.dbApproxBytes // empty' "$PROOF_JSON_FILE")"
disk_used="$(jq -r '.node.disk.usedBytes // empty' "$PROOF_JSON_FILE")"
max_delay="$(jq -r '[.node.shardStatus[]?.blockDelay | numbers] | max // empty' "$PROOF_JSON_FILE")"
fid="$(value_or_pending '.client.fid')"
key_add_hash="$(value_or_pending '.client.keyAddMessageHash')"
write_count="$(jq '.writes | length' "$PROOF_JSON_FILE")"

report_tmp="$(mktemp "$PROOF_DIR/report.XXXXXX")"
{
  printf '# In Three run receipt\n\n'
  printf 'Generated from local and owned-node observations at %s.\n\n' "$generated_at"
  printf '## Release\n\n'
  printf -- '- Version: %s\n' "$release"
  printf -- '- Source: %s\n\n' "https://github.com/P-U-C/farcaster-in-three/tree/v$release"
  printf '## Infrastructure\n\n'
  printf -- '- Provisioned: %s\n' "$provisioned_at"
  printf -- '- Plan: %s in %s, %s GiB data volume\n' "$server_type" "$location" "$volume_gib"
  if [[ "$cost_hourly" != "not recorded" && "$cost_monthly" != "not recorded" ]]; then
    printf -- '- Provider quote: ~%.4f %s/hour; %.2f %s/month gross\n' \
      "$cost_hourly" "$cost_currency" "$cost_monthly" "$cost_currency"
  else
    printf -- '- Provider quote: not recorded\n'
  fi
  printf -- '- Server identifiers and addresses: redacted\n\n'
  printf '## Snapchain\n\n'
  printf -- '- Ready: %s\n' "$node_ready_at"
  printf -- '- Version: %s\n' "$node_version"
  if [[ -n "$max_delay" ]]; then
    printf -- '- Maximum observed shard delay: %s seconds\n' "$max_delay"
  else
    printf -- '- Maximum observed shard delay: not recorded\n'
  fi
  printf -- '- Database: %s\n' "$(format_gib "$db_bytes")"
  printf -- '- Disk used: %s\n\n' "$(format_gib "$disk_used")"
  printf '## Client\n\n'
  printf -- '- Live: %s\n' "$client_live_at"
  printf -- '- FID: %s\n' "$fid"
  printf -- '- Gasless KEY_ADD message: %s\n' "$key_add_hash"
  printf -- '- Accepted write receipts: %s\n' "$write_count"
  if (( write_count > 0 )); then
    jq -r '.writes[] | "- " + .action + " " + .hash + " at " + .at' "$PROOF_JSON_FILE"
  fi
  printf '\n## Teardown\n\n'
  printf -- '- Resources deleted: %s\n\n' "$destroyed_at"
  printf '## Scope\n\n'
  printf 'A write receipt means the owned read node accepted the signed message for relay. '
  printf 'The public test report must also show that the message was read back from synced state and appeared in another client.\n\n'
  printf 'This report excludes cloud tokens, private keys, recovery phrases, passwords, server IDs, IP addresses, and raw environment files.\n'
} > "$report_tmp"
chmod 600 "$report_tmp"
mv "$report_tmp" "$PROOF_REPORT_FILE"

if [[ "$quiet" != true ]]; then
  success "Redacted run receipt updated"
  printf '  JSON      %s\n' "$PROOF_JSON_FILE"
  printf '  Markdown  %s\n' "$PROOF_REPORT_FILE"
  printf '  writes    %s accepted message hash(es)\n' "$write_count"
  if [[ "$destroyed_at" != "not recorded" ]]; then
    printf '  teardown  recorded at %s\n' "$destroyed_at"
  elif [[ "$live_state" == true ]]; then
    printf '  teardown  not yet recorded\n'
  fi
fi
