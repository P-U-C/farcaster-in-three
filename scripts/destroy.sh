#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
load_state

if [[ "${PROVIDER:-}" == "existing" ]]; then
  printf 'This stops In Three on %s. The machine and /srv/in-three data are retained.\n' "$SERVER_IP"
  read -r -p "Type STOP to continue: " confirmation
  [[ "$confirmation" == "STOP" ]] || die "stop cancelled"

  record_proof_event "destroy_started" '{"provider":"existing"}'
  "$IN_THREE_ROOT/scripts/proof.sh" --quiet ||
    note "Could not refresh the pre-stop receipt; shutdown will continue"
  note "Stopping In Three services"
  remote "cd /srv/in-three && sudo -n docker compose down"
  record_proof_event "destroy_complete" \
    '{"providerResourcesDeleted":false,"servicesStopped":true,"hostRetained":true,"dataRetained":true}'
  "$IN_THREE_ROOT/scripts/proof.sh" --quiet || true
  success "In Three stopped; your machine and data were retained"
  printf '  data           /srv/in-three\n'
  printf '  proof receipt  %s\n' "$PROOF_REPORT_FILE"
  exit 0
fi

[[ "${PROVIDER:-}" == "hcloud" ]] || die "unsupported provider in state: ${PROVIDER:-missing}"
require_command curl
require_command jq

if [[ -z "${HCLOUD_TOKEN:-}" ]]; then
  [[ -t 0 ]] || die "HCLOUD_TOKEN is required in non-interactive mode"
  read -r -s -p "Hetzner Cloud API token: " HCLOUD_TOKEN
  printf '\n'
fi

printf 'This deletes server %s and its entire Snapchain database.\n' "$SERVER_ID"
read -r -p "Type DESTROY to continue: " confirmation
[[ "$confirmation" == "DESTROY" ]] || die "destroy cancelled"

record_proof_event "destroy_started" '{}'
"$IN_THREE_ROOT/scripts/proof.sh" --quiet ||
  note "Could not refresh the pre-teardown receipt; deletion will continue"

api_delete() {
  local path="$1"
  hcloud_delete_with_retry "$path" || die "delete $path did not complete"
}

note "Deleting server"
api_delete "/servers/$SERVER_ID"

for ((attempt = 1; attempt <= 30; attempt++)); do
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15     -H "Authorization: Bearer $HCLOUD_TOKEN"     "https://api.hetzner.cloud/v1/volumes/$VOLUME_ID")"
  [[ "$status" == "200" ]] || break
  sleep 2
done

note "Deleting volume, firewall, and SSH key"
api_delete "/volumes/$VOLUME_ID"
api_delete "/firewalls/$FIREWALL_ID"
api_delete "/ssh_keys/$SSH_KEY_ID"

rm -f "$SSH_KEY" "$SSH_KEY.pub" "$STATE_FILE"
record_proof_event "destroy_complete" '{"providerResourcesDeleted":true}'
"$IN_THREE_ROOT/scripts/proof.sh" --quiet || true
success "All provisioned resources were deleted"
printf '  proof receipt  %s\n' "$PROOF_REPORT_FILE"
