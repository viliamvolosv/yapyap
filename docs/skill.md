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

### Start a YapYap node

```bash
yapyap start
```

Starts the YapYap node and connects to the P2P network. This runs continuously in the terminal.

**Options:**
```bash
yapyap start --data-dir /path/to/data --api-port 3000 --network /ip4/127.0.0.1/tcp/0 --listen /ip4/0.0.0.0/tcp/0 --verbose
```

- `--data-dir <path>`: Custom data directory (default: current directory/data)
- `--api-port <number>`: Override API port
- `--network <bootstrap>`: Bootstrap node addresses (comma-separated)
- `--listen <multiaddr>`: Libp2p listen multiaddr
- `--verbose`: Enable verbose logging

### Send a message to a peer

```bash
yapyap send-message --to <peer-id> --payload "Your message here"
```

Sends an end-to-end encrypted message to a peer. The message is delivered via the P2P network with retry logic.

**Options:**
```bash
yapyap send-message --to <peer-id> --payload "Hello, encrypted world!" --alias "Alice" --encrypted
```

- `--to <peer-id>`: Target peer ID (required)
- `--payload <string>`: Message content (required)
- `--encrypted`: Encrypt message (default: true)
- `--alias <name>`: Alias for the contact

### Get your Peer ID

```bash
yapyap get-peer-id
```

Displays your node's Peer ID and public key.

**Options:**
```bash
yapyap get-peer-id --data-dir /path/to/data
```

- `--data-dir <path>`: Custom data directory (default: current directory/data)

### View logs

```bash
yapyap logs
```

Shows the last 50 lines of logs.

**Options:**
```bash
yapyap logs --tail 100 --filter "error"
```

- `--tail <number>`: Show last N lines (default: 50)
- `--filter <pattern>`: Filter logs by pattern

### Display version information

```bash
yapyap version
```

Shows YapYap version, build time, build environment, and platform information.

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


## Common Use Cases

### Setting up a new YapYap instance
```bash
# Install
curl -fsSL https://viliamvolosv.github.io/yapyap/install.sh | bash

# Start the node
yapyap start

# Get your Peer ID
yapyap get-peer-id
```

### Sending encrypted messages
```bash
# After starting the node and connecting to peers, send messages
yapyap send-message --to <peer-id> --payload "Hello, encrypted world!"
```

### Monitoring message delivery
```bash
# View logs to see message queue and delivery status
yapyap logs --tail 50

# View more detailed logs with filtering
yapyap logs --tail 100 --filter "error"
```

### Checking logs and debugging
The CLI runs in the terminal where it's started. Look for:
- Connection success/failure messages
- Message transmission logs
- ACK confirmations
- Retry attempts

Use `yapyap logs` to view historical logs even after the node has stopped.

---

## Troubleshooting

### Node won't start
- Check Node.js version: `node --version` (requires ≥22.12.0)
- Verify database permissions in the data directory
- Check for port conflicts (default ports for libp2p)
- Run with `--verbose` flag to see detailed error messages: `yapyap start --verbose`

### Messages not delivering
- Check logs for transmission errors: `yapyap logs --filter "error"`
- Verify peer ID is correct: `yapyap get-peer-id`
- Ensure both nodes have proper NAT traversal configured
- Check if peer exists in contacts: use API to query contacts

### Database issues
- Database is created automatically when starting the node
- Location is typically in current directory/data (use `--data-dir` to specify)
- Database uses SQLite with better-sqlite3
- Check logs for database-related errors: `yapyap logs --filter "database"`

### Viewing logs
- View recent logs: `yapyap logs`
- View more lines: `yapyap logs --tail 100`
- Filter for specific patterns: `yapyap logs --filter "error"` or `yapyap logs --filter "message"`
- Logs file location: current directory/data/yapyap.log

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

2. **Start your node:**
   ```bash
   yapyap start
   ```

3. **Get your Peer ID:**
   ```bash
   yapyap get-peer-id
   ```

4. **Share your Peer ID** with others so they can send you messages

5. **Send encrypted messages to peers:**
   ```bash
   yapyap send-message --to <peer-id> --payload "Hello, encrypted message!"
   ```

6. **Monitor logs and delivery status:**
   ```bash
   yapyap logs --tail 50
   ```

---

## Related Resources

- **Project GitHub:** https://github.com/viliamvolosv/yapyap
- **Quick Install:** https://viliamvolosv.github.io/yapyap/install.sh
- **AGENT skill:** Get started quickly with `curl -s https://viliamvolosv.github.io/yapyap/skill.md | bash`