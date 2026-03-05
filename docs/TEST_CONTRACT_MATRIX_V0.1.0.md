# Test Contract Matrix for v0.1.0

**Date**: 2026-03-06
**Version**: 0.1.0
**Status**: Phase 1 - Testing Gate

---

## 1. Purpose

This contract matrix defines the testing strategy, coverage requirements, and acceptance criteria for the YapYap v0.1.0 release. It serves as the authoritative source for what must be tested and how tests must be structured across all agent teams.

---

## 2. Core Module Contracts

### 2.1 Crypto Module (`src/crypto/`)

**Contract Owner**: Core Test Agent 1 (Crypto Negative Paths)

| Component | Interface/Class | Test Coverage | Acceptance Criteria |
|-----------|----------------|---------------|---------------------|
| Session Manager | `SessionManager` | ✓ Unit tests | - Session creation with unique IDs<br>- Session expiration handling<br>- Multi-session per peer restriction<br>- Negative path: invalid keys, expired sessions |
| Session Manager | `SessionManager.createSession()` | ✓ Unit tests | - Returns valid session object<br>- Validates peer_id format<br>- Handles concurrent session creation |
| Session Manager | `SessionManager.cleanupExpired()` | ✓ Unit tests | - Removes expired sessions<br>- Returns count of cleaned sessions<br>- Handles empty database |
| Session Manager | `SessionManager.getSession()` | ✓ Unit tests | - Retrieves active session<br>- Returns null for non-existent/expired<br>- Handles concurrent reads |
| Session Manager | `SessionManager.updateLastUsed()` | ✓ Unit tests | - Updates last_used timestamp<br>- Validates session exists<br>- Handles invalid session ID |
| Session Manager | `SessionManager.revokeSession()` | ✓ Unit tests | - Marks session as inactive<br>- Updates database<br>- Returns session status |

**Test Requirements**:
- All tests must use deterministic fixtures
- Session IDs must be generated using fixed seed or predictable format
- Timestamps in tests must be fixed (not `Date.now()`)
- Test DB must be in-memory or fixed SQLite file
- Mock all external dependencies (crypto operations, database I/O)

---

### 2.2 Message Router Module (`src/message/`)

**Contract Owner**: Core Test Agent 2 (Message Router Contracts)

| Component | Interface/Class | Test Coverage | Acceptance Criteria |
|-----------|----------------|---------------|---------------------|
| Message Router | `MessageRouter` | ✓ Unit tests | - Constructor initializes all components<br>- Event handlers registered correctly<br>- Queue management works |
| Message Router | `enqueueMessage()` | ✓ Unit tests | - Creates message record in DB<br>- Sets status to 'pending'<br>- Triggers 'message:enqueued' event<br>- Handles duplicate messages via dedup table |
| Message Router | `transmitMessage()` | ✓ Unit tests | - Attempts to send via libp2p<br>- Updates status to 'transmitting' or 'failed'<br>- Handles network errors<br>- Triggers 'message:transmitted' or 'message:failed' events |
| Message Router | `handleIncomingMessage()` | ✓ Unit tests | - Validates message format<br>- Stores to DB with status 'received'<br>- Triggers 'message:received' event<br>- Handles duplicate deduplication |
| Message Router | `handleACK()` | ✓ Unit tests | - Updates message status to 'delivered'<br>- Removes from pending queue<br>- Triggers 'message:delivered' event<br>- Handles missing message ID |
| Message Router | `handleNACK()` | ✓ Unit tests | - Updates message status to 'failed'<br>- Increments retry count<br>- Reschedules for retry<br>- Triggers 'message:failed' event |
| Message Router | `retryFailedMessages()` | ✓ Unit tests | - Queries failed messages<br>- Reschedules with backoff<br>- Respects max retries<br>- Handles permanent failures |
| Message Router | `getPendingMessages()` | ✓ Unit tests | - Returns pending messages<br>- Limits by batch size<br>- Filters by status |

**Test Requirements**:
- Message IDs must be deterministic (fixed format or seeded)
- All timestamps in tests must be fixed
- Use mock libp2p transport for network operations
- Test deduplication with known message IDs
- Verify event emission order and payload

---

### 2.3 Database Module (`src/database/`)

**Contract Owner**: Core Test Agent 3 (Database/State Invariants)

| Component | Interface/Class | Test Coverage | Acceptance Criteria |
|-----------|----------------|---------------|---------------------|
| DB Schema | `message_queue` table | ✓ Invariant tests | - All required columns exist<br>- Indexes match schema<br>- Foreign key constraints work |
| DB Schema | `processed_messages` table | ✓ Invariant tests | - All required columns exist<br>- Indexes match schema<br>- Unique constraint on message_id |
| DB Schema | `peer_cache` table | ✓ Invariant tests | - All required columns exist<br>- Indexes match schema<br>- TTL handling works |
| DatabaseManager | `DatabaseManager` | ✓ Integration tests | - Constructor initializes DB<br>- Tables created on init<br>- Transaction handling works |
| DatabaseManager | `saveMessage()` | ✓ Unit tests | - Inserts into message_queue<br>- Returns message_id<br>- Handles duplicates (upsert) |
| DatabaseManager | `getMessage()` | ✓ Unit tests | - Retrieves by ID<br>- Returns null for missing<br>- Handles transaction rollback |
| DatabaseManager | `updateMessageStatus()` | ✓ Unit tests | - Updates status field<br>- Returns affected rows<br>- Handles invalid message_id |
| DatabaseManager | `saveProcessedMessage()` | ✓ Unit tests | - Inserts into processed_messages<br>- Handles duplicates (upsert) |
| DatabaseManager | `markMessageDelivered()` | ✓ Unit tests | - Moves from message_queue to processed_messages<br>- Sets delivered_at timestamp<br>- Returns true if moved |
| DatabaseManager | `cleanupExpired()` | ✓ Unit tests | - Removes expired peer records<br>- Returns count cleaned<br>- Transaction safety |
| DatabaseManager | `getPendingMessageCount()` | ✓ Unit tests | - Returns count of pending messages<br>- Filters by status |

**Test Requirements**:
- All tests must use separate DB instances (in-memory or temp file)
- Verify foreign key constraints are enforced
- Test transaction rollback on errors
- Verify data integrity after concurrent operations
- Check index performance with test data

---

### 2.4 Core Node Module (`src/core/`)

**Contract Owner**: Refactor Agent 3 (Core/Network Boundary)

| Component | Interface/Class | Test Coverage | Acceptance Criteria |
|-----------|----------------|---------------|---------------------|
| YapYapNode | `YapYapNode` | ✓ Integration tests | - Constructor initializes all components<br>- start() starts all services<br>- stop() stops all services<br>- Lifecycle events emitted |
| YapYapNode | `start()` | ✓ Integration tests | - Initializes database<br>- Starts message router<br>- Starts libp2p network<br>- Emits 'node:started' event |
| YapYapNode | `stop()` | ✓ Integration tests | - Stops message router<br>- Stops libp2p network<br>- Closes database<br>- Emits 'node:stopped' event |
| YapYapNode | `sendMessage()` | ✓ Integration tests | - Enqueues message via router<br>- Returns success/failure<br>- Handles node not started |
| YapYapNode | `sendToPeer()` | ✓ Integration tests | - Validates peer ID<br>- Sends via libp2p<br>- Returns transport result |
| YapYapNode | `getPeerInfo()` | ✓ Unit tests | - Returns peer status<br>- Handles missing peer |

**Test Requirements**:
- Use test configuration (no persistence to main DB)
- Mock libp2p transport for network operations
- Test graceful shutdown
- Verify event sequence
- Test node lifecycle transitions

---

### 2.5 Network Module (`src/network/`)

**Contract Owner**: Refactor Agent 3 (Core/Network Boundary)

| Component | Interface/Class | Test Coverage | Acceptance Criteria |
|-----------|----------------|---------------|---------------------|
| ConnectionManager | `ConnectionManager` | ✓ Unit tests | - Constructor initializes<br>- Connection tracking works |
| ConnectionManager | `connectToPeer()` | ✓ Unit tests | - Initiates connection<br>- Tracks connection state<br>- Handles connection errors |
| ConnectionManager | `disconnectPeer()` | ✓ Unit tests | - Closes connection<br>- Removes from tracking<br>- Handles missing peer |
| ConnectionManager | `getConnectionStatus()` | ✓ Unit tests | - Returns status for peer<br>- Handles missing peer |

**Test Requirements**:
- Mock libp2p transport
- Test connection state transitions
- Verify cleanup on disconnect
- Test concurrent connection attempts

---

### 2.6 API Module (`src/api/`)

**Contract Owner**: Refactor Agent 1 (API Split)

| Component | Interface/Class | Test Coverage | Acceptance Criteria |
|-----------|----------------|---------------|---------------------|
| API Server | `APIHandler` | ✓ Unit tests | - Constructor initializes<br>- Route registration works |
| API Server | `GET /status` | ✓ Integration tests | - Returns node status<br>- Handles node not started |
| API Server | `POST /messages` | ✓ Integration tests | - Validates message format<br>- Enqueues message<br>- Returns message ID |
| API Server | `GET /messages/:id` | ✓ Integration tests | - Returns message status<br>- Handles missing message |
| API Server | `GET /peers` | ✓ Integration tests | - Returns peer list<br>- Filters by status |

**Test Requirements**:
- Use mock HTTP server
- Test all HTTP status codes
- Validate request/response formats
- Test error handling

---

## 3. Deterministic Fixture Rules

### 3.1 Session Fixtures
```typescript
// ❌ BAD - Non-deterministic
const session = await sessionManager.createSession(peerId);

// ✅ GOOD - Deterministic
const session = await sessionManager.createSession(peerId, {
  sessionId: 'fixed-session-id-123',
  createdAt: 1234567890000,
  expiresAt: 1234567896000,
});
```

### 3.2 Message Fixtures
```typescript
// ❌ BAD - Non-deterministic
const message = {
  id: crypto.randomUUID(),
  content: 'Hello',
  timestamp: Date.now(),
};

// ✅ GOOD - Deterministic
const message = {
  id: 'msg-fixed-id-abc123',
  content: 'Hello',
  timestamp: 1234567890000,
  peerId: 'peer-fixed-id',
};
```

### 3.3 Timestamps
```typescript
// ❌ BAD - Always changing
const now = Date.now();
const expiresAt = now + 3600000;

// ✅ GOOD - Fixed timestamps
const now = 1234567890000; // Fixed epoch timestamp
const expiresAt = now + 3600000;
```

### 3.4 Peer IDs
```typescript
// ❌ BAD - Random peer IDs
const peerId = crypto.randomUUID();

// ✅ GOOD - Fixed peer IDs
const peerId = 'fixed-peer-id-1';
const peerId2 = 'fixed-peer-id-2';
```

### 3.5 Test Database
```typescript
// Use in-memory SQLite for tests
const dbPath = ':memory:';
const db = new Database(dbPath);

// Or use temporary file with fixed name
const dbPath = '/tmp/test-db-v0.1.0.sqlite';
```

---

## 4. Test Acceptance Criteria

### 4.1 Unit Test Criteria
- [ ] All public methods have at least one test case
- [ ] All edge cases and error paths are covered
- [ ] Tests are isolated (no shared state between tests)
- [ ] Test execution time < 1 second per file
- [ ] All tests pass in the same order
- [ ] No flaky tests (pass 10 consecutive runs)

### 4.2 Integration Test Criteria
- [ ] Tests cover module interactions
- [ ] Database transactions are tested
- [ ] Event emissions are verified
- [ ] External dependencies are mocked
- [ ] Tests pass 3 consecutive runs
- [ ] No race conditions detected

### 4.3 Docker Integration Criteria
- [ ] All scenarios run successfully
- [ ] Artifacts are collected in correct location
- [ ] Logs are captured and readable
- [ ] Test duration < 5 minutes
- [ ] Containers clean up properly
- [ ] No resource leaks

### 4.4 Code Coverage Criteria
- [ ] Overall coverage ≥ 80%
- [ ] Critical path coverage ≥ 90%
- [ ] No files with 0% coverage
- [ ] No files with > 20% untested lines

---

## 5. Test Execution Commands

### 5.1 Local Execution
```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Unit tests
npm test

# Integration tests
bash tests/integration/docker/run-basic-suite.sh

# Full quality checks
npm run typecheck && npm run lint && npm test && bash tests/integration/docker/run-basic-suite.sh
```

### 5.2 Docker Scenario Execution
```bash
# Run basic suite
bash tests/integration/docker/run-basic-suite.sh

# Run specific scenario
bash tests/integration/docker/run-scenario.sh <scenario-name>

# View logs
docker logs yapyap-node-1
docker logs yapyap-test-controller

# Clean up
docker compose -f tests/integration/docker/docker-compose.yml down -v
```

### 5.3 Artifact Collection
```
tests/integration/docker/results/artifacts/<run-id>/<scenario>/
├── logs/
│   ├── node.log
│   └── controller.log
├── database/
│   └── <node-db.sqlite>
└── network/
    └── <trace.json>
```

---

## 6. Phase 1 Exit Criteria

### 6.1 Test Expansion Complete
- [ ] Contract matrix document created ✅
- [ ] All T2 tasks merged (Crypto, Router, DB tests)
- [ ] All T5 tasks merged (Docker scenarios)
- [ ] All T6 tasks merged (Docker harness)
- [ ] All tests pass locally

### 6.2 Quality Gate Passed
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (all 40 suites)
- [ ] Docker integration suite passes
- [ ] No flaky tests
- [ ] Coverage ≥ 80%

### 6.3 Artifact Collection Verified
- [ ] All Docker runs generate artifacts
- [ ] Artifacts are complete and analyzable
- [ ] Logs are captured correctly
- [ ] Database snapshots available

---

## 7. Phase 2 Dependencies

Phase 2 (Refactor) cannot start until Phase 1 exit criteria are met:
- Test expansion complete
- Quality gate passed
- No regressions in tests

---

## 8. Agent Responsibilities

### 8.1 Test Architecture Lead
- Owns this contract matrix
- Updates acceptance criteria as needed
- Validates test completion
- Monitors test quality

### 8.2 Core Test Agents
- Implement tests per contract matrix
- Follow deterministic fixture rules
- Report test coverage metrics
- Flag any gaps or issues

### 8.3 Docker Integration Agents
- Expand Docker scenarios
- Harden test harness
- Verify artifact collection
- Debug integration issues

### 8.4 Quality Gate Agent
- Runs quality checks
- Validates exit criteria
- Creates gate status reports
- Coordinates merge windows

---

## 9. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1.0 | 2026-03-06 | Agent Team | Initial contract matrix for v0.1.0 |

---

**End of Contract Matrix**