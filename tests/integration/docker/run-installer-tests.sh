#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKER_DIR="$ROOT_DIR/docker"

echo "=== YapYap Installer Integration Tests ==="
echo ""

# Check if docker is available
if ! command -v docker &> /dev/null; then
  echo "Error: Docker is not installed or not in PATH"
  exit 1
fi

# Check if docker compose is available
if ! docker compose version &> /dev/null; then
  echo "Error: Docker Compose is not available"
  exit 1
fi

# Check if install.sh exists
# ROOT_DIR is tests/integration/docker, so we need to go up 3 levels
PROJECT_ROOT="$(cd "$ROOT_DIR/../../.." && pwd)"
INSTALL_SCRIPT="$PROJECT_ROOT/docs/install.sh"
if [ ! -f "$INSTALL_SCRIPT" ]; then
  echo "Error: docs/install.sh not found at $INSTALL_SCRIPT"
  exit 1
fi

echo "Test directory: $DOCKER_DIR"
echo ""

# Function to run a single test
run_test() {
  local scenario="$1"
  local test_name="$2"

  echo "========================================="
  echo "Running: $test_name"
  echo "Scenario: $scenario"
  echo "========================================="

  export TEST_SCENARIO="$scenario"

  # Cleanup previous test results
  rm -f "$DOCKER_DIR/results/${scenario}.result.json"

  # Run the test
  cd "$DOCKER_DIR"
  if docker compose -f docker-compose.yml up test-installer 2>&1 | tee /tmp/test-output.log; then
    echo ""
    echo "✓ $test_name passed"
    echo ""

    # Show result summary
    if [ -f "$DOCKER_DIR/results/${scenario}.result.json" ]; then
      echo "Result summary:"
      cat "$DOCKER_DIR/results/${scenario}.result.json" | jq -r '
        "  Status: \(.status)",
        "  Steps executed: \(.steps | length)",
        "  Failed steps: \(.steps | map(select(.status == "failed")) | length)"
      '
    fi
  else
    echo ""
    echo "✗ $test_name failed"
    echo ""
    echo "Last output lines:"
    tail -n 50 /tmp/test-output.log
    return 1
  fi
}

# Function to cleanup
cleanup() {
  cd "$DOCKER_DIR"
  docker compose down -v 2>/dev/null || true
  echo ""
  echo "Cleanup complete"
}

# Setup trap for cleanup
trap cleanup EXIT

# Run tests
PASSED=0
FAILED=0

# Run git installation test
if run_test "install-git" "Git Installation Test"; then
  PASSED=$((PASSED + 1))
else
  FAILED=$((FAILED + 1))
fi

echo ""

# Run npm installation test
if run_test "install-npm" "NPM Installation Test"; then
  PASSED=$((PASSED + 1))
else
  FAILED=$((FAILED + 1))
fi

# Final summary
echo "========================================="
echo "Test Summary"
echo "========================================="
echo "Passed: $PASSED"
echo "Failed: $FAILED"
echo "========================================="

if [ $FAILED -eq 0 ]; then
  echo "✓ All installer tests passed!"
  exit 0
else
  echo "✗ Some installer tests failed"
  exit 1
fi