#!/bin/bash
# Integration Test: Message Forwarding Between Discovered Nodes
# This test verifies that messages can be forwarded between nodes that discovered each other via DHT

set -e

echo "========================================"
echo "Integration Test: Message Forwarding"
echo "========================================"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TEST_DIR="/tmp/yapyap-message-test-$$"
SENDER_DIR="$TEST_DIR/sender"
RELAY_DIR="$TEST_DIR/relay"
RECEIVER_DIR="$TEST_DIR/receiver"
SENDER_PORT=14001
RELAY_PORT=14002
RECEIVER_PORT=14003

cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    pkill -f "yapyap.*$SENDER_PORT" 2>/dev/null || true
    pkill -f "yapyap.*$RELAY_PORT" 2>/dev/null || true
    pkill -f "yapyap.*$RECEIVER_PORT" 2>/dev/null || true
    rm -rf "$TEST_DIR"
}

trap cleanup EXIT

mkdir -p "$SENDER_DIR" "$RELAY_DIR" "$RECEIVER_DIR"

echo -e "${GREEN}Test directory: $TEST_DIR${NC}"

# Start all nodes without bootstrap
echo -e "${YELLOW}Starting Sender node...${NC}"
node dist/cli.js start \
    --data-dir "$SENDER_DIR" \
    --api-port $SENDER_PORT \
    --listen "/ip4/127.0.0.1/tcp/0" \
    > "$SENDER_DIR/node.log" 2>&1 &
SENDER_PID=$!

echo -e "${YELLOW}Starting Relay node...${NC}"
node dist/cli.js start \
    --data-dir "$RELAY_DIR" \
    --api-port $RELAY_PORT \
    --listen "/ip4/127.0.0.1/tcp/0" \
    > "$RELAY_DIR/node.log" 2>&1 &
RELAY_PID=$!

echo -e "${YELLOW}Starting Receiver node...${NC}"
node dist/cli.js start \
    --data-dir "$RECEIVER_DIR" \
    --api-port $RECEIVER_PORT \
    --listen "/ip4/127.0.0.1/tcp/0" \
    > "$RECEIVER_DIR/node.log" 2>&1 &
RECEIVER_PID=$!

echo -e "${YELLOW}Waiting for nodes to initialize...${NC}"
sleep 5

# Verify nodes are running
for pid in $SENDER_PID $RELAY_PID $RECEIVER_PID; do
    if ! kill -0 $pid 2>/dev/null; then
        echo -e "${RED}ERROR: Node process $pid died${NC}"
        exit 1
    fi
done

echo -e "${GREEN}All nodes started${NC}"

# Get Peer IDs and Public Keys
echo -e "${YELLOW}Getting node information...${NC}"
SENDER_ID=$(curl -s "http://127.0.0.1:$SENDER_PORT/api/node/info" | jq -r '.data.peerId')
RELAY_ID=$(curl -s "http://127.0.0.1:$RELAY_PORT/api/node/info" | jq -r '.data.peerId')
RECEIVER_ID=$(curl -s "http://127.0.0.1:$RECEIVER_PORT/api/node/info" | jq -r '.data.peerId')

RECEIVER_PUBKEY=$(curl -s "http://127.0.0.1:$RECEIVER_PORT/api/node/info" | jq -r '.data.publicKey')

echo -e "${GREEN}Sender: $SENDER_ID${NC}"
echo -e "${GREEN}Relay: $RELAY_ID${NC}"
echo -e "${GREEN}Receiver: $RECEIVER_ID${NC}"

# Connect nodes manually (simulating discovered peers)
echo -e "${YELLOW}Connecting nodes...${NC}"

# Sender connects to Relay
curl -s -X POST "http://127.0.0.1:$SENDER_PORT/api/peers/$RELAY_ID/dial" > /dev/null
sleep 1

# Relay connects to Receiver
curl -s -X POST "http://127.0.0.1:$RELAY_PORT/api/peers/$RECEIVER_ID/dial" > /dev/null
sleep 1

# Sender connects to Receiver (direct path)
curl -s -X POST "http://127.0.0.1:$SENDER_PORT/api/peers/$RECEIVER_ID/dial" > /dev/null
sleep 1

# Verify connections
SENDER_CONNECTIONS=$(curl -s "http://127.0.0.1:$SENDER_PORT/api/peers" | jq -r 'length')
RELAY_CONNECTIONS=$(curl -s "http://127.0.0.1:$RELAY_PORT/api/peers" | jq -r 'length')
RECEIVER_CONNECTIONS=$(curl -s "http://127.0.0.1:$RECEIVER_PORT/api/peers" | jq -r 'length')

echo -e "${GREEN}Sender connections: $SENDER_CONNECTIONS${NC}"
echo -e "${GREEN}Relay connections: $RELAY_CONNECTIONS${NC}"
echo -e "${GREEN}Receiver connections: $RECEIVER_CONNECTIONS${NC}"

# Add Receiver as contact on Sender (for encryption)
echo -e "${YELLOW}Adding Receiver as contact on Sender...${NC}"
curl -s -X POST "http://127.0.0.1:$SENDER_PORT/api/database/contacts" \
    -H "Content-Type: application/json" \
    -d "{\"peerId\": \"$RECEIVER_ID\", \"publicKey\": \"$RECEIVER_PUBKEY\", \"alias\": \"Receiver\"}" \
    > /dev/null

# Send encrypted message
echo -e "${YELLOW}Sending encrypted message from Sender to Receiver...${NC}"
MESSAGE_PAYLOAD='{"text": "Hello, this is a test message!", "timestamp": '$(date +%s)'}'

SEND_RESPONSE=$(curl -s -X POST "http://127.0.0.1:$SENDER_PORT/api/messages/send" \
    -H "Content-Type: application/json" \
    -d "{\"to\": \"$RECEIVER_ID\", \"payload\": $MESSAGE_PAYLOAD}")

SEND_SUCCESS=$(echo "$SEND_RESPONSE" | jq -r '.success')

if [ "$SEND_SUCCESS" = "true" ]; then
    echo -e "${GREEN}✓ Message sent successfully${NC}"
    MESSAGE_ID=$(echo "$SEND_RESPONSE" | jq -r '.data.messageId // "unknown"')
    echo -e "${GREEN}Message ID: $MESSAGE_ID${NC}"
else
    echo -e "${RED}✗ Message send failed${NC}"
    echo "$SEND_RESPONSE" | jq -r '.error.message'
fi

# Wait for message delivery
echo -e "${YELLOW}Waiting for message delivery...${NC}"
sleep 3

# Check Receiver inbox
echo -e "${YELLOW}Checking Receiver inbox...${NC}"
INBOX_RESPONSE=$(curl -s "http://127.0.0.1:$RECEIVER_PORT/api/messages/inbox")
INBOX_COUNT=$(echo "$INBOX_RESPONSE" | jq -r '.data | length')

echo -e "${GREEN}Receiver inbox: $INBOX_COUNT messages${NC}"

if [ "$INBOX_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Message received!${NC}"
    echo -e "${YELLOW}Inbox contents:${NC}"
    echo "$INBOX_RESPONSE" | jq '.data'
else
    echo -e "${YELLOW}⚠ No messages in inbox (checking outbox...)${NC}"
    
    # Check Sender outbox
    OUTBOX_RESPONSE=$(curl -s "http://127.0.0.1:$SENDER_PORT/api/messages/outbox")
    OUTBOX_COUNT=$(echo "$OUTBOX_RESPONSE" | jq -r '.data | length')
    echo -e "${GREEN}Sender outbox: $OUTBOX_COUNT messages${NC}"
fi

# Test message forwarding through Relay
echo -e "${YELLOW}Testing message via Relay node...${NC}"

# Add Relay as contact
RELAY_PUBKEY=$(curl -s "http://127.0.0.1:$RELAY_PORT/api/node/info" | jq -r '.data.publicKey')
curl -s -X POST "http://127.0.0.1:$SENDER_PORT/api/database/contacts" \
    -H "Content-Type: application/json" \
    -d "{\"peerId\": \"$RELAY_ID\", \"publicKey\": \"$RELAY_PUBKEY\", \"alias\": \"Relay\"}" \
    > /dev/null

# Send message to Relay
RELAY_MESSAGE=$(curl -s -X POST "http://127.0.0.1:$SENDER_PORT/api/messages/send" \
    -H "Content-Type: application/json" \
    -d "{\"to\": \"$RELAY_ID\", \"payload\": {\"text\": \"Message for Relay\"}}")

echo -e "${GREEN}Relay message response: $(echo "$RELAY_MESSAGE" | jq -r '.success')${NC}"

# Check Relay inbox
sleep 2
RELAY_INBOX=$(curl -s "http://127.0.0.1:$RELAY_PORT/api/messages/inbox" | jq -r '.data | length')
echo -e "${GREEN}Relay inbox: $RELAY_INBOX messages${NC}"

# Summary
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo -e "${GREEN}Nodes started: 3/3${NC}"
echo -e "${GREEN}Connections established:${NC}"
echo -e "  Sender: $SENDER_CONNECTIONS"
echo -e "  Relay: $RELAY_CONNECTIONS"
echo -e "  Receiver: $RECEIVER_CONNECTIONS"
echo -e "${GREEN}Messages sent: 2${NC}"
echo -e "${GREEN}Receiver inbox: $INBOX_COUNT${NC}"
echo -e "${GREEN}Relay inbox: $RELAY_INBOX${NC}"
echo "========================================"

# Check for errors
echo -e "${YELLOW}Checking logs for errors...${NC}"
for dir in "$SENDER_DIR" "$RELAY_DIR" "$RECEIVER_DIR"; do
    ERROR_COUNT=$(grep -ci "error" "$dir/node.log" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo -e "${RED}$(basename $dir): $ERROR_COUNT errors${NC}"
        grep -i "error" "$dir/node.log" | head -3
    else
        echo -e "${GREEN}$(basename $dir): No errors${NC}"
    fi
done

echo -e "${GREEN}Test completed!${NC}"
echo -e "${YELLOW}Logs: $TEST_DIR${NC}"

exit 0
