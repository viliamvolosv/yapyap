#!/bin/sh
set -e

RESULTS_DIR="/results"
mkdir -p "$RESULTS_DIR"
STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
SCENARIO="${TEST_SCENARIO:-basic-messaging}"
RESULT_FILE="$RESULTS_DIR/$SCENARIO.result.json"

PASSED=true
ERRORS=""
SEND_STATUS=0
SEND_TARGET_STATUS=0
INVALID_SEND_STATUS=0
SEND_BODY="{}"
SEND_RECONNECT_STATUS=0
SEND_RECONNECT_BODY="{}"
SEND_RESTART_STATUS=0
SEND_RESTART_BODY="{}"

echo "[controller] Loading scenario: $SCENARIO"
SCENARIO_FILE="/scenarios/$SCENARIO.yml"
if [ ! -f "$SCENARIO_FILE" ]; then
  echo "Scenario not found: $SCENARIO_FILE" >&2
  exit 1
fi

fetch_json() {
  URL="$1"
  bun -e "const u=process.argv[1]; const res=await fetch(u); if(!res.ok){console.error('http',res.status,'for',u); process.exit(2)} const t=await res.text(); console.log(t);" "$URL"
}

wait_health() {
  HOST="$1"
  for i in $(seq 1 30); do
    if bun -e "const h=process.argv[1]; fetch('http://'+h+':3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));" "$HOST"; then
      echo "[controller] $HOST healthy"
      return 0
    fi
    sleep 1
  done
  echo "[controller] $HOST failed health check" >&2
  return 1
}

assert_node_info() {
  HOST="$1"
  JSON="$(fetch_json "http://$HOST:3000/api/node/info")"
  echo "$JSON" | bun -e "const data=JSON.parse(await Bun.stdin.text()); if(!data.peerId || typeof data.peerId !== 'string'){console.error('missing peerId'); process.exit(1)}"
}

wait_peer_connected() {
  HOST="$1"
  TARGET_PEER_ID="$2"
  for i in $(seq 1 30); do
    if bun -e "const host=process.argv[1]; const target=process.argv[2];
      const res=await fetch('http://'+host+':3000/api/peers');
      if(!res.ok){process.exit(1)}
      const peers=await res.json();
      const connected=Array.isArray(peers) && peers.some((p)=>p?.peerId===target);
      process.exit(connected?0:1);" "$HOST" "$TARGET_PEER_ID"; then
      echo "[controller] $HOST connected to $TARGET_PEER_ID"
      return 0
    fi
    sleep 1
  done
  echo "[controller] $HOST failed to connect to $TARGET_PEER_ID" >&2
  return 1
}

wait_peer_disconnected() {
  HOST="$1"
  TARGET_PEER_ID="$2"
  for i in $(seq 1 20); do
    if bun -e "const host=process.argv[1]; const target=process.argv[2];
      const res=await fetch('http://'+host+':3000/api/peers');
      if(!res.ok){process.exit(1)}
      const peers=await res.json();
      const connected=Array.isArray(peers) && peers.some((p)=>p?.peerId===target);
      process.exit(connected?1:0);" "$HOST" "$TARGET_PEER_ID"; then
      echo "[controller] $HOST disconnected from $TARGET_PEER_ID"
      return 0
    fi
    sleep 1
  done
  echo "[controller] $HOST failed to disconnect from $TARGET_PEER_ID" >&2
  return 1
}

wait_inbox_delivery() {
  HOST="$1"
  KIND="$2"
  for i in $(seq 1 40); do
    if bun -e "const host=process.argv[1]; const kind=process.argv[2];
      const res=await fetch('http://'+host+':3000/api/messages/inbox');
      if(!res.ok){process.exit(1)}
      const data=await res.json();
      const inbox=Array.isArray(data.inbox)?data.inbox:[];
      const delivered=inbox.some((entry)=>entry?.message?.payload?.kind===kind);
      process.exit(delivered?0:1);" "$HOST" "$KIND"; then
      echo "[controller] $HOST inbox received kind=$KIND"
      return 0
    fi
    sleep 1
  done
  echo "[controller] $HOST missing inbox message kind=$KIND" >&2
  return 1
}

append_error() {
  CODE="$1"
  if [ -z "$ERRORS" ]; then
    ERRORS="$CODE"
  else
    ERRORS="$ERRORS $CODE"
  fi
}

run_common_setup() {
  echo "[controller] Waiting for node health..."
  wait_health node1
  wait_health node2
  wait_health node3

  echo "[controller] Asserting node info endpoints..."
  assert_node_info node1
  assert_node_info node2
  assert_node_info node3
}

run_basic_messaging() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | bun -e "const data=JSON.parse(await Bun.stdin.text()); console.log(data.peerId)")"

  echo "[controller] Waiting for node1 to connect to node2..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Validating contact create/list on node1..."
  bun -e "const peerId=process.argv[1];
const createRes=await fetch('http://node1:3000/api/database/contacts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({peerId,alias:'node2',metadata:{source:'docker-it'}})});
if(!createRes.ok){console.error('contact-create-status',createRes.status); process.exit(1)}
const listRes=await fetch('http://node1:3000/api/database/contacts');
if(!listRes.ok){console.error('contact-list-status',listRes.status); process.exit(1)}
const data=await listRes.json();
if(!Array.isArray(data.contacts) || !data.contacts.some((c)=>c.peer_id===peerId)){console.error('contact-not-found'); process.exit(1)}" "$NODE2_PEER_ID"

  echo "[controller] Executing API send-message smoke from node1 -> node2 (to)..."
  SEND_RAW="$(bun -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'docker-smoke',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"
  SEND_STATUS="$(echo "$SEND_RAW" | bun -e "const d=JSON.parse(await Bun.stdin.text()); console.log(d.status)")"
  SEND_BODY="$(echo "$SEND_RAW" | bun -e "const d=JSON.parse(await Bun.stdin.text()); console.log(d.body)")"

  echo "[controller] Executing compatibility send-message using targetId..."
  SEND_TARGET_RAW="$(bun -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targetId:process.argv[1],payload:{kind:'docker-smoke-target',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"
  SEND_TARGET_STATUS="$(echo "$SEND_TARGET_RAW" | bun -e "const d=JSON.parse(await Bun.stdin.text()); console.log(d.status)")"

  echo "[controller] Executing negative send-message validation..."
  INVALID_SEND_STATUS="$(bun -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:'invalid-peer-id',payload:{kind:'invalid'}})}); console.log(res.status);")"

  echo "[controller] Validating node2 inbox delivery..."
  wait_inbox_delivery node2 docker-smoke
  wait_inbox_delivery node2 docker-smoke-target

  if [ "$SEND_STATUS" -ne 200 ]; then
    PASSED=false
    append_error "send_to_status_$SEND_STATUS"
  fi
  if [ "$SEND_TARGET_STATUS" -ne 200 ]; then
    PASSED=false
    append_error "send_target_status_$SEND_TARGET_STATUS"
  fi
  if [ "$INVALID_SEND_STATUS" -ne 400 ]; then
    PASSED=false
    append_error "invalid_send_status_$INVALID_SEND_STATUS"
  fi
}

run_basic_reconnect() {
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | bun -e "const data=JSON.parse(await Bun.stdin.text()); console.log(data.peerId)")"
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | bun -e "const data=JSON.parse(await Bun.stdin.text()); console.log(data.peerId)")"

  echo "[controller] Waiting for initial node1 <-> node2 connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"
  wait_peer_connected node2 "$NODE1_PEER_ID"

  echo "[controller] Forcing disconnect node1 <-> node2..."
  bun -e "const p=process.argv[1]; await fetch('http://node1:3000/api/peers/'+p,{method:'DELETE'});" "$NODE2_PEER_ID"
  bun -e "const p=process.argv[1]; await fetch('http://node2:3000/api/peers/'+p,{method:'DELETE'});" "$NODE1_PEER_ID"
  wait_peer_disconnected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending message during disconnected period..."
  RECONNECT_RAW="$(bun -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'docker-reconnect',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"
  SEND_RECONNECT_STATUS="$(echo "$RECONNECT_RAW" | bun -e "const d=JSON.parse(await Bun.stdin.text()); console.log(d.status)")"
  SEND_RECONNECT_BODY="$(echo "$RECONNECT_RAW" | bun -e "const d=JSON.parse(await Bun.stdin.text()); console.log(d.body)")"

  echo "[controller] Waiting for reconnect..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Verifying delivery after reconnect..."
  wait_inbox_delivery node2 docker-reconnect

  if [ "$SEND_RECONNECT_STATUS" -lt 200 ] || [ "$SEND_RECONNECT_STATUS" -ge 300 ]; then
    PASSED=false
    append_error "send_reconnect_status_$SEND_RECONNECT_STATUS"
  fi
}

run_basic_restart() {
  NODE2_BEFORE_RESTART="$(fetch_json http://node2:3000/api/node/info | bun -e "const data=JSON.parse(await Bun.stdin.text()); console.log(data.peerId)")"

  echo "[controller] Waiting for initial node1 -> node2 connectivity..."
  wait_peer_connected node1 "$NODE2_BEFORE_RESTART"

  echo "[controller] Triggering node2 process stop (container auto-restart expected)..."
  bun -e "const res=await fetch('http://node2:3000/api/node/stop',{method:'POST'}); console.log('stop-status',res.status);"

  echo "[controller] Waiting for node2 health after restart..."
  wait_health node2
  NODE2_AFTER_RESTART="$(fetch_json http://node2:3000/api/node/info | bun -e "const data=JSON.parse(await Bun.stdin.text()); console.log(data.peerId)")"

  echo "[controller] Waiting for node1 connectivity to restarted node2..."
  wait_peer_connected node1 "$NODE2_AFTER_RESTART"

  echo "[controller] Sending message to restarted node2..."
  RESTART_RAW="$(bun -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'docker-restart',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_AFTER_RESTART")"
  SEND_RESTART_STATUS="$(echo "$RESTART_RAW" | bun -e "const d=JSON.parse(await Bun.stdin.text()); console.log(d.status)")"
  SEND_RESTART_BODY="$(echo "$RESTART_RAW" | bun -e "const d=JSON.parse(await Bun.stdin.text()); console.log(d.body)")"

  echo "[controller] Verifying delivery after restart..."
  wait_inbox_delivery node2 docker-restart

  if [ "$SEND_RESTART_STATUS" -lt 200 ] || [ "$SEND_RESTART_STATUS" -ge 300 ]; then
    PASSED=false
    append_error "send_restart_status_$SEND_RESTART_STATUS"
  fi
}

run_common_setup
case "$SCENARIO" in
  basic-messaging)
    run_basic_messaging
    ;;
  basic-reconnect)
    run_basic_reconnect
    ;;
  basic-restart)
    run_basic_restart
    ;;
  *)
    echo "[controller] Unsupported scenario: $SCENARIO" >&2
    PASSED=false
    append_error "unsupported_scenario"
    ;;
esac

FINISHED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
cat > "$RESULT_FILE" <<EOF
{
  "scenario": "$SCENARIO",
  "startedAt": "$STARTED_AT",
  "finishedAt": "$FINISHED_AT",
  "passed": $PASSED,
  "sendStatus": $SEND_STATUS,
  "sendTargetStatus": $SEND_TARGET_STATUS,
  "invalidSendStatus": $INVALID_SEND_STATUS,
  "sendReconnectStatus": $SEND_RECONNECT_STATUS,
  "sendRestartStatus": $SEND_RESTART_STATUS,
  "sendBody": $(printf '%s' "$SEND_BODY" | bun -e "const t=await Bun.stdin.text(); console.log(JSON.stringify(t))"),
  "sendReconnectBody": $(printf '%s' "$SEND_RECONNECT_BODY" | bun -e "const t=await Bun.stdin.text(); console.log(JSON.stringify(t))"),
  "sendRestartBody": $(printf '%s' "$SEND_RESTART_BODY" | bun -e "const t=await Bun.stdin.text(); console.log(JSON.stringify(t))"),
  "errors": "$(echo "$ERRORS" | xargs)"
}
EOF

echo "[controller] Wrote $RESULT_FILE"
cat "$RESULT_FILE"
echo "[controller] Done."

if [ "$PASSED" = false ]; then
  exit 1
fi
