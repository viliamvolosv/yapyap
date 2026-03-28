#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCENARIO="${TEST_SCENARIO:-basic-messaging}"
RESULT_FILE="$DOCKER_DIR/results/$SCENARIO.result.json"
ASSERT_TIMEOUT_SECONDS="${ASSERT_TIMEOUT_SECONDS:-120}"
E2E_ERROR_PATTERN="${E2E_ERROR_PATTERN:-E2E encryption failed}"

requires_e2e_log_assertion() {
  case "$SCENARIO" in
    basic-*|message-*|cross-network-messaging|retry-on-failure|database-persistence|network-interruption|multi-hop-routing|message-size-limits|invalid-message-format|high-load-concurrency|peer-timeout|queue-cleanup|handshake-validation|privacy-validation|e2e-*|restart-during-retry|replica-ack-timeout-recovery|out-of-order-delivery)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

echo "[assert] Waiting for controller to finish..."
for i in $(seq 1 "$ASSERT_TIMEOUT_SECONDS"); do
  if [ -s "$RESULT_FILE" ] && jq -e '.passed | type == "boolean"' "$RESULT_FILE" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if [ ! -s "$RESULT_FILE" ] || ! jq -e '.passed | type == "boolean"' "$RESULT_FILE" >/dev/null 2>&1; then
  echo "[assert] Missing result file: $RESULT_FILE" >&2
  echo "[assert] Wait timeout: ${ASSERT_TIMEOUT_SECONDS}s" >&2
  if [ -f "$RESULT_FILE" ]; then
    echo "[assert] Result file present but incomplete/invalid JSON:" >&2
    cat "$RESULT_FILE" >&2 || true
  fi
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

if requires_e2e_log_assertion; then
  echo "[assert] Checking node logs for strict E2E encryption failures..."
  E2E_ERROR_FOUND=0
  for service in node1 node2 node3; do
    LOG_FILE="$(mktemp)"
    docker compose -f "$DOCKER_DIR/docker-compose.yml" logs --no-color "$service" >"$LOG_FILE" 2>&1 || true
    if grep -Fq "$E2E_ERROR_PATTERN" "$LOG_FILE"; then
      echo "[assert] Strict failure: '$E2E_ERROR_PATTERN' found in ${service} logs" >&2
      grep -Fn "$E2E_ERROR_PATTERN" "$LOG_FILE" | head -10 >&2 || true
      E2E_ERROR_FOUND=1
    fi
    rm -f "$LOG_FILE"
  done

  if [ "$E2E_ERROR_FOUND" -ne 0 ]; then
    exit 1
  fi
fi
