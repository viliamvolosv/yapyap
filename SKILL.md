---
name: yapyap
description: YapYap messenger - Decentralized P2P messaging with end-to-end encryption. Use when working with YapYap CLI, installing, sending messages, or managing the node.
---

# YapYap Messenger

YapYap is a decentralized P2P messenger with end-to-end encrypted messaging, offline delivery, and no servers.

## Installation

### Quick Install (macOS/Linux)

```bash
curl -fsSL --proto '=https' --tlsv1.2 https://raw.githubusercontent.com/viliamvolosv/yapyap/main/install.sh | bash
```

### Install via Git (Development)

```bash
# Clone the repo
git clone https://github.com/viliamvolosv/yapyap.git
cd yapyap

# Install dependencies
bun install

# Build
bun run build

# Run CLI
bun run dist/cli.js <command>
```

### Requirements

- **Node.js 22+** (required)
- **Bun** (for development)
- **npm** (for global installs)

## Core Commands

### 1. Start the Node (Daemon Mode)

Start YapYap as a background service:

```bash
# Basic start
yapyap start

# Custom data directory
yapyap start --data-dir /path/to/data

# With API port
yapyap start --api-port 3000

# With custom listen address
yapyap start --listen /ip4/0.0.0.0/tcp/0

# Bootstrap from specific nodes
yapyap start --network /ip4/1.2.3.4/tcp/4001/p2p/QmXxxx...

# Verbose logging
yapyap start --verbose
```

**Tip:** Run this in the background (e.g., using `nohup yapyap start &`) to keep it running continuously.

### 2. Get Your Peer ID

Display your node's permanent identity:

```bash
yapyap get-peer-id
```

**Output:**
```
╔══════════════════════════════════════════════════════════╗
║                    YapYap Node Identity                   ║
╚══════════════════════════════════════════════════════════╝

Peer ID: QmXxxx...

This Peer ID is your permanent identity in the YapYap network.
Share it with others so they can send you messages.

To use this Peer ID:
  - Send messages: ./yapyap send-message --to <peer-id> --payload <text>
  - Add to contacts: POST to /api/database/contacts

To start your node (daemon mode):
  - ./yapyap start --data-dir /path/to/data
```

**Important:** Share your Peer ID with contacts so they can send you encrypted messages.

### 3. Send Encrypted Messages

Send an end-to-end encrypted message to a peer:

```bash
# Basic message
yapyap send-message \
  --to QmXxxx... \
  --payload "Hello from YapYap!"

# With alias
yapyap send-message \
  --to QmXxxx... \
  --payload "Secret message" \
  --alias "Alice"

# Disable encryption (not recommended)
yapyap send-message \
  --to QmXxxx... \
  --payload "Plain text" \
  --encrypted false
```

**Command structure:**
- `--to <peer-id>`: Target peer's Peer ID (required)
- `--payload <string>`: Message content (required)
- `--alias <name>`: Alias for the contact (optional)
- `--encrypted`: Enable encryption (default: true)

### 4. View Logs

Check node logs for troubleshooting:

```bash
# Show last 50 lines
yapyap logs

# Show last 100 lines
yapyap logs --tail 100

# Filter logs
yapyap logs --filter "error"
yapyap logs --filter "message"
```

**Log location:** `./data/yapyap.log`

### 5. Check Version

Display version information:

```bash
yapyap version
```

**Output:**
```
YapYap Messenger v1.0.0
Build time: 2025-01-15T10:30:00Z
Build environment: production
Platform: darwin-arm64
```

## Workflow Example

### Complete Setup and Messaging Flow

```bash
# 1. Start the node in background
nohup yapyap start > /dev/null 2>&1 &

# 2. Wait a moment for the node to initialize
sleep 5

# 3. Get your Peer ID
PEER_ID=$(yapyap get-peer-id | grep "Peer ID:" | awk '{print $2}')

# 4. Share your Peer ID with contacts
echo "My Peer ID: $PEER_ID"

# 5. Send an encrypted message
yapyap send-message \
  --to <CONTACT_PEER_ID> \
  --payload "Hello! I'm using YapYap for private messaging."

# 6. Check logs to verify message was sent
yapyap logs --tail 20
```

## Architecture Overview

### Key Concepts

- **Peer ID**: Your permanent identity in the YapYap network (base58-encoded Ed25519 public key)
- **End-to-end encryption**: Messages are encrypted before transmission using Ed25519
- **P2P network**: No servers - messages go directly between peers
- **Libp2p**: Underlying networking stack for transport and encryption
- **Offline delivery**: Messages persist in the database until delivered

### Network Stack

- **Transports**: TCP, WebSockets (for NAT traversal)
- **Encryption**: Noise protocol (XX/IK pattern)
- **Multiplexing**: Yamux (stream multiplexing over connections)
- **Crypto**: Ed25519 key pairs for identity and encryption

## API (Optional)

The node exposes a REST API on `http://localhost:<port>`:

```bash
# Check API status
curl http://localhost:3000/api/health

# Get contacts
curl http://localhost:3000/api/database/contacts

# Add a contact
curl -X POST http://localhost:3000/api/database/contacts \
  -H "Content-Type: application/json" \
  -d '{"peer_id": "QmXxxx...", "alias": "Alice"}'
```

## Configuration

### Environment Variables

```bash
# Log level (debug, info, warn, error)
export YAPYAP_LOG_LEVEL=debug

# Enable pretty logging
export YAPYAP_PRETTY_LOG=true

# Listen address
export YAPYAP_LISTEN_ADDR=/ip4/0.0.0.0/tcp/0

# Bootstrap node addresses (comma-separated)
export YAPYAP_BOOTSTRAP_ADDRS=/ip4/1.2.3.4/tcp/4001/p2p/QmXxxx...
```

### Data Directory

- Default: `./data`
- Stores: Database, keys, logs, message queue
- Custom: Use `--data-dir` flag

## Troubleshooting

### Node won't start

```bash
# Check if port is already in use
lsof -i :3000

# Check logs
yapyap logs --tail 50

# Verify Node.js version
node -v  # Should be v22+
```

### Can't send messages

```bash
# Verify peer ID is correct (32-character base58)
# Check node is running
ps aux | grep yapyap

# Check logs for errors
yapyap logs --filter "error"
```

### Need to restart the node

```bash
# Stop the process
pkill yapyap

# Start again
yapyap start
```

## Development

### Run in Development Mode

```bash
# Start with hot reload
bun dev

# This runs the development server on http://localhost:3000
# Use this for local testing and benchmarking
```

### Build for Production

```bash
# Build CLI
bun run build

# Or build CLI only
bun run build:cli

# Or build everything
bun run build:all
```

### Run Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test src/cli/index.test.ts

# Run with coverage
bun test --coverage
```

### Linting and Formatting

```bash
# Lint code
bun run lint

# Format code
bun run format

# Type check
bun run check

# Run all checks
bun run typecheck
```

## Integration Tests

### Run Docker Compose Suite

```bash
# Start the integration test suite
bash tests/integration/docker/run-basic-suite.sh

# Stop containers
docker compose -f tests/integration/docker/docker-compose.yml down -v

# Run custom scenarios
bash tests/integration/docker/run.sh
```

## Best Practices

1. **Keep your Peer ID safe**: It's your permanent identity
2. **Use encryption**: Always send encrypted messages (default)
3. **Run node in background**: Use `nohup` or system service
4. **Check logs**: Monitor logs for connectivity issues
5. **Backup data directory**: Contains your keys and message history
6. **Use bootstrap nodes**: Connect to known peers to discover others

## Key Files

- `src/cli/index.ts` - CLI entry point
- `src/core/node.ts` - YapYap node implementation
- `src/message/message-router.ts` - Message routing logic
- `src/database/schema.ts` - Database schema
- `docs/MESSAGE_FLOW.md` - Message lifecycle documentation
- `PLAN.md` - Architecture and roadmap

## Resources

- **Project README**: https://github.com/viliamvolosv/yapyap#readme
- **Message Flow**: `docs/MESSAGE_FLOW.md`
- **Architecture**: `PLAN.md`
- **MVP Roadmap**: `yapyap_mvp_stabilization_roadmap.md`