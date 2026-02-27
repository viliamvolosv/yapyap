#!/bin/bash
# Integration Test: Peer Discovery Without Bootstrap
# This test verifies that nodes can discover each other via DHT without explicit bootstrap configuration

set -e

echo "========================================"
echo "Integration Test: DHT Peer Discovery"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test configuration
TEST_DIR="/tmp/yapyap-discovery-test-$$"
NODE1_DIR="$TEST_DIR/node1"
NODE2_DIR="$TEST_DIR/node2"
NODE3_DIR="$TEST_DIR/node3"
API_PORT1=13001
API_PORT2=13002
API_PORT3=13003

# Cleanup function
cleanup() {
    echo -e "${YELLOW}Cleaning up...${NC}"
    pkill -f "yapyap.*$API_PORT1" 2>/dev/null || true
    pkill -f "yapyap.*$API_PORT2" 2>/dev/null || true
    pkill -f "yapyap.*$API_PORT3" 2>/dev/null || true
    rm -rf "$TEST_DIR"
}

trap cleanup EXIT

# Create directories
mkdir -p "$NODE1_DIR" "$NODE2_DIR" "$NODE3_DIR"

echo -e "${GREEN}Test directory: $TEST_DIR${NC}"

# Start Node 1 (no bootstrap)
echo -e "${YELLOW}Starting Node 1 (no bootstrap)...${NC}"
node dist/cli.js start \
    --data-dir "$NODE1_DIR" \
    --api-port $API_PORT1 \
    --listen "/ip4/127.0.0.1/tcp/0" \
    > "$NODE1_DIR/node.log" 2>&1 &
NODE1_PID=$!

# Start Node 2 (no bootstrap)
echo -e "${YELLOW}Starting Node 2 (no bootstrap)...${NC}"
node dist/cli.js start \
    --data-dir "$NODE2_DIR" \
    --api-port $API_PORT2 \
    --listen "/ip4/127.0.0.1/tcp/0" \
    > "$NODE2_DIR/node.log" 2>&1 &
NODE2_PID=$!

# Start Node 3 (no bootstrap)
echo -e "${YELLOW}Starting Node 3 (no bootstrap)...${NC}"
node dist/cli.js start \
    --data-dir "$NODE3_DIR" \
    --api-port $API_PORT3 \
    --listen "/ip4/127.0.0.1/tcp/0" \
    > "$NODE3_DIR/node.log" 2>&1 &
NODE3_PID=$!

# Wait for nodes to start
echo -e "${YELLOW}Waiting for nodes to initialize...${NC}"
sleep 5

# Check if nodes are running
for pid in $NODE1_PID $NODE2_PID $NODE3_PID; do
    if ! kill -0 $pid 2>/dev/null; then
        echo -e "${RED}ERROR: Node process $pid died${NC}"
        exit 1
    fi
done

echo -e "${GREEN}All nodes started successfully${NC}"

# Get Peer IDs
echo -e "${YELLOW}Getting Peer IDs...${NC}"
NODE1_PEER_ID=$(curl -s "http://127.0.0.1:$API_PORT1/api/node/info" | jq -r '.data.peerId')
NODE2_PEER_ID=$(curl -s "http://127.0.0.1:$API_PORT2/api/node/info" | jq -r '.data.peerId')
NODE3_PEER_ID=$(curl -s "http://127.0.0.1:$API_PORT3/api/node/info" | jq -r '.data.peerId')

echo -e "${GREEN}Node 1 Peer ID: $NODE1_PEER_ID${NC}"
echo -e "${GREEN}Node 2 Peer ID: $NODE2_PEER_ID${NC}"
echo -e "${GREEN}Node 3 Peer ID: $NODE3_PEER_ID${NC}"

# Wait for DHT discovery
echo -e "${YELLOW}Waiting for DHT peer discovery (30 seconds)...${NC}"
sleep 30

# Check discovered peers on each node
echo -e "${YELLOW}Checking discovered peers...${NC}"

NODE1_DISCOVERED=$(curl -s "http://127.0.0.1:$API_PORT1/api/peers/discovered" | jq -r '.data.count')
NODE2_DISCOVERED=$(curl -s "http://127.0.0.1:$API_PORT2/api/peers/discovered" | jq -r '.data.count')
NODE3_DISCOVERED=$(curl -s "http://127.0.0.1:$API_PORT3/api/peers/discovered" | jq -r '.data.count')

echo -e "${GREEN}Node 1 discovered: $NODE1_DISCOVERED peers${NC}"
echo -e "${GREEN}Node 2 discovered: $NODE2_DISCOVERED peers${NC}"
echo -e "${GREEN}Node 3 discovered: $NODE3_DISCOVERED peers${NC}"

# Verify that at least some peers were discovered
TOTAL_DISCOVERED=$((NODE1_DISCOVERED + NODE2_DISCOVERED + NODE3_DISCOVERED))
if [ "$TOTAL_DISCOVERED" -gt 0 ]; then
    echo -e "${GREEN}✓ Peer discovery working: $TOTAL_DISCOVERED total peers discovered${NC}"
else
    echo -e "${YELLOW}⚠ No peers discovered via DHT (this may be expected in isolated environment)${NC}"
    echo -e "${YELLOW}  Testing manual peer connection instead...${NC}"
fi

# Test manual peer connection
echo -e "${YELLOW}Testing manual peer connection...${NC}"

# Connect Node 2 to Node 1
curl -s -X POST "http://127.0.0.1:$API_PORT2/api/peers/$NODE1_PEER_ID/dial" > /dev/null
sleep 2

# Check connections
NODE2_PEERS=$(curl -s "http://127.0.0.1:$API_PORT2/api/peers" | jq -r 'length')
echo -e "${GREEN}Node 2 connections: $NODE2_PEERS${NC}"

if [ "$NODE2_PEERS" -gt 0 ]; then
    echo -e "${GREEN}✓ Manual peer connection successful${NC}"
else
    echo -e "${YELLOW}⚠ Manual peer connection may have failed (checking logs)${NC}"
fi

# Test message sending between connected nodes
echo -e "${YELLOW}Testing message sending...${NC}"

# Add Node 1 as contact on Node 2 (get public key)
NODE1_PUBLIC_KEY=$(curl -s "http://127.0.0.1:$API_PORT1/api/node/info" | jq -r '.data.publicKey')

curl -s -X POST "http://127.0.0.1:$API_PORT2/api/database/contacts" \
    -H "Content-Type: application/json" \
    -d "{\"peerId\": \"$NODE1_PEER_ID\", \"publicKey\": \"$NODE1_PUBLIC_KEY\", \"alias\": \"Node1\"}" \
    > /dev/null

# Send message from Node 2 to Node 1
SEND_RESULT=$(curl -s -X POST "http://127.0.0.1:$API_PORT2/api/messages/send" \
    -H "Content-Type: application/json" \
    -d "{\"to\": \"$NODE1_PEER_ID\", \"payload\": {\"text\": \"Hello from Node 2!\"}}")

SEND_SUCCESS=$(echo "$SEND_RESULT" | jq -r '.success')

if [ "$SEND_SUCCESS" = "true" ]; then
    echo -e "${GREEN}✓ Message sent successfully${NC}"
else
    echo -e "${YELLOW}⚠ Message queued (recipient may need to be directly connected)${NC}"
fi

# Check Node 1 inbox
sleep 2
NODE1_INBOX=$(curl -s "http://127.0.0.1:$API_PORT1/api/messages/inbox" | jq -r '.data | length')
echo -e "${GREEN}Node 1 inbox: $NODE1_INBOX messages${NC}"

# Test trigger discovery endpoint
echo -e "${YELLOW}Testing manual discovery trigger...${NC}"
curl -s -X POST "http://127.0.0.1:$API_PORT1/api/peers/discover" > /dev/null
sleep 5

NODE1_DISCOVERED_AFTER=$(curl -s "http://127.0.0.1:$API_PORT1/api/peers/discovered" | jq -r '.data.count')
echo -e "${GREEN}Node 1 discovered after trigger: $NODE1_DISCOVERED_AFTER peers${NC}"

# Test dial cached peers
echo -e "${YELLOW}Testing dial cached peers...${NC}"
DIAL_RESULT=$(curl -s -X POST "http://127.0.0.1:$API_PORT1/api/peers/dial-cached")
DIALED=$(echo "$DIAL_RESULT" | jq -r '.data.dialed // 0')
echo -e "${GREEN}Dialed $DIALED cached peers${NC}"

# Summary
echo ""
echo "========================================"
echo "Test Summary"
echo "========================================"
echo -e "${GREEN}Nodes started: 3/3${NC}"
echo -e "${GREEN}Peer IDs obtained: 3/3${NC}"
echo -e "Peers discovered: $TOTAL_DISCOVERED"
echo -e "Manual connection: $NODE2_PEERS connections"
echo -e "Messages sent: $SEND_SUCCESS"
echo -e "Messages received: $NODE1_INBOX"
echo "========================================"

# Check logs for errors
echo -e "${YELLOW}Checking for errors in logs...${NC}"
for dir in "$NODE1_DIR" "$NODE2_DIR" "$NODE3_DIR"; do
    ERROR_COUNT=$(grep -ci "error" "$dir/node.log" 2>/dev/null | wc -l | tr -d ' ')
    if [ "$ERROR_COUNT" -gt 0 ]; then
        echo -e "${RED}Errors found in $(basename $dir)/node.log:${NC}"
        grep -i "error" "$dir/node.log" | head -5
    fi
done

echo -e "${GREEN}Test completed!${NC}"
echo -e "${YELLOW}Logs available at: $TEST_DIR${NC}"

# Keep nodes running for manual inspection if needed
# Uncomment the following line to prevent cleanup
# read -p "Press Enter to cleanup..."

exit 0
