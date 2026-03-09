# YapYap Test Contract Matrix

**Document Purpose**: Define observable contracts for YapYap modules to guide test development and ensure behavioral stability.

**Last Updated**: 2026-03-09

---

## Phase A: Contract Inventory (Complete)

### Module: `src/crypto/index.ts`

| # | Public Behavior | Success Contract | Failure Contract | Invariants | Persistence | Status |
|---|----------------|------------------|------------------|------------|-------------|--------|
| 1 | `generateIdentityKeyPair()` | Returns key pair with Ed25519 keys | Throws if crypto fails | Private key never exposed publicly; public/private key pair matches | N/A | Covered |
| 2 | `generateEphemeralKeyPair()` | Returns key pair with X25519 keys | Throws if crypto fails | Keys are distinct from identity keys | N/A | Covered |
| 3 | `deriveSharedSecret(publicKey, privateKey)` | Returns shared secret bytes | Throws if keys are not X25519 or invalid | Shared secret length = 32 bytes | N/A | Covered |
| 4 | `encryptMessage(plaintext, key, nonce)` | Returns encrypted message with auth tag | Throws on encryption failure | Ciphertext includes auth tag; nonce length = 12 bytes | N/A | Covered |
| 5 | `decryptMessage(ciphertext, key, nonce)` | Returns plaintext bytes | Throws on decryption failure (auth tag invalid) | Decrypted plaintext matches original | N/A | Covered |
| 6 | `signMessage(message, privateKey)` | Returns signature bytes | Throws if private key invalid | Signature length = 64 bytes (Ed25519) | N/A | Covered |
| 7 | `verifySignature(message, signature, publicKey)` | Returns true for valid signature | Returns false for invalid signature | Deterministic: same input = same output | N/A | Covered |
| 8 | `deriveKeyFromPassword(password, salt, iterations)` | Returns 32-byte key | Throws if password invalid | Key length = 32 bytes | N/A | Covered |
| 9 | `generateSessionId()` | Returns unique session identifier | N/A | Session ID contains timestamp and random bytes | N/A | Covered |
| 10 | `deriveMessageKey(message, peerIdentity)` | Returns 32-byte key | N/A | Deterministic: same input = same output | N/A | Covered |
| 11 | `encryptE2EMessage(plaintext, recipientPublicKey, senderPrivateKey)` | Returns encrypted message with signature and ephemeral key | Throws if crypto fails | Message contains: ciphertext, nonce, ephemeralPublicKey, signature; signature valid | N/A | Partial |
| 12 | `decryptE2EMessage(encryptedMessage, senderPublicKey, recipientPrivateKey)` | Returns plaintext string | Throws on invalid signature or decryption | Plaintext matches original message | N/A | Partial |

**Missing Tests (P0)**:
- [ ] Test 11.1: Reject E2E encrypt when recipientPublicKey is not X25519
- [ ] Test 11.2: Reject E2E encrypt when senderPrivateKey is not Ed25519
- [ ] Test 11.3: Reject E2E decrypt when ephemeralPublicKey is missing
- [ ] Test 11.4: Reject E2E decrypt when ciphertext is truncated
- [ ] Test 11.5: Reject E2E decrypt when signature is tampered
- [ ] Test 11.6: Reject E2E decrypt when senderPublicKey is wrong
- [ ] Test 11.7: Reject E2E decrypt when recipientPrivateKey is wrong
- [ ] Test 12.1: Reject E2E decrypt when plaintext is empty but auth tag present
- [ ] Test 12.2: Reject E2E decrypt when ciphertext is malformed (no auth tag)

**Owner**: Agent 2 (Crypto/E2E negative-path suite)

---

### Module: `src/message/message-router.ts`

| # | Public Behavior | Success Contract | Failure Contract | Invariants | Persistence | Status |
|---|----------------|------------------|------------------|------------|-------------|--------|
| 13 | `sendMessage(recipientPeerId, message)` | Queues message, emits event | Throws if recipient key missing | Message ID unique; status = pending; attempts = 0 | Yes (pending_messages) | Covered |
| 14 | `receiveMessage(message, senderPeerId)` | Processes message, emits event | Throws if duplicate (idempotent) | Sequence number monotonic per peer; vector clock non-decreasing | Yes (processed_messages, peer_sequences, peer_vector_clocks) | Covered |
| 15 | `handleAck(messageId)` | Updates status to delivered | Ignores non-pending messages | Message status transitions valid; no duplicate side effects | Yes (pending_messages) | Covered |
| 16 | `handleNak(messageId, reason)` | Schedules retry with backoff | Throws if message not pending | Retry increments attempts once; next_retry_at increases | Yes (pending_messages) | Covered |
| 17 | `handleRouteMessage(message, senderPeerId)` | Routes message through network | Returns null on failure | Message delivery uses fallback relay; target peer excluded | Yes (replicated_messages, message_replicas) | Covered |
| 18 | `handleSyncMessage(message, senderPeerId)` | Syncs state with peer | Returns null on failure | No duplicate sync processing; vector clock updated | Yes (peer_vector_clocks, peer_sequences) | Covered |
| 19 | `getPendingMessages(peerId)` | Returns pending messages for peer | N/A | Returns empty array if no messages | Yes (pending_messages) | Covered |
| 20 | `getMessagesForPeer(peerId)` | Returns inbox for peer | N/A | Returns empty array if no messages | Yes (processed_messages) | Covered |

**Missing Tests (P0)**:
- [ ] Test 13.1: Reject send when recipient key not found in database
- [ ] Test 13.2: Reject send when recipient key is malformed
- [ ] Test 14.1: Receive duplicate message is idempotent (no double events)
- [ ] Test 14.2: Receive duplicate message causes zero sequence/vector-clock changes
- [ ] Test 15.1: ACK on non-pending message is safely ignored (no side effects)
- [ ] Test 15.2: ACK on delivered message is safely ignored
- [ ] Test 16.1: NAK schedules retry with bounded exponential backoff
- [ ] Test 16.2: NAK propagates reason to last_error field
- [ ] Test 17.1: Fallback relay selection avoids blocked peers
- [ ] Test 17.2: Fallback relay selection excludes target peer
- [ ] Test 18.1: Replay of old vector clock does not regress local clock
- [ ] Test 20.1: Retry cleanup removes expired/terminal entries

**Owner**: Agent 2 (MessageRouter behavior-contract suite)

---

### Module: `src/database/index.ts`

| # | Public Behavior | Success Contract | Failure Contract | Invariants | Persistence | Status |
|---|----------------|------------------|------------------|------------|-------------|--------|
| 21 | `persistIncomingMessageAtomically(input)` | Returns {applied: true, duplicate: false} | Returns {applied: false, duplicate: true} for duplicates | Never applies partial updates; atomic transaction | Yes (processed_messages, peer_sequences, peer_vector_clocks) | Partial |
| 22 | `queueMessage(messageId, messageData, targetPeerId, deadlineAt)` | Inserts or upserts message | N/A | Message ID unique; status = pending; attempts = 0 | Yes (pending_messages) | Covered |
| 23 | `scheduleRetry(messageId, nextRetryAt, reason)` | Updates retry time | N/A | Increments attempts exactly once per call | Yes (pending_messages) | Partial |
| 24 | `assignMessageReplica(messageId, replicaPeerId)` | Assigns replica to peer | N/A | Status = assigned; no duplicate assignments | Yes (message_replicas) | Covered |
| 25 | `markReplicaStored(messageId, replicaPeerId)` | Marks replica stored | N/A | Status = stored; ack_expected = 1 | Yes (message_replicas) | Covered |
| 26 | `markReplicaAckReceived(messageId, replicaPeerId)` | Marks ack received | N/A | ack_received_at set; no duplicate updates | Yes (message_replicas) | Covered |
| 27 | `saveContact(contact)` | Inserts or updates contact | N/A | Peer ID unique | Yes (contacts) | Covered |
| 28 | `savePeerMetadata(peerId, key, value, ttl)` | Inserts or updates metadata | N/A | Key unique per peer | Yes (peer_metadata) | Covered |
| 29 | `searchContacts(query)` | Returns matching contacts | N/A | Returns empty array if no matches | Yes (contacts + search_index) | Covered |
| 30 | `cleanup()` | Deletes expired/stale entries | N/A | No side effects on non-expired data | Yes (all tables) | Covered |

**Missing Tests (P0)**:
- [ ] Test 21.1: `persistIncomingMessageAtomically` never applies partial updates
- [ ] Test 21.2: Duplicate incoming message causes zero sequence/vector-clock side effects
- [ ] Test 23.1: Retry scheduling increments attempts exactly once per schedule call
- [ ] Test 24.1: Replica ack lifecycle: assigned → stored → ack_expected → ack_received
- [ ] Test 24.2: Cleanup deletes only expired/terminal rows
- [ ] Test 29.1: Search index consistency after contact update/delete
- [ ] Test 30.1: `cleanup()` preserves non-expired pending messages

**Owner**: Agent 3 (Database transactional and lifecycle contract suite)

---

### Module: `src/protocols/route.ts`

| # | Public Behavior | Success Contract | Failure Contract | Invariants | Persistence | Status |
|---|----------------|------------------|------------------|------------|-------------|--------|
| 31 | `RoutingTable.updatePeer(peerId, info)` | Updates routing entry | N/A | Entry timestamp updated | N/A | Covered |
| 32 | `RoutingTable.getPeer(peerId)` | Returns routing entry | Returns undefined | Returns null for non-existent peer | N/A | Covered |
| 33 | `RoutingTable.cleanupStaleEntries(maxAge)` | Deletes stale entries | N/A | Only deletes entries older than maxAge | N/A | Covered |
| 34 | `handleRouteAnnounce(message, remotePeerId, routingTable, broadcastFn)` | Validates signature and updates routing | Returns null if signature invalid | Signature verification required; routing updated only if valid | N/A | Partial |
| 35 | `handleRouteQuery(message, remotePeerId, routingTable)` | Returns route result | Returns null | Returns peer IDs from routing table | N/A | Partial |
| 36 | `handleRouteResult(message, remotePeerId, routingTable)` | Updates routing with results | Returns null | Only updates if peerIds non-empty | N/A | Partial |
| 37 | `createRouteAnnounce(originPeerId, reachablePeers, routingHints)` | Creates signed route announce | N/A | Signature valid; includes publicKey | N/A | Covered |
| 38 | `createRouteQuery(targetPeerId, queryId, originPeerId)` | Creates route query message | N/A | Includes all required fields | N/A | Covered |
| 39 | `createRouteResult(queryId, originPeerId, peerIds, routingHints)` | Creates route result message | N/A | Includes all required fields | N/A | Covered |

**Missing Tests (P0)**:
- [ ] Test 34.1: Route announce signature validation rejects tampered signatures
- [ ] Test 34.2: Route announce signature validation rejects wrong sender key
- [ ] Test 35.1: Route query handles missing target peer gracefully
- [ ] Test 35.2: Route result handles missing peerIds gracefully
- [ ] Test 36.1: Route result only updates routing if peerIds non-empty

**Owner**: Agent 1 (Protocol coverage completion)

---

### Module: `src/protocols/error-handler.ts`

| # | Public Behavior | Success Contract | Failure Contract | Invariants | Persistence | Status |
|---|----------------|------------------|------------------|------------|-------------|--------|
| 40 | `handleProtocolError(operationName, handler)` | Returns handler result | Returns null; logs error | Wraps error with operation name | N/A | Partial |
| 41 | `handleProtocolErrorSync(operationName, handler)` | Returns handler result | Returns null; logs error | Does not throw (sync) | N/A | Partial |

**Missing Tests (P0)**:
- [ ] Test 40.1: Error handler wraps unknown thrown values with operation name
- [ ] Test 40.2: Error handler logs stack trace for errors
- [ ] Test 40.3: Error handler preserves original error message
- [ ] Test 40.4: Error handler returns null (not undefined) for errors
- [ ] Test 41.1: Sync error handler returns null (not undefined) for errors

**Owner**: Agent 1 (Protocol coverage completion)

---

### Module: `src/storage/StorageModule.ts`

| # | Public Behavior | Success Contract | Failure Contract | Invariants | Persistence | Status |
|---|----------------|------------------|------------------|------------|-------------|--------|
| 42 | `StorageModule` (constructor) | Initializes storage | Throws if DB fails | Creates database if not exists | Yes | Covered |
| 43 | `getContact(peerId)` | Returns contact | Returns null | Returns null for non-existent contact | Yes | Covered |
| 44 | `setContact(peerId, contact)` | Saves contact | N/A | Contact ID unique | Yes | Covered |
| 45 | `searchContacts(query)` | Returns matching contacts | N/A | Uses search index | Yes | Covered |
| 46 | `getPeerMetadata(peerId, key)` | Returns metadata | Returns null | Returns null if key not found | Yes | Covered |
| 47 | `setPeerMetadata(peerId, key, value)` | Saves metadata | N/A | Key unique per peer | Yes | Covered |

**Missing Tests (P0)**:
- [ ] Test 44.1: Search index consistency after contact update
- [ ] Test 44.2: Search index consistency after contact delete
- [ ] Test 47.1: Metadata update updates search index if applicable

**Owner**: Agent 3 (Database + storage contract suite)

---

### Module: `src/protocols/framing.ts` (re-exports `core/protocols.ts`)

| # | Public Behavior | Success Contract | Failure Contract | Invariants | Persistence | Status |
|---|----------------|------------------|------------------|------------|-------------|--------|
| 48 | `MessageFramer.encode(msg)` | Frames message with length prefix | Throws if message too large | Frame size = 4 + payload length | N/A | Partial |
| 49 | `MessageFramer.decode(data)` | Decodes single framed message | Throws if incomplete or malformed | Throws on truncated/oversized payloads | N/A | Partial |
| 50 | `MessageFramer.decodeFrames(buffer)` | Extracts complete frames | Returns frames + remainder | Handles partial frames correctly | N/A | Partial |
| 51 | `MessageFramer.splitMessages<T>(buffer)` | Splits buffer into messages | Returns messages + remaining | Handles malformed messages gracefully | N/A | Partial |

**Missing Tests (P0)**:
- [ ] Test 48.1: Framing decode rejects truncated payloads (less than 4 bytes)
- [ ] Test 48.2: Framing decode rejects oversized payloads (>256KB)
- [ ] Test 48.3: Framing decode rejects incomplete messages (size > remaining bytes)
- [ ] Test 49.1: Frames with size = 0 are rejected
- [ ] Test 50.1: DecodeFrames handles partial frames correctly
- [ ] Test 51.1: SplitMessages skips malformed messages without crashing

**Owner**: Agent 1 (Protocol coverage completion)

---

## Phase B: P0 Contract Tests (Execution Plan)

### B1) Crypto/E2E Negative-Path Suite
**File**: `src/crypto/e2e-negative.test.ts`

**Tests to write**:
1. Reject decrypt when ciphertext is tampered
2. Reject decrypt when nonce is tampered
3. Reject decrypt when signature is tampered
4. Reject verify when sender key is wrong
5. Reject deriveSharedSecret when key type is invalid
6. Reject decrypt when payload missing required fields
7. Ensure errors are explicit and stable enough for callers

**Status**: Not started

---

### B2) MessageRouter Behavior-Contract Suite
**File**: `src/message/message-router.contract.test.ts`

**Tests to write**:
1. Send path requires recipient key and node keys; missing keys fails before transmit
2. Receive duplicate message is idempotent (no double side effects/events)
3. Out-of-order sequence buffering flushes in correct order
4. NAK schedules retry with bounded backoff and reason propagation
5. ACK on non-pending message is safely ignored
6. Replay of old vector clock does not regress local clock
7. Fallback relay selection avoids blocked peers and excludes target peer
8. Retry cleanup removes expired/terminal entries

**Status**: Not started

---

### B3) Database Transactional and Lifecycle Contract Suite
**File**: `src/database/persistence-contract.test.ts`

**Tests to write**:
1. `persistIncomingMessageAtomically` never applies partial updates
2. Duplicate incoming message causes zero sequence/vector-clock side effects
3. `queueMessage` upsert semantics preserve message_id uniqueness
4. Retry scheduling increments attempts exactly once per schedule call
5. Replica ack lifecycle (`assigned → stored → ack_expected → ack_received`)
6. Cleanup deletes only expired/terminal rows
7. LWW behavior for contacts/routing under equal timestamps
8. Search index consistency after contact update/delete

**Status**: Not started

---

### B4) Protocol Module Coverage Completion
**Files to add**:
- `src/protocols/framing.test.ts`
- `src/protocols/route.test.ts`
- `src/protocols/error-handler.test.ts`

**Tests to write**:
1. Framing decode rejects truncated/oversized/invalid payloads
2. Route announce signature validation and rejection paths
3. Route query/result handling with missing fields and stale timestamps
4. Error-handler wraps/normalizes unknown thrown values

**Status**: Not started

---

## Phase C: P0 End-to-End Messaging + Persistence + Crypto

**Status**: Not started

**Scenarios to add**:
- `tests/integration/docker/scenarios/e2e-replay-attack.yml`
- `tests/integration/docker/scenarios/e2e-key-rotation.yml`
- `tests/integration/docker/scenarios/restart-during-retry.yml`
- `tests/integration/docker/scenarios/replica-ack-timeout-recovery.yml`
- `tests/integration/docker/scenarios/out-of-order-delivery.yml`

---

## Phase D: Core Behavior Contract Harness

**Status**: Not started

**Files to add**:
- `tests/contracts/public-api.contract.test.ts`
- `tests/contracts/state-invariants.contract.test.ts`

---

## Coverage Summary

**Total Public Behaviors**: 51

**Covered**: 33 (64.7%)

**Partially Covered**: 8 (15.7%)

**Missing**: 10 (19.6%)

**P0 Missing Behaviors**: 51

**P1 Missing Behaviors**: 0

**P2 Missing Behaviors**: 0

---

## Prioritization

**P0 (Critical - Must implement before integration)**:
- All 51 missing behaviors across all modules

**P1**:
- None

**P2**:
- None

---

## Execution Ownership

1. **Agent 1**: Phase A matrix + protocol coverage completion (B4)
2. **Agent 2**: Crypto/message-router contracts (B1/B2)
3. **Agent 3**: Database + storage contract suite (B3)
4. **Agent 4**: Docker E2E scenarios (Phase C)
5. **Agent 5**: Contract harness + cleanup of flaky tests (Phase D)

---

## Definition of Done

For each missing contract:

- [ ] Unit test file exists with Given/When/Then naming
- [ ] Test asserts both positive and negative paths
- [ ] Test is deterministic (no flaky waits)
- [ ] Test passes locally with `npm test`
- [ ] Test includes failure diagnostics for debugging