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
SSH_PROXY_JUMP=""
PROVISION_MODE=""
EXISTING_TARGET=""
EXISTING_KEY=""
CLIENT_DOMAIN_OVERRIDE=""
ASSUME_YES=false

select_mode() {
  local requested="$1"
  if [[ -n "$PROVISION_MODE" && "$PROVISION_MODE" != "$requested" ]]; then
    die "choose either --host or --hetzner, not both"
  fi
  PROVISION_MODE="$requested"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) select_mode existing; EXISTING_TARGET="$2"; shift 2 ;;
    --ssh-key) EXISTING_KEY="$2"; shift 2 ;;
    --domain) CLIENT_DOMAIN_OVERRIDE="$2"; shift 2 ;;
    --hetzner) select_mode hcloud; shift ;;
    --location) LOCATION="$2"; shift 2 ;;
    --server-type) SERVER_TYPE="$2"; shift 2 ;;
    --volume-size) VOLUME_SIZE="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --source-cidr) SOURCE_CIDR="$2"; shift 2 ;;
    --ssh-proxy) SSH_PROXY_JUMP="$2"; shift 2 ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help)
      cat <<EOF
Usage: $IN_THREE_COMMAND provision [--host USER@HOST | --hetzner] [options]

Use an Ubuntu machine you already own, or add --hetzner to create one.
Without either flag, the command asks which path to use.

Existing-machine options:
  --host USER@HOST      Existing SSH target
  --ssh-key PATH        SSH private key (default: ~/.ssh/id_ed25519)
  --domain HOSTNAME     Public hostname (IPv4 defaults to sslip.io)
  --ssh-proxy HOST      Reach the machine through this SSH jump host

Optional Hetzner options:
  --hetzner             Create a Hetzner server and 2 TiB volume
  --location CODE       Hetzner location (default: ash)
  --server-type TYPE    Hetzner server type (default: ccx33)
  --volume-size GIB     Data volume size (default: 2048)
  --source-cidr CIDR    CIDR allowed to SSH (default: detected)
  --name NAME           Resource name prefix (default: in-three)

Shared options:
  --yes                 Skip confirmation after the target is shown

Hetzner requires HCLOUD_TOKEN or asks for it at a hidden prompt.
EOF
      exit 0
      ;;
    *) die "unknown provision option: $1" ;;
  esac
done

if [[ -z "$PROVISION_MODE" ]]; then
  [[ -t 0 ]] || die "non-interactive setup requires --host USER@HOST or --hetzner"
  read -r -p "Existing SSH host (USER@HOST), or type HETZNER: " target_answer
  if [[ "$target_answer" == [Hh][Ee][Tt][Zz][Nn][Ee][Rr] ]]; then
    PROVISION_MODE="hcloud"
  else
    [[ -n "$target_answer" ]] || die "enter an SSH host or HETZNER"
    PROVISION_MODE="existing"
    EXISTING_TARGET="$target_answer"
  fi
fi

for command in jq ssh; do
  require_command "$command"
done

if [[ -n "$SSH_PROXY_JUMP" ]]; then
  [[ "$SSH_PROXY_JUMP" =~ ^[A-Za-z0-9][A-Za-z0-9._@:-]*$ ]] ||
    die "--ssh-proxy must be an SSH host, alias, or user@host without spaces"
fi

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
[[ ! -f "$STATE_FILE" ]] || die "a host is already provisioned; run $IN_THREE_COMMAND destroy first"

provision_existing_host() {
  local target_user target_host key_directory resource_line cpu_count memory_kib
  local disk_line disk_size disk_available volume_gib domain

  [[ -n "$EXISTING_TARGET" ]] || die "--host requires USER@HOST"
  [[ "$EXISTING_TARGET" =~ ^([A-Za-z_][A-Za-z0-9_-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$ ]] ||
    die "--host must be USER@HOST or HOST without spaces"

  if [[ "$EXISTING_TARGET" == *@* ]]; then
    target_user="${EXISTING_TARGET%@*}"
    target_host="${EXISTING_TARGET#*@}"
  else
    target_user="${USER:-$(id -un)}"
    target_host="$EXISTING_TARGET"
  fi
  [[ "$target_user" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] ||
    die "SSH user contains unsupported characters"

  if [[ -z "$EXISTING_KEY" ]]; then
    if [[ -t 0 ]]; then
      read -r -p "SSH private key [~/.ssh/id_ed25519]: " EXISTING_KEY
    fi
    EXISTING_KEY="${EXISTING_KEY:-~/.ssh/id_ed25519}"
  fi
  EXISTING_KEY="${EXISTING_KEY/#\~/$HOME}"
  [[ "$EXISTING_KEY" =~ ^[A-Za-z0-9_./-]+$ ]] ||
    die "--ssh-key must use a path without spaces or shell metacharacters"
  [[ -r "$EXISTING_KEY" ]] || die "SSH private key is not readable: $EXISTING_KEY"
  key_directory="$(cd "$(dirname "$EXISTING_KEY")" && pwd)"
  SSH_KEY="$key_directory/$(basename "$EXISTING_KEY")"

  if [[ -n "$CLIENT_DOMAIN_OVERRIDE" ]]; then
    [[ "$CLIENT_DOMAIN_OVERRIDE" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]] ||
      die "--domain must be a hostname without a scheme or path"
    domain="$CLIENT_DOMAIN_OVERRIDE"
  elif [[ "$target_host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    domain="${target_host//./-}.sslip.io"
  elif [[ "$target_host" == *.* ]]; then
    domain="$target_host"
  else
    die "--domain is required when --host is not a public IPv4 address or hostname"
  fi

  SERVER_IP="$target_host"
  SSH_USER="$target_user"
  SSH_PROXY_JUMP="${SSH_PROXY_JUMP:-}"

  printf '\nIN THREE / EXISTING MACHINE\n'
  printf '  SSH target   %s@%s\n' "$SSH_USER" "$SERVER_IP"
  printf '  client URL   https://%s\n' "$domain"
  printf '  disk needed  at least 2 TB free\n'
  printf '  network      TCP 80/443 and UDP 443/3382 public\n'
  printf '  changes      Docker and In Three files under /srv/in-three\n\n'

  if [[ "$ASSUME_YES" != true ]]; then
    read -r -p "Type CONNECT to prepare this machine: " confirmation
    [[ "$confirmation" == "CONNECT" ]] || die "provisioning cancelled"
  fi

  record_proof_event "provision_started" '{"provider":"existing"}'
  note "Connecting to the existing machine"
  wait_for_ssh 1 || die "could not reach $SSH_USER@$SERVER_IP with $SSH_KEY"
  remote "sudo -n true" >/dev/null 2>&1 ||
    die "$SSH_USER needs passwordless sudo on the existing machine"

  if ! remote "sudo -n docker compose version" >/dev/null 2>&1; then
    note "Installing Docker, Compose, curl, and jq"
    remote "command -v apt-get >/dev/null && sudo -n apt-get update && sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 curl jq ca-certificates" ||
      die "automatic Docker installation failed; install Docker Compose and rerun"
    remote "sudo -n systemctl enable --now docker" ||
      die "Docker was installed but could not be started"
  fi

  remote "command -v curl >/dev/null && command -v jq >/dev/null && sudo -n docker compose version >/dev/null" ||
    die "the machine needs curl, jq, Docker, and Docker Compose"
  if ! remote "sudo -n docker info" >/dev/null 2>&1; then
    remote "sudo -n systemctl enable --now docker" ||
      die "Docker is installed but its service could not be started"
  fi

  resource_line="$(remote "getconf _NPROCESSORS_ONLN; awk '/^MemTotal:/{print \$2}' /proc/meminfo" | tr '\n' ' ')"
  read -r cpu_count memory_kib <<<"$resource_line"
  [[ "$cpu_count" =~ ^[0-9]+$ && "$memory_kib" =~ ^[0-9]+$ ]] ||
    die "could not read CPU and memory capacity from the existing machine"
  (( cpu_count >= 4 )) || die "the machine has $cpu_count CPU cores; Snapchain requires at least 4"
  (( memory_kib >= 15000000 )) ||
    die "the machine has less than 16 GB RAM; Snapchain requires at least 16 GB"

  remote "sudo -n mkdir -p /srv/in-three/data/rocks /srv/in-three/data/snapshot && sudo -n chown -R \$(id -u):\$(id -g) /srv/in-three"

  disk_line="$(remote "df -B1 --output=size,avail /srv/in-three | tail -1")"
  read -r disk_size disk_available <<<"$disk_line"
  [[ "$disk_size" =~ ^[0-9]+$ && "$disk_available" =~ ^[0-9]+$ ]] ||
    die "could not read disk capacity from the existing machine"
  (( disk_available >= 2000000000000 )) ||
    die "only $((disk_available / 1000000000)) GB is free; Snapchain requires at least 2 TB"
  volume_gib=$((disk_size / 1073741824))

  cat > "$STATE_FILE" <<EOF
PROVIDER=existing
SERVER_ID=
SERVER_IP=$SERVER_IP
SSH_USER=$SSH_USER
SSH_KEY=$SSH_KEY
SSH_PROXY_JUMP=$SSH_PROXY_JUMP
SSH_KEY_ID=
VOLUME_ID=
FIREWALL_ID=
CLIENT_DOMAIN=$domain
LOCATION=owned
SERVER_TYPE=existing
VOLUME_SIZE=$volume_gib
EOF
  chmod 600 "$STATE_FILE"

  record_proof_event "provision_complete" "$(jq -cn \
    --arg provider "existing" \
    --arg location "owned" \
    --arg serverType "existing" \
    --argjson volumeGiB "$volume_gib" \
    '{provider:$provider,location:$location,serverType:$serverType,volumeGiB:$volumeGiB}')"
  success "Existing machine is ready"
  printf '  client URL   https://%s (activated in step 3)\n' "$domain"
  printf '  local state  %s\n' "$STATE_FILE"
  printf '\nNext: %s node up\n' "$IN_THREE_COMMAND"
}

if [[ "$PROVISION_MODE" == "existing" ]]; then
  provision_existing_host
  exit 0
fi

[[ -z "$EXISTING_KEY" && -z "$CLIENT_DOMAIN_OVERRIDE" ]] ||
  die "--ssh-key and --domain apply only with --host"

for command in curl ssh-keygen openssl; do
  require_command "$command"
done
[[ "$VOLUME_SIZE" =~ ^[0-9]+$ ]] || die "--volume-size must be an integer"
(( VOLUME_SIZE >= 2048 )) || die "Snapchain requires at least 2 TB free; use --volume-size 2048 or larger"

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
  if [[ -n "$SSH_PROXY_JUMP" ]]; then
    note "Detecting the SSH source address through $SSH_PROXY_JUMP"
    public_ip="$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SSH_PROXY_JUMP" \
      "curl -4fsS --max-time 10 https://api.ipify.org" 2>/dev/null || true)"
  else
    public_ip="$(curl -4fsS --max-time 10 https://api.ipify.org || true)"
  fi
  [[ "$public_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    die "could not detect the IPv4 SSH source address; pass --source-cidr"
  SOURCE_CIDR="$public_ip/32"
fi

server_type_json="$(hcloud_api GET "/server_types?name=$SERVER_TYPE")" ||
  die "Hetzner rejected the token or server type"
cores="$(jq -r '.server_types[0].cores // empty' <<<"$server_type_json")"
memory="$(jq -r '.server_types[0].memory // empty' <<<"$server_type_json")"
[[ -n "$cores" && -n "$memory" ]] || die "server type $SERVER_TYPE was not found"
jq -e '.server_types[0] | .cores >= 4 and .memory >= 16' <<<"$server_type_json" >/dev/null ||
  die "server type $SERVER_TYPE is too small; Snapchain requires at least 4 CPU cores and 16 GB RAM"
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
if [[ -n "$SSH_PROXY_JUMP" ]]; then
  printf '  SSH path     through %s\n' "$SSH_PROXY_JUMP"
else
  printf '  SSH path     direct\n'
fi
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
  --arg provider "hcloud" \
  --arg location "$LOCATION" \
  --arg serverType "$SERVER_TYPE" \
  --argjson volumeGiB "$VOLUME_SIZE" \
  --argjson costEstimate "$cost_estimate_json" \
  '{
    provider:$provider,
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
SSH_PROXY_JUMP=$SSH_PROXY_JUMP
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
  --arg provider "hcloud" \
  --arg location "$LOCATION" \
  --arg serverType "$SERVER_TYPE" \
  --argjson volumeGiB "$VOLUME_SIZE" \
  --argjson costEstimate "$cost_estimate_json" \
  --arg sourceCidrRestricted "true" \
  '{
    provider:$provider,
    location:$location,
    serverType:$serverType,
    volumeGiB:$volumeGiB,
    sourceCidrRestricted:($sourceCidrRestricted == "true"),
    costEstimate:$costEstimate
  }')"
success "Compute is ready at $server_ip"
printf '  client URL   https://%s (activated in step 3)\n' "$domain"
printf '  local state  %s\n' "$STATE_FILE"
printf '\nNext: %s node up\n' "$IN_THREE_COMMAND"
