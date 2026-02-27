---
name: yapyap
description: YapYap is a decentralized P2P messenger node and CLI library. Use when working with YapYap installation, configuration, messaging, network operations, or debugging messaging flows.
disable-model-invocation: false
---

# YapYap Messenger

YapYap is a decentralized, peer-to-peer messenger node and CLI library built with Node.js + TypeScript. It provides end-to-end encrypted messaging, offline/store-and-forward delivery, automatic peer discovery via DHT, and ACK-driven reliability.

## Quick Install

Install YapYap with a single command:

```bash
curl -fsSL https://viliamvolosv.github.io/yapyap/install.sh | bash
```

**Requirements:** Node.js ≥22.12.0

---

## Quick Start

### 1. Start your node

```bash
yapyap start
```

The node automatically:
- Generates your cryptographic identity (Peer ID + keys)
- Connects to the P2P network via DHT peer discovery
- Starts the API server (default port 3000)

### 2. Get your Peer ID

```bash
yapyap get-peer-id
```

Share this Peer ID with others so they can send you messages.

### 3. Add a contact

```bash
yapyap contact add --peer-id <peer-id> --public-key <hex>
```

Store the recipient's public key for end-to-end encryption.

### 4. Send a message

```bash
yapyap send-message --to <peer-id> --payload "Hello!"
```

### 5. Receive messages

```bash
yapyap receive
```

---

## CLI Commands Reference

### Node Management

#### `yapyap start` — Start the YapYap node

```bash
yapyap start [options]
```

**Options:**
- `--data-dir <path>` — Custom data directory (default: `./data`)
- `--api-port <number>` — Override API port (default: 3000)
- `--network <addrs>` — Bootstrap node addresses (comma-separated)
- `--listen <multiaddr>` — Libp2p listen address (default: `/ip4/0.0.0.0/tcp/0`)
- `--verbose` — Enable verbose logging

**Example:**
```bash
yapyap start --data-dir ~/.yapyap --api-port 4000 --verbose
```

#### `yapyap status` — Check node health and connections

```bash
yapyap status
```

Shows:
- Node Peer ID and uptime
- Connected peers count
- Bootstrap health status
- Network configuration

---

### Messaging

#### `yapyap send-message` — Send a message to a peer

```bash
yapyap send-message --to <peer-id> --payload <message> [options]
```

**Required:**
- `--to <peer-id>` — Target peer ID
- `--payload <string>` — Message content

**Options:**
- `--encrypted` — Encrypt message (default: true)
- `--data-dir <path>` — Custom data directory

**Example:**
```bash
yapyap send-message --to 12D3KooWExample... --payload "Hello, encrypted!" --encrypted
```

#### `yapyap receive` — View received messages (inbox)

```bash
yapyap receive [options]
```

**Options:**
- `--api-port <number>` — API port (if not default 3000)

**Example:**
```bash
yapyap receive --api-port 4000
```

---

### Contact Management

#### `yapyap contact add` — Add or update a contact

```bash
yapyap contact add --peer-id <peer-id> [options]
```

**Required:**
- `--peer-id <peer-id>` — Contact's Peer ID

**Options:**
- `--public-key <hex>` — Public key for encryption
- `--alias <name>` — Human-readable alias
- `--metadata <json>` — Additional metadata as JSON
- `--multiaddr <addr...>` — Known multiaddrs for routing
- `--trusted` — Mark as trusted contact

**Example:**
```bash
yapyap contact add \
  --peer-id 12D3KooWExample... \
  --public-key a1b2c3d4... \
  --alias "Alice" \
  --multiaddr /ip4/192.168.1.1/tcp/4001/p2p/12D3KooWExample...
```

#### `yapyap contact list` — List all contacts

```bash
yapyap contact list
```

#### `yapyap contact remove` — Remove a contact

```bash
yapyap contact remove --peer-id <peer-id>
```

---

### Identity & Discovery

#### `yapyap get-peer-id` — Display your node identity

```bash
yapyap get-peer-id [options]
```

Shows:
- Peer ID (libp2p identity)
- Public Key (Ed25519, hex format)

**Options:**
- `--data-dir <path>` — Custom data directory

#### `yapyap peers` — View discovered/cached peers

```bash
yapyap peers              # Show all discovered peers from database
yapyap peers --discover   # Trigger manual DHT peer discovery
yapyap peers --dial       # Dial all cached peers to reconnect
```

**Output example:**
```json
{
  "peers": [
    {
      "peer_id": "12D3KooWExample...",
      "multiaddrs": ["/ip4/192.168.1.1/tcp/4001"],
      "last_seen": 1709078400000
    }
  ],
  "count": 5,
  "timestamp": 1709078400000
}
```

---

### Utilities

#### `yapyap logs` — View node logs

```bash
yapyap logs [options]
```

**Options:**
- `--tail <number>` — Show last N lines (default: 50)
- `--filter <pattern>` — Filter by pattern
- `--data-dir <path>` — Custom data directory

**Example:**
```bash
yapyap logs --tail 100 --filter "error"
```

#### `yapyap api-docs` — Print API documentation URL

```bash
yapyap api-docs
```

Opens API documentation at `http://127.0.0.1:<port>/api/docs`

#### `yapyap version` — Display version information

```bash
yapyap version
```

Shows version, platform, and build info.

---

## Key Features

### 🔐 End-to-End Encryption
Messages encrypted with Noise protocol + Ed25519 signatures. Only recipients can decrypt.

### 📦 Offline Delivery
Store-and-forward: messages queued locally and delivered when recipient comes online.

### 🔍 Automatic Peer Discovery
DHT-based discovery finds peers automatically — no manual bootstrap configuration needed.
The node performs DHT random walk every 30 seconds, querying random peer IDs to discover
new peers. Discovered peers are cached in SQLite for 24 hours with automatic reconnection.

### ✅ ACK-Driven Reliability
Messages require acknowledgments. Failed deliveries retry with exponential backoff.

### 💾 Persistence
SQLite database stores messages, contacts, and peer routing information.

---

## Common Workflows

### First-time Setup

```bash
# 1. Install
curl -fsSL https://viliamvolosv.github.io/yapyap/install.sh | bash

# 2. Start node (generates identity automatically)
yapyap start

# 3. In another terminal, get your Peer ID
yapyap get-peer-id
```

### Send Message to a New Contact

```bash
# 1. Get recipient's Peer ID and public key
# (they run: yapyap get-peer-id)

# 2. Add them as a contact
yapyap contact add \
  --peer-id 12D3KooWRecipient... \
  --public-key a1b2c3d4e5f6... \
  --alias "Friend"

# 3. Send encrypted message
yapyap send-message \
  --to 12D3KooWRecipient... \
  --payload "Hello!" \
  --encrypted
```

### Check Message Delivery

```bash
# View inbox
yapyap receive

# Check node status and connections
yapyap status

# View logs for delivery confirmation
yapyap logs --filter "message"
```

### Monitor Network

```bash
# See connected peers
yapyap status

# View discovered/cached peers
yapyap peers

# Trigger peer discovery
yapyap peers --discover

# Reconnect to cached peers
yapyap peers --dial
```

---

## Troubleshooting

### Can't send message — "peer not found"

Add the contact with their public key first:
```bash
yapyap contact add --peer-id <id> --public-key <hex>
```

### No peers connected

Check bootstrap health:
```bash
yapyap status
```

The node automatically discovers peers via DHT. Wait ~30 seconds for DHT random walk discovery.

**Force peer discovery:**
```bash
yapyap peers --discover   # Trigger manual DHT discovery
yapyap peers --dial       # Reconnect to cached peers
```

**Without bootstrap nodes:**
YapYap works without bootstrap configuration. The DHT random walk discovers peers by querying random peer IDs every 30 seconds. Discovered peers are cached in the database for 24 hours.

### View detailed errors

```bash
yapyap logs --tail 100 --filter "error"
```

### Node won't start

```bash
# Check Node.js version (requires ≥22.12.0)
node --version

# Run with verbose logging
yapyap start --verbose

# Try custom data directory
yapyap start --data-dir /tmp/yapyap-test
```

---

## Security Notes

- **Share your Peer ID** — others need it to send you messages
- **Keep private keys secure** — stored in `data/` directory
- **Messages are E2E encrypted** — only recipients can read them
- **Verify public keys** — ensure you have the correct key for each contact

---

## API Access

The REST API is available at `http://127.0.0.1:3000` (or custom `--api-port`).

**Documentation:** `http://127.0.0.1:<port>/api/docs`

**Key endpoints:**
- `GET /api/node/info` — Node status
- `GET /api/peers` — Connected peers
- `GET /api/peers/discovered` — Discovered/cached peers from database
- `POST /api/peers/discover` — Trigger manual DHT peer discovery
- `POST /api/peers/dial-cached` — Dial all cached peers
- `POST /api/peers/{peerId}/dial` — Connect to specific peer
- `POST /api/messages/send` — Send message
- `GET /api/messages/inbox` — Received messages
- `GET /api/database/contacts` — List contacts
- `POST /api/database/contacts` — Add contact

---

## Resources

- **GitHub:** https://github.com/viliamvolosv/yapyap
- **API Docs:** `yapyap api-docs` or `http://127.0.0.1:<port>/api/docs`
- **Install Script:** https://viliamvolosv.github.io/yapyap/install.sh
