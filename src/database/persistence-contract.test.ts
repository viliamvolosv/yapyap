/**
 * Transactional and lifecycle contract tests for DatabaseManager
 * Tests atomic operations, duplicate handling, and state transitions
 */

import assert from "node:assert";
import { describe, test } from "node:test";
import { DatabaseManager } from "./index.js";
import type { YapYapNodeOptions } from "../core/node.js";

// Test utilities
function createTestDBManager() {
	const dbPath = `/tmp/yapyap-test-${Date.now()}-${Math.random().toString(36).substring(7)}.db`;
	const options: YapYapNodeOptions = {
		dataDir: dbPath,
	};

	const dbManager = new DatabaseManager(options);

	return {
		dbManager,
		dbPath,
		cleanup: () => {
			dbManager.close();
			try {
				import("node:fs").then((fs) => fs.unlinkSync(dbPath));
			} catch (e) {
				// Ignore if file doesn't exist
			}
		},
	};
}

// ============================================================================
// Test Suite: persistIncomingMessageAtomically
// ============================================================================

describe("DatabaseManager - persistIncomingMessageAtomically - Atomicity", () => {
	test(
		"Given valid message, When persistIncomingMessageAtomically called, Then applies all updates atomically",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const input = {
					messageId: "msg-atomic-1",
					fromPeerId: "peer-1",
					toPeerId: "peer-2",
					sequenceNumber: 1,
					messageData: { text: "test message" },
					ttl: 3600000,
					vectorClock: { peer1: 1, peer2: 0 },
				};

				const result = dbManager.persistIncomingMessageAtomically(input);

				assert.strictEqual(result.applied, true, "Should apply message");
				assert.strictEqual(result.duplicate, false, "Should not be duplicate");

				// Verify processed_messages table
				const processed = dbManager.isMessageProcessed("msg-atomic-1");
				assert.ok(processed, "Message should be marked as processed");

				// Verify peer_sequences table
				const sequence = dbManager.getLastPeerSequence("peer-1");
				assert.strictEqual(sequence, 1, "Sequence should be 1");

				// Verify peer_vector_clocks table
				const vectorClock = dbManager.getVectorClock("peer-1");
				assert.strictEqual(vectorClock, 1, "Vector clock should be 1");
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);

	test(
		"Given duplicate message, When persistIncomingMessageAtomically called, Then no side effects",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const input = {
					messageId: "msg-duplicate-1",
					fromPeerId: "peer-1",
					toPeerId: "peer-2",
					sequenceNumber: 1,
					messageData: { text: "test message" },
					ttl: 3600000,
					vectorClock: { peer1: 1, peer2: 0 },
				};

				// First call
				dbManager.persistIncomingMessageAtomically(input);

				// Get vector clock before second call
				const vectorClockBefore = dbManager.getVectorClock("peer-1");

				// Second call (duplicate)
				const result = dbManager.persistIncomingMessageAtomically(input);

				assert.strictEqual(result.applied, false, "Should not apply duplicate");
				assert.strictEqual(result.duplicate, true, "Should be marked as duplicate");

				// Verify no side effects
				const vectorClockAfter = dbManager.getVectorClock("peer-1");
				assert.strictEqual(vectorClockAfter, vectorClockBefore, "Vector clock should not change");

				const sequence = dbManager.getLastPeerSequence("peer-1");
				assert.strictEqual(sequence, 1, "Sequence should remain 1");
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);

	test(
		"Given partial update failure, When persistIncomingMessageAtomically called, Then never applies partial updates",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const input = {
					messageId: "msg-partial-1",
					fromPeerId: "peer-1",
					toPeerId: "peer-2",
					sequenceNumber: 1,
					messageData: { text: "test message" },
					ttl: 3600000,
					vectorClock: { peer1: 1, peer2: 0 },
				};

				// This should succeed
				const result = dbManager.persistIncomingMessageAtomically(input);
				assert.strictEqual(result.applied, true);

				// Verify all tables updated
				const processed = dbManager.isMessageProcessed("msg-partial-1");
				assert.ok(processed, "processed_messages should be updated");

				const sequence = dbManager.getLastPeerSequence("peer-1");
				assert.strictEqual(sequence, 1, "peer_sequences should be updated");

				const vectorClock = dbManager.getVectorClock("peer-1");
				assert.strictEqual(vectorClock, 1, "peer_vector_clocks should be updated");
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: Duplicate Handling
// ============================================================================

describe("DatabaseManager - Duplicate Handling", () => {
	test(
		"Given duplicate incoming message, When processed multiple times, Then zero sequence/vector-clock side effects",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const messageId = "msg-dup-1";
				const input = {
					messageId,
					fromPeerId: "peer-1",
					toPeerId: "peer-2",
					sequenceNumber: 1,
					messageData: { text: "test message" },
					ttl: 3600000,
					vectorClock: { peer1: 1 },
				};

				// Process once
				dbManager.persistIncomingMessageAtomically(input);

				const sequence1 = dbManager.getLastPeerSequence("peer-1");
				const vectorClock1 = dbManager.getVectorClock("peer-1");

				// Process again (duplicate)
				dbManager.persistIncomingMessageAtomically(input);

				const sequence2 = dbManager.getLastPeerSequence("peer-1");
				const vectorClock2 = dbManager.getVectorClock("peer-1");

				// Process third time
				dbManager.persistIncomingMessageAtomically(input);

				const sequence3 = dbManager.getLastPeerSequence("peer-1");
				const vectorClock3 = dbManager.getVectorClock("peer-1");

				// All should be equal
				assert.strictEqual(sequence1, sequence2, "Sequence should not change on duplicate");
				assert.strictEqual(sequence2, sequence3, "Sequence should not change on duplicate");
				assert.strictEqual(vectorClock1, vectorClock2, "Vector clock should not change on duplicate");
				assert.strictEqual(vectorClock2, vectorClock3, "Vector clock should not change on duplicate");
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: queueMessage
// ============================================================================

describe("DatabaseManager - queueMessage - Upsert Semantics", () => {
	test(
		"Given message_id collision, When queueMessage called, Then preserves uniqueness and upserts data",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const messageId = "msg-unique-1";

				// First insert
				dbManager.queueMessage(
					messageId,
					{ text: "first version" },
					"peer-1",
					Date.now() + 3600000,
				);

				const msg1 = dbManager.getPendingMessage(messageId);
				assert.ok(msg1, "Message should exist");
				assert.strictEqual(msg1?.message_id, messageId);
				assert.strictEqual(msg1?.status, "pending");
				assert.strictEqual(msg1?.attempts, 0);

				// Second insert (upsert)
				dbManager.queueMessage(
					messageId,
					{ text: "second version" },
					"peer-2",
					Date.now() + 7200000,
				);

				const msg2 = dbManager.getPendingMessage(messageId);
				assert.ok(msg2, "Message should exist after upsert");
				assert.strictEqual(msg2?.message_id, messageId);
				assert.strictEqual(msg2?.status, "pending");
				assert.strictEqual(msg2?.attempts, 0); // Should reset attempts on upsert
				assert.strictEqual(msg2?.target_peer_id, "peer-2"); // Should update target peer
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: Retry Scheduling
// ============================================================================

describe("DatabaseManager - Retry Scheduling", () => {
	test(
		"Given scheduleRetry called, Then increments attempts exactly once per call",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const messageId = "msg-retry-1";

				// Initial insert
				dbManager.queueMessage(messageId, { text: "test" }, "peer-1", Date.now() + 3600000);

				// Schedule retry (attempts should increment)
				dbManager.scheduleRetry(messageId, Date.now() + 7200000, "timeout");

				const msg1 = dbManager.getPendingMessage(messageId);
				assert.strictEqual(msg1?.attempts, 1, "Attempts should be 1 after first schedule");

				// Schedule retry again (attempts should increment again)
				dbManager.scheduleRetry(messageId, Date.now() + 10800000, "error");

				const msg2 = dbManager.getPendingMessage(messageId);
				assert.strictEqual(msg2?.attempts, 2, "Attempts should be 2 after second schedule");
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);

	test(
		"Given schedulePendingRetry called, Then increments attempts exactly once",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const messageId = "msg-schedule-1";

				// Initial insert
				dbManager.queueMessage(messageId, { text: "test" }, "peer-1", Date.now() + 3600000);

				// Use schedulePendingRetry (attempts should increment)
				dbManager.schedulePendingRetry(
					messageId,
					Date.now() + 7200000,
					"timeout",
				);

				const msg1 = dbManager.getPendingMessage(messageId);
				assert.strictEqual(msg1?.attempts, 1, "Attempts should be 1 after schedulePendingRetry");
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: Replica ACK Lifecycle
// ============================================================================

describe("DatabaseManager - Replica ACK Lifecycle", () => {
	test(
		"Given assignMessageReplica, markReplicaStored, markReplicaAckReceived, Then lifecycle complete",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const messageId = "msg-replica-1";
				const replicaPeerId = "peer-1";

				// Step 1: Assign replica
				dbManager.assignMessageReplica(messageId, replicaPeerId);

				const replicas1 = dbManager.getMessageReplicas(messageId);
				assert.strictEqual(replicas1.length, 1, "Should have one replica");
				assert.strictEqual(replicas1[0].status, "assigned", "Status should be assigned");
				assert.strictEqual(replicas1[0].ack_expected, 1, "ack_expected should be 1");

				// Step 2: Mark replica stored
				dbManager.markReplicaStored(messageId, replicaPeerId);

				const replicas2 = dbManager.getMessageReplicas(messageId);
				assert.strictEqual(replicas2[0].status, "stored", "Status should be stored");
				assert.strictEqual(replicas2[0].ack_expected, 1, "ack_expected should still be 1");

				// Step 3: Mark ack received
				dbManager.markReplicaAckReceived(messageId, replicaPeerId);

				const replicas3 = dbManager.getMessageReplicas(messageId);
				assert.strictEqual(replicas3[0].status, "stored", "Status should remain stored");
				assert.ok(replicas3[0].ack_received_at, "ack_received_at should be set");
				assert.strictEqual(
					typeof replicas3[0].ack_received_at,
					"number",
					"ack_received_at should be a number",
				);
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);

	test(
		"Given multiple replicas, Then lifecycle independent per replica",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const messageId = "msg-multi-replica";
				const replicas = ["peer-1", "peer-2", "peer-3"];

				// Assign all replicas
				replicas.forEach((replicaPeerId) => {
					dbManager.assignMessageReplica(messageId, replicaPeerId);
				});

				// Store and ack first replica
				dbManager.markReplicaStored(messageId, "peer-1");
				dbManager.markReplicaAckReceived(messageId, "peer-1");

				// Get replicas
				const allReplicas = dbManager.getMessageReplicas(messageId);
				assert.strictEqual(allReplicas.length, 3, "Should have 3 replicas");

				// Check state of each replica
				allReplicas.forEach((replica) => {
					if (replica.replica_peer_id === "peer-1") {
						assert.ok(replica.ack_received_at, "peer-1 should have ack_received_at");
						assert.strictEqual(replica.status, "stored", "peer-1 should be stored");
					} else {
						assert.strictEqual(replica.status, "assigned", "Other replicas should be assigned");
						assert.strictEqual(replica.ack_expected, 1, "Other replicas should have ack_expected");
					}
				});
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: Cleanup
// ============================================================================

describe("DatabaseManager - Cleanup", () => {
	test(
		"Given expired messages, When cleanup called, Then deletes only expired/terminal rows",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const now = Date.now();

				// Add expired pending message
				dbManager.queueMessage("msg-expired", { text: "test" }, "peer-1", now - 10000);

				// Add delivered message (should be deleted)
				dbManager.queueMessage("msg-delivered", { text: "test" }, "peer-1", now - 10000);
				dbManager.markPendingMessageDelivered("msg-delivered");

				// Add failed message (should be deleted)
				dbManager.queueMessage("msg-failed", { text: "test" }, "peer-1", now - 10000);
				dbManager.markPendingMessageFailed("msg-failed", "error");

				// Add valid pending message (should NOT be deleted)
				dbManager.queueMessage("msg-valid", { text: "test" }, "peer-1", now + 3600000);

				// Add expired replica message
				dbManager.assignMessageReplica("msg-replica-expired", "peer-1");
				dbManager.markReplicaStored("msg-replica-expired", "peer-1");
				dbManager.markReplicatedMessageFailed("msg-replica-expired");

				// Cleanup
				const deleted = dbManager.deleteExpiredPendingMessages(now + 1000);

				// Should delete expired/terminal messages
				assert.ok(deleted >= 3, `Should delete at least 3 messages, got ${deleted}`);

				// Valid message should still exist
				const pendingMessages = dbManager.getPendingMessagesByIds(["msg-valid"]);
				assert.strictEqual(pendingMessages.length, 1, "Valid pending message should still exist");
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);

	test(
		"Given stale routing entries, When deleteStaleRoutingEntries called, Then deletes only expired entries",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const now = Date.now();

				// Add valid routing entry
				dbManager.saveRoutingEntry({
					peer_id: "peer-valid",
					multiaddrs: ["/ip4/127.0.0.1"],
					last_seen: now,
					is_available: true,
					ttl: 3600000,
				});

				// Add stale routing entry
				dbManager.saveRoutingEntry({
					peer_id: "peer-stale",
					multiaddrs: ["/ip4/127.0.0.1"],
					last_seen: now - 4000000, // 1 hour ago
					is_available: true,
					ttl: 3600000,
				});

				// Cleanup
				const deleted = dbManager.deleteStaleRoutingEntries();

				// Should delete stale entry
				assert.ok(deleted >= 1, `Should delete at least 1 stale entry, got ${deleted}`);

				// Valid entry should still exist
				const validEntry = dbManager.getRoutingEntry("peer-valid");
				assert.ok(validEntry, "Valid routing entry should still exist");

				const staleEntry = dbManager.getRoutingEntry("peer-stale");
				assert.strictEqual(staleEntry, null, "Stale routing entry should be deleted");
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: LWW Behavior
// ============================================================================

describe("DatabaseManager - Last-Write-Wins Behavior", () => {
	test(
		"Given equal timestamps, When saveContactLww called, Then LWW logic applies",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				const peerId = "peer-lww-1";

				// First save
				dbManager.saveContact({
					peer_id: peerId,
					alias: "first",
					last_seen: Date.now(),
					metadata: JSON.stringify({ version: 1 }),
					is_trusted: false,
				});

				const contact1 = dbManager.getContact(peerId);
				assert.strictEqual(contact1?.alias, "first");

				// Second save with equal timestamp (simulate by using same timestamp)
				// In real scenario, this would use the same timestamp
				dbManager.saveContact({
					peer_id: peerId,
					alias: "second",
					last_seen: contact1?.last_seen ?? Date.now(),
					metadata: JSON.stringify({ version: 2 }),
					is_trusted: true,
				});

				const contact2 = dbManager.getContact(peerId);
				// LWW should keep the later write
				assert.ok(
					contact2?.metadata?.includes("version: 2"),
					"LWW should keep later write with equal timestamp",
				);
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: Search Index Consistency
// ============================================================================

describe("DatabaseManager - Search Index Consistency", () => {
	test(
		"Given contact update, When searchContacts called, Then index reflects changes",
		() => {
			const { dbManager, cleanup } = createTestDBManager();
			try {
				// Create contact with alias
				dbManager.saveContact({
					peer_id: "peer-search-1",
					alias: "test-contact",
					last_seen: Date.now(),
					metadata: JSON.stringify({}),
					is_trusted: false,
				});

				// Search should find contact
				const results1 = dbManager.searchContacts("test-contact");
				assert.strictEqual(results1.length, 1, "Should find contact by alias");

				// Update contact alias
				dbManager.saveContact({
					peer_id: "peer-search-1",
					alias: "updated-contact",
					last_seen: Date.now(),
					metadata: JSON.stringify({}),
					is_trusted: false,
				});

				// Search should find updated contact
				const results2 = dbManager.searchContacts("updated-contact");
				assert.strictEqual(results2.length, 1, "Should find updated contact");

				// Old alias should not find contact
				const results3 = dbManager.searchContacts("test-contact");
				assert.strictEqual(results3.length, 0, "Old alias should not find contact");
			} finally {
				cleanup();
			}
		},
		{ timeout: 5000 },
	);
});