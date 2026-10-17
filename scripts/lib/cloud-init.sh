#!/usr/bin/env bash

render_cloud_init() {
  local public_key="$1"
  local volume_id="$2"

  cat <<EOF
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
EOF
  cat <<'EOF'
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
}
