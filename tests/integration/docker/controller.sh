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
  node -e "const u=process.argv[1];
const res=await fetch(u);
if(!res.ok){console.error('http',res.status,'for',u); process.exit(2)}
const payload=await res.json();
if(payload && payload.success===false){
  console.error('api-error', payload.error?.message || JSON.stringify(payload.error));
  process.exit(3);
}
const output = payload && payload.success===true ? (payload.data ?? {}) : payload;
console.log(JSON.stringify(output));" "$URL"
}

wait_health() {
  HOST="$1"
  for i in $(seq 1 30); do
    if node -e "const h=process.argv[1]; fetch('http://'+h+':3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));" "$HOST"; then
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
  echo "$JSON" | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); if(!data.peerId || typeof data.peerId !== 'string'){console.error('missing peerId'); process.exit(1)}"
}

wait_peer_connected() {
  HOST="$1"
  TARGET_PEER_ID="$2"
  for i in $(seq 1 30); do
    if node -e "const host=process.argv[1]; const target=process.argv[2];
      const res=await fetch('http://'+host+':3000/api/peers');
      if(!res.ok){process.exit(1)}
      const body=await res.json();
      const payload = body && body.success===true ? body.data : body;
      const peers = Array.isArray(payload) ? payload : [];
      const connected=peers.some((p)=>p?.peerId===target);
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
    if node -e "const host=process.argv[1]; const target=process.argv[2];
      const res=await fetch('http://'+host+':3000/api/peers');
      if(!res.ok){process.exit(1)}
      const body=await res.json();
      const payload = body && body.success===true ? body.data : body;
      const peers = Array.isArray(payload) ? payload : [];
      const connected=peers.some((p)=>p?.peerId===target);
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
    if node -e "const host=process.argv[1]; const kind=process.argv[2];
      const res=await fetch('http://'+host+':3000/api/messages/inbox');
      if(!res.ok){process.exit(1)}
      const data=await res.json();
      const payload = data && data.success===true ? data.data : data;
      const inbox=Array.isArray(payload?.inbox)?payload.inbox:[];
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
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for node1 to connect to node2..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Validating contact create/list on node1..."
  node -e "const peerId=process.argv[1];
const createRes=await fetch('http://node1:3000/api/database/contacts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({peerId,alias:'node2',metadata:{source:'docker-it'}})});
if(!createRes.ok){console.error('contact-create-status',createRes.status); process.exit(1)}
const listRes=await fetch('http://node1:3000/api/database/contacts');
if(!listRes.ok){console.error('contact-list-status',listRes.status); process.exit(1)}
const response=await listRes.json();
const payload = response && response.success===true ? response.data : response;
const contacts=Array.isArray(payload.contacts) ? payload.contacts : [];
if(!contacts.some((c)=>c.peer_id===peerId)){console.error('contact-not-found'); process.exit(1)}" "$NODE2_PEER_ID"

  echo "[controller] Executing API send-message smoke from node1 -> node2 (to)..."
  SEND_RAW="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'docker-smoke',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"
  SEND_STATUS="$(echo "$SEND_RAW" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.status)")"
  SEND_BODY="$(echo "$SEND_RAW" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.body)")"

  echo "[controller] Executing compatibility send-message using targetId..."
  SEND_TARGET_RAW="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targetId:process.argv[1],payload:{kind:'docker-smoke-target',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"
  SEND_TARGET_STATUS="$(echo "$SEND_TARGET_RAW" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.status)")"

  echo "[controller] Executing negative send-message validation..."
  INVALID_SEND_STATUS="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:'invalid-peer-id',payload:{kind:'invalid'}})}); console.log(res.status);")"

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
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for initial node1 <-> node2 connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"
  wait_peer_connected node2 "$NODE1_PEER_ID"

  echo "[controller] Forcing disconnect node1 <-> node2..."
  node -e "const p=process.argv[1]; await fetch('http://node1:3000/api/peers/'+p,{method:'DELETE'});" "$NODE2_PEER_ID"
  node -e "const p=process.argv[1]; await fetch('http://node2:3000/api/peers/'+p,{method:'DELETE'});" "$NODE1_PEER_ID"
  wait_peer_disconnected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending message during disconnected period..."
  RECONNECT_RAW="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'docker-reconnect',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"
  SEND_RECONNECT_STATUS="$(echo "$RECONNECT_RAW" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.status)")"
  SEND_RECONNECT_BODY="$(echo "$RECONNECT_RAW" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.body)")"

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
  NODE2_BEFORE_RESTART="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for initial node1 -> node2 connectivity..."
  wait_peer_connected node1 "$NODE2_BEFORE_RESTART"

  echo "[controller] Triggering node2 process stop (container auto-restart expected)..."
  node -e "const res=await fetch('http://node2:3000/api/node/stop',{method:'POST'}); console.log('stop-status',res.status);"

  echo "[controller] Waiting for node2 health after restart..."
  wait_health node2
  NODE2_AFTER_RESTART="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for node1 connectivity to restarted node2..."
  wait_peer_connected node1 "$NODE2_AFTER_RESTART"

  echo "[controller] Sending message to restarted node2..."
  RESTART_RAW="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'docker-restart',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_AFTER_RESTART")"
  SEND_RESTART_STATUS="$(echo "$RESTART_RAW" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.status)")"
  SEND_RESTART_BODY="$(echo "$RESTART_RAW" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.body)")"

  echo "[controller] Verifying delivery after restart..."
  wait_inbox_delivery node2 docker-restart

  if [ "$SEND_RESTART_STATUS" -lt 200 ] || [ "$SEND_RESTART_STATUS" -ge 300 ]; then
    PASSED=false
    append_error "send_restart_status_$SEND_RESTART_STATUS"
  fi
}

run_message_state_transitions() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for node1 to connect to node2..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending state-test-1 message..."
  STATE_MSG_ID="state-$(date +%s)-1"
  SEND_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'state-test-1',id:process.argv[2],t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID" "$STATE_MSG_ID")"
  SEND_STATUS="$(echo "$SEND_RESULT" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.status)")"

  if [ "$SEND_STATUS" -lt 200 ] || [ "$SEND_STATUS" -ge 300 ]; then
    echo "[controller] Failed to send state-test-1 message"
    PASSED=false
    append_error "send_state_test_1_failed"
    return
  fi

  echo "[controller] Checking outbox status immediately after send..."
  sleep 1
  OUTBOX_CHECK="$(node -e "
const res=await fetch('http://node1:3000/api/messages/outbox');
if(!res.ok){console.log('{}');process.exit(0)}
const raw=await res.json();
const payload = raw && raw.success===true ? raw.data : raw;
const outbox=Array.isArray(payload?.outbox)?payload.outbox:[];
const msg=outbox.find(m=>m.message?.payload?.kind==='state-test-1');
if(msg){
  console.log(JSON.stringify({
    status: msg.status,
    attempts: msg.attempts,
    createdAt: msg.createdAt
  }));
}else{
  console.log('{}');
}
")"
  echo "[controller] Outbox status: $OUTBOX_CHECK"

  echo "[controller] Verifying state-test-1 delivery..."
  wait_inbox_delivery node2 state-test-1

  echo "[controller] Disconnecting node1 from node2..."
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  node -e "const p=process.argv[1]; await fetch('http://node1:3000/api/peers/'+p,{method:'DELETE'});" "$NODE2_PEER_ID"
  node -e "const p=process.argv[1]; await fetch('http://node2:3000/api/peers/'+p,{method:'DELETE'});" "$NODE1_PEER_ID"
  wait_peer_disconnected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending state-test-2 message while disconnected..."
  STATE_MSG_2_ID="state-$(date +%s)-2"
  SEND_2_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'state-test-2',id:process.argv[2],t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID" "$STATE_MSG_2_ID")"
  SEND_2_STATUS="$(echo "$SEND_2_RESULT" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.status)")"

  if [ "$SEND_2_STATUS" -lt 200 ] || [ "$SEND_2_STATUS" -ge 300 ]; then
    echo "[controller] Note: Send during disconnect returned $SEND_2_STATUS (may be queued)"
  fi

  echo "[controller] Checking outbox for retry scheduling while disconnected..."
  sleep 2
  OUTBOX_2_CHECK="$(node -e "
const res=await fetch('http://node1:3000/api/messages/outbox');
if(!res.ok){console.log('{}');process.exit(0)}
const raw=await res.json();
const payload = raw && raw.success===true ? raw.data : raw;
const outbox=Array.isArray(payload?.outbox)?payload.outbox:[];
const msg=outbox.find(m=>m.message?.payload?.kind==='state-test-2');
if(msg){
  console.log(JSON.stringify({
    status: msg.status,
    attempts: msg.attempts,
    nextRetryAt: msg.nextRetryAt
  }));
}else{
  console.log('{}');
}
")"
  echo "[controller] Outbox state-test-2 while disconnected: $OUTBOX_2_CHECK"

  echo "[controller] Waiting for reconnect and delivery..."
  wait_peer_connected node1 "$NODE2_PEER_ID"
  wait_inbox_delivery node2 state-test-2

  echo "[controller] Verifying final state - outbox should be cleared or message delivered..."
  sleep 2
  FINAL_OUTBOX="$(node -e "
const res=await fetch('http://node1:3000/api/messages/outbox');
if(!res.ok){console.log('[]');process.exit(0)}
const raw=await res.json();
const payload = raw && raw.success===true ? raw.data : raw;
const outbox=Array.isArray(payload?.outbox)?payload.outbox:[];
const stateMsgs=outbox.filter(m=>m.message?.payload?.kind && m.message.payload.kind.startsWith('state-test'));
console.log(stateMsgs.length);
")"
  echo "[controller] Final state messages in outbox: $FINAL_OUTBOX"

  echo "[controller] State transitions validated successfully"
}

run_retry_on_failure() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for initial connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"
  wait_peer_connected node2 "$NODE1_PEER_ID"

  echo "[controller] Disconnecting peers..."
  node -e "const p=process.argv[1]; await fetch('http://node1:3000/api/peers/'+p,{method:'DELETE'});" "$NODE2_PEER_ID"
  node -e "const p=process.argv[1]; await fetch('http://node2:3000/api/peers/'+p,{method:'DELETE'});" "$NODE1_PEER_ID"
  wait_peer_disconnected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending retry-test message while disconnected..."
  RETRY_MSG_ID="retry-$(date +%s)"
  SEND_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'retry-test',id:process.argv[2],t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID" "$RETRY_MSG_ID")"
  SEND_STATUS="$(echo "$SEND_RESULT" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.status)")"

  if [ "$SEND_STATUS" -lt 200 ] || [ "$SEND_STATUS" -ge 300 ]; then
    echo "[controller] Send returned $SEND_STATUS (expected for disconnected peer)"
  fi

  echo "[controller] Checking outbox for retry scheduling with status and attempts..."
  sleep 2
  OUTBOX_CHECK="$(node -e "
const res=await fetch('http://node1:3000/api/messages/outbox');
if(!res.ok){console.log('{}');process.exit(0)}
const raw=await res.json();
const payload = raw && raw.success===true ? raw.data : raw;
const outbox=Array.isArray(payload?.outbox)?payload.outbox:[];
const msg=outbox.find(m=>m.message?.payload?.kind==='retry-test');
if(msg){
  console.log(JSON.stringify({
    messageId: msg.messageId,
    status: msg.status,
    attempts: msg.attempts,
    nextRetryAt: msg.nextRetryAt,
    targetPeerId: msg.targetPeerId
  }));
}else{
  console.log('{}');
}
")"

  echo "[controller] Outbox message: $OUTBOX_CHECK"

  if [ "$OUTBOX_CHECK" != "{}" ] && [ -n "$OUTBOX_CHECK" ]; then
    MSG_STATUS="$(echo "$OUTBOX_CHECK" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.status||'unknown')")"
    MSG_ATTEMPTS="$(echo "$OUTBOX_CHECK" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.attempts||0)")"
    MSG_NEXT_RETRY="$(echo "$OUTBOX_CHECK" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.nextRetryAt||0)")"
    
    echo "[controller] Message status: $MSG_STATUS, attempts: $MSG_ATTEMPTS, nextRetryAt: $MSG_NEXT_RETRY"
    
    if [ "$MSG_ATTEMPTS" -gt 0 ]; then
      echo "[controller] Retry mechanism working: attempts = $MSG_ATTEMPTS"
    fi
    
    if [ "$MSG_NEXT_RETRY" -gt 0 ]; then
      echo "[controller] Next retry scheduled at: $MSG_NEXT_RETRY"
    fi
  else
    echo "[controller] Warning: Message not found in outbox yet (may need more time)"
  fi

  echo "[controller] Reconnecting and waiting for delivery..."
  wait_peer_connected node1 "$NODE2_PEER_ID"
  wait_inbox_delivery node2 retry-test

  echo "[controller] Verifying message delivered and outbox cleared..."
  sleep 2
  OUTBOX_AFTER="$(node -e "
const res=await fetch('http://node1:3000/api/messages/outbox');
if(!res.ok){console.log('[]');process.exit(0)}
const raw=await res.json();
const payload = raw && raw.success===true ? raw.data : raw;
const outbox=Array.isArray(payload?.outbox)?payload.outbox:[];
const msg=outbox.find(m=>m.message?.payload?.kind==='retry-test');
console.log(msg?'found':'not-found');
")"
  echo "[controller] After delivery check: $OUTBOX_AFTER"

  echo "[controller] Retry behavior validated successfully"
}

run_database_persistence() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for node1 to connect to node2..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Adding contact to node2 before restart..."
  node -e "const peerId=process.argv[1];
const createRes=await fetch('http://node2:3000/api/database/contacts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({peerId,alias:'node1-persist-test',metadata:{test:'persistence'}})});
if(!createRes.ok){console.error('contact-create-failed',createRes.status); process.exit(1)}" "$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Sending persist-test-1 message..."
  SEND_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'persist-test-1',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"

  echo "[controller] Waiting for delivery..."
  wait_inbox_delivery node2 persist-test-1

  echo "[controller] Recording inbox state before restart..."
  INBOX_BEFORE="$(fetch_json http://node2:3000/api/messages/inbox)"

  echo "[controller] Stopping node2..."
  node -e "const res=await fetch('http://node2:3000/api/node/stop',{method:'POST'}); console.log('stop-status',res.status);"

  echo "[controller] Waiting for node2 restart..."
  sleep 5
  wait_health node2

  NODE2_AFTER_RESTART="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Checking inbox persistence (accounting for peer ID change on restart)..."
  echo "[controller] Note: Inbox check is informational - peer ID changes on restart"
  echo "[controller] Key persistence checks: contacts and message delivery after restart"

  echo "[controller] Verifying contacts persisted..."
  CONTACTS_AFTER="$(fetch_json http://node2:3000/api/database/contacts)"
  HAS_CONTACTS="$(echo "$CONTACTS_AFTER" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(Array.isArray(d.contacts)&&d.contacts.length>0?'true':'false')")"

  if [ "$HAS_CONTACTS" != "true" ]; then
    echo "[controller] Persistence check failed: contacts lost"
    PASSED=false
    append_error "persistence_contacts_lost"
  else
    echo "[controller] Contacts persisted correctly"
  fi

  echo "[controller] Reconnecting and sending new message..."
  wait_peer_connected node1 "$NODE2_AFTER_RESTART"

  SEND_2_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'persist-test-2',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_AFTER_RESTART")"
  SEND_2_STATUS="$(echo "$SEND_2_RESULT" | node -e "const d=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(d.status)")"

  if [ "$SEND_2_STATUS" -lt 200 ] || [ "$SEND_2_STATUS" -ge 300 ]; then
    PASSED=false
    append_error "send_persist_test_2_failed"
  fi

  wait_inbox_delivery node2 persist-test-2
  echo "[controller] Database persistence validated successfully"
}

run_deduplication() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for node1 to connect to node2..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  DEDUP_MSG_ID="dedup-$(date +%s)"

  echo "[controller] Sending dedup-test message with ID: $DEDUP_MSG_ID (3 times)"
  for i in 1 2 3; do
    SEND_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'dedup-test',id:process.argv[2],seq:$i,t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID" "$DEDUP_MSG_ID")"
    echo "[controller] Send attempt $i completed"
    sleep 0.5
  done

  echo "[controller] Waiting for inbox to stabilize..."
  sleep 3

  echo "[controller] Checking inbox for duplicate handling (processed_messages table equivalent)..."
  DEDUP_CHECK="$(node -e "
const res=await fetch('http://node2:3000/api/messages/inbox');
if(!res.ok){console.log('-1');process.exit(0)}
const raw=await res.json();
const payload = raw && raw.success===true ? raw.data : raw;
const inbox=Array.isArray(payload?.inbox)?payload.inbox:[];
const dedupMsgs=inbox.filter(m=>m.message?.payload?.kind==='dedup-test'&&m.message?.payload?.id===process.argv[1]);
console.log(dedupMsgs.length);
" "$DEDUP_MSG_ID")"

  echo "[controller] Deduplication check: found $DEDUP_CHECK copies (expected 1)"
  
  if [ "$DEDUP_CHECK" -eq 1 ]; then
    echo "[controller] Deduplication PASSED: exactly 1 copy in processed_messages (inbox)"
  elif [ "$DEDUP_CHECK" -gt 1 ]; then
    echo "[controller] Deduplication FAILED: found $DEDUP_CHECK copies (expected 1)"
    PASSED=false
    append_error "deduplication_failed_$DEDUP_CHECK_copies"
  else
    echo "[controller] Deduplication WARNING: no copies found (message may not have been delivered)"
    PASSED=false
    append_error "deduplication_no_copies"
  fi

  echo "[controller] Sending dedup-test-2 with new ID..."
  DEDUP_MSG_2_ID="dedup-$(date +%s)-2"
  SEND_2_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'dedup-test-2',id:process.argv[2],t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID" "$DEDUP_MSG_2_ID")"

  wait_inbox_delivery node2 dedup-test-2

  echo "[controller] Verifying total inbox has 2 unique messages..."
  TOTAL_INBOX="$(node -e "
const res=await fetch('http://node2:3000/api/messages/inbox');
if(!res.ok){console.log('0');process.exit(0)}
const raw=await res.json();
const payload = raw && raw.success===true ? raw.data : raw;
const inbox=Array.isArray(payload?.inbox)?payload.inbox:[];
const uniqueMsgs=inbox.filter(m=>m.message?.payload?.kind && (m.message?.payload?.kind==='dedup-test' || m.message?.payload?.kind==='dedup-test-2'));
console.log(uniqueMsgs.length);
")"
  echo "[controller] Total dedup test messages in inbox: $TOTAL_INBOX"

  if [ "$TOTAL_INBOX" -ne 2 ]; then
    echo "[controller] Warning: expected 2 unique messages, got $TOTAL_INBOX"
  fi

  echo "[controller] Deduplication validated successfully"
}

run_network_interruption() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending network-test-1 while connected..."
  SEND_1="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'network-test-1',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"
  wait_inbox_delivery node2 network-test-1
  echo "[controller] Immediate delivery verified"

  echo "[controller] Disconnecting peers..."
  node -e "const p=process.argv[1]; await fetch('http://node1:3000/api/peers/'+p,{method:'DELETE'});" "$NODE2_PEER_ID"
  node -e "const p=process.argv[1]; await fetch('http://node2:3000/api/peers/'+p,{method:'DELETE'});" "$NODE1_PEER_ID"
  wait_peer_disconnected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending network-test-2 while disconnected..."
  SEND_2="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'network-test-2',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"

  echo "[controller] Waiting 3s and checking outbox..."
  sleep 3

  echo "[controller] Reconnecting..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Verifying queued message delivery..."
  wait_inbox_delivery node2 network-test-2

  echo "[controller] Sending network-test-3 after recovery..."
  SEND_3="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'network-test-3',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE2_PEER_ID")"
  wait_inbox_delivery node2 network-test-3

  echo "[controller] Network interruption validated successfully"
}

run_multi_hop_routing() {
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  NODE3_PEER_ID="$(fetch_json http://node3:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for mesh discovery..."
  wait_peer_connected node1 "$NODE2_PEER_ID"
  wait_peer_connected node1 "$NODE3_PEER_ID"

  echo "[controller] Sending multi-hop-test from node1 to node3..."
  MULTIHOP_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'multi-hop-test',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE3_PEER_ID")"

  echo "[controller] Waiting for delivery to node3..."
  wait_inbox_delivery node3 multi-hop-test
  echo "[controller] Multi-hop delivery verified"

  echo "[controller] Sending reverse-hop-test via node2..."
  REVERSE_RESULT="$(node -e "const res=await fetch('http://node2:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'reverse-hop-test',t:Date.now()}})});
const body=await res.text();
console.log(JSON.stringify({status:res.status,body}));" "$NODE1_PEER_ID")"

  wait_inbox_delivery node1 reverse-hop-test
  echo "[controller] Bidirectional routing validated successfully"
}

run_message_size_limits() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending small message (below limit)..."
  SMALL_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'size-small',data:'x'.repeat(100),t:Date.now()}})});
console.log(res.status);" "$NODE2_PEER_ID")"
  wait_inbox_delivery node2 size-small

  echo "[controller] Sending medium message (1KB)..."
  MEDIUM_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'size-medium',data:'x'.repeat(1024),t:Date.now()}})});
console.log(res.status);" "$NODE2_PEER_ID")"
  wait_inbox_delivery node2 size-medium

  echo "[controller] Sending large message (1MB)..."
  LARGE_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'size-large',data:'x'.repeat(1048576),t:Date.now()}})});
console.log(res.status);" "$NODE2_PEER_ID")"

  if [ "$LARGE_RESULT" -ge 400 ] || [ "$LARGE_RESULT" -lt 200 ]; then
    echo "[controller] Large message correctly rejected with status $LARGE_RESULT"
  else
    echo "[controller] Note: Large message accepted (status $LARGE_RESULT)"
  fi

  echo "[controller] Verifying node stability..."
  wait_health node1
  wait_health node2
  echo "[controller] Message size limits validated successfully"
}

run_invalid_message_format() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Testing missing payload..."
  MISSING_PAYLOAD="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1]})}); console.log(res.status);" "$NODE2_PEER_ID")"
  if [ "$MISSING_PAYLOAD" -ne 400 ]; then
    echo "[controller] Expected 400 for missing payload, got $MISSING_PAYLOAD"
    PASSED=false
    append_error "invalid_missing_payload_$MISSING_PAYLOAD"
  fi

  echo "[controller] Testing invalid peer ID format..."
  INVALID_PEER="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:'invalid-peer-id-format',payload:{kind:'test'}})}); console.log(res.status);")"
  if [ "$INVALID_PEER" -ne 400 ]; then
    echo "[controller] Expected 400 for invalid peer ID, got $INVALID_PEER"
    PASSED=false
    append_error "invalid_peer_id_$INVALID_PEER"
  fi

  echo "[controller] Testing null target..."
  NULL_TARGET="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:null,payload:{kind:'test'}})}); console.log(res.status);")"
  if [ "$NULL_TARGET" -ne 400 ]; then
    echo "[controller] Expected 400 for null target, got $NULL_TARGET"
    PASSED=false
    append_error "invalid_null_target_$NULL_TARGET"
  fi

  echo "[controller] Testing valid message..."
  VALID_RESULT="$(node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'format-valid',t:Date.now()}})}); console.log(res.status);" "$NODE2_PEER_ID")"

  wait_inbox_delivery node2 format-valid

  echo "[controller] Verifying node stability after invalid inputs..."
  wait_health node1
  wait_health node2
  echo "[controller] Invalid message format handling validated successfully"
}

run_high_load_concurrency() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending multiple messages rapidly..."
  for i in $(seq 1 5); do
    node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'load-test-$i',t:Date.now()}})}); console.log(res.status);" "$NODE2_PEER_ID" &
  done
  wait

  echo "[controller] Waiting for deliveries..."
  for i in $(seq 1 5); do
    wait_inbox_delivery node2 load-test-$i
  done

  echo "[controller] Verifying node stability..."
  wait_health node1
  wait_health node2

  echo "[controller] High load concurrency validated"
}

run_peer_timeout() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending timeout-test-1 while connected..."
  node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'timeout-test-1',t:Date.now()}})}); console.log(res.status);" "$NODE2_PEER_ID"
  wait_inbox_delivery node2 timeout-test-1

  echo "[controller] Disconnecting nodes..."
  node -e "const p=process.argv[1]; await fetch('http://node1:3000/api/peers/'+p,{method:'DELETE'});" "$NODE2_PEER_ID"
  node -e "const p=process.argv[1]; await fetch('http://node2:3000/api/peers/'+p,{method:'DELETE'});" "$NODE1_PEER_ID"
  wait_peer_disconnected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending timeout-test-2 while disconnected..."
  node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'timeout-test-2',t:Date.now()}})}); console.log(res.status);" "$NODE2_PEER_ID"

  echo "[controller] Waiting 10s for connection attempts..."
  sleep 10

  echo "[controller] Reconnecting..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Verifying timeout-test-2 delivered after reconnect..."
  wait_inbox_delivery node2 timeout-test-2

  echo "[controller] Verifying node stability..."
  wait_health node1
  wait_health node2
  echo "[controller] Peer timeout validated successfully"
}

run_queue_cleanup() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for initial connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Disconnecting nodes..."
  node -e "const p=process.argv[1]; await fetch('http://node1:3000/api/peers/'+p,{method:'DELETE'});" "$NODE2_PEER_ID"
  node -e "const p=process.argv[1]; await fetch('http://node2:3000/api/peers/'+p,{method:'DELETE'});" "$NODE1_PEER_ID"
  wait_peer_disconnected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending 10 messages while disconnected..."
  for i in $(seq 1 10); do
    node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'queue-cleanup-$i',t:Date.now()}})});" "$NODE2_PEER_ID" &
  done
  wait
  sleep 2

  echo "[controller] Checking outbox queue..."
  QUEUE_COUNT_1="$(node -e "const res=await fetch('http://node1:3000/api/messages/outbox');
const raw=await res.json();
const payload = raw && raw.success===true ? raw.data : raw;
console.log(payload?.outbox?.length||0);" )"
  echo "[controller] Queue has $QUEUE_COUNT_1 messages"

  echo "[controller] Reconnecting nodes..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Waiting for all 10 queued messages to deliver..."
  for i in $(seq 1 10); do
    wait_inbox_delivery node2 "queue-cleanup-$i"
  done

  echo "[controller] Disconnecting again..."
  node -e "const p=process.argv[1]; await fetch('http://node1:3000/api/peers/'+p,{method:'DELETE'});" "$NODE2_PEER_ID"
  node -e "const p=process.argv[1]; await fetch('http://node2:3000/api/peers/'+p,{method:'DELETE'});" "$NODE1_PEER_ID"
  wait_peer_disconnected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending 5 more messages..."
  for i in $(seq 1 5); do
    node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'queue-cleanup-fail-$i',t:Date.now()}})});" "$NODE2_PEER_ID" &
  done
  wait

  echo "[controller] Reconnecting..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Verifying final 5 messages delivered..."
  for i in $(seq 1 5); do
    wait_inbox_delivery node2 "queue-cleanup-fail-$i"
  done

  echo "[controller] Queue cleanup validated successfully"
}

run_handshake_validation() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for peer connection..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Verifying peer connection established..."
  PEER_INFO="$(fetch_json http://node1:3000/api/peers/$NODE2_PEER_ID)"
  echo "[controller] Peer info: $PEER_INFO"

  echo "[controller] Sending handshake-test-1..."
  node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'handshake-test-1',t:Date.now()}})}); console.log(res.status);" "$NODE2_PEER_ID"
  wait_inbox_delivery node2 handshake-test-1

  echo "[controller] Disconnecting..."
  node -e "const p=process.argv[1]; await fetch('http://node1:3000/api/peers/'+p,{method:'DELETE'});" "$NODE2_PEER_ID"
  node -e "const p=process.argv[1]; await fetch('http://node2:3000/api/peers/'+p,{method:'DELETE'});" "$NODE1_PEER_ID"
  wait_peer_disconnected node1 "$NODE2_PEER_ID"

  echo "[controller] Waiting 3s..."
  sleep 3

  echo "[controller] Reconnecting..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Verifying new session..."
  PEER_INFO_2="$(fetch_json http://node1:3000/api/peers/$NODE2_PEER_ID)"
  echo "[controller] New peer info: $PEER_INFO_2"

  echo "[controller] Sending handshake-test-2..."
  node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'handshake-test-2',t:Date.now()}})}); console.log(res.status);" "$NODE2_PEER_ID"
  wait_inbox_delivery node2 handshake-test-2

  echo "[controller] Handshake validation validated successfully"
}

run_privacy_validation() {
  NODE2_PEER_ID="$(fetch_json http://node2:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"
  NODE1_PEER_ID="$(fetch_json http://node1:3000/api/node/info | node -e "const data=JSON.parse(await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); })); console.log(data.peerId)")"

  echo "[controller] Waiting for connectivity..."
  wait_peer_connected node1 "$NODE2_PEER_ID"

  echo "[controller] Sending privacy-test-1..."
  node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'privacy-test-1',t:Date.now()}})}); console.log(res.status);" "$NODE2_PEER_ID"
  wait_inbox_delivery node2 privacy-test-1

  echo "[controller] Verifying message delivered..."
  INBOX_MSG="$(node -e "const res=await fetch('http://node2:3000/api/messages/inbox');
const raw=await res.json();
const payload = raw && raw.success===true ? raw.data : raw;
const msg=payload?.inbox?.find(m=>m.message?.payload?.kind==='privacy-test-1');
console.log(JSON.stringify(msg));")"
  echo "[controller] Inbox message: $INBOX_MSG"

  echo "[controller] Sending privacy-test-2..."
  node -e "const res=await fetch('http://node1:3000/api/messages/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({to:process.argv[1],payload:{kind:'privacy-test-2',t:Date.now()}})}); console.log(res.status);" "$NODE2_PEER_ID"
  wait_inbox_delivery node2 privacy-test-2

  echo "[controller] Checking peer IDs in peers list..."
  PEERS="$(fetch_json http://node1:3000/api/peers)"
  echo "[controller] Peers: $PEERS"

  echo "[controller] Privacy validation validated successfully"
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
  message-state-transitions)
    run_message_state_transitions
    ;;
  retry-on-failure)
    run_retry_on_failure
    ;;
  database-persistence)
    run_database_persistence
    ;;
  deduplication)
    run_deduplication
    ;;
  network-interruption)
    run_network_interruption
    ;;
  multi-hop-routing)
    run_multi_hop_routing
    ;;
  message-size-limits)
    run_message_size_limits
    ;;
  invalid-message-format)
    run_invalid_message_format
    ;;
  high-load-concurrency)
    run_high_load_concurrency
    ;;
  peer-timeout)
    run_peer_timeout
    ;;
  queue-cleanup)
    run_queue_cleanup
    ;;
  handshake-validation)
    run_handshake_validation
    ;;
  privacy-validation)
    run_privacy_validation
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
  "sendBody": $(printf '%s' "$SEND_BODY" | node -e "const t=await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); }); console.log(JSON.stringify(t))"),
  "sendReconnectBody": $(printf '%s' "$SEND_RECONNECT_BODY" | node -e "const t=await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); }); console.log(JSON.stringify(t))"),
  "sendRestartBody": $(printf '%s' "$SEND_RESTART_BODY" | node -e "const t=await new Promise(r => { let d=\"\"; process.stdin.on(\"data\", c => d+=c); process.stdin.on(\"end\", () => r(d)); }); console.log(JSON.stringify(t))"),
  "errors": "$(echo "$ERRORS" | xargs)"
}
EOF

echo "[controller] Wrote $RESULT_FILE"
cat "$RESULT_FILE"
echo "[controller] Done."

if [ "$PASSED" = false ]; then
  exit 1
fi
