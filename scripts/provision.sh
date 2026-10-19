#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
# shellcheck source=scripts/lib/cloud-init.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/cloud-init.sh"

LOCATION="ash"
SERVER_TYPE="ccx33"
VOLUME_SIZE=2048
NAME="in-three"
SOURCE_CIDR=""
ASSUME_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --location) LOCATION="$2"; shift 2 ;;
    --server-type) SERVER_TYPE="$2"; shift 2 ;;
    --volume-size) VOLUME_SIZE="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --source-cidr) SOURCE_CIDR="$2"; shift 2 ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help)
      cat <<EOF
Usage: $IN_THREE_COMMAND provision [options]

Options:
  --location CODE       Hetzner location (default: ash)
  --server-type TYPE    Hetzner server type (default: ccx33)
  --volume-size GIB     Data volume size (default: 2048)
  --source-cidr CIDR    CIDR allowed to SSH (default: your current public IP)
  --name NAME           Resource name prefix (default: in-three)
  --yes                 Skip the confirmation prompt

Set HCLOUD_TOKEN or enter it at the hidden prompt.
EOF
      exit 0
      ;;
    *) die "unknown provision option: $1" ;;
  esac
done

for command in curl jq ssh ssh-keygen openssl; do
  require_command "$command"
done

[[ "$VOLUME_SIZE" =~ ^[0-9]+$ ]] || die "--volume-size must be an integer"
(( VOLUME_SIZE >= 1536 )) || die "Snapchain requires at least 1.5 TiB; use --volume-size 1536 or larger"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
[[ ! -f "$STATE_FILE" ]] || die "a host is already provisioned; run $IN_THREE_COMMAND destroy first"

if [[ -z "${HCLOUD_TOKEN:-}" ]]; then
  [[ -t 0 ]] || die "HCLOUD_TOKEN is required in non-interactive mode"
  read -r -s -p "Hetzner Cloud API token: " HCLOUD_TOKEN
  printf '\n'
fi
[[ -n "$HCLOUD_TOKEN" ]] || die "empty Hetzner token"

ssh_key_id=""
volume_id=""
firewall_id=""
server_id=""
completed=false

cleanup_partial() {
  local status=$?
  local cleanup_ok=true
  trap - EXIT
  if [[ "$completed" != true && $status -ne 0 ]]; then
    note "Provisioning failed; removing partial billable resources"
    [[ -z "$server_id" ]] || hcloud_delete_with_retry "/servers/$server_id" || cleanup_ok=false
    [[ -z "$volume_id" ]] || hcloud_delete_with_retry "/volumes/$volume_id" || cleanup_ok=false
    [[ -z "$firewall_id" ]] || hcloud_delete_with_retry "/firewalls/$firewall_id" || cleanup_ok=false
    [[ -z "$ssh_key_id" ]] || hcloud_delete_with_retry "/ssh_keys/$ssh_key_id" || cleanup_ok=false
    rm -f "$STATE_FILE" "$STATE_DIR/id_ed25519" "$STATE_DIR/id_ed25519.pub"
    [[ "$cleanup_ok" == true ]] || note "One or more partial resources could not be removed; inspect the provider console"
    record_proof_event "provision_failed" "$(jq -cn \
      --argjson exitCode "$status" \
      --argjson partialResourcesRemoved "$cleanup_ok" \
      '{exitCode:$exitCode,partialResourcesRemoved:$partialResourcesRemoved}')" || true
  fi
  exit "$status"
}
trap cleanup_partial EXIT

if [[ -z "$SOURCE_CIDR" ]]; then
  public_ip="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
  [[ "$public_ip" =~ ^[0-9a-fA-F:.]+$ ]] || die "could not detect your public IP; pass --source-cidr"
  if [[ "$public_ip" == *:* ]]; then
    SOURCE_CIDR="$public_ip/128"
  else
    SOURCE_CIDR="$public_ip/32"
  fi
fi

server_type_json="$(hcloud_api GET "/server_types?name=$SERVER_TYPE")" ||
  die "Hetzner rejected the token or server type"
cores="$(jq -r '.server_types[0].cores // empty' <<<"$server_type_json")"
memory="$(jq -r '.server_types[0].memory // empty' <<<"$server_type_json")"
[[ -n "$cores" && -n "$memory" ]] || die "server type $SERVER_TYPE was not found"
pricing_json="$(hcloud_api GET /pricing)" || die "could not read the Hetzner price list"
cost_estimate_json="$(hcloud_cost_estimate \
  "$server_type_json" \
  "$pricing_json" \
  "$LOCATION" \
  "$VOLUME_SIZE")" || die "could not price $SERVER_TYPE in $LOCATION"

printf '\nIN THREE / COMPUTE PLAN\n'
printf '  region       %s\n' "$LOCATION"
printf '  compute      %s (%s vCPU, %s GiB RAM)\n' "$SERVER_TYPE" "$cores" "$memory"
printf '  data         %s GiB cloud block volume\n' "$VOLUME_SIZE"
printf '  ingress      SSH from %s; HTTPS and gossip public\n' "$SOURCE_CIDR"
printf '  protocol     no hosted Farcaster API keys\n'
printf '  estimate     ~%s %s/hour; %s / 12h; %s / 24h; %s / month gross\n\n' \
  "$(jq -r '.totalHourlyEstimate * 10000 | round / 10000' <<<"$cost_estimate_json")" \
  "$(jq -r '.currency' <<<"$cost_estimate_json")" \
  "$(jq -r '.total12Hours * 100 | round / 100' <<<"$cost_estimate_json")" \
  "$(jq -r '.total24Hours * 100 | round / 100' <<<"$cost_estimate_json")" \
  "$(jq -r '.totalMonthly * 100 | round / 100' <<<"$cost_estimate_json")"

if [[ "$ASSUME_YES" != true ]]; then
  read -r -p "Type PROVISION to create billable resources: " confirmation
  [[ "$confirmation" == "PROVISION" ]] || die "provisioning cancelled"
fi

record_proof_event "provision_started" "$(jq -cn \
  --arg location "$LOCATION" \
  --arg serverType "$SERVER_TYPE" \
  --argjson volumeGiB "$VOLUME_SIZE" \
  --argjson costEstimate "$cost_estimate_json" \
  '{
    location:$location,
    serverType:$serverType,
    volumeGiB:$volumeGiB,
    costEstimate:$costEstimate
  }')"

suffix="$(openssl rand -hex 3)"
resource_name="$NAME-$suffix"
ssh_key="$STATE_DIR/id_ed25519"
ssh-keygen -q -t ed25519 -N "" -C "$resource_name" -f "$ssh_key"
chmod 600 "$ssh_key"
public_key="$(cat "$ssh_key.pub")"

note "Checking quota by creating the $VOLUME_SIZE GiB data volume first"
if ! volume_response="$(hcloud_api POST /volumes "$(jq -n   --arg name "$resource_name-data"   --arg location "$LOCATION"   --argjson size "$VOLUME_SIZE"   '{name:$name, location:$location, size:$size, format:"ext4", labels:{"managed-by":"in-three"}}')")"; then
  printf 'The project must allow at least %s GiB of total Volume storage.\n' "$VOLUME_SIZE" >&2
  printf 'Request at least 2,500 GiB of Volume quota in Hetzner Console, then rerun this command.\n' >&2
  exit 1
fi
volume_id="$(jq -r '.volume.id' <<<"$volume_response")"

note "Registering an isolated SSH key"
ssh_response="$(hcloud_api POST /ssh_keys "$(jq -n   --arg name "$resource_name"   --arg public_key "$public_key"   '{name:$name, public_key:$public_key, labels:{"managed-by":"in-three"}}')")"
ssh_key_id="$(jq -r '.ssh_key.id' <<<"$ssh_response")"

note "Applying least-exposure firewall rules"
firewall_response="$(hcloud_api POST /firewalls "$(jq -n   --arg name "$resource_name"   --arg source "$SOURCE_CIDR"   '{
    name:$name,
    labels:{"managed-by":"in-three"},
    rules:[
      {direction:"in",protocol:"tcp",port:"22",source_ips:[$source]},
      {direction:"in",protocol:"tcp",port:"80",source_ips:["0.0.0.0/0","::/0"]},
      {direction:"in",protocol:"tcp",port:"443",source_ips:["0.0.0.0/0","::/0"]},
      {direction:"in",protocol:"udp",port:"443",source_ips:["0.0.0.0/0","::/0"]},
      {direction:"in",protocol:"udp",port:"3382",source_ips:["0.0.0.0/0","::/0"]}
    ]
  }')")"
firewall_id="$(jq -r '.firewall.id' <<<"$firewall_response")"

cloud_init="$(render_cloud_init "$public_key" "$volume_id")"

note "Creating the Snapchain host"
server_response="$(hcloud_api POST /servers "$(jq -n   --arg name "$resource_name"   --arg type "$SERVER_TYPE"   --arg location "$LOCATION"   --arg user_data "$cloud_init"   --argjson ssh_key "$ssh_key_id"   --argjson firewall "$firewall_id"   '{
    name:$name,
    server_type:$type,
    image:"ubuntu-24.04",
    location:$location,
    ssh_keys:[$ssh_key],
    firewalls:[{firewall:$firewall}],
    user_data:$user_data,
    start_after_create:true,
    public_net:{enable_ipv4:true,enable_ipv6:true},
    labels:{"managed-by":"in-three"}
  }')")"
server_id="$(jq -r '.server.id' <<<"$server_response")"
server_ip="$(jq -r '.server.public_net.ipv4.ip' <<<"$server_response")"
[[ -n "$server_id" && -n "$server_ip" ]] || die "server creation returned no server ID or IP"

note "Attaching the data volume"
hcloud_api POST "/volumes/$volume_id/actions/attach" "$(jq -n --argjson server "$server_id" '{server:$server, automount:false}')" >/dev/null

domain="${server_ip//./-}.sslip.io"
cat > "$STATE_FILE" <<EOF
PROVIDER=hcloud
SERVER_ID=$server_id
SERVER_IP=$server_ip
SSH_USER=inthree
SSH_KEY=$ssh_key
SSH_KEY_ID=$ssh_key_id
VOLUME_ID=$volume_id
FIREWALL_ID=$firewall_id
CLIENT_DOMAIN=$domain
LOCATION=$LOCATION
SERVER_TYPE=$SERVER_TYPE
VOLUME_SIZE=$VOLUME_SIZE
EOF
chmod 600 "$STATE_FILE"

note "Waiting for cloud-init and the mounted data disk"
load_state
wait_for_ssh 72 || die "server exists at $server_ip but SSH did not become ready"
for ((attempt = 1; attempt <= 72; attempt++)); do
  if remote "sudo test -f /var/lib/cloud/instance/in-three-ready" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
remote "sudo test -f /var/lib/cloud/instance/in-three-ready" ||
  die "cloud-init did not finish; partial resources will be removed"

completed=true
record_proof_event "provision_complete" "$(jq -cn \
  --arg location "$LOCATION" \
  --arg serverType "$SERVER_TYPE" \
  --argjson volumeGiB "$VOLUME_SIZE" \
  --argjson costEstimate "$cost_estimate_json" \
  --arg sourceCidrRestricted "true" \
  '{
    location:$location,
    serverType:$serverType,
    volumeGiB:$volumeGiB,
    sourceCidrRestricted:($sourceCidrRestricted == "true"),
    costEstimate:$costEstimate
  }')"
success "Compute is ready at $server_ip"
printf '  client URL   https://%s (activated by command 2)\n' "$domain"
printf '  local state  %s\n' "$STATE_FILE"
printf '\nNext: %s node up\n' "$IN_THREE_COMMAND"
