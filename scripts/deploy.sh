#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

SERVICE_ORIGIN="${IN_THREE_DEPLOY_SERVICE:-}"
MAX_AMOUNT="${IN_THREE_DEPLOY_MAX_AMOUNT:-25}"
SOURCE_CIDR=""
BUY_ACCOUNT="${IN_THREE_BUY_ACCOUNT:-in-three}"
BUY_ACCOUNT_EXPLICIT=false
PAYMENT_NETWORK="${IN_THREE_PAYMENT_NETWORK:-celo}"
PAYMENT_NETWORK_EXPLICIT=false
ASSUME_YES=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service) SERVICE_ORIGIN="$2"; shift 2 ;;
    --max-amount) MAX_AMOUNT="$2"; shift 2 ;;
    --source-cidr) SOURCE_CIDR="$2"; shift 2 ;;
    --buy-account) BUY_ACCOUNT="$2"; BUY_ACCOUNT_EXPLICIT=true; shift 2 ;;
    --payment-network) PAYMENT_NETWORK="$2"; PAYMENT_NETWORK_EXPLICIT=true; shift 2 ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: ./farcaster deploy --service https://BROKER [options]

Buy one deployment, provision the fixed In Three Hetzner plan, start
Snapchain, wait for it, and finish the local client key ceremony.

Options:
  --service ORIGIN      Buy-enabled In Three deployment broker
  --max-amount USDC     Hard payment ceiling (default: 25)
  --source-cidr CIDR    CIDR allowed to SSH (default: your public IP)
  --buy-account NAME    usebuy.ai account to charge on Celo (default: in-three)
  --payment-network NET Celo or Base (default: celo)
  --yes                 Approve the stated ceiling without typing BUY DEPLOY

Set HCLOUD_TOKEN or enter it at the hidden prompt. The payment is the broker's
automation fee. Hetzner bills the persistent server and 2 TiB volume separately.
EOF
      exit 0
      ;;
    *) die "unknown deploy option: $1" ;;
  esac
done

finish_deployment() {
  "$IN_THREE_ROOT/scripts/node.sh" up
  "$IN_THREE_ROOT/scripts/client.sh" create
}

if [[ -f "$STATE_FILE" ]]; then
  note "A paid or manual deployment already exists; resuming without another payment"
  finish_deployment
  exit 0
fi

[[ "$PAYMENT_NETWORK" == "celo" || "$PAYMENT_NETWORK" == "base" ]] ||
  die "--payment-network must be celo or base"
for command in curl jq ssh ssh-keygen openssl; do
  require_command "$command"
done

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"
ssh_key="$STATE_DIR/id_ed25519"
deployment_id_file="$STATE_DIR/deployment-id"
payment_marker="$STATE_DIR/deployment-payment.pending"
receipt_file="$STATE_DIR/deploy-receipt.txt"
service_file="$STATE_DIR/deployment-service"
source_cidr_file="$STATE_DIR/deployment-source-cidr"
buy_account_file="$STATE_DIR/deployment-buy-account"
payment_network_file="$STATE_DIR/deployment-payment-network"

if [[ -f "$payment_marker" && -f "$service_file" ]]; then
  saved_service="$(cat "$service_file")"
  if [[ -n "$SERVICE_ORIGIN" && "${SERVICE_ORIGIN%/}" != "$saved_service" ]]; then
    die "the pending payment is bound to $saved_service"
  fi
  SERVICE_ORIGIN="$saved_service"
fi
if [[ -f "$payment_marker" ]]; then
  saved_payment_network="celo"
  if [[ -f "$payment_network_file" ]]; then
    saved_payment_network="$(cat "$payment_network_file")"
  fi
  if [[ "$PAYMENT_NETWORK_EXPLICIT" == true && "$PAYMENT_NETWORK" != "$saved_payment_network" ]]; then
    die "the pending payment is bound to $saved_payment_network"
  fi
  PAYMENT_NETWORK="$saved_payment_network"
fi
if [[ "$PAYMENT_NETWORK" == "celo" && -f "$payment_marker" && -f "$buy_account_file" ]]; then
  saved_buy_account="$(cat "$buy_account_file")"
  if [[ "$BUY_ACCOUNT_EXPLICIT" == true && "$BUY_ACCOUNT" != "$saved_buy_account" ]]; then
    die "the pending payment is bound to usebuy.ai account $saved_buy_account"
  fi
  BUY_ACCOUNT="$saved_buy_account"
fi
[[ "$PAYMENT_NETWORK" == "celo" || "$PAYMENT_NETWORK" == "base" ]] ||
  die "invalid payment network in local recovery state"
if [[ "$PAYMENT_NETWORK" == "celo" ]]; then
  require_command buy
else
  require_command node
fi
[[ "$SERVICE_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?/?$ ]] ||
  die "--service must be an HTTPS origin with no path"
SERVICE_ORIGIN="${SERVICE_ORIGIN%/}"
[[ "$MAX_AMOUNT" =~ ^[0-9]+([.][0-9]{1,6})?$ ]] ||
  die "--max-amount must be a decimal USDC amount"
[[ "$BUY_ACCOUNT" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] ||
  die "--buy-account contains unsupported characters"

if [[ ! -f "$ssh_key" ]]; then
  ssh-keygen -q -t ed25519 -N "" -C "in-three-paid-deploy" -f "$ssh_key"
  chmod 600 "$ssh_key"
fi
public_key="$(cat "$ssh_key.pub")"

if [[ -f "$deployment_id_file" ]]; then
  deployment_id="$(cat "$deployment_id_file")"
else
  deployment_id="dep-$(openssl rand -hex 16)"
  printf '%s\n' "$deployment_id" > "$deployment_id_file"
  chmod 600 "$deployment_id_file"
fi
[[ "$deployment_id" =~ ^dep-[a-z0-9]{16,60}$ ]] ||
  die "invalid saved deployment ID at $deployment_id_file"

if [[ -z "${HCLOUD_TOKEN:-}" ]]; then
  [[ -t 0 ]] || die "HCLOUD_TOKEN is required in non-interactive mode"
  read -r -s -p "Dedicated Hetzner project API token: " HCLOUD_TOKEN
  printf '\n'
fi
[[ -n "$HCLOUD_TOKEN" ]] || die "empty Hetzner token"

if [[ -f "$payment_marker" && -f "$source_cidr_file" ]]; then
  saved_source_cidr="$(cat "$source_cidr_file")"
  if [[ -n "$SOURCE_CIDR" && "$SOURCE_CIDR" != "$saved_source_cidr" ]]; then
    die "the pending payment is bound to SSH source $saved_source_cidr"
  fi
  SOURCE_CIDR="$saved_source_cidr"
fi
if [[ -z "$SOURCE_CIDR" ]]; then
  public_ip="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
  [[ "$public_ip" =~ ^[0-9a-fA-F:.]+$ ]] ||
    die "could not detect your public IP; pass --source-cidr"
  if [[ "$public_ip" == *:* ]]; then
    SOURCE_CIDR="$public_ip/128"
  else
    SOURCE_CIDR="$public_ip/32"
  fi
fi

request_body="$(mktemp)"
status_body="$(mktemp)"
response_body="$(mktemp)"
response_headers="$(mktemp)"
preflight_body="$(mktemp)"
cleanup() {
  secure_delete "$request_body"
  secure_delete "$status_body"
  rm -f "$response_body" "$response_headers" "$preflight_body"
  unset HCLOUD_TOKEN
}
trap cleanup EXIT

jq -n \
  --arg deploymentId "$deployment_id" \
  --arg hetznerToken "$HCLOUD_TOKEN" \
  --arg sshPublicKey "$public_key" \
  --arg sourceCidr "$SOURCE_CIDR" \
  '{
    deploymentId:$deploymentId,
    hetznerToken:$hetznerToken,
    sshPublicKey:$sshPublicKey,
    sourceCidr:$sourceCidr
  }' > "$request_body"
chmod 600 "$request_body"

jq -n \
  --arg deploymentId "$deployment_id" \
  --arg hetznerToken "$HCLOUD_TOKEN" \
  '{deploymentId:$deploymentId, hetznerToken:$hetznerToken}' > "$status_body"
chmod 600 "$status_body"

write_state_from_response() {
  local response="$1"
  local server_id server_ip ssh_user ssh_key_id volume_id firewall_id domain

  server_id="$(jq -er '.server.id | numbers' "$response")"
  server_ip="$(jq -er '.server.ip | strings' "$response")"
  ssh_user="$(jq -er '.server.sshUser | strings' "$response")"
  ssh_key_id="$(jq -er '.resources.sshKeyId | numbers' "$response")"
  volume_id="$(jq -er '.resources.volumeId | numbers' "$response")"
  firewall_id="$(jq -er '.resources.firewallId | numbers' "$response")"
  domain="${server_ip//./-}.sslip.io"

  [[ "$server_ip" =~ ^[0-9]+([.][0-9]+){3}$ ]] ||
    die "broker returned an invalid server IP"
  [[ "$ssh_user" == "inthree" ]] ||
    die "broker returned an unexpected SSH user"

  cat > "$STATE_FILE" <<EOF
PROVIDER=hcloud
SERVER_ID=$server_id
SERVER_IP=$server_ip
SSH_USER=$ssh_user
SSH_KEY=$ssh_key
SSH_KEY_ID=$ssh_key_id
VOLUME_ID=$volume_id
FIREWALL_ID=$firewall_id
CLIENT_DOMAIN=$domain
LOCATION=ash
SERVER_TYPE=ccx33
DEPLOYMENT_ID=$deployment_id
DEPLOYMENT_SERVICE=$SERVICE_ORIGIN
EOF
  chmod 600 "$STATE_FILE"
}

if [[ -f "$payment_marker" ]]; then
  note "Recovering the prior paid attempt before considering another payment"
  status_code="$(
    curl -sS --max-time 60 \
      -o "$response_body" \
      -w '%{http_code}' \
      -X POST \
      -H "Content-Type: application/json" \
      --data-binary "@$status_body" \
      "$SERVICE_ORIGIN/agent/v1/deployments/status"
  )"
  if [[ "$status_code" == "200" ]]; then
    write_state_from_response "$response_body"
    rm -f "$payment_marker"
    success "Recovered deployment $deployment_id without paying again"
  elif jq -e '.resumable == true' "$response_body" >/dev/null 2>&1; then
    note "The paid entitlement exists; resuming provisioning without another payment"
    curl -fsS --max-time 120 \
      -X POST \
      -H "Content-Type: application/json" \
      --data-binary "@$request_body" \
      "$SERVICE_ORIGIN/agent/v1/deployments/resume" > "$response_body"
    write_state_from_response "$response_body"
    rm -f "$payment_marker"
    success "Resumed deployment $deployment_id without paying again"
  else
    printf 'No matching paid entitlement or complete deployment was recovered for %s (HTTP %s).\n' \
      "$deployment_id" "$status_code" >&2
    if [[ "$PAYMENT_NETWORK" == "celo" ]]; then
      printf 'Run: buy --account %s receipts --resolve\n' "$BUY_ACCOUNT" >&2
    else
      printf 'Inspect %s and the Base wallet history, then contact the broker with the deployment ID.\n' \
        "$receipt_file" >&2
    fi
    printf 'Keep %s. Do not remove it or buy again until the receipt is resolved.\n' \
      "$payment_marker" >&2
    exit 1
  fi
else
  note "Checking the fixed plan and dedicated Hetzner project before payment"
  curl -fsS --max-time 60 \
    -X POST \
    -H "Content-Type: application/json" \
    --data-binary "@$request_body" \
    "$SERVICE_ORIGIN/agent/v1/deployments/preflight" > "$preflight_body"
  jq '{
    deploymentId,
    plan,
    billing,
    secrets
  }' "$preflight_body"

  printf '\nIN THREE / ONE-PURCHASE DEPLOYMENT\n'
  printf '  broker fee ceiling   %s USDC on %s\n' "$MAX_AMOUNT" "$PAYMENT_NETWORK"
  printf '  infrastructure       fixed ccx33 + 2048 GiB in ash; billed by Hetzner\n'
  printf '  SSH private key      remains at %s\n' "$ssh_key"
  printf '  custody phrase       requested locally only after Snapchain is ready\n\n'

  note "Reading the authoritative x402 quote; nothing is signed or paid"
  if [[ "$PAYMENT_NETWORK" == "celo" ]]; then
    buy --account "$BUY_ACCOUNT" quote \
      -X POST \
      -H "Content-Type: application/json" \
      --data-binary "@$request_body" \
      "$SERVICE_ORIGIN/agent/v1/deployments"
  else
    node "$IN_THREE_ROOT/scripts/pay-base.mjs" \
      --url "$SERVICE_ORIGIN/agent/v1/deployments" \
      --method POST \
      --data-file "$request_body" \
      --max "$MAX_AMOUNT" \
      --quote-only
  fi

  if [[ "$ASSUME_YES" != true ]]; then
    read -r -p "Type BUY DEPLOY to authorize up to $MAX_AMOUNT USDC: " confirmation
    [[ "$confirmation" == "BUY DEPLOY" ]] || die "deployment purchase cancelled"
  fi

  printf '%s\n' "$SERVICE_ORIGIN" > "$service_file"
  printf '%s\n' "$SOURCE_CIDR" > "$source_cidr_file"
  printf '%s\n' "$PAYMENT_NETWORK" > "$payment_network_file"
  if [[ "$PAYMENT_NETWORK" == "celo" ]]; then
    printf '%s\n' "$BUY_ACCOUNT" > "$buy_account_file"
  else
    rm -f "$buy_account_file"
  fi
  printf '%s\n' "$deployment_id" > "$payment_marker"
  chmod 600 "$service_file" "$source_cidr_file" "$payment_network_file" "$payment_marker"
  [[ ! -f "$buy_account_file" ]] || chmod 600 "$buy_account_file"

  note "Buying one deployment and creating the persistent host"
  payment_succeeded=false
  if [[ "$PAYMENT_NETWORK" == "celo" ]]; then
    if buy --account "$BUY_ACCOUNT" curl --max-amount "$MAX_AMOUNT" \
      --data-file "$request_body" \
      --fail-with-body \
      -D "$response_headers" \
      -o "$response_body" \
      -X POST \
      -H "Content-Type: application/json" \
      "$SERVICE_ORIGIN/agent/v1/deployments"; then
      awk 'BEGIN{IGNORECASE=1} /^X-PAYMENT-RESPONSE:/ {sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print}' \
        "$response_headers" > "$receipt_file"
      payment_succeeded=true
    fi
  else
    if node "$IN_THREE_ROOT/scripts/pay-base.mjs" \
      --url "$SERVICE_ORIGIN/agent/v1/deployments" \
      --method POST \
      --data-file "$request_body" \
      --max "$MAX_AMOUNT" \
      --output "$response_body" \
      --receipt-output "$receipt_file" \
      --yes; then
      payment_succeeded=true
    fi
  fi

  if [[ "$payment_succeeded" != true ]]; then
    printf '\nThe paid response was unsuccessful or interrupted.\n' >&2
    if [[ "$PAYMENT_NETWORK" == "celo" ]]; then
      printf 'Run buy --account %s receipts --resolve, then rerun with the same service.\n' \
        "$BUY_ACCOUNT" >&2
    else
      printf 'Inspect the Base wallet history and %s before rerunning with the same service.\n' \
        "$receipt_file" >&2
    fi
    printf 'The saved deployment ID prevents an automatic second purchase.\n' >&2
    exit 1
  fi

  write_state_from_response "$response_body"
  chmod 600 "$receipt_file"
  rm -f "$payment_marker"
  success "One deployment purchased; no further setup payment is required"
fi

load_state
note "Waiting for cloud-init and the auto-started Snapchain container"
wait_for_ssh 72 ||
  die "server exists at $SERVER_IP but SSH did not become ready; rerun ./farcaster deploy"
for ((attempt = 1; attempt <= 72; attempt++)); do
  if remote "sudo test -f /var/lib/cloud/instance/in-three-ready" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
remote "sudo test -f /var/lib/cloud/instance/in-three-ready" ||
  die "cloud-init is still running; rerun ./farcaster deploy to continue without paying again"

finish_deployment
