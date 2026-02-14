#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNNER="${ROOT_DIR}/tests/integration/docker/run.sh"

scenarios=(
  "basic-messaging"
  "basic-reconnect"
  "basic-restart"
)

for scenario in "${scenarios[@]}"; do
  echo "=== Running ${scenario} ==="
  bash "${RUNNER}" "${scenario}"
done

echo "All basic Docker integration scenarios passed."
