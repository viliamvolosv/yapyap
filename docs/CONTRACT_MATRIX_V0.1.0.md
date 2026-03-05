# Contract Matrix for v0.1.0

## Overview
Defines test contracts for YapYap v0.1.0 release. Each contract specifies module boundary, public interfaces, expected behaviors, test coverage, and negative path requirements.

## Module Contracts

### 1. Core Contract: YapYapNode
**Module:** `src/core/node.ts`
**Public Interfaces:**
```typescript
class YapYapNode {
  constructor(config: NodeConfig)
  start(): Promise<void>
  stop(): Promise<void>
  sendMessage(peerId: string, content: string): Promise<void>
  getStatus(): NodeStatus
  getConnections(): ConnectionInfo[]
  on(event: string, handler: Function): void
}
```

**Contract Invariants:**
1. Node lifecycle must be clean: start → operations → stop → cleanup
2. `sendMessage` must be idempotent
3. `getStatus()` must reflect current state (pending/processing/transmitting/delivered/failed)
4. Event handlers must be called in order of message flow

**Negative Path Requirements:**
- Invalid peer ID handling
- Node not started before send
- Node stopped during send
- Message queue overflow
- Concurrent start/stop

### 2. Message Router Contract
**Module:** `src/message/message-router.ts`
**Public Interfaces:**
```typescript
class MessageRouter {
  constructor(node: YapYapNode, config: RouterConfig)
  start(): Promise<void>
  stop(): Promise<void>
  addPeer(peerId: string, metadata: PeerMetadata): void
  removePeer(peerId: string): void
  forwardMessage(message: Message): Promise<void>
  on(event: string, handler: Function): void
}
```

**Contract Invariants:**
1. Message routing must be deterministic
2. Deduplication must prevent duplicate processing
3. Retry logic must respect exponential backoff
4. Peer list must be consistent with network events

**Negative Path Requirements:**
- Duplicate message processing
- Invalid peer in routing table
- Message with no peer (orphan)
- Invalid message format
- Queue overflow

### 3. Session Management Contract
**Module:** `src/crypto/session-manager.ts`
**Public Interfaces:**
```typescript
class SessionManager {
  constructor(keyPair: Ed25519KeyPair)
  createSession(peerId: string): Promise<Session>
  getSession(peerId: string): Promise<Session | null>
  closeSession(peerId: string): void
  encryptMessage(session: Session, plaintext: string): Promise<Ciphertext>
  decryptMessage(session: Session, ciphertext: string): Promise<Plaintext>
}
```

**Contract Invariants:**
1. Encryption/decryption must be bi-directional
2. Session keys must be unique per peer
3. Session lifetime must be bounded
4. Session must fail gracefully on invalid keys

**Negative Path Requirements:**
- Encryption with invalid session
- Decryption with wrong session
- Corrupted ciphertext
- Missing session keys
- Session reuse with wrong peer

### 4. Database Contract
**Module:** `src/database/`
**Tables:**
```typescript
message_queue {
  id: string (PK)
  peer_id: string
  content: string
  status: pending|processing|transmitting|delivered|failed
  retry_count: integer
  timestamp: timestamp
}

processed_messages {
  id: string (PK)
  message_id: string (FK)
  timestamp: timestamp
}
```

**Contract Invariants:**
1. Database must be transactional
2. Idempotent inserts
3. Status transitions must be valid
4. Timestamps must be monotonic per peer
5. Connection must be closed after operations

**Negative Path Requirements:**
- Duplicate message insertion
- Invalid status transitions
- Missing foreign keys
- Corrupted data
- Concurrent access

### 5. Network Module Contract
**Module:** `src/network/NetworkModule.ts`
**Public Interfaces:**
```typescript
interface NetworkModule {
  start(): Promise<void>
  stop(): Promise<void>
  connectPeer(peerId: string): Promise<void>
  disconnectPeer(peerId: string): Promise<void>
  sendMessage(peerId: string, data: Uint8Array): Promise<void>
  onData(handler: (peerId: string, data: Uint8Array) => void): void
}
```

**Contract Invariants:**
1. Network must handle NAT traversal
2. Messages must be sent reliably
3. Connection must persist across restarts
4. Event handlers must be registered once

**Negative Path Requirements:**
- Invalid peer ID connection
- Network not started
- Duplicate event handlers
- Connection timeout
- Message fragmentation

### 6. API Contract
**Module:** `src/api/`
**Public Interfaces:**
```typescript
// HTTP endpoints
POST /api/messages/send
GET /api/status
GET /api/peers

// WebSocket events
message: { peerId: string, content: string }
status: { status: string }
```

**Contract Invariants:**
1. All endpoints must return JSON
2. Status must match NodeStatus enum
3. Peer list must match NetworkModule connections
4. WebSocket must reconnect automatically
5. Rate limiting must be applied

**Negative Path Requirements:**
- Invalid message format
- Unauthorized access
- Rate limit exceeded
- WebSocket disconnection
- Invalid peer ID

## Test Coverage Matrix

| Module | Unit Tests | Integration Tests | Contract Tests | Negative Path Tests |
|--------|-----------|-------------------|----------------|---------------------|
| YapYapNode | ✅ | ✅ | ✅ | ✅ |
| MessageRouter | ✅ | ✅ | ✅ | ✅ |
| SessionManager | ✅ | ✅ | ✅ | ✅ |
| Database | ✅ | ✅ | ✅ | ✅ |
| NetworkModule | ✅ | ✅ | ✅ | ✅ |
| API | ✅ | ✅ | ✅ | ✅ |

## Deterministic Fixture Requirements

All test fixtures must use fixed values:
```typescript
const FIXED_TIMESTAMP = new Date('2026-03-06T00:00:00Z').getTime()
const FIXED_PEER_ID = '12D3KooWGZ9y7yvPfj3s6Xq9m8n0p1q2r3s4t5u6v7w8x9y0z1a2b3c4d5e6f7'
const FIXED_MESSAGE_ID = 'msg-001'
const FIXED_SESSION_ID = 'session-001'
const FIXED_CONTENT = 'hello world'
const FIXED_STATUS = 'pending' as const
```

## Test Acceptance Criteria

### P0 (Must Have)
- All module contracts verified
- All negative paths tested
- Database schema integrity
- Message flow contract (enqueue → transmit → receive → ACK)
- Retry contract (exponential backoff)

### P1 (Should Have)
- Network persistence
- Session management
- API endpoints
- Docker integration scenarios

### P2 (Nice to Have)
- Performance benchmarks
- Stress tests
- Security audits
- Coverage reports

---

**Status:** Contract matrix created. Ready for T2-T6 tasks.
