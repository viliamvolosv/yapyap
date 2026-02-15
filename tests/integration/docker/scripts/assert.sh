#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCENARIO="${TEST_SCENARIO:-basic-messaging}"
RESULT_FILE="$DOCKER_DIR/results/$SCENARIO.result.json"

echo "[assert] Waiting for controller to finish..."
for i in $(seq 1 60); do
  if [ -f "$RESULT_FILE" ]; then
    break
  fi
  sleep 1
done

if [ ! -f "$RESULT_FILE" ]; then
  echo "[assert] Missing result file: $RESULT_FILE" >&2
  docker compose -f "$DOCKER_DIR/docker-compose.yml" logs controller || true
  exit 1
fi

echo "[assert] Controller result:"
cat "$RESULT_FILE"

ASSERT_OK=$(jq -e '.passed' "$RESULT_FILE" 2>/dev/null > /dev/null && echo 'true' || echo 'false')
if [ "$ASSERT_OK" != "true" ]; then
  echo "[assert] Scenario failed" >&2
  docker compose -f "$DOCKER_DIR/docker-compose.yml" logs controller || true
  exit 1
fi

echo "[assert] Scenario passed"
