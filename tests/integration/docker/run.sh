#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCENARIO="${1:-basic-messaging}"
export TEST_SCENARIO="$SCENARIO"
export TEST_RUN_ID="${TEST_RUN_ID:-$(date -u +"%Y%m%dT%H%M%SZ")}"

cleanup() {
  status=$?
  sh "$SCRIPT_DIR/scripts/collect-artifacts.sh" "$SCENARIO" "$status" || true
  "$SCRIPT_DIR/scripts/teardown.sh"
  exit "$status"
}

trap cleanup EXIT

"$SCRIPT_DIR/scripts/setup.sh"
"$SCRIPT_DIR/scripts/assert.sh"
