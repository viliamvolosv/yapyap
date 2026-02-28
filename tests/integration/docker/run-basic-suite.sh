#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNNER="${ROOT_DIR}/tests/integration/docker/run.sh"

scenarios=(
  "basic-messaging"
  "basic-reconnect"
  "basic-restart"
  "message-state-transitions"
  "retry-on-failure"
  "database-persistence"
  # "deduplication"  # Requires app changes to test properly (custom message IDs)
  "network-interruption"
  "multi-hop-routing"
  "message-size-limits"
  "invalid-message-format"
  "high-load-concurrency"
  "peer-timeout"
  "queue-cleanup"
  "handshake-validation"
  "privacy-validation"
  "cli-queries"
)

echo "========================================"
echo "Running Standard Docker Scenarios"
echo "========================================"

for scenario in "${scenarios[@]}"; do
  echo "=== Running ${scenario} ==="
  bash "${RUNNER}" "${scenario}"
done

echo ""
echo "========================================"
echo "Running Peer Discovery Tests"
echo "========================================"

# Run peer discovery integration tests (no Docker required)
bash "${ROOT_DIR}/tests/integration/docker/discovery-test.sh"
bash "${ROOT_DIR}/tests/integration/docker/message-forward-test.sh"

echo ""
echo "========================================"
echo "All Docker integration scenarios passed."
echo "All peer discovery tests passed."
echo "========================================"
