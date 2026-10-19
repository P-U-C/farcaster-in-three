#!/usr/bin/env bash
set -euo pipefail

cat > /tmp/snapchain.toml <<'EOF'
rpc_address="0.0.0.0:3383"
http_address="0.0.0.0:3381"
rocksdb_dir=".rocks"
fc_network="Mainnet"
read_node=true

[statsd]
prefix="snapchain"

[gossip]
address="/ip4/0.0.0.0/udp/3382/quic-v1"
bootstrap_peers="/ip4/54.236.164.51/udp/3382/quic-v1, /ip4/54.87.204.167/udp/3382/quic-v1, /ip4/44.197.255.20/udp/3382/quic-v1, /ip4/54.157.62.17/udp/3382/quic-v1, /ip4/34.195.157.114/udp/3382/quic-v1, /ip4/107.20.169.236/udp/3382/quic-v1, /ip4/35.212.102.55/udp/3382/quic-v1, /ip4/35.157.151.56/udp/3382/quic-v1, /ip4/108.132.114.186/udp/3382/quic-v1"

[consensus]
shard_ids=[1,2]
num_shards=2

[snapshot]
endpoint_url="https://e1f9f185c6e63471dd39f96abd3413c4.r2.cloudflarestorage.com"
load_db_from_snapshot=true
EOF

cat /opt/in-three/validators.toml >> /tmp/snapchain.toml

if [[ "${IN_THREE_CHECK_CONFIG:-}" == "1" ]]; then
  exec /app/snapchain --config-path /tmp/snapchain.toml --check-config
fi
exec /app/snapchain --config-path /tmp/snapchain.toml
