#!/usr/bin/env bash
set -euo pipefail

MAX_DELAY="${SNAPCHAIN_READY_DELAY_SECONDS:-30}"
[[ "$MAX_DELAY" =~ ^[1-9][0-9]*$ ]] || exit 1

if [[ -n "${IN_THREE_INFO_JSON:-}" ]]; then
  body="$IN_THREE_INFO_JSON"
else
  exec 3<>/dev/tcp/127.0.0.1/3381
  printf 'GET /v1/info HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n' >&3
  response="$(cat <&3)"
  exec 3>&-
  status_line="${response%%$'\r\n'*}"
  [[ "$status_line" == *" 200 "* ]] || exit 1
  body="${response#*$'\r\n\r\n'}"
fi

compact="$(printf '%s' "$body" | tr -d '[:space:]')"
for shard in 0 1 2; do
  matches="$(grep -o "\"shardId\":${shard}[^}]*" <<<"$compact" || true)"
  [[ "$(wc -l <<<"$matches" | tr -d ' ')" == "1" ]] || exit 1
  object="$matches"
  height="$(sed -n 's/.*"maxHeight":\([0-9][0-9]*\).*/\1/p' <<<"$object")"
  delay="$(sed -n 's/.*"blockDelay":\([0-9][0-9]*\).*/\1/p' <<<"$object")"
  [[ "$height" =~ ^[0-9]+$ && "$delay" =~ ^[0-9]+$ ]] || exit 1
  (( delay < MAX_DELAY )) || exit 1
done
