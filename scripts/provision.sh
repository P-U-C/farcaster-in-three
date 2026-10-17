#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

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
      cat <<'EOF'
Usage: ./farcaster provision [options]

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
[[ ! -f "$STATE_FILE" ]] || die "a host is already provisioned; run ./farcaster destroy first"

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
  trap - EXIT
  if [[ "$completed" != true && $status -ne 0 ]]; then
    note "Provisioning failed; removing partial billable resources"
    [[ -z "$server_id" ]] || curl -sS --max-time 30 -X DELETE       -H "Authorization: Bearer $HCLOUD_TOKEN"       "https://api.hetzner.cloud/v1/servers/$server_id" >/dev/null 2>&1 || true
    sleep 2
    [[ -z "$volume_id" ]] || curl -sS --max-time 30 -X DELETE       -H "Authorization: Bearer $HCLOUD_TOKEN"       "https://api.hetzner.cloud/v1/volumes/$volume_id" >/dev/null 2>&1 || true
    [[ -z "$firewall_id" ]] || curl -sS --max-time 30 -X DELETE       -H "Authorization: Bearer $HCLOUD_TOKEN"       "https://api.hetzner.cloud/v1/firewalls/$firewall_id" >/dev/null 2>&1 || true
    [[ -z "$ssh_key_id" ]] || curl -sS --max-time 30 -X DELETE       -H "Authorization: Bearer $HCLOUD_TOKEN"       "https://api.hetzner.cloud/v1/ssh_keys/$ssh_key_id" >/dev/null 2>&1 || true
    rm -f "$STATE_FILE" "$STATE_DIR/id_ed25519" "$STATE_DIR/id_ed25519.pub"
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

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local args=(
    -fsS
    --max-time 45
    -X "$method"
    -H "Authorization: Bearer $HCLOUD_TOKEN"
    -H "Content-Type: application/json"
  )
  [[ -z "$data" ]] || args+=(--data "$data")
  curl "${args[@]}" "https://api.hetzner.cloud/v1$path"
}

server_type_json="$(api GET "/server_types?name=$SERVER_TYPE")" ||
  die "Hetzner rejected the token or server type"
cores="$(jq -r '.server_types[0].cores // empty' <<<"$server_type_json")"
memory="$(jq -r '.server_types[0].memory // empty' <<<"$server_type_json")"
[[ -n "$cores" && -n "$memory" ]] || die "server type $SERVER_TYPE was not found"

printf '\nIN THREE / COMPUTE PLAN\n'
printf '  region       %s\n' "$LOCATION"
printf '  compute      %s (%s vCPU, %s GiB RAM)\n' "$SERVER_TYPE" "$cores" "$memory"
printf '  data         %s GiB cloud block volume\n' "$VOLUME_SIZE"
printf '  ingress      SSH from %s; HTTPS and gossip public\n' "$SOURCE_CIDR"
printf '  protocol     no hosted Farcaster API keys\n\n'

if [[ "$ASSUME_YES" != true ]]; then
  read -r -p "Type PROVISION to create billable resources: " confirmation
  [[ "$confirmation" == "PROVISION" ]] || die "provisioning cancelled"
fi

suffix="$(openssl rand -hex 3)"
resource_name="$NAME-$suffix"
ssh_key="$STATE_DIR/id_ed25519"
ssh-keygen -q -t ed25519 -N "" -C "$resource_name" -f "$ssh_key"
chmod 600 "$ssh_key"
public_key="$(cat "$ssh_key.pub")"

note "Registering an isolated SSH key"
ssh_response="$(api POST /ssh_keys "$(jq -n   --arg name "$resource_name"   --arg public_key "$public_key"   '{name:$name, public_key:$public_key, labels:{"managed-by":"in-three"}}')")"
ssh_key_id="$(jq -r '.ssh_key.id' <<<"$ssh_response")"

note "Creating the $VOLUME_SIZE GiB data volume"
volume_response="$(api POST /volumes "$(jq -n   --arg name "$resource_name-data"   --arg location "$LOCATION"   --argjson size "$VOLUME_SIZE"   '{name:$name, location:$location, size:$size, format:"ext4", labels:{"managed-by":"in-three"}}')")"
volume_id="$(jq -r '.volume.id' <<<"$volume_response")"

note "Applying least-exposure firewall rules"
firewall_response="$(api POST /firewalls "$(jq -n   --arg name "$resource_name"   --arg source "$SOURCE_CIDR"   '{
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

cloud_init="$(cat <<EOF
#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-v2
  - curl
  - jq
users:
  - default
  - name: inthree
    gecos: In Three operator
    groups: [adm, sudo, docker]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    ssh_authorized_keys:
      - "$public_key"
write_files:
  - path: /usr/local/sbin/mount-in-three-volume
    permissions: "0755"
    content: |
      #!/usr/bin/env bash
      set -euo pipefail
      device="/dev/disk/by-id/scsi-0HC_Volume_$volume_id"
      for attempt in $(seq 1 120); do
        [[ -b "$device" ]] && break
        sleep 2
      done
      [[ -b "$device" ]] || { echo "volume device not found" >&2; exit 1; }
      mkdir -p /srv/in-three
      if ! mountpoint -q /srv/in-three; then
        mount "$device" /srv/in-three
      fi
      grep -qF "$device /srv/in-three" /etc/fstab ||
        echo "$device /srv/in-three ext4 defaults,nofail 0 2" >> /etc/fstab
      mkdir -p /srv/in-three/data/{rocks,snapshot,caddy-data,caddy-config}
      chown -R inthree:inthree /srv/in-three
runcmd:
  - [systemctl, enable, --now, docker]
  - [usermod, -aG, docker, inthree]
  - [/usr/local/sbin/mount-in-three-volume]
  - [sh, -c, "touch /var/lib/cloud/instance/in-three-ready"]
EOF
)"

note "Creating the Snapchain host"
server_response="$(api POST /servers "$(jq -n   --arg name "$resource_name"   --arg type "$SERVER_TYPE"   --arg location "$LOCATION"   --arg user_data "$cloud_init"   --argjson ssh_key "$ssh_key_id"   --argjson firewall "$firewall_id"   '{
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
api POST "/volumes/$volume_id/actions/attach" "$(jq -n --argjson server "$server_id" '{server:$server, automount:false}')" >/dev/null

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
EOF
chmod 600 "$STATE_FILE"

note "Waiting for cloud-init and the mounted data disk"
load_state
wait_for_ssh 72 || die "server exists at $server_ip but SSH did not become ready"
for attempt in $(seq 1 72); do
  if remote "sudo test -f /var/lib/cloud/instance/in-three-ready" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
remote "sudo test -f /var/lib/cloud/instance/in-three-ready" ||
  die "cloud-init did not finish; partial resources will be removed"

completed=true
success "Compute is ready at $server_ip"
printf '  client URL   https://%s (activated by command 2)\n' "$domain"
printf '  local state  %s\n' "$STATE_FILE"
printf '\nNext: ./farcaster node up\n'
