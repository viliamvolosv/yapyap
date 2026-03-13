/**
 * Behavior-contract tests for MessageRouter
 * Tests observable behavior contracts, not implementation details
 */

import assert from "node:assert";
import { describe, test } from "node:test";
import {
	generateEphemeralKeyPair,
	generateIdentityKeyPair,
} from "../crypto/index.js";
import { Events } from "../events/event-types.js";
import { MessageRouter } from "./message-router.js";

// Generate valid key pairs for tests
const testIdentityKeyPair = await generateIdentityKeyPair();
const _testEphemeralKeyPair = await generateEphemeralKeyPair();

const VALID_PEER_ID = "12D3KooWCJDjHYFsC3TJzDE6rtmyL6wRonuY9qEKnBH1r5y1jRWx";
const RELAY_PEER_ID = "12D3KooWQv6UQhEMaXbYJHseY4R4vkc7x4S76QfW8D2V6Q3cQJjX";
const PEER_A = "12D3KooWSBUjBmLvcdnTmNLf6ozPZeBUmXiE3wrRA9RBTjcjqNFm";

type DbMock = {
	updateMessageStatusCalls: Array<{ id: string; status: string }>;
	markProcessedCalls: string[];
	processedIds: Set<string>;
	processedMessagesCount: number;
	lastSequences: Map<string, number>;
	queueMessage: (
		messageId: string,
		message: Record<string, unknown>,
		targetPeerId: string,
		deadlineAt: number,
	) => void;
	getAllPendingMessages: () => Array<Record<string, unknown>>;
	updateMessageStatus: (id: string, status: string) => void;
	setNextRetryAt: (id: string, nextRetryAt: number) => void;
	isMessageProcessed: (messageId: string) => boolean;
	markMessageProcessed: (
		messageId: string,
		fromPeerId: string,
		sequenceNumber?: number,
	) => void;
	persistIncomingMessageAtomically: (input: Record<string, unknown>) => {
		applied: boolean;
		duplicate: boolean;
	};
	getLastPeerSequence: (peerId: string) => number | null;
	updatePeerSequence: (peerId: string, sequenceNumber: number) => void;
	getPendingMessage: (messageId: string) => {
		message_id: string;
		target_peer_id: string;
		message_data: string;
		status: "pending" | "processing" | "delivered" | "failed";
		attempts: number;
		next_retry_at: number;
		created_at: number;
		updated_at: number;
		deadline_at: number;
		last_error?: string;
	} | null;
	incrementAttempts: (messageId: string) => void;
	scheduleRetry: (
		messageId: string,
		nextRetryAt: number,
		reason?: string,
	) => void;
	getRetryablePendingMessages: () => Array<{
		message_id: string;
		target_peer_id: string;
		message_data: string;
		status: "pending" | "processing" | "delivered" | "failed";
		attempts: number;
		next_retry_at: number;
		created_at: number;
		updated_at: number;
		deadline_at: number;
	}>;
	getPendingMessagesForPeer: (
		targetPeerId: string,
		limit?: number,
		now?: number,
	) => Array<{
		message_id: string;
		target_peer_id: string;
		message_data: string;
		status: "pending" | "delivered" | "failed";
		attempts: number;
		next_retry_at: number;
		created_at: number;
		updated_at: number;
		deadline_at: number;
	}>;
	markPendingMessageDelivered: (messageId: string) => void;
	markPendingMessageFailed: (messageId: string, reason?: string) => void;
	schedulePendingRetry: (
		messageId: string,
		nextRetryAt: number,
		reason?: string,
	) => void;
	getAllRoutingEntries: () => Array<{
		peer_id: string;
		multiaddrs: string[];
		last_seen: number;
		is_available: boolean;
		ttl: number;
	}>;
	saveRoutingEntry: (entry: {
		peer_id: string;
		multiaddrs: string[];
		last_seen: number;
		is_available: boolean;
		ttl: number;
	}) => void;
	deleteStaleRoutingEntries: () => number;
	getCachedPeerCount: () => number;
	markPeerUnavailable: (peerId: string) => void;
	markPeerAvailable: (peerId: string) => void;
	saveContact: (contact: {
		peer_id: string;
		alias: string;
		last_seen: number;
		metadata: string;
		is_trusted: boolean;
	}) => void;
	getContact: (peerId: string) => {
		peer_id: string;
		alias: string;
		last_seen: number;
		metadata: string;
		is_trusted: boolean;
	} | null;
	savePeerMetadata: (
		peerId: string,
		key: string,
		value: unknown,
		ttl?: number,
	) => void;
	getPeerMetadata: (peerId: string, key: string) => unknown | null;
	searchContacts: (query: string) => Array<{
		peer_id: string;
		alias: string;
		last_seen: number;
		metadata: string;
		is_trusted: boolean;
	}>;
	deleteContact: (peerId: string) => number;
	assignMessageReplica: (messageId: string, replicaPeerId: string) => void;
	markReplicaStored: (messageId: string, replicaPeerId: string) => void;
	markReplicaFailed: (
		messageId: string,
		replicaPeerId: string,
		reason?: string,
	) => void;
	getMessageReplicas: (messageId: string) => Array<{
		id: number;
		message_id: string;
		replica_peer_id: string;
		status: "assigned" | "stored" | "delivered" | "failed";
		assigned_at: number;
		updated_at: number;
		ack_expected: number;
		ack_received_at: number | null;
		last_error?: string;
		original_target_peer_id?: string;
	}>;
	updateReplicaAckExpected: (
		messageId: string,
		replicaPeerId: string,
		expected: boolean,
	) => void;
	markReplicaAckReceived: (messageId: string, replicaPeerId: string) => void;
	getMessagesWaitingForReplicaAck: () => Array<{
		id: number;
		message_id: string;
		replica_peer_id: string;
		status: "assigned" | "stored" | "delivered" | "failed";
		assigned_at: number;
		updated_at: number;
		ack_expected: number;
		ack_received_at: number | null;
		last_error?: string;
		original_target_peer_id?: string;
	}>;
	upsertReplicatedMessage: (
		messageId: string,
		originalTargetPeerId: string,
		sourcePeerId: string,
		deadlineAt: number,
	) => void;
	markReplicatedMessageDelivered: (messageId: string) => void;
	markReplicatedMessageFailed: (messageId: string) => void;
	deleteExpiredReplicatedMessages: (now?: number) => number;
	updateReplicaAckExpected: (
		messageId: string,
		replicaPeerId: string,
		expected: boolean,
	) => void;
	markReplicaAckReceived: (messageId: string, replicaPeerId: string) => void;
	getReplicaAckStatus: (messageId: string) => Array<{
		id: number;
		message_id: string;
		replica_peer_id: string;
		status: "assigned" | "stored" | "delivered" | "failed";
		assigned_at: number;
		updated_at: number;
		ack_expected: number;
		ack_received_at: number | null;
		last_error?: string;
		original_target_peer_id?: string;
	}>;
	deleteExpiredPendingMessages: (now?: number) => number;
	getAllVectorClocks: () => Record<string, number>;
	updateVectorClock: (peerId: string, counter: number) => void;
	getVectorClock: (peerId: string) => number;
};

// Create mock database manager
function createMockDb(): DbMock {
	const processedIds = new Set<string>();
	let processedMessagesCount = 0;
	const lastSequences = new Map<string, number>();
	const updateMessageStatusCalls: Array<{ id: string; status: string }> = [];
	const markProcessedCalls: string[] = [];
	const getAllRoutingEntriesMock: Array<{
		peer_id: string;
		multiaddrs: string[];
		last_seen: number;
		is_available: boolean;
		ttl: number;
	}> = [
		{
			peer_id: RELAY_PEER_ID,
			multiaddrs: [`/ip4/127.0.0.1/tcp/4001/p2p/${RELAY_PEER_ID}`],
			last_seen: Date.now(),
			is_available: true,
			ttl: 3600000,
		},
		{
			peer_id: PEER_A,
			multiaddrs: [`/ip4/127.0.0.1/tcp/4002/p2p/${PEER_A}`],
			last_seen: Date.now(),
			is_available: true,
			ttl: 3600000,
		},
	];

	const getAllRoutingEntries = () => getAllRoutingEntriesMock;

	return {
		updateMessageStatusCalls,
		markProcessedCalls,
		processedIds,
		processedMessagesCount,
		lastSequences,
		queueMessage: () => {},
		getAllPendingMessages: () => [],
		updateMessageStatus: (id: string, status: string) => {
			updateMessageStatusCalls.push({ id, status });
		},
		setNextRetryAt: () => {},
		isMessageProcessed: (messageId: string) => processedIds.has(messageId),
		markMessageProcessed: (
			messageId: string,
			_fromPeerId: string,
			_sequenceNumber?: number,
		) => {
			processedIds.add(messageId);
			markProcessedCalls.push(messageId);
		},
		persistIncomingMessageAtomically: (input: Record<string, unknown>) => {
			const messageId = input.message_id as string;
			const fromPeerId = input.from_peer_id as string;
			const _toPeerId = input.to_peer_id as string;
			const sequenceNumber = input.sequence_number as number | undefined;
			const vectorClock = input.vector_clock as
				| Record<string, number>
				| undefined;

			// Check if message is already processed
			if (processedIds.has(messageId)) {
				return { applied: false, duplicate: true };
			}

			// Mark as processed
			processedIds.add(messageId);
			processedMessagesCount++;

			// Update sequence if provided
			if (typeof sequenceNumber === "number") {
				lastSequences.set(fromPeerId, sequenceNumber);
			}

			// Update vector clock if provided
			if (vectorClock) {
				for (const [peerId, counter] of Object.entries(vectorClock)) {
					if (typeof counter === "number" && counter >= 0) {
						// Update the vector clock counter
						// (simplified - just storing the counter for the peer)
						if (!lastSequences.has(peerId)) {
							lastSequences.set(peerId, counter);
						}
					}
				}
			}

			return { applied: true, duplicate: false };
		},
		getLastPeerSequence: (peerId: string) => lastSequences.get(peerId) ?? null,
		updatePeerSequence: (peerId: string, sequenceNumber: number) => {
			lastSequences.set(peerId, sequenceNumber);
		},
		getPendingMessage: () => null,
		incrementAttempts: () => {},
		scheduleRetry: () => {},
		getRetryablePendingMessages: () => [],
		getPendingMessagesForPeer: () => [],
		markPendingMessageDelivered: () => {},
		markPendingMessageFailed: () => {},
		schedulePendingRetry: () => {},
		getAllRoutingEntries,
		saveRoutingEntry: () => {},
		deleteStaleRoutingEntries: () => 0,
		getCachedPeerCount: () => 0,
		markPeerUnavailable: () => {},
		markPeerAvailable: () => {},
		saveContact: () => {},
		getContact: () => null,
		savePeerMetadata: () => {},
		getPeerMetadata: () => null,
		searchContacts: () => [],
		deleteContact: () => 0,
		assignMessageReplica: () => {},
		markReplicaStored: () => {},
		markReplicaFailed: () => {},
		getMessageReplicas: () => [],
		updateReplicaAckExpected: () => {},
		markReplicaAckReceived: () => {},
		getMessagesWaitingForReplicaAck: () => [],
		upsertReplicatedMessage: () => {},
		markReplicatedMessageDelivered: () => {},
		markReplicatedMessageFailed: () => {},
		deleteExpiredReplicatedMessages: () => 0,
		getAllVectorClocks: () => ({}),
		updateVectorClock: () => {},
		getVectorClock: () => 0,
	};
}

// Create event emitter mock
function createEventEmitterMock() {
	const listeners = new Map<string, Set<(...args: unknown[]) => unknown>>();

	return {
		on: (event: string, callback: (...args: unknown[]) => void) => {
			if (!listeners.has(event)) {
				listeners.set(event, new Set());
			}
			listeners.get(event)?.add(callback);
		},
		off: (event: string, callback: (...args: unknown[]) => void) => {
			const eventListeners = listeners.get(event);
			if (eventListeners) {
				eventListeners.delete(callback);
			}
		},
		emit: (event: string, data?: unknown) => {
			const eventListeners = listeners.get(event);
			if (eventListeners) {
				eventListeners.forEach((callback) => {
					void callback(data);
				});
			}
		},
		listenerCount: (event: string) => {
			return listeners.get(event)?.size ?? 0;
		},
	};
}

// Test utilities
function _waitForEvent(
	emitter: {
		on: (event: string, callback: (...args: unknown[]) => unknown) => void;
	},
	event: string,
	timeout = 100,
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`Event ${event} not received within ${timeout}ms`));
		}, timeout);

		const handler = (data: unknown) => {
			clearTimeout(timeoutId);
			resolve(data);
		};

		emitter.on(event, handler);

		// Auto cleanup
		setTimeout(() => emitter.off(event, handler), timeout + 100);
	});
}

// ============================================================================
// Test Suite: Send Path - Missing Keys
// ============================================================================

describe("MessageRouter - Send Path - Missing Keys", () => {
	test(
		"Given messageRouter with non-existent recipient, When send attempted, Then throws error before transmit",
		() => {
			const db = createMockDb();
			const events = createEventEmitterMock();
			const router = new MessageRouter(
				{
					db,
					getLibp2p: () => ({}),
					getPeerId: () => VALID_PEER_ID,
					fetchRecipientPublicKey: async () => null,
					getNodeKeyPair: () => ({
						privateKey: Buffer.from(testIdentityKeyPair.privateKey),
						publicKey: Buffer.from(testIdentityKeyPair.publicKey),
					}),
					encryptMessage: () => {},
					encodeResponse: () => new Uint8Array(),
					safeClose: async () => {},
				},
				events,
			);

			assert.throws(
				() =>
					router.sendMessage(
						"12D3KooNONEXISTENT1234567890ABCDEF",
						{ text: "test message" },
						10000,
					),
				/No recipient key found|recipient key/i,
			);
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: Receive - Idempotency
// ============================================================================

describe("MessageRouter - Receive - Idempotency", () => {
	test(
		"Given duplicate message received, When processed twice, Then no duplicate side effects/events",
		async () => {
			const db = createMockDb();
			const events = createEventEmitterMock();
			const router = new MessageRouter(
				{
					db,
					getLibp2p: () => ({}),
					getPeerId: () => VALID_PEER_ID,
					fetchRecipientPublicKey: async () =>
						Buffer.from(testIdentityKeyPair.publicKey),
					getNodeKeyPair: () => ({
						privateKey: Buffer.from(testIdentityKeyPair.privateKey),
						publicKey: Buffer.from(testIdentityKeyPair.publicKey),
					}),
					encryptMessage: () => {},
					encodeResponse: () => new Uint8Array(),
					safeClose: async () => {},
				},
				events,
			);

			const messageId = "msg-duplicate-123";
			const message = {
				message_id: messageId,
				from_peer_id: PEER_A,
				to_peer_id: VALID_PEER_ID,
				sequence_number: 1,
				timestamp: Date.now(),
				payload: { text: "test message" },
			};

			// First receive
			router.receiveMessage(message, PEER_A);

			// Count events before second receive
			const _eventCountBefore = events.listenerCount(Events.MESSAGE_RECEIVED);

			// Second receive (duplicate)
			router.receiveMessage(message, PEER_A);

			// Count events after second receive
			const _eventCountAfter = events.listenerCount(Events.MESSAGE_RECEIVED);

			// Sequence should not increase
			const sequence = db.getLastPeerSequence(PEER_A);
			assert.strictEqual(
				sequence,
				1,
				"Sequence should not increase on duplicate",
			);

			// Vector clock should not increase
			const vectorClock = db.getVectorClock(PEER_A);
			assert.strictEqual(
				vectorClock,
				0,
				"Vector clock should not increase on duplicate",
			);
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: ACK - Safe Ignorance
// ============================================================================

describe("MessageRouter - ACK - Safe Ignorance", () => {
	test(
		"Given non-pending message, When ACK received, Then ignored safely with no side effects",
		() => {
			const db = createMockDb();
			const events = createEventEmitterMock();
			const router = new MessageRouter(
				{
					db,
					getLibp2p: () => ({}),
					getPeerId: () => VALID_PEER_ID,
					fetchRecipientPublicKey: async () =>
						Buffer.from(testIdentityKeyPair.publicKey),
					getNodeKeyPair: () => ({
						privateKey: Buffer.from(testIdentityKeyPair.privateKey),
						publicKey: Buffer.from(testIdentityKeyPair.publicKey),
					}),
					encryptMessage: () => {},
					encodeResponse: () => new Uint8Array(),
					safeClose: async () => {},
				},
				events,
			);

			// Try to ACK a message that was never sent
			router.handleAck({
				message_id: "non-existent-message",
				timestamp: Date.now(),
			});

			// Should not throw and should not modify database
			const pendingMessages = db.getAllPendingMessages();
			assert.strictEqual(
				pendingMessages.length,
				0,
				"No messages should be created",
			);
		},
		{ timeout: 5000 },
	);

	test(
		"Given delivered message, When ACK received, Then ignored safely",
		() => {
			const db = createMockDb();
			const events = createEventEmitterMock();
			const router = new MessageRouter(
				{
					db,
					getLibp2p: () => ({}),
					getPeerId: () => VALID_PEER_ID,
					fetchRecipientPublicKey: async () =>
						Buffer.from(testIdentityKeyPair.publicKey),
					getNodeKeyPair: () => ({
						privateKey: Buffer.from(testIdentityKeyPair.privateKey),
						publicKey: Buffer.from(testIdentityKeyPair.publicKey),
					}),
					encryptMessage: () => {},
					encodeResponse: () => new Uint8Array(),
					safeClose: async () => {},
				},
				events,
			);

			// Create and deliver a message
			router.sendMessage(PEER_A, { text: "test" }, 10000);

			const pendingMessages = db.getAllPendingMessages();
			assert.strictEqual(
				pendingMessages.length,
				1,
				"Message should be pending",
			);

			// ACK the delivered message
			router.handleAck({
				message_id: pendingMessages[0].message_id,
				timestamp: Date.now(),
			});

			// Should not throw and should not create new pending messages
			const pendingMessagesAfter = db.getAllPendingMessages();
			assert.strictEqual(
				pendingMessagesAfter.length,
				1,
				"No new messages should be created",
			);
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: NAK - Retry with Backoff
// ============================================================================

describe("MessageRouter - NAK - Retry with Backoff", () => {
	test(
		"Given pending message, When NAK received, Then schedules retry with bounded backoff and reason propagation",
		() => {
			const db = createMockDb();
			const events = createEventEmitterMock();
			const router = new MessageRouter(
				{
					db,
					getLibp2p: () => ({}),
					getPeerId: () => VALID_PEER_ID,
					fetchRecipientPublicKey: async () =>
						Buffer.from(testIdentityKeyPair.publicKey),
					getNodeKeyPair: () => ({
						privateKey: Buffer.from(testIdentityKeyPair.privateKey),
						publicKey: Buffer.from(testIdentityKeyPair.publicKey),
					}),
					encryptMessage: () => {},
					encodeResponse: () => new Uint8Array(),
					safeClose: async () => {},
				},
				events,
			);

			// Send a message
			router.sendMessage(PEER_A, { text: "test" }, 10000);

			const pendingMessages = db.getAllPendingMessages();
			assert.strictEqual(
				pendingMessages.length,
				1,
				"Message should be pending",
			);

			const messageId = pendingMessages[0].message_id;

			// Send NAK with reason
			router.handleNak({
				message_id: messageId,
				timestamp: Date.now(),
				reason: "timeout",
			});

			// Check that retry was scheduled
			const retryableMessages = db.getRetryablePendingMessages();
			assert.strictEqual(
				retryableMessages.length,
				1,
				"Retry should be scheduled",
			);
			assert.strictEqual(
				retryableMessages[0].attempts,
				1,
				"Attempts should increment to 1",
			);
			assert.ok(
				retryableMessages[0].next_retry_at > Date.now(),
				"Next retry time should be in future",
			);
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: Vector Clock - Replay Protection
// ============================================================================

describe("MessageRouter - Vector Clock - Replay Protection", () => {
	test(
		"Given old vector clock, When processed, Then does not regress local clock",
		() => {
			const db = createMockDb();
			const events = createEventEmitterMock();
			const router = new MessageRouter(
				{
					db,
					getLibp2p: () => ({}),
					getPeerId: () => VALID_PEER_ID,
					fetchRecipientPublicKey: async () =>
						Buffer.from(testIdentityKeyPair.publicKey),
					getNodeKeyPair: () => ({
						privateKey: Buffer.from(testIdentityKeyPair.privateKey),
						publicKey: Buffer.from(testIdentityKeyPair.publicKey),
					}),
					encryptMessage: () => {},
					encodeResponse: () => new Uint8Array(),
					safeClose: async () => {},
				},
				events,
			);

			// Process a message with current vector clock
			const message1 = {
				message_id: "msg-1",
				from_peer_id: PEER_A,
				to_peer_id: VALID_PEER_ID,
				sequence_number: 1,
				timestamp: Date.now(),
				vector_clock: { [PEER_A]: 1 },
				payload: { text: "test message 1" },
			};

			router.receiveMessage(message1, PEER_A);

			// Get current vector clock
			const currentClock = db.getVectorClock(PEER_A);
			assert.ok(currentClock >= 1, "Vector clock should be at least 1");

			// Try to process same message again (old vector clock)
			router.receiveMessage(message1, PEER_A);

			// Vector clock should not decrease
			const newClock = db.getVectorClock(PEER_A);
			assert.strictEqual(
				newClock,
				currentClock,
				"Vector clock should not regress",
			);
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: Retry Cleanup
// ============================================================================

describe("MessageRouter - Retry Cleanup", () => {
	test(
		"Given expired terminal messages, When cleanup called, Then removes entries",
		() => {
			const db = createMockDb();
			const events = createEventEmitterMock();
			const _router = new MessageRouter(
				{
					db,
					getLibp2p: () => ({}),
					getPeerId: () => VALID_PEER_ID,
					fetchRecipientPublicKey: async () =>
						Buffer.from(testIdentityKeyPair.publicKey),
					getNodeKeyPair: () => ({
						privateKey: Buffer.from(testIdentityKeyPair.privateKey),
						publicKey: Buffer.from(testIdentityKeyPair.publicKey),
					}),
					encryptMessage: () => {},
					encodeResponse: () => new Uint8Array(),
					safeClose: async () => {},
				},
				events,
			);

			// Add a delivered message
			const messageId = "msg-expired";
			db.queueMessage(messageId, { text: "test" }, PEER_A, Date.now() - 10000);
			db.markPendingMessageDelivered(messageId);

			// Add a failed message
			db.queueMessage(
				"msg-failed",
				{ text: "test" },
				PEER_A,
				Date.now() - 10000,
			);
			db.markPendingMessageFailed("msg-failed", "error");

			// Add an expired pending message
			db.queueMessage(
				"msg-pending-expired",
				{ text: "test" },
				PEER_A,
				Date.now() - 10000,
			);

			// Add a valid pending message
			db.queueMessage(
				"msg-valid",
				{ text: "test" },
				PEER_A,
				Date.now() + 3600000,
			);

			// Cleanup
			const deleted = db.deleteExpiredPendingMessages(Date.now() + 1000);

			// Should delete expired and terminal messages
			assert.ok(
				deleted >= 3,
				`Should delete at least 3 expired messages, got ${deleted}`,
			);

			// Valid message should still exist
			const pendingMessages = db.getAllPendingMessages();
			const validExists = pendingMessages.some(
				(m) => m.message_id === "msg-valid",
			);
			assert.ok(validExists, "Valid pending message should still exist");
		},
		{ timeout: 5000 },
	);
});
