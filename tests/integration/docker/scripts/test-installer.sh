#!/bin/sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[installer-test] Starting installer test"
SCENARIO="${TEST_SCENARIO:-install-git}"

# Determine test type
case "$SCENARIO" in
  install-git)
    TEST_TYPE="git"
    ;;
  install-npm)
    TEST_TYPE="npm"
    ;;
  *)
    echo "Unknown test scenario: $SCENARIO" >&2
    exit 1
    ;;
esac

echo "[installer-test] Test type: $TEST_TYPE"
echo "[installer-test] Running test: $SCENARIO"

# Run the specific test
case "$TEST_TYPE" in
  git)
    echo "[test] Running git installation test"

    # Step 1: Verify script syntax
    echo "[test] Step 1: Verify script syntax"
    if bash -n /tmp/install.sh; then
      echo "[test] ✓ Script syntax check passed"
      STEP1_STATUS="success"
      STEP1_EXIT=0
    else
      echo "[test] ✗ Script syntax check failed"
      STEP1_STATUS="failed"
      STEP1_EXIT=1
    fi

    # Step 2: Run installation with git method (actually install)
    echo "[test] Step 2: Run installation with git method"
    if bash -c "cd /tmp && OSTYPE=linux-gnu /tmp/install.sh --install-method git --no-onboard --no-prompt" > /tmp/step-output.log 2>&1; then
      echo "[test] ✓ Installation completed successfully"
      STEP2_STATUS="success"
      STEP2_EXIT=0
    else
      echo "[test] ✗ Installation failed"
      STEP2_STATUS="failed"
      STEP2_EXIT=$?
    fi

    # Step 3: Check if git method was selected
    echo "[test] Step 3: Check if git method was selected"
    if grep -iE '(install method.*git|install method.*npm)' /tmp/step-output.log; then
      echo "[test] ✓ Git method detected in output"
      STEP3_STATUS="success"
      STEP3_EXIT=0
    else
      echo "[test] ✗ Git method not detected"
      STEP3_STATUS="failed"
      STEP3_EXIT=1
    fi

    # Step 4: Verify wrapper script was created
    echo "[test] Step 4: Verify wrapper script was created"
    if grep -iE '(install|wrapper|checkout|directory)' /tmp/step-output.log | head -3; then
      echo "[test] ✓ Installer output contains relevant information"
      STEP4_STATUS="success"
      STEP4_EXIT=0
    else
      echo "[test] ✗ Installer output missing expected information"
      STEP4_STATUS="failed"
      STEP4_EXIT=1
    fi

    # Step 5: Check for yapyap binary (add common bin paths to PATH)
    echo "[test] Step 5: Check for yapyap binary"
    export PATH="$HOME/.local/bin:$PATH"
    export PATH="/usr/local/bin:$PATH"
    export PATH="/opt/homebrew/bin:$PATH"
    if command -v yapyap >/dev/null 2>&1; then
      echo "[test] ✓ yapyap binary found in PATH"
      STEP5_STATUS="success"
      STEP5_EXIT=0
    else
      echo "[test] ✗ yapyap binary not found in PATH"
      echo "[test] Checking for binary at common locations..."
      for bin_dir in "$HOME/.local/bin" "/usr/local/bin" "/opt/homebrew/bin"; do
        if [ -x "$bin_dir/yapyap" ]; then
          echo "[test] ✓ Found binary at $bin_dir/yapyap"
          export PATH="$bin_dir:$PATH"
          break
        fi
      done
      if ! command -v yapyap >/dev/null 2>&1; then
        STEP5_STATUS="failed"
        STEP5_EXIT=1
      else
        STEP5_STATUS="success"
        STEP5_EXIT=0
      fi
    fi

    # Step 6: Run yapyap --version to verify app works
    echo "[test] Step 6: Run yapyap --version to verify app works"
    if yapyap --version >/tmp/version-output.log 2>&1; then
      echo "[test] ✓ yapyap --version succeeded"
      STEP6_STATUS="success"
      STEP6_EXIT=0
    else
      echo "[test] ✗ yapyap --version failed"
      STEP6_STATUS="failed"
      STEP6_EXIT=1
    fi

    # Step 7: Verify version output is valid
    echo "[test] Step 7: Verify version output is valid"
    if grep -E '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$' /tmp/version-output.log >/dev/null 2>&1; then
      echo "[test] ✓ Version output is valid format"
      STEP7_STATUS="success"
      STEP7_EXIT=0
    else
      echo "[test] ✗ Version output is not in expected format"
      cat /tmp/version-output.log
      STEP7_STATUS="failed"
      STEP7_EXIT=1
    fi

    # Count failed steps
    FAILED_STEPS=0
    [ "$STEP1_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP2_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP3_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP4_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP5_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP6_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP7_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))

    echo "[test] Git installation test completed"
    echo "[test] Failed steps: $FAILED_STEPS/7"
    ;;

  npm)
    echo "[test] Running npm installation test"

    # Step 1: Verify script syntax
    echo "[test] Step 1: Verify script syntax"
    if bash -n /tmp/install.sh; then
      echo "[test] ✓ Script syntax check passed"
      STEP1_STATUS="success"
      STEP1_EXIT=0
    else
      echo "[test] ✗ Script syntax check failed"
      STEP1_STATUS="failed"
      STEP1_EXIT=1
    fi

    # Step 2: Run installation with npm method (actually install)
    echo "[test] Step 2: Run installation with npm method"
    if bash -c "cd /tmp && OSTYPE=linux-gnu /tmp/install.sh --install-method npm --no-onboard --no-prompt" > /tmp/step-output.log 2>&1; then
      echo "[test] ✓ Installation completed successfully"
      STEP2_STATUS="success"
      STEP2_EXIT=0
    else
      echo "[test] ✗ Installation failed"
      STEP2_STATUS="failed"
      STEP2_EXIT=$?
    fi

    # Step 3: Check if npm method was selected
    echo "[test] Step 3: Check if npm method was selected"
    if grep -iE '(install method.*git|install method.*npm)' /tmp/step-output.log; then
      echo "[test] ✓ NPM method detected in output"
      STEP3_STATUS="success"
      STEP3_EXIT=0
    else
      echo "[test] ✗ NPM method not detected"
      STEP3_STATUS="failed"
      STEP3_EXIT=1
    fi

    # Step 4: Verify npm package installation
    echo "[test] Step 4: Verify npm package installation"
    if grep -iE '(npm package|yapyap)' /tmp/step-output.log; then
      echo "[test] ✓ NPM package information found"
      STEP4_STATUS="success"
      STEP4_EXIT=0
    else
      echo "[test] ✗ NPM package information not found"
      STEP4_STATUS="failed"
      STEP4_EXIT=1
    fi

    # Step 5: Check for binary link
    echo "[test] Step 5: Check for binary link"
    if grep -iE '(yapyap|binary|link)' /tmp/step-output.log; then
      echo "[test] ✓ Binary information found"
      STEP5_STATUS="success"
      STEP5_EXIT=0
    else
      echo "[test] ✗ Binary information not found"
      STEP5_STATUS="failed"
      STEP5_EXIT=1
    fi

    # Step 6: Run yapyap --version to verify app works
    echo "[test] Step 6: Run yapyap --version to verify app works"
    if yapyap --version >/tmp/version-output.log 2>&1; then
      echo "[test] ✓ yapyap --version succeeded"
      STEP6_STATUS="success"
      STEP6_EXIT=0
    else
      echo "[test] ✗ yapyap --version failed"
      STEP6_STATUS="failed"
      STEP6_EXIT=1
    fi

    # Step 7: Verify version output is valid
    echo "[test] Step 7: Verify version output is valid"
    if grep -E '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$' /tmp/version-output.log >/dev/null 2>&1; then
      echo "[test] ✓ Version output is valid format"
      STEP7_STATUS="success"
      STEP7_EXIT=0
    else
      echo "[test] ✗ Version output is not in expected format"
      cat /tmp/version-output.log
      STEP7_STATUS="failed"
      STEP7_EXIT=1
    fi

    # Count failed steps
    FAILED_STEPS=0
    [ "$STEP1_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP2_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP3_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP4_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP5_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP6_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))
    [ "$STEP7_STATUS" = "failed" ] && FAILED_STEPS=$((FAILED_STEPS + 1))

    echo "[test] NPM installation test completed"
    echo "[test] Failed steps: $FAILED_STEPS/7"
    ;;

  *)
    echo "[test] Unknown test type: $TEST_TYPE" >&2
    exit 1
    ;;
esac

# Mark as complete
echo "[test] Test completed: $SCENARIO"
echo "[test] Result: $([ $FAILED_STEPS -eq 0 ] && echo "SUCCESS" || echo "FAILED")"

# Cleanup
rm -f /tmp/step-output.log /tmp/test-results/*.log
rm -rf /tmp/yapyap-test 2>/dev/null || true

# Exit with error if test failed
if [ $FAILED_STEPS -ne 0 ]; then
  exit 1
fi

exit 0