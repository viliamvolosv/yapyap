---
name: yapyap
description: YapYap is a decentralized P2P messenger node and CLI library. Use when working with YapYap installation, configuration, messaging, network operations, or debugging messaging flows.
disable-model-invocation: false
---

# YapYap Messenger

YapYap is a decentralized, peer-to-peer messenger node and CLI library built with Node.js + TypeScript. It prioritizes reliable end-to-end encrypted delivery, offline/store-and-forward support, deduplication, and ACK-driven reliability.

## Quick Install

Install YapYap with a single command (no options needed):

```bash
curl -fsSL https://viliamvolosv.github.io/yapyap/install.sh | bash
```

This installs the `yapyap` CLI binary to your system and sets up a default configuration.

**Requirements:** Node.js ≥22.12.0

---

## Basic CLI Commands

### Initialize a YapYap node

```bash
yapyap init
```

Creates a new YapYap node with default configuration. This sets up the SQLite database and network identity.

### Start a YapYap node

```bash
yapyap start
```

Starts the YapYap node and connects to the P2P network. This runs continuously in the terminal.

### Send a message

```bash
yapyap send <peer-id> <message>
```

Sends an end-to-end encrypted message to a peer. The message is delivered via the P2P network with retry logic.

### Check node status

```bash
yapyap status
```

Shows current node status including:
- Network connectivity
- Peer list
- Message queue status
- Database statistics

### List connected peers

```bash
yapyap peers
```

Displays all currently connected peers with their peer IDs.

---

## Key Features

### End-to-End Encryption
All messages are encrypted using Noise XX/IK protocol and Ed25519 signatures. Only the intended recipient can decrypt messages.

### Offline Delivery
YapYap supports store-and-forward delivery. Messages are queued locally and delivered when the peer comes online.

### Deduplication
The system maintains a deduplication cache to prevent duplicate message processing.

### ACK-Driven Reliability
Messages require acknowledgments for reliable delivery. Failed transmissions are automatically retried with exponential backoff.

### Persistence
Messages and processed messages are persisted in SQLite using `better-sqlite3` with tables for `message_queue` and `processed_messages`.

---

## Network Architecture

YapYap uses libp2p for networking with:
- **Transport:** TCP and WebSocket with yamux multiplexing
- **Discovery:** Bootstrap nodes and DHT
- **NAT Traversal:** Autonat and relay fallbacks

The message flow follows this pipeline (see `docs/MESSAGE_FLOW.md`):
1. Enqueue message into database
2. Transmit via P2P network
3. Await ACK from recipient
4. Update message status (pending → processing → transmitting → delivered/failed)
5. Retry failed messages with backoff

---

## Common Use Cases

### Setting up a new YapYap instance
```bash
# Install
curl -fsSL https://viliamvolosv.github.io/yapyap/install.sh | bash

# Initialize node
yapyap init

# Start the node
yapyap start
```

### Sending encrypted messages
```bash
# After starting the node and connecting to peers, send messages
yapyap send <peer-id> "Your encrypted message here"
```

### Monitoring message delivery
```bash
# Check status to see message queue and delivery status
yapyap status

# View connected peers
yapyap peers
```

### Checking logs and debugging
The CLI runs in the terminal where it's started. Look for:
- Connection success/failure messages
- Message transmission logs
- ACK confirmations
- Retry attempts

---

## Development & Testing

### Running locally from source
```bash
# Clone and install dependencies
git clone https://github.com/viliamvolosv/yapyap
cd yapyap
npm install

# Build the project
npm run build:all

# Start development server
npm run dev

# Run the CLI directly
node dist/cli.js start
```

### Running tests
```bash
# Run all tests
npm test

# Run specific test file
node --test path/to/file.test.ts
```

### Integration testing
```bash
# Run Docker Compose integration suite
bash tests/integration/docker/run-basic-suite.sh

# Run custom scenarios
bash tests/integration/docker/run.sh
```

---

## Documentation

For detailed information about:
- **Message flow and pipeline:** See `docs/MESSAGE_FLOW.md`
- **Architecture and roadmap:** See `PLAN.md`
- **MVP stabilization roadmap:** See `yapyap_mvp_stabilization_roadmap.md`

---

## Troubleshooting

### Node won't start
- Check Node.js version: `node --version` (requires ≥22.12.0)
- Verify database permissions in the data directory
- Check for port conflicts (default ports for libp2p)

### Messages not delivering
- Verify peers are connected: `yapyap peers`
- Check node status: `yapyap status`
- Review logs for transmission errors
- Ensure both nodes have proper NAT traversal configured

### Database issues
- Database is created automatically on `yapyap init`
- Location is typically in the current directory (check configuration)
- Database uses SQLite with better-sqlite3

---

## Security Notes

- **Never share your peer ID** — it's your network identity
- **Messages are encrypted end-to-end** — only recipients can read them
- **Peer connections are authenticated** using Ed25519 signatures
- **Network traffic is encrypted** using Noise protocol
- Do not enable debug mode in production environments

---

## Example Workflow

1. **Install YapYap:**
   ```bash
   curl -fsSL https://viliamvolosv.github.io/yapyap/install.sh | bash
   ```

2. **Initialize your node:**
   ```bash
   yapyap init
   ```

3. **Start the node:**
   ```bash
   yapyap start
   ```

4. **Connect to peers** (after network bootstrap or via DHT discovery)

5. **Send encrypted messages:**
   ```bash
   yapyap send <peer-id> "Hello, encrypted message!"
   ```

6. **Monitor status:**
   ```bash
   yapyap status
   yapyap peers
   ```

---

## Related Resources

- **Project GitHub:** https://github.com/viliamvolosv/yapyap
- **Quick Install:** https://viliamvolosv.github.io/yapyap/install.sh
- **AGENT skill:** Get started quickly with `curl -s https://viliamvolosv.github.io/yapyap/skill.md | bash`