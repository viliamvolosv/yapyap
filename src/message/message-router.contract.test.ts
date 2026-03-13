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
import { Events, type YapYapEvent } from "../events/event-types.js";
import type { YapYapMessage } from "../message/message.js";
import { MessageRouter } from "./message-router.js";
import type { Stream } from "@libp2p/interface";

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
	type PendingMessageEntry = {
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
	};
	const pendingMessages = new Map<string, PendingMessageEntry>();
	const vectorClocks = new Map<string, number>();

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

	const recordVectorClock = (peerId: string, counter: number) => {
		const current = vectorClocks.get(peerId) ?? 0;
		vectorClocks.set(peerId, Math.max(current, counter));
	};

	const applyVectorClockSnapshot = (clock?: Record<string, number>) => {
		if (!clock) return;
		for (const [peerId, counter] of Object.entries(clock)) {
			if (typeof counter === "number" && counter >= 0) {
				recordVectorClock(peerId, counter);
			}
		}
	};

	const queueMessage = (
		messageId: string,
		message: Record<string, unknown>,
		targetPeerId: string,
		deadlineAt: number,
	) => {
		const now = Date.now();
		pendingMessages.set(messageId, {
			message_id: messageId,
			target_peer_id: targetPeerId,
			message_data: JSON.stringify(message),
			status: "pending",
			attempts: 0,
			next_retry_at: now,
			created_at: now,
			updated_at: now,
			deadline_at: deadlineAt,
		});
	};

	return {
		updateMessageStatusCalls,
		markProcessedCalls,
		processedIds,
		processedMessagesCount,
		lastSequences,
		queueMessage,
		getAllPendingMessages: () => Array.from(pendingMessages.values()),
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
		const messageId = (input.messageId ?? input.message_id) as string;
		const fromPeerId = (input.fromPeerId ?? input.from_peer_id) as string;
		const _toPeerId = input.toPeerId ?? input.to_peer_id;
		const sequenceNumber = (input.sequenceNumber ??
			input.sequence_number) as number | undefined;
		const vectorClock = (input.vectorClock ??
			input.vector_clock) as Record<string, number> | undefined;

			if (processedIds.has(messageId)) {
				return { applied: false, duplicate: true };
			}

			processedIds.add(messageId);
			processedMessagesCount++;

			if (typeof sequenceNumber === "number") {
				lastSequences.set(fromPeerId, sequenceNumber);
			}

			applyVectorClockSnapshot(vectorClock);

			return { applied: true, duplicate: false };
		},
		getLastPeerSequence: (peerId: string) => lastSequences.get(peerId) ?? null,
		updatePeerSequence: (peerId: string, sequenceNumber: number) => {
			lastSequences.set(peerId, sequenceNumber);
		},
		getPendingMessage: (messageId: string) => pendingMessages.get(messageId) ?? null,
		incrementAttempts: (messageId: string) => {
			const entry = pendingMessages.get(messageId);
			if (entry) {
				entry.attempts += 1;
				entry.updated_at = Date.now();
			}
		},
		scheduleRetry: (
			messageId: string,
			nextRetryAt: number,
			reason?: string,
		) => {
			const entry = pendingMessages.get(messageId);
			if (entry) {
				entry.next_retry_at = nextRetryAt;
				entry.last_error = reason;
				entry.updated_at = Date.now();
			}
		},
		getRetryablePendingMessages: () =>
			Array.from(pendingMessages.values()).filter(
				(entry) => entry.status === "pending",
			),
		getPendingMessagesForPeer: () => [],
		markPendingMessageDelivered: (messageId: string) => {
			const entry = pendingMessages.get(messageId);
			if (entry) {
				entry.status = "delivered";
				entry.updated_at = Date.now();
			}
		},
		markPendingMessageFailed: (messageId: string, reason?: string) => {
			const entry = pendingMessages.get(messageId);
			if (entry) {
				entry.status = "failed";
				entry.last_error = reason;
				entry.updated_at = Date.now();
			}
		},
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
		deleteExpiredPendingMessages: (now = Date.now()) => {
			const expired: string[] = [];
			for (const [messageId, entry] of pendingMessages) {
				if (
					entry.status === "delivered" ||
					entry.status === "failed" ||
					entry.deadline_at <= now
				) {
					expired.push(messageId);
				}
			}
			expired.forEach((messageId) => pendingMessages.delete(messageId));
			return expired.length;
		},
		getAllVectorClocks: () => Object.fromEntries(vectorClocks),
		updateVectorClock: (peerId: string, counter: number) => {
			recordVectorClock(peerId, counter);
		},
		getVectorClock: (peerId: string) => vectorClocks.get(peerId) ?? 0,
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

type RouterTestOptions = {
	db?: DbMock;
	fetchRecipientPublicKey?: Buffer | null;
	bootstrapPeerIds?: string[];
	routingEntries?: Array<{
		peer_id: string;
		multiaddrs: string[];
		last_seen: number;
		is_available: boolean;
		ttl: number;
	}>;
};

function createRouterTestEnvironment(
	options: RouterTestOptions = {},
) {
	const db = options.db ?? createMockDb();
	if (options.routingEntries) {
		db.getAllRoutingEntries = () => options.routingEntries ?? [];
	}
	const events = createEventEmitterMock();
	const createDummyStream = (): Stream =>
		({
			send: async () => undefined,
			close: async () => undefined,
		}) as unknown as Stream;

	const libp2pMock = {
		dialProtocol: async () => createDummyStream(),
		hangUp: async () => {},
	};
	const router = new MessageRouter({
		db,
		getLibp2p: () => libp2pMock,
		getPeerId: () => VALID_PEER_ID,
		fetchRecipientPublicKey: async () => {
			if (options.fetchRecipientPublicKey !== undefined) {
				return options.fetchRecipientPublicKey;
			}
			return Buffer.from(testIdentityKeyPair.publicKey);
		},
		getNodeKeyPair: () => ({
			privateKey: Buffer.from(testIdentityKeyPair.privateKey),
			publicKey: Buffer.from(testIdentityKeyPair.publicKey),
		}),
		encryptMessage: () => {},
		encodeResponse: () => new Uint8Array(),
		safeClose: async () => {},
		getBootstrapPeerIds: () => options.bootstrapPeerIds ?? [],
		emitEvent: async (event: YapYapEvent) => {
			events.emit(event.type, event);
		},
	});
	return { router, db, events };
}

function createDataMessage(overrides: Partial<YapYapMessage> = {}): YapYapMessage {
	const base: YapYapMessage = {
		id: overrides.id ?? `msg-${Math.random().toString(36).slice(2)}`,
		type: "data",
		from: overrides.from ?? PEER_A,
		to: overrides.to ?? VALID_PEER_ID,
		payload: overrides.payload ?? { text: "test message" },
		timestamp: overrides.timestamp ?? Date.now(),
	};

	return { ...base, ...overrides };
}

// ============================================================================
// Test Suite: Send Path - Missing Keys
// ============================================================================

describe("MessageRouter - Send Path - Missing Keys", () => {
	test(
		"Given messageRouter with non-existent recipient, When send attempted, Then throws error before transmit",
		async () => {
			const { router } = createRouterTestEnvironment({
				fetchRecipientPublicKey: null,
			});
			const message = createDataMessage({
				id: "msg-missing-key",
				to: "12D3KooNONEXISTENT1234567890ABCDEF",
			});

			await assert.rejects(
				async () => {
					await router.send(message);
				},
				/Encryption required/,
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
			const { router, db, events } = createRouterTestEnvironment();

			const messageId = "msg-duplicate-123";
			const message = createDataMessage({
				id: messageId,
				from: PEER_A,
				to: VALID_PEER_ID,
				sequenceNumber: 1,
				payload: { text: "test message" },
				vectorClock: { [PEER_A]: 1 },
			});

			// First receive
			await router.receive(message);

			const _eventCountBefore = events.listenerCount(Events.MESSAGE_RECEIVED);
			const vectorClockAfterFirst = db.getVectorClock(PEER_A);
			assert.ok(
				vectorClockAfterFirst >= 1,
				"Vector clock should increment on first receive",
			);

			// Second receive (duplicate)
			await router.receive(message);

			const _eventCountAfter = events.listenerCount(Events.MESSAGE_RECEIVED);
			const vectorClockAfterSecond = db.getVectorClock(PEER_A);

			// Sequence should not increase
			const sequence = db.getLastPeerSequence(PEER_A);
			assert.strictEqual(
				sequence,
				1,
				"Sequence should not increase on duplicate",
			);

			// Vector clock should not increase
			assert.strictEqual(
				vectorClockAfterSecond,
				vectorClockAfterFirst,
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
		async () => {
			const { router, db } = createRouterTestEnvironment();

			await router.handleAck({
				id: "ack-non-existent",
				type: "ack",
				from: PEER_A,
				to: VALID_PEER_ID,
				payload: {},
				timestamp: Date.now(),
				originalMessageId: "non-existent-message",
			});

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
		async () => {
			const { router, db } = createRouterTestEnvironment();
			const message = createDataMessage({
				id: "msg-ack-delivered",
				from: VALID_PEER_ID,
				to: PEER_A,
			});

			await router.send(message);

			const pendingMessages = db.getAllPendingMessages();
			assert.strictEqual(
				pendingMessages.length,
				1,
				"Message should be pending",
			);

			await router.handleAck({
				id: "ack-delivered",
				type: "ack",
				from: PEER_A,
				to: VALID_PEER_ID,
				payload: {},
				timestamp: Date.now(),
				originalMessageId: pendingMessages[0].message_id,
			});

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
		async () => {
			const { router, db } = createRouterTestEnvironment();
			const message = createDataMessage({
				id: "msg-nak-retry",
				from: VALID_PEER_ID,
				to: PEER_A,
			});

			await router.send(message);

			const pendingMessages = db.getAllPendingMessages();
			assert.strictEqual(
				pendingMessages.length,
				1,
				"Message should be pending",
			);

			const messageId = pendingMessages[0].message_id;

			await router.handleNak({
				id: "nak-retry",
				type: "nak",
				from: PEER_A,
				to: VALID_PEER_ID,
				payload: {},
				timestamp: Date.now(),
				reason: "timeout",
				originalMessageId: messageId,
			});

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
		assert.strictEqual(
			retryableMessages[0].last_error,
			"timeout",
			"Retry reason should propagate to last_error",
		);
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: Fallback Relay Selection
// ============================================================================

describe("MessageRouter - Fallback Relay Selection", () => {
	test(
		"Given blocked relay candidates, When selectReplicaPeers called, Then blocked peers and the target peer are excluded",
		() => {
			const entries = [
				{
					peer_id: RELAY_PEER_ID,
					multiaddrs: [`/ip4/127.0.0.1/tcp/4001/p2p/${RELAY_PEER_ID}`],
					last_seen: Date.now(),
					is_available: true,
					ttl: 3600000,
				},
				{
					peer_id: "blocked-relay",
					multiaddrs: [`/ip4/127.0.0.1/tcp/4002/p2p/blocked-relay`],
					last_seen: Date.now(),
					is_available: true,
					ttl: 3600000,
				},
				{
					peer_id: VALID_PEER_ID,
					multiaddrs: [`/ip4/127.0.0.1/tcp/4003/p2p/${VALID_PEER_ID}`],
					last_seen: Date.now(),
					is_available: true,
					ttl: 3600000,
				},
			];
			const { router } = createRouterTestEnvironment({
				bootstrapPeerIds: ["bootstrap-peer"],
				routingEntries: entries,
			});
			const routerPrivate = router as unknown as { peerScores: Map<string, number> };
			routerPrivate.peerScores.set("blocked-relay", -50);
			const candidates = router.selectReplicaPeers(
				VALID_PEER_ID,
				2,
			);
			assert.ok(candidates.includes(RELAY_PEER_ID), "Available relay should be selected");
			assert.ok(
				candidates.includes("bootstrap-peer"),
				"Bootstrap relays are used when routing entries are filtered",
			);
			assert.ok(
				!candidates.includes("blocked-relay"),
				"Blocked peers must be excluded from relay selection",
			);
			assert.ok(
				!candidates.includes(VALID_PEER_ID),
				"Target peer must never be chosen as a relay",
			);
		},
	);
});

// ============================================================================
// Test Suite: Out-of-Order Buffering
// ============================================================================

describe("MessageRouter - Out-of-Order Buffering", () => {
	test(
		"Given a gap in sequence numbers, When later messages arrive, Then buffered messages flush in order",
		async () => {
			const { router, db } = createRouterTestEnvironment();
			const routerPrivate = router as unknown as {
				outOfOrderBuffer: Map<string, Map<number, YapYapMessage>>;
			};
			await router.receive(
				createDataMessage({ id: "ooo-seq-1", sequenceNumber: 1 }),
			);
			assert.strictEqual(
				db.getLastPeerSequence(PEER_A),
				1,
				"First message should set the peer sequence",
			);
			await router.receive(
				createDataMessage({ id: "ooo-seq-3", sequenceNumber: 3 }),
			);
			assert.strictEqual(
				db.getLastPeerSequence(PEER_A),
				1,
				"Out-of-order message should not advance sequence before gap filled",
			);
			const buffer = routerPrivate.outOfOrderBuffer.get(PEER_A);
			assert.ok(buffer?.has(3), "Out-of-order sequence should be buffered");
			await router.receive(
				createDataMessage({ id: "ooo-seq-2", sequenceNumber: 2 }),
			);
			assert.strictEqual(
				db.getLastPeerSequence(PEER_A),
				3,
				"Buffered messages should flush once gap is filled",
			);
			assert.ok(
				!routerPrivate.outOfOrderBuffer.has(PEER_A),
				"Buffer should be cleared for the peer after flush",
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
		async () => {
			const { router, db } = createRouterTestEnvironment();

			const message1 = createDataMessage({
				id: "msg-1",
				from: PEER_A,
				to: VALID_PEER_ID,
				sequenceNumber: 1,
				vectorClock: { [PEER_A]: 1 },
				payload: { text: "test message 1" },
			});

			await router.receive(message1);

			const currentClock = db.getVectorClock(PEER_A);
			assert.ok(currentClock >= 1, "Vector clock should be at least 1");

			await router.receive(message1);

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
			createRouterTestEnvironment({ db });

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
