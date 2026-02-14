#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

rm -f "$DOCKER_DIR"/results/*.result.json

echo "[setup] Building and starting docker integration stack..."
docker compose -f "$DOCKER_DIR/docker-compose.yml" up -d --build

echo "[setup] Stack started. Use assert.sh to validate controller result."
