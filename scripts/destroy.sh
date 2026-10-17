#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
load_state

[[ "${PROVIDER:-}" == "hcloud" ]] || die "automatic destroy only supports Hetzner"
require_command curl

if [[ -z "${HCLOUD_TOKEN:-}" ]]; then
  [[ -t 0 ]] || die "HCLOUD_TOKEN is required in non-interactive mode"
  read -r -s -p "Hetzner Cloud API token: " HCLOUD_TOKEN
  printf '\n'
fi

printf 'This deletes server %s and its entire Snapchain database.\n' "$SERVER_ID"
read -r -p "Type DESTROY to continue: " confirmation
[[ "$confirmation" == "DESTROY" ]] || die "destroy cancelled"

api_delete() {
  local path="$1"
  local status
  status="$(curl -sS -o /tmp/in-three-delete-response -w '%{http_code}'     --max-time 45 -X DELETE     -H "Authorization: Bearer $HCLOUD_TOKEN"     "https://api.hetzner.cloud/v1$path")"
  [[ "$status" == "204" || "$status" == "200" || "$status" == "404" ]] ||
    die "delete $path failed with HTTP $status"
}

note "Deleting server"
api_delete "/servers/$SERVER_ID"

for attempt in $(seq 1 30); do
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15     -H "Authorization: Bearer $HCLOUD_TOKEN"     "https://api.hetzner.cloud/v1/volumes/$VOLUME_ID")"
  [[ "$status" == "200" ]] || break
  sleep 2
done

note "Deleting volume, firewall, and SSH key"
api_delete "/volumes/$VOLUME_ID"
api_delete "/firewalls/$FIREWALL_ID"
api_delete "/ssh_keys/$SSH_KEY_ID"

rm -f "$SSH_KEY" "$SSH_KEY.pub" "$STATE_FILE" /tmp/in-three-delete-response
success "All provisioned resources were deleted"
