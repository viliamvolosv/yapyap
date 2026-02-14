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

ASSERT_OK="$(bun -e "const data=JSON.parse(await Bun.file(process.argv[1]).text());
const pass=Boolean(data.passed);
const statuses=[data.sendStatus,data.sendTargetStatus,data.sendReconnectStatus,data.sendRestartStatus]
  .filter((n)=>typeof n==='number' && n>0);
const sendOk=statuses.length>0 && statuses.every((n)=>n>=200 && n<300);
const invalidOk=(typeof data.invalidSendStatus!=='number') || data.invalidSendStatus===0 || data.invalidSendStatus===400;
console.log(pass && sendOk && invalidOk ? 'true' : 'false');" "$RESULT_FILE")"
if [ "$ASSERT_OK" != "true" ]; then
  echo "[assert] Scenario failed" >&2
  docker compose -f "$DOCKER_DIR/docker-compose.yml" logs controller || true
  exit 1
fi

echo "[assert] Scenario passed"
