#!/bin/sh
set -e

YAPYAP_DATA_DIR="${YAPYAP_DATA_DIR:-/data}"
YAPYAP_API_PORT="${YAPYAP_API_PORT:-3000}"

echo "[entrypoint] Starting YapYap node"
echo "[entrypoint] data_dir=$YAPYAP_DATA_DIR api_port=$YAPYAP_API_PORT"

mkdir -p "$YAPYAP_DATA_DIR"

exec bun run dist/index.js start --data-dir "$YAPYAP_DATA_DIR" --api-port "$YAPYAP_API_PORT"
