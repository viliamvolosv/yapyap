#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCENARIO="${1:-basic-messaging}"
export TEST_SCENARIO="$SCENARIO"

cleanup() {
  "$SCRIPT_DIR/scripts/teardown.sh"
}

trap cleanup EXIT

"$SCRIPT_DIR/scripts/setup.sh"
"$SCRIPT_DIR/scripts/assert.sh"
