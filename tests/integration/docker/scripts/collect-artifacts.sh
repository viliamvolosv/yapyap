#!/bin/sh
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SCENARIO="${1:-${TEST_SCENARIO:-unknown-scenario}}"
EXIT_CODE="${2:-0}"
RUN_ID="${TEST_RUN_ID:-$(date -u +"%Y%m%dT%H%M%SZ")}"

ARTIFACT_BASE="$DOCKER_DIR/results/artifacts/$RUN_ID/$SCENARIO"
RESULT_FILE="$DOCKER_DIR/results/$SCENARIO.result.json"
COMPOSE_FILE="$DOCKER_DIR/docker-compose.yml"

mkdir -p "$ARTIFACT_BASE"

{
	echo "{"
	echo "  \"scenario\": \"${SCENARIO}\","
	echo "  \"runId\": \"${RUN_ID}\","
	echo "  \"exitCode\": ${EXIT_CODE},"
	echo "  \"timestamp\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\""
	echo "}"
} >"$ARTIFACT_BASE/summary.json"

if [ -f "$RESULT_FILE" ]; then
	cp "$RESULT_FILE" "$ARTIFACT_BASE/result.json"
fi

docker compose -f "$COMPOSE_FILE" ps >"$ARTIFACT_BASE/compose-ps.txt" 2>&1 || true
docker compose -f "$COMPOSE_FILE" config --services >"$ARTIFACT_BASE/services.txt" 2>/dev/null || true

if [ -s "$ARTIFACT_BASE/services.txt" ]; then
	while IFS= read -r service; do
		if [ -n "$service" ]; then
			docker compose -f "$COMPOSE_FILE" logs --no-color "$service" >"$ARTIFACT_BASE/${service}.log" 2>&1 || true
		fi
	done <"$ARTIFACT_BASE/services.txt"
fi

docker compose -f "$COMPOSE_FILE" logs --no-color >"$ARTIFACT_BASE/compose-all.log" 2>&1 || true

echo "[artifacts] Collected: $ARTIFACT_BASE"
