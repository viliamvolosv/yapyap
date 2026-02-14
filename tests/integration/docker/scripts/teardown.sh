#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[teardown] Stopping docker integration stack..."
docker compose -f "$DOCKER_DIR/docker-compose.yml" down -v --remove-orphans
# Add teardown logic here
