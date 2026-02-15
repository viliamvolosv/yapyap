import assert from "node:assert";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { peerIdFromString } from "@libp2p/peer-id";
import type { YapYapEvent } from "../events/event-types.js";
import { Events } from "../events/event-types.js";
import type { AckMessage, YapYapMessage } from "./message.js";
import { MessageRouter } from "./message-router.js";

const VALID_PEER_ID = "12D3KooWCJDjHYFsC3TJzDE6rtmyL6wRonuY9qEKnBH1r5y1jRWx";
const RELAY_PEER_ID = "12D3KooWQv6UQhEMaXbYJHseY4R4vkc7x4S76QfW8D2V6Q3cQJjX";
const PEER_A = "12D3KooWSBUjBmLvcdnTmNLf6ozPZeBUmXiE3wrRA9RBTjcjqNFm";
const PEER_B = "12D3KooWB6urPZfyGZYtbGxVRhgGFbgsSFVjjEpuQgPd4X8S3LZE";
const BOOTSTRAP_PEER_ID = PEER_B;

type DbMock = {
	queueMessageCalls: number;
	updateMessageStatusCalls: Array<{ id: number; status: string }>;
	markProcessedCalls: string[];
	processedIds: Set<string>;
	lastSequences: Map<string, number>;
	queueMessage: (message: Record<string, unknown>) => number;
	getAllPendingMessages: () => Array<Record<string, unknown>>;
	updateMessageStatus: (id: number, status: string) => void;
	setNextRetryAt: (id: number, nextRetryAt: number) => void;
	isMessageProcessed: (messageId: string) => boolean;
	markMessageProcessed: (
		messageId: string,
		fromPeerId: string,
		sequenceNumber?: number,
	) => void;
	getLastPeerSequence: (peerId: string) => number | null;
	updatePeerSequence: (peerId: string, sequenceNumber: number) => void;
	upsertPendingMessage: (
		messageId: string,
		messageData: Record<string, unknown>,
		targetPeerId: string,
		deadlineAt: number,
	) => void;
	getRetryablePendingMessages: () => Array<{
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
	upsertReplicatedMessage: (
		messageId: string,
		originalTargetPeerId: string,
		sourcePeerId: string,
		deadlineAt: number,
	) => void;
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
		last_error?: string;
	}>;
	markReplicatedMessageDelivered: (messageId: string) => void;
	markReplicatedMessageFailed: (messageId: string) => void;
	cleanup: () => void;
	getVectorClock: (peerId: string) => number;
	getAllVectorClocks: () => Record<string, number>;
	updateVectorClock: (peerId: string, counter: number) => void;
	persistIncomingMessageAtomically: (input: {
		messageId: string;
		fromPeerId: string;
		sequenceNumber?: number;
		messageData: Record<string, unknown>;
		ttl: number;
		vectorClock?: Record<string, number>;
	}) => {
		applied: boolean;
		queueMessageId?: number;
		duplicate: boolean;
	};
	getProcessedMessageIdsSince: (
		sinceTimestamp: number,
		limit?: number,
	) => string[];
	getPendingMessagesSince: (
		sinceTimestamp: number,
		limit?: number,
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
	getPendingMessagesByIds: (messageIds: string[]) => Array<{
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
};

function createDbMock(): DbMock {
	let rowId = 0;
	const updateMessageStatusCalls: Array<{ id: number; status: string }> = [];
	const markProcessedCalls: string[] = [];
	const processedIds = new Set<string>();
	const lastSequences = new Map<string, number>();
	const pendingMessages = new Map<
		string,
		{ attempts: number; status: string }
	>();
	const replicaAssignments = new Map<
		string,
		{ target: string; status: string; replicas: Set<string> }
	>();
	const replicaStatuses = new Map<
		string,
		Map<string, "assigned" | "stored" | "delivered" | "failed">
	>();
	const vectorClocks = new Map<string, number>();
	return {
		queueMessageCalls: 0,
		updateMessageStatusCalls,
		markProcessedCalls,
		processedIds,
		lastSequences,
		queueMessage: () => {
			rowId += 1;
			return rowId;
		},
		getAllPendingMessages: () => [],
		updateMessageStatus: (id, status) => {
			updateMessageStatusCalls.push({ id, status });
		},
		setNextRetryAt: () => {},
		isMessageProcessed: (messageId: string): boolean => {
			return processedIds.has(messageId);
		},
		markMessageProcessed: (
			messageId: string,
			_fromPeerId: string,
			_sequenceNumber?: number,
		): void => {
			processedIds.add(messageId);
			markProcessedCalls.push(messageId);
		},
		getLastPeerSequence: (peerId: string): number | null => {
			return lastSequences.get(peerId) ?? null;
		},
		updatePeerSequence: (peerId: string, sequenceNumber: number): void => {
			lastSequences.set(peerId, sequenceNumber);
		},
		upsertPendingMessage: (
			messageId: string,
			_messageData: Record<string, unknown>,
			_targetPeerId: string,
			_deadlineAt: number,
		): void => {
			pendingMessages.set(messageId, { attempts: 0, status: "pending" });
		},
		getRetryablePendingMessages: () => [],
		getPendingMessagesForPeer: () => [],
		markPendingMessageDelivered: (messageId: string): void => {
			const existing = pendingMessages.get(messageId);
			pendingMessages.set(messageId, {
				attempts: existing?.attempts ?? 0,
				status: "delivered",
			});
		},
		markPendingMessageFailed: (messageId: string, _reason?: string): void => {
			const existing = pendingMessages.get(messageId);
			pendingMessages.set(messageId, {
				attempts: existing?.attempts ?? 0,
				status: "failed",
			});
		},
		schedulePendingRetry: (
			messageId: string,
			_nextRetryAt: number,
			_reason?: string,
		): void => {
			const existing = pendingMessages.get(messageId);
			pendingMessages.set(messageId, {
				attempts: (existing?.attempts ?? 0) + 1,
				status: "pending",
			});
		},
		getAllRoutingEntries: () => [],
		upsertReplicatedMessage: (
			messageId: string,
			originalTargetPeerId: string,
			_sourcePeerId: string,
			_deadlineAt: number,
		): void => {
			const existing = replicaAssignments.get(messageId);
			replicaAssignments.set(messageId, {
				target: originalTargetPeerId,
				status: existing?.status ?? "pending",
				replicas: existing?.replicas ?? new Set<string>(),
			});
		},
		assignMessageReplica: (messageId: string, replicaPeerId: string): void => {
			const existing = replicaAssignments.get(messageId) ?? {
				target: "",
				status: "pending",
				replicas: new Set<string>(),
			};
			existing.replicas.add(replicaPeerId);
			replicaAssignments.set(messageId, existing);
			if (!replicaStatuses.has(messageId)) {
				replicaStatuses.set(messageId, new Map());
			}
			replicaStatuses.get(messageId)?.set(replicaPeerId, "assigned");
		},
		markReplicaStored: (messageId: string, replicaPeerId: string): void => {
			if (!replicaStatuses.has(messageId)) {
				replicaStatuses.set(messageId, new Map());
			}
			replicaStatuses.get(messageId)?.set(replicaPeerId, "stored");
		},
		markReplicaFailed: (
			messageId: string,
			replicaPeerId: string,
			_reason?: string,
		): void => {
			if (!replicaStatuses.has(messageId)) {
				replicaStatuses.set(messageId, new Map());
			}
			replicaStatuses.get(messageId)?.set(replicaPeerId, "failed");
		},
		getMessageReplicas: (messageId: string) => {
			const statuses = replicaStatuses.get(messageId);
			if (!statuses) {
				return [];
			}
			return Array.from(statuses.entries()).map(
				([replicaPeerId, status], idx) => ({
					id: idx + 1,
					message_id: messageId,
					replica_peer_id: replicaPeerId,
					status,
					assigned_at: Date.now(),
					updated_at: Date.now(),
				}),
			);
		},
		markReplicatedMessageDelivered: (messageId: string): void => {
			const existing = replicaAssignments.get(messageId);
			if (existing) {
				existing.status = "delivered";
				replicaAssignments.set(messageId, existing);
			}
		},
		markReplicatedMessageFailed: (messageId: string): void => {
			const existing = replicaAssignments.get(messageId);
			if (existing) {
				existing.status = "failed";
				replicaAssignments.set(messageId, existing);
			}
		},
		cleanup: () => {},
		getVectorClock: (peerId: string): number => vectorClocks.get(peerId) ?? 0,
		getAllVectorClocks: (): Record<string, number> => {
			const out: Record<string, number> = {};
			for (const [peerId, counter] of vectorClocks.entries()) {
				out[peerId] = counter;
			}
			return out;
		},
		updateVectorClock: (peerId: string, counter: number): void => {
			const current = vectorClocks.get(peerId) ?? 0;
			vectorClocks.set(peerId, Math.max(current, counter));
		},
		persistIncomingMessageAtomically: (
			input,
		): {
			applied: boolean;
			queueMessageId?: number;
			duplicate: boolean;
		} => {
			if (processedIds.has(input.messageId)) {
				return { applied: false, duplicate: true };
			}
			processedIds.add(input.messageId);
			markProcessedCalls.push(input.messageId);
			if (typeof input.sequenceNumber === "number") {
				const currentSeq = lastSequences.get(input.fromPeerId) ?? -Infinity;
				lastSequences.set(
					input.fromPeerId,
					Math.max(currentSeq, input.sequenceNumber),
				);
			}
			if (input.vectorClock) {
				for (const [peerId, counter] of Object.entries(input.vectorClock)) {
					if (typeof counter !== "number" || counter < 0) {
						continue;
					}
					const current = vectorClocks.get(peerId) ?? 0;
					vectorClocks.set(peerId, Math.max(current, counter));
				}
			} else if (typeof input.sequenceNumber === "number") {
				const current = vectorClocks.get(input.fromPeerId) ?? 0;
				vectorClocks.set(
					input.fromPeerId,
					Math.max(current, input.sequenceNumber),
				);
			}
			rowId += 1;
			updateMessageStatusCalls.push({ id: rowId, status: "delivered" });
			return { applied: true, queueMessageId: rowId, duplicate: false };
		},
		getProcessedMessageIdsSince: () => [],
		getPendingMessagesSince: () => [],
		getPendingMessagesByIds: () => [],
	};
}

function createContext(db: DbMock, emittedEvents: YapYapEvent[] = []) {
	return {
		db: db as never,
		getPeerId: () => "peer-local",
		fetchRecipientPublicKey: async () => null,
		getNodeKeyPair: () => ({ privateKey: undefined, publicKey: undefined }),
		encryptMessage: async (payload: unknown) => payload,
		safeClose: async () => {},
		messageQueues: new Map(),
		pendingAcks: new Map(),
		emitEvent: async (event: YapYapEvent) => {
			emittedEvents.push(event);
		},
		signRelayEnvelope: async (payload: {
			targetPeerId: string;
			originalMessage: YapYapMessage;
			recoveryReason?: string;
			lastTransportError?: string;
			integrityHash?: string;
		}) => ({
			signature: signRelayEnvelopePayload(payload),
			signerPublicKey: "test-relay-key",
		}),
		verifyRelayEnvelope: async (
			payload: {
				targetPeerId: string;
				originalMessage: YapYapMessage;
				recoveryReason?: string;
				lastTransportError?: string;
				integrityHash?: string;
			},
			signature: string,
			signerPublicKey: string,
		) =>
			signerPublicKey === "test-relay-key" &&
			signature === signRelayEnvelopePayload(payload),
		getBootstrapPeerIds: () => [],
		getThrottleKeyForPeer: (_peerId: string) => undefined,
	};
}

function compareDistance(
	targetPeerId: string,
	aPeerId: string,
	bPeerId: string,
): number {
	const targetParsed = peerIdFromString(targetPeerId);
	const aParsed = peerIdFromString(aPeerId);
	const bParsed = peerIdFromString(bPeerId);
	const targetMhBytes = (targetParsed as { multihash?: { bytes?: Uint8Array } })
		.multihash?.bytes;
	const aMhBytes = (aParsed as { multihash?: { bytes?: Uint8Array } }).multihash
		?.bytes;
	const bMhBytes = (bParsed as { multihash?: { bytes?: Uint8Array } }).multihash
		?.bytes;
	const target = targetMhBytes
		? targetMhBytes
		: Buffer.from(targetParsed.toString(), "utf8");
	const a = aMhBytes ? aMhBytes : Buffer.from(aParsed.toString(), "utf8");
	const b = bMhBytes ? bMhBytes : Buffer.from(bParsed.toString(), "utf8");
	const maxLen = Math.max(target.length, a.length, b.length);
	for (let i = 0; i < maxLen; i++) {
		const t = target[i] ?? 0;
		const da = t ^ (a[i] ?? 0);
		const db = t ^ (b[i] ?? 0);
		if (da !== db) {
			return da - db;
		}
	}
	return 0;
}

function hashMessage(message: YapYapMessage): string {
	return createHash("sha256").update(JSON.stringify(message)).digest("hex");
}

function signRelayEnvelopePayload(payload: {
	targetPeerId: string;
	originalMessage: YapYapMessage;
	recoveryReason?: string;
	lastTransportError?: string;
	integrityHash?: string;
}): string {
	return createHash("sha256")
		.update(`${JSON.stringify(payload)}::test-relay-key`)
		.digest("hex");
}

describe("MessageRouter", () => {
	test("receive persists a new data message and ACKs it", async () => {
		const db = createDbMock();
		const events: YapYapEvent[] = [];
		const streams: YapYapMessage[] = [];
		const stream = {
			send: async (encoded: Uint8Array) => {
				streams.push(
					JSON.parse(Buffer.from(encoded).toString()) as YapYapMessage,
				);
			},
			close: async () => {},
		};

		const router = new MessageRouter({
			...createContext(db, events),
			getLibp2p: () =>
				({
					dialProtocol: async () => stream,
				}) as never,
			encodeResponse: (message) =>
				Buffer.from(JSON.stringify(message), "utf8") as unknown as Uint8Array,
			onMessage: async () => {},
		});

		const incoming: YapYapMessage = {
			id: "msg-1",
			type: "data",
			from: VALID_PEER_ID,
			to: "peer-local",
			payload: { hello: "world" },
			timestamp: Date.now(),
			sequenceNumber: 1,
		};

		await router.receive(incoming);

		assert.deepStrictEqual(db.markProcessedCalls, ["msg-1"]);
		assert.strictEqual(db.lastSequences.get(VALID_PEER_ID), 1);
		assert.strictEqual(
			streams.some((msg) => msg.type === "ack"),
			true,
		);
		expect(events.some((event) => event.type === Events.Message.Received)).toBe(
			true,
		);
		expect(events.some((event) => event.type === Events.Message.Sent)).toBe(
			true,
		);
		expect(events.some((event) => event.type === Events.Message.Queued)).toBe(
			true,
		);
	});

	test("receive drops duplicate message IDs", async () => {
		const db = createDbMock();
		db.processedIds.add("dup-1");

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		await router.receive({
			id: "dup-1",
			type: "store-and-forward",
			from: "peer-remote",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
		});

		assert.strictEqual(db.markProcessedCalls.length, 0);
	});

	test("receive enforces monotonic peer sequence", async () => {
		const db = createDbMock();
		db.lastSequences.set("peer-remote", 10);

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		await router.receive({
			id: "msg-old-seq",
			type: "store-and-forward",
			from: "peer-remote",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
			sequenceNumber: 8,
		});

		assert.strictEqual(db.markProcessedCalls.length, 0);
	});

	test("receive routes ACK to handleAck path", async () => {
		const db = createDbMock();
		const events: YapYapEvent[] = [];
		const messageQueues = new Map<string, Array<Record<string, unknown>>>();
		messageQueues.set("peer-remote", [
			{
				id: 11,
				message_data: JSON.stringify({ id: "original-msg" }),
				target_peer_id: "peer-remote",
				queued_at: Date.now(),
				attempts: 0,
				status: "pending",
				ttl: 1000,
			},
		]);

		const router = new MessageRouter({
			...createContext(db, events),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
			messageQueues: messageQueues as never,
		});

		const ack: AckMessage = {
			id: "ack-1",
			type: "ack",
			from: "peer-remote",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
			originalMessageId: "original-msg",
		};

		await router.receive(ack);
		assert.strictEqual(messageQueues.get("peer-remote")?.length, 0);
		expect(
			events.some((event) => event.type === Events.Message.AckReceived),
		).toBe(true);
		expect(
			events.some((event) => event.type === Events.Message.Delivered),
		).toBe(true);
	});

	test("retry marks message as failed after max attempts", async () => {
		const db = createDbMock();
		const events: YapYapEvent[] = [];
		let failedMessageId: string | undefined;
		db.getRetryablePendingMessages = () => [
			{
				message_id: "msg-fail",
				target_peer_id: "peer-x",
				message_data: JSON.stringify({
					id: "msg-fail",
					type: "data",
					from: "peer-local",
					to: VALID_PEER_ID,
					payload: {},
					timestamp: Date.now(),
				}),
				status: "pending",
				attempts: 8,
				next_retry_at: Date.now() - 100,
				created_at: Date.now() - 1000,
				updated_at: Date.now() - 1000,
				deadline_at: Date.now() + 60_000,
			},
		];
		db.markPendingMessageFailed = (messageId: string): void => {
			failedMessageId = messageId;
		};

		const router = new MessageRouter({
			...createContext(db, events),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		await router.retry();
		assert.strictEqual(failedMessageId, "msg-fail");
		expect(events.some((event) => event.type === Events.Message.Failed)).toBe(
			true,
		);
	});

	test("retry attempts fallback relay routing after repeated failures", async () => {
		const db = createDbMock();
		let scheduledReason: string | undefined;
		const assignedReplicas: string[] = [];
		db.getRetryablePendingMessages = () => [
			{
				message_id: "msg-relay",
				target_peer_id: VALID_PEER_ID,
				message_data: JSON.stringify({
					id: "msg-relay",
					type: "data",
					from: "peer-local",
					to: VALID_PEER_ID,
					payload: { text: "hello" },
					timestamp: Date.now(),
				}),
				status: "pending",
				attempts: 3,
				next_retry_at: Date.now() - 100,
				created_at: Date.now() - 1_000,
				updated_at: Date.now() - 1_000,
				deadline_at: Date.now() + 60_000,
			},
		];
		db.getAllRoutingEntries = () => [
			{
				peer_id: RELAY_PEER_ID,
				multiaddrs: [],
				last_seen: Date.now(),
				is_available: true,
				ttl: 60_000,
			},
		];
		db.schedulePendingRetry = (
			_messageId: string,
			_nextRetryAt: number,
			reason?: string,
		): void => {
			scheduledReason = reason;
		};
		db.assignMessageReplica = (
			_messageId: string,
			replicaPeerId: string,
		): void => {
			assignedReplicas.push(replicaPeerId);
		};

		const dialedPeers: string[] = [];
		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () =>
				({
					dialProtocol: async (peerId: { toString: () => string }) => {
						const peer = peerId.toString();
						dialedPeers.push(peer);
						if (peer === VALID_PEER_ID) {
							throw new Error("direct failed");
						}
						return {
							send: async () => {},
							close: async () => {},
						};
					},
				}) as never,
			encodeResponse: () => new Uint8Array(),
		});

		await router.retry();
		assert.ok(dialedPeers.includes(VALID_PEER_ID));
		assert.ok(dialedPeers.includes(RELAY_PEER_ID));
		assert.ok(assignedReplicas.includes(RELAY_PEER_ID));
		assert.strictEqual(scheduledReason?.startsWith("fallback-routed:"), true);
	});

	test("retry uses existing replica assignments for fallback relays", async () => {
		const db = createDbMock();
		const assignedReplicas: string[] = [];
		const dialedPeers: string[] = [];

		db.getRetryablePendingMessages = () => [
			{
				message_id: "msg-existing-replica",
				target_peer_id: VALID_PEER_ID,
				message_data: JSON.stringify({
					id: "msg-existing-replica",
					type: "data",
					from: "peer-local",
					to: VALID_PEER_ID,
					payload: { text: "hello" },
					timestamp: Date.now(),
				}),
				status: "pending",
				attempts: 3,
				next_retry_at: Date.now() - 1,
				created_at: Date.now() - 1_000,
				updated_at: Date.now() - 1_000,
				deadline_at: Date.now() + 60_000,
			},
		];
		db.getAllRoutingEntries = () => [
			{
				peer_id: PEER_A,
				multiaddrs: [],
				last_seen: Date.now(),
				is_available: true,
				ttl: 60_000,
			},
			{
				peer_id: RELAY_PEER_ID,
				multiaddrs: [],
				last_seen: Date.now(),
				is_available: true,
				ttl: 60_000,
			},
		];
		db.getMessageReplicas = (_messageId: string) => [
			{
				id: 1,
				message_id: "msg-existing-replica",
				replica_peer_id: RELAY_PEER_ID,
				status: "stored",
				assigned_at: Date.now(),
				updated_at: Date.now(),
			},
		];
		db.assignMessageReplica = (
			_messageId: string,
			replicaPeerId: string,
		): void => {
			assignedReplicas.push(replicaPeerId);
		};

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () =>
				({
					dialProtocol: async (peerId: { toString: () => string }) => {
						const peer = peerId.toString();
						dialedPeers.push(peer);
						if (peer === VALID_PEER_ID) {
							throw new Error("direct failed");
						}
						return {
							send: async () => {},
							close: async () => {},
						};
					},
				}) as never,
			encodeResponse: () => new Uint8Array(),
		});

		await router.retry();
		assert.ok(dialedPeers.includes(VALID_PEER_ID));
		assert.ok(dialedPeers.includes(RELAY_PEER_ID));
		assert.ok(!dialedPeers.includes(PEER_A));
		assert.strictEqual(assignedReplicas.length, 0);
	});

	test("send retries dial once before succeeding", async () => {
		const db = createDbMock();
		let dialAttempts = 0;
		const router = new MessageRouter(
			{
				...createContext(db),
				getLibp2p: () =>
					({
						dialProtocol: async () => {
							dialAttempts += 1;
							if (dialAttempts === 1) {
								throw new Error("transient dial failure");
							}
							return {
								send: async () => {},
								close: async () => {},
							};
						},
						hangUp: async () => {},
					}) as never,
				encodeResponse: (message) =>
					Buffer.from(JSON.stringify(message), "utf8") as unknown as Uint8Array,
			},
			{
				transport: {
					reconnectAttempts: 1,
					dialTimeoutMs: 100,
					sendTimeoutMs: 100,
					closeTimeoutMs: 100,
				},
			},
		);

		await router.send({
			id: "msg-reconnect",
			type: "data",
			from: "peer-local",
			to: VALID_PEER_ID,
			payload: { ok: true },
			timestamp: Date.now(),
		});

		assert.strictEqual(dialAttempts, 2);
	});

	test("retry classifies stalled send timeout as send-timeout", async () => {
		const db = createDbMock();
		let scheduledReason: string | undefined;
		db.getRetryablePendingMessages = () => [
			{
				message_id: "msg-timeout",
				target_peer_id: VALID_PEER_ID,
				message_data: JSON.stringify({
					id: "msg-timeout",
					type: "data",
					from: "peer-local",
					to: VALID_PEER_ID,
					payload: {},
					timestamp: Date.now(),
				}),
				status: "pending",
				attempts: 0,
				next_retry_at: Date.now() - 1,
				created_at: Date.now() - 1_000,
				updated_at: Date.now() - 1_000,
				deadline_at: Date.now() + 60_000,
			},
		];
		db.schedulePendingRetry = (
			_messageId: string,
			_nextRetryAt: number,
			reason?: string,
		): void => {
			scheduledReason = reason;
		};

		const router = new MessageRouter(
			{
				...createContext(db),
				getLibp2p: () =>
					({
						dialProtocol: async () => ({
							send: async () => {
								await new Promise(() => {});
							},
							close: async () => {},
						}),
						hangUp: async () => {},
					}) as never,
				encodeResponse: () => new Uint8Array(),
			},
			{
				transport: {
					reconnectAttempts: 0,
					sendTimeoutMs: 5,
					dialTimeoutMs: 50,
					closeTimeoutMs: 50,
				},
			},
		);

		await router.retry();
		assert.strictEqual(scheduledReason?.startsWith("send-timeout:"), true);
	});

	test("selectReplicaPeers prefers closest routing peers", () => {
		const db = createDbMock();
		db.getAllRoutingEntries = () => [
			{
				peer_id: PEER_B,
				multiaddrs: [],
				last_seen: 1,
				is_available: true,
				ttl: 1,
			},
			{
				peer_id: PEER_A,
				multiaddrs: [],
				last_seen: 1,
				is_available: true,
				ttl: 1,
			},
			{
				peer_id: RELAY_PEER_ID,
				multiaddrs: [],
				last_seen: 1,
				is_available: true,
				ttl: 1,
			},
		];
		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		const selected = router.selectReplicaPeers(VALID_PEER_ID, 2);
		const expected = [PEER_B, PEER_A, RELAY_PEER_ID]
			.sort((a, b) => compareDistance(VALID_PEER_ID, a, b))
			.slice(0, 2);
		assert.deepStrictEqual(selected, expected);
	});

	test("selectReplicaPeers falls back to bootstrap peers", () => {
		const db = createDbMock();
		db.getAllRoutingEntries = () => [];

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
			getBootstrapPeerIds: () => [BOOTSTRAP_PEER_ID],
		});

		const selected = router.selectReplicaPeers(VALID_PEER_ID, 1);
		assert.deepStrictEqual(selected, [BOOTSTRAP_PEER_ID]);
	});

	test("receive triggers handover delivery for reconnected peer", async () => {
		const db = createDbMock();
		let deliveredMessageId: string | undefined;
		db.getPendingMessagesForPeer = (peerId: string) => [
			{
				message_id: "handover-1",
				target_peer_id: peerId,
				message_data: JSON.stringify({
					id: "handover-1",
					type: "data",
					from: "peer-local",
					to: peerId,
					payload: { text: "offline-msg" },
					timestamp: Date.now(),
				}),
				status: "pending",
				attempts: 0,
				next_retry_at: Date.now() - 10,
				created_at: Date.now() - 1000,
				updated_at: Date.now() - 1000,
				deadline_at: Date.now() + 60_000,
			},
		];
		db.markPendingMessageDelivered = (messageId: string): void => {
			deliveredMessageId = messageId;
		};

		const dialedPeers: string[] = [];
		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () =>
				({
					dialProtocol: async (peerId: { toString: () => string }) => {
						dialedPeers.push(peerId.toString());
						return {
							send: async () => {},
							close: async () => {},
						};
					},
				}) as never,
			encodeResponse: () => new Uint8Array(),
		});

		await router.receive({
			id: "peer-ping",
			type: "store-and-forward",
			from: VALID_PEER_ID,
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
		});

		assert.ok(dialedPeers.includes(VALID_PEER_ID));
		assert.strictEqual(deliveredMessageId, "handover-1");
	});

	test("receive stores valid relay envelope for later handover", async () => {
		const db = createDbMock();
		let storedPendingMessageId: string | undefined;
		db.upsertPendingMessage = (messageId: string): void => {
			storedPendingMessageId = messageId;
		};

		const original: YapYapMessage = {
			id: "orig-1",
			type: "data",
			from: "peer-src",
			to: VALID_PEER_ID,
			payload: { text: "hello" },
			timestamp: Date.now(),
		};

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		await router.receive({
			id: "relay-msg-1",
			type: "store-and-forward",
			from: RELAY_PEER_ID,
			to: "peer-local",
			payload: (() => {
				const relayPayload = {
					targetPeerId: VALID_PEER_ID,
					originalMessage: original,
					integrityHash: hashMessage(original),
				};
				return {
					...relayPayload,
					signature: signRelayEnvelopePayload(relayPayload),
					signerPublicKey: "test-relay-key",
				};
			})(),
			timestamp: Date.now(),
		});

		assert.strictEqual(storedPendingMessageId, "orig-1");
	});

	test("receive drops invalid relay envelope hash", async () => {
		const db = createDbMock();
		let storedPendingMessageId: string | undefined;
		db.upsertPendingMessage = (messageId: string): void => {
			storedPendingMessageId = messageId;
		};

		const original: YapYapMessage = {
			id: "orig-bad",
			type: "data",
			from: "peer-src",
			to: VALID_PEER_ID,
			payload: { text: "tampered" },
			timestamp: Date.now(),
		};

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		await router.receive({
			id: "relay-msg-bad",
			type: "store-and-forward",
			from: RELAY_PEER_ID,
			to: "peer-local",
			payload: (() => {
				const relayPayload = {
					targetPeerId: VALID_PEER_ID,
					originalMessage: original,
					integrityHash: "bad-hash",
				};
				return {
					...relayPayload,
					signature: signRelayEnvelopePayload(relayPayload),
					signerPublicKey: "test-relay-key",
				};
			})(),
			timestamp: Date.now(),
		});

		assert.strictEqual(storedPendingMessageId, undefined);
	});

	test("receive rejects stale vector clock", async () => {
		const db = createDbMock();
		db.updateVectorClock("peer-remote", 5);

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		await router.receive({
			id: "stale-vc",
			type: "store-and-forward",
			from: "peer-remote",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
			vectorClock: { "peer-remote": 3 },
		});

		assert.deepStrictEqual(db.markProcessedCalls, []);
	});

	test("receive accepts and merges newer vector clock", async () => {
		const db = createDbMock();
		db.updateVectorClock("peer-remote", 2);

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		await router.receive({
			id: "fresh-vc",
			type: "store-and-forward",
			from: "peer-remote",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
			vectorClock: { "peer-remote": 6, "peer-x": 4 },
		});

		assert.deepStrictEqual(db.markProcessedCalls, ["fresh-vc"]);
		assert.strictEqual(db.getVectorClock("peer-remote"), 6);
		assert.strictEqual(db.getVectorClock("peer-x"), 4);
	});

	test("createDeltaSyncPayload includes pending and processed windows", () => {
		const db = createDbMock();
		db.getProcessedMessageIdsSince = () => ["processed-1"];
		db.getPendingMessagesSince = () => [
			{
				message_id: "pending-1",
				target_peer_id: "peer-x",
				message_data: JSON.stringify({
					id: "pending-1",
					type: "data",
					from: "peer-local",
					to: "peer-x",
					payload: { t: 1 },
					timestamp: Date.now(),
				}),
				status: "pending",
				attempts: 0,
				next_retry_at: Date.now(),
				created_at: Date.now(),
				updated_at: Date.now(),
				deadline_at: Date.now() + 1000,
			},
		];
		db.updateVectorClock("peer-local", 3);

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		const payload = router.createDeltaSyncPayload(Date.now() - 10_000);
		assert.deepStrictEqual(payload.processedMessageIds, ["processed-1"]);
		assert.strictEqual(payload.pendingMessages.length, 1);
		assert.strictEqual(payload.vectorClock["peer-local"], 3);
	});

	test("applyDeltaSyncPayload replays missing pending messages", () => {
		const db = createDbMock();
		const upserted: string[] = [];
		db.upsertPendingMessage = (messageId: string): void => {
			upserted.push(messageId);
		};
		db.isMessageProcessed = (messageId: string): boolean =>
			messageId === "already-done";

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		router.applyDeltaSyncPayload({
			originPeerId: "peer-remote",
			sinceTimestamp: Date.now() - 1000,
			timestamp: Date.now(),
			processedMessageIds: [],
			vectorClock: { "peer-remote": 4 },
			pendingMessages: [
				{
					id: "already-done",
					type: "data",
					from: "peer-remote",
					to: "peer-local",
					payload: {},
					timestamp: Date.now(),
				},
				{
					id: "missing-1",
					type: "data",
					from: "peer-remote",
					to: "peer-local",
					payload: {},
					timestamp: Date.now(),
				},
			],
		});

		assert.deepStrictEqual(upserted, ["missing-1"]);
		assert.strictEqual(db.getVectorClock("peer-remote"), 4);
	});

	test("receive buffers out-of-order messages and flushes when gap closes", async () => {
		const db = createDbMock();

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		await router.receive({
			id: "seq-3",
			type: "store-and-forward",
			from: "peer-remote",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
			sequenceNumber: 3,
		});
		assert.deepStrictEqual(db.markProcessedCalls, []);

		await router.receive({
			id: "seq-1",
			type: "store-and-forward",
			from: "peer-remote",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
			sequenceNumber: 1,
		});
		assert.deepStrictEqual(db.markProcessedCalls, ["seq-1"]);

		await router.receive({
			id: "seq-2",
			type: "store-and-forward",
			from: "peer-remote",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
			sequenceNumber: 2,
		});
		assert.deepStrictEqual(db.markProcessedCalls, ["seq-1", "seq-2", "seq-3"]);
		assert.strictEqual(db.lastSequences.get("peer-remote"), 3);
	});

	test("receive enforces inbound per-peer rate limit", async () => {
		const db = createDbMock();
		const router = new MessageRouter(
			{
				...createContext(db),
				getLibp2p: () => undefined,
				encodeResponse: () => new Uint8Array(),
			},
			{
				rateLimit: {
					tokensPerInterval: 1,
					intervalMs: 10_000,
					burst: 1,
				},
			},
		);

		await router.receive({
			id: "rl-1",
			type: "store-and-forward",
			from: "peer-flood",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
		});
		await router.receive({
			id: "rl-2",
			type: "store-and-forward",
			from: "peer-flood",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
		});

		assert.deepStrictEqual(db.markProcessedCalls, ["rl-1"]);
	});

	test("penalizes tampered relay envelopes in peer score", async () => {
		const db = createDbMock();
		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		await router.receive({
			id: "tampered-1",
			type: "store-and-forward",
			from: "peer-bad",
			to: "peer-local",
			payload: (() => {
				const relayPayload = {
					targetPeerId: VALID_PEER_ID,
					originalMessage: {
						id: "orig-tampered",
						type: "data" as const,
						from: "peer-bad",
						to: VALID_PEER_ID,
						payload: {},
						timestamp: Date.now(),
					},
					integrityHash: "wrong",
				};
				return {
					...relayPayload,
					signature: signRelayEnvelopePayload(relayPayload),
					signerPublicKey: "test-relay-key",
				};
			})(),
			timestamp: Date.now(),
		});

		expect(router.getPeerScore("peer-bad")).toBeLessThan(0);
	});

	test("selectReplicaPeers excludes blocked low-score peers", async () => {
		const db = createDbMock();
		db.getAllRoutingEntries = () => [
			{
				peer_id: PEER_A,
				multiaddrs: [],
				last_seen: Date.now(),
				is_available: true,
				ttl: 60_000,
			},
			{
				peer_id: PEER_B,
				multiaddrs: [],
				last_seen: Date.now(),
				is_available: true,
				ttl: 60_000,
			},
		];

		const router = new MessageRouter({
			...createContext(db),
			getLibp2p: () => undefined,
			encodeResponse: () => new Uint8Array(),
		});

		// Drive PEER_A below block threshold through repeated tampered relay payloads.
		for (let i = 0; i < 10; i++) {
			await router.receive({
				id: `tampered-${i}`,
				type: "store-and-forward",
				from: PEER_A,
				to: "peer-local",
				payload: (() => {
					const relayPayload = {
						targetPeerId: VALID_PEER_ID,
						originalMessage: {
							id: `orig-${i}`,
							type: "data" as const,
							from: PEER_A,
							to: VALID_PEER_ID,
							payload: {},
							timestamp: Date.now(),
						},
						integrityHash: "bad",
					};
					return {
						...relayPayload,
						signature: signRelayEnvelopePayload(relayPayload),
						signerPublicKey: "test-relay-key",
					};
				})(),
				timestamp: Date.now(),
			});
		}

		const selected = router.selectReplicaPeers(VALID_PEER_ID, 2);
		assert.ok(!selected.includes(PEER_A));
		assert.ok(selected.includes(PEER_B));
	});

	test("receive enforces shared-origin throttling across peers", async () => {
		const db = createDbMock();
		const router = new MessageRouter(
			{
				...createContext(db),
				getLibp2p: () => undefined,
				encodeResponse: () => new Uint8Array(),
				getThrottleKeyForPeer: () => "ip:10.0.0.1",
			},
			{
				originRateLimit: {
					tokensPerInterval: 1,
					intervalMs: 10_000,
					burst: 1,
				},
				rateLimit: {
					tokensPerInterval: 100,
					intervalMs: 10_000,
					burst: 100,
				},
			},
		);

		await router.receive({
			id: "origin-1",
			type: "store-and-forward",
			from: "peer-a",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
		});
		await router.receive({
			id: "origin-2",
			type: "store-and-forward",
			from: "peer-b",
			to: "peer-local",
			payload: {},
			timestamp: Date.now(),
		});

		assert.deepStrictEqual(db.markProcessedCalls, ["origin-1"]);
	});
});
