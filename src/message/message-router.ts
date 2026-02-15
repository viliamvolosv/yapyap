import { createHash } from "node:crypto";
import type { Libp2p, Stream } from "@libp2p/interface";
import { peerIdFromString } from "@libp2p/peer-id";
import type { DatabaseManager, MessageReplicaEntry, PendingMessageEntry, RoutingCacheEntry } from "../database/index.js";
import { Events, type YapYapEvent } from "../events/event-types.js";
import type { AckMessage, NakMessage, YapYapMessage } from "./message.js";

/**
 * Node context interface for MessageRouter with proper type safety
 */
interface NodeContext {
	db: DatabaseManager;
	getLibp2p: () => Libp2p | undefined;
	getPeerId: () => string;
	fetchRecipientPublicKey: (peerId: string) => Promise<Buffer | null>;
	getNodeKeyPair: () => {
		privateKey: Buffer | undefined;
		publicKey: Buffer | undefined;
	};
	encryptMessage: (payload: unknown, recipient: Uint8Array) => Promise<unknown>;
	encodeResponse: (message: YapYapMessage) => Uint8Array;
	safeClose: (stream: Stream) => Promise<void>;
	messageQueues?: Map<string, MessageQueueEntryInternal[]>;
	pendingAcks?: Map<string, { timeout: NodeJS.Timeout }>;
	onMessage?: (message: YapYapMessage) => Promise<void>;
	emitEvent?: (event: YapYapEvent) => Promise<void>;
	signRelayEnvelope?: (payload: {
		targetPeerId: string;
		originalMessage: YapYapMessage;
		recoveryReason?: string;
		lastTransportError?: string;
		integrityHash?: string;
	}) => Promise<{ signature: string; signerPublicKey: string } | null>;
	verifyRelayEnvelope?: (
		payload: {
			targetPeerId: string;
			originalMessage: YapYapMessage;
			recoveryReason?: string;
			lastTransportError?: string;
			integrityHash?: string;
		},
		signature: string,
		signerPublicKey: string,
	) => Promise<boolean>;
	getBootstrapPeerIds?: () => string[];
	getThrottleKeyForPeer?: (peerId: string) => string | undefined;
}

export interface MessageRouterOptions {
	rateLimit?: {
		tokensPerInterval: number;
		intervalMs: number;
		burst: number;
	};
	originRateLimit?: {
		tokensPerInterval: number;
		intervalMs: number;
		burst: number;
	};
	transport?: {
		dialTimeoutMs?: number;
		sendTimeoutMs?: number;
		closeTimeoutMs?: number;
		reconnectAttempts?: number;
	};
}

/**
 * Message queue entry type (in-memory representation)
 */
export interface MessageQueueEntryInternal {
	id: number;
	message_data: string;
	target_peer_id: string;
	queued_at: number;
	attempts: number;
	status: "pending" | "processing" | "delivered" | "failed";
	ttl: number;
	next_retry_at?: number;
}

const DEFAULT_MESSAGE_TTL_MS = 86_400_000;
const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEDUP_CACHE_LIMIT = 10_000;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;
const MAX_RETRY_ATTEMPTS = 8;
const FALLBACK_RELAY_THRESHOLD_ATTEMPTS = 3;
const MAX_FALLBACK_RELAYS = 2;
const DEFAULT_REPLICA_COUNT = 3;
const MAX_BUFFERED_OUT_OF_ORDER = 512;
const DEFAULT_RATE_LIMIT = {
	tokensPerInterval: 30,
	intervalMs: 1_000,
	burst: 60,
} as const;
const DEFAULT_ORIGIN_RATE_LIMIT = {
	tokensPerInterval: 60,
	intervalMs: 1_000,
	burst: 120,
} as const;
const PEER_SCORE_MIN = -100;
const PEER_SCORE_MAX = 100;
const PEER_SCORE_BLOCK_THRESHOLD = -40;
const DEFAULT_DIAL_TIMEOUT_MS = 5_000;
const DEFAULT_SEND_TIMEOUT_MS = 5_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;
const DEFAULT_RECONNECT_ATTEMPTS = 1;

interface RelayEnvelopePayload {
	targetPeerId: string;
	originalMessage: YapYapMessage;
	recoveryReason?: string;
	lastTransportError?: string;
	integrityHash?: string;
	signature?: string;
	signerPublicKey?: string;
}

export interface DeltaSyncPayload {
	originPeerId: string;
	sinceTimestamp: number;
	timestamp: number;
	processedMessageIds: string[];
	pendingMessages: YapYapMessage[];
	vectorClock: Record<string, number>;
}

/**
 * Centralized message router for YapYapNode
 * Handles send, receive, retry, and ACK logic
 */
export class MessageRouter {
	/**
	 * Optional callback for received messages (event bus)
	 */
	public onMessage?: (message: YapYapMessage) => Promise<void>;
	// Reference to node context (YapYapNode or similar)
	private nodeContext: NodeContext;
	private processedIdsCache: Map<string, number> = new Map();
	private retryTimer: ReturnType<typeof setInterval> | undefined;
	private outOfOrderBuffer: Map<string, Map<number, YapYapMessage>> = new Map();
	private inboundBuckets: Map<
		string,
		{ tokens: number; lastRefillAt: number }
	> = new Map();
	private inboundOriginBuckets: Map<
		string,
		{ tokens: number; lastRefillAt: number }
	> = new Map();
	private peerScores: Map<string, number> = new Map();
	private readonly options: MessageRouterOptions;

	constructor(nodeContext: NodeContext, options: MessageRouterOptions = {}) {
		this.nodeContext = nodeContext;
		this.options = options;
	}

	/**
	 * Send a message: enqueue, persist, encrypt, and transmit
	 */
	async send(message: YapYapMessage): Promise<void> {
		// 1. Persist to DB (queue for delivery)
		const db = this.nodeContext.db;
		const queueKey = message.to;
		const now = Date.now();
		this.applyOutgoingVectorClock(message);
		const deadlineAt = now + DEFAULT_MESSAGE_TTL_MS;
		const id = db.queueMessage(
			message as unknown as Record<string, unknown>,
			queueKey,
			DEFAULT_MESSAGE_TTL_MS,
		);
		db.upsertPendingMessage(
			message.id,
			message as unknown as Record<string, unknown>,
			queueKey,
			deadlineAt,
		);
		await this.emitRouterEvent({
			id: `evt_${Date.now()}_${message.id}`,
			timestamp: Date.now(),
			type: Events.Message.Queued,
			message: {
				id: message.id,
				to: message.to,
				content: this.getMessageContent(message),
				timestamp: message.timestamp,
			},
		});
		// 2. Compose entry for in-memory queue
		const entry: MessageQueueEntryInternal = {
			id,
			message_data: JSON.stringify(message),
			target_peer_id: queueKey,
			queued_at: Date.now(),
			attempts: 0,
			status: "pending",
			ttl: DEFAULT_MESSAGE_TTL_MS,
			next_retry_at: now,
		};
		if (!this.nodeContext.messageQueues) {
			this.nodeContext.messageQueues = new Map();
		}
		if (!this.nodeContext.messageQueues.has(queueKey)) {
			this.nodeContext.messageQueues.set(queueKey, []);
		}
		const queue = this.nodeContext.messageQueues?.get(queueKey);
		if (queue) {
			queue.push(entry);
		}

		// 3. Encrypt payload if needed
		if (message.payload && typeof message.payload === "object") {
			const recipientPublicKey = await this.nodeContext.fetchRecipientPublicKey(
				message.to,
			);
			const nodeKeyPair = this.nodeContext.getNodeKeyPair();
			if (
				recipientPublicKey &&
				nodeKeyPair?.privateKey &&
				nodeKeyPair?.publicKey
			) {
				const encrypted = await this.nodeContext.encryptMessage(
					message.payload,
					recipientPublicKey,
				);
				message.payload = encrypted;
			}
		}

		// 4. Transmit message using libp2p
		const libp2p = this.nodeContext.getLibp2p();
		if (!libp2p) throw new Error("libp2p not initialized");

		// Dial the message protocol on the target peer
		try {
			await this.transmit(message);
			await this.emitRouterEvent({
				id: `evt_${Date.now()}_${message.id}`,
				timestamp: Date.now(),
				type: Events.Message.Sent,
				message: {
					id: message.id,
					to: message.to,
					content: this.getMessageContent(message),
					timestamp: message.timestamp,
				},
			});
		} catch (error) {
			await this.emitRouterEvent({
				id: `evt_${Date.now()}_${message.id}`,
				timestamp: Date.now(),
				type: Events.Message.Failed,
				message: {
					id: message.id,
					to: message.to,
					error: String(error),
				},
			});
			throw error;
		}
	}

	/**
	 * Receive a message: deduplicate, persist, ACK, process
	 */
	async receive(message: YapYapMessage): Promise<void> {
		const throttleKey =
			this.nodeContext.getThrottleKeyForPeer?.(message.from) ?? message.from;
		if (!this.allowInboundByOriginKey(throttleKey)) {
			this.bumpPeerScore(message.from, -2);
			return;
		}
		if (!this.allowInboundFromPeer(message.from)) {
			this.bumpPeerScore(message.from, -2);
			return;
		}

		// Delivery handover on reconnection: if this peer is reachable again,
		// attempt immediate flush of pending messages addressed to it.
		if (message.from && message.from !== this.nodeContext.getPeerId()) {
			await this.handoverPendingMessagesToPeer(message.from);
		}

		if (message.type === "ack") {
			await this.handleAck(message as AckMessage);
			return;
		}

		if (message.type === "nak") {
			await this.handleNak(message as NakMessage);
			return;
		}

		if (!this.isTimestampValid(message.timestamp)) {
			this.bumpPeerScore(message.from, -2);
			return;
		}

		if (
			message.type === "store-and-forward" &&
			(await this.handleStoreAndForwardMessage(message))
		) {
			this.bumpPeerScore(message.from, 1);
			return;
		}

		// 1. Deduplication: check in-memory cache, then persistent table
		const db = this.nodeContext.db;
		const isDuplicate =
			this.processedIdsCache.has(message.id) ||
			db.isMessageProcessed(message.id);

		if (isDuplicate) {
			await this.emitRouterEvent({
				id: `evt_${Date.now()}_${message.id}`,
				timestamp: Date.now(),
				type: Events.Message.Received,
				message: {
					id: message.id,
					from: message.from,
					to: message.to,
					content: this.getMessageContent(message),
					timestamp: message.timestamp,
				},
				wasDuplicate: true,
			});
			this.bumpPeerScore(message.from, -1);
			if (message.type === "data") {
				await this.sendAck(message);
			}
			return;
		}

		if (!this.isSequenceValid(message.from, message.sequenceNumber)) {
			this.bumpPeerScore(message.from, -3);
			if (message.type === "data") {
				await this.sendAck(message);
			}
			return;
		}
		if (this.shouldBufferOutOfOrder(message)) {
			this.bufferOutOfOrderMessage(message);
			this.bumpPeerScore(message.from, -1);
			return;
		}
		if (!this.isVectorClockValid(message)) {
			this.bumpPeerScore(message.from, -3);
			return;
		}

		await this.processAcceptedIncomingMessage(message);
		this.bumpPeerScore(message.from, 1);
		await this.flushBufferedMessagesForPeer(message.from);
	}

	/**
	 * Retry pending messages: scan, backoff, deliver
	 */
	async retry(): Promise<void> {
		const db = this.nodeContext.db;
		const pending = db.getRetryablePendingMessages();
		const now = Date.now();
		for (const entry of pending) {
			if (entry.next_retry_at > now) continue;
			if (entry.attempts >= MAX_RETRY_ATTEMPTS) {
				db.markPendingMessageFailed(entry.message_id, "max-retries-exceeded");
				db.markReplicatedMessageFailed(entry.message_id);
				await this.emitRouterEvent({
					id: `evt_${Date.now()}_${entry.message_id}`,
					timestamp: Date.now(),
					type: Events.Message.Failed,
					message: {
						id: entry.message_id,
						to: entry.target_peer_id,
						error: "max-retries-exceeded",
					},
				});
				continue;
			}
			const delay = this.calculateBackoffDelay(entry.attempts);
			try {
				const message = JSON.parse(entry.message_data) as YapYapMessage;
				await this.transmit(message);
				db.markPendingMessageDelivered(entry.message_id);
				await this.emitRouterEvent({
					id: `evt_${Date.now()}_${entry.message_id}`,
					timestamp: Date.now(),
					type: Events.Message.Delivered,
					message: {
						id: entry.message_id,
						to: entry.target_peer_id,
						peer: entry.target_peer_id,
					},
				});

				const queued = this.findQueuedEntryByMessageId(entry.message_id);
				if (queued) {
					db.updateMessageStatus(queued.entry.id, "delivered");
					queued.queue.splice(queued.index, 1);
				}
			} catch (error) {
				const nextRetry = now + delay;
				const message = JSON.parse(entry.message_data) as YapYapMessage;
				const relayed = await this.tryFallbackRelayRoutes(
					message,
					entry.attempts,
					String(error),
				);
				const transportError = this.classifyTransportError(error);
				db.schedulePendingRetry(
					entry.message_id,
					nextRetry,
					relayed
						? `fallback-routed:${transportError}:${String(error)}`
						: `${transportError}:${String(error)}`,
				);
			}
		}
		db.cleanup();
	}

	startRetryScheduler(intervalMs = 5_000): void {
		if (this.retryTimer) {
			return;
		}
		this.retryTimer = setInterval(() => {
			this.retry().catch(() => {});
		}, intervalMs);
	}

	stopRetryScheduler(): void {
		if (!this.retryTimer) {
			return;
		}
		clearInterval(this.retryTimer);
		this.retryTimer = undefined;
	}

	/**
	 * Handle ACK for a message: clear pending, update status, remove from queue
	 */
	async handleAck(ack: AckMessage): Promise<void> {
		const db = this.nodeContext.db;
		await this.emitRouterEvent({
			id: `evt_${Date.now()}_${ack.id}`,
			timestamp: Date.now(),
			type: Events.Message.AckReceived,
			messageId: ack.originalMessageId,
			peer: ack.from,
		});
		// Clear pending ACK timeout if tracked
		if (this.nodeContext.pendingAcks?.has(ack.originalMessageId)) {
			const timeoutData = this.nodeContext.pendingAcks.get(
				ack.originalMessageId,
			);
			if (timeoutData) {
				clearTimeout(timeoutData.timeout);
				this.nodeContext.pendingAcks.delete(ack.originalMessageId);
			}
		}
		// Update status in DB and remove from queue
		db.markPendingMessageDelivered(ack.originalMessageId);
		db.markReplicatedMessageDelivered(ack.originalMessageId);
		await this.emitRouterEvent({
			id: `evt_${Date.now()}_${ack.originalMessageId}`,
			timestamp: Date.now(),
			type: Events.Message.Delivered,
			message: {
				id: ack.originalMessageId,
				to: ack.to,
				peer: ack.from,
			},
		});
		const queued = this.findQueuedEntryByMessageId(ack.originalMessageId);
		if (queued) {
			db.updateMessageStatus(queued.entry.id, "delivered");
			queued.queue.splice(queued.index, 1);
		}
	}

	/**
	 * Handle NAK for a message: increment retry attempts and schedule next retry
	 */
	async handleNak(nak: NakMessage): Promise<void> {
		const db = this.nodeContext.db;
		await this.emitRouterEvent({
			id: `evt_${Date.now()}_${nak.id}`,
			timestamp: Date.now(),
			type: Events.Message.NakReceived,
			messageId: nak.originalMessageId,
			peer: nak.from,
			error: nak.reason ?? "nak-received",
		});

		// Find the message in the queue
		const queue = this.nodeContext.messageQueues?.get(nak.to);
		if (!queue) return;

		const entry = queue.find((e: MessageQueueEntryInternal) => {
			try {
				const msg = JSON.parse(e.message_data as string) as YapYapMessage;
				return msg.id === nak.originalMessageId;
			} catch {
				return false;
			}
		});

		if (entry) {
			// Increment retry attempts
			entry.attempts++;
			const now = Date.now();
			const delay = this.calculateBackoffDelay(entry.attempts);

			// Update DB with next retry time
			db.setNextRetryAt(entry.id, now + delay);
			db.updateMessageStatus(entry.id, "pending");
			db.schedulePendingRetry(
				nak.originalMessageId,
				now + delay,
				nak.reason ?? "nak-received",
			);

			console.log(
				`NAK received for message ${nak.originalMessageId}, retrying in ${delay}ms (attempt ${entry.attempts})`,
			);
		}
	}

	private isTimestampValid(timestamp: number): boolean {
		return Math.abs(Date.now() - timestamp) <= DEFAULT_MAX_CLOCK_SKEW_MS;
	}

	private isSequenceValid(peerId: string, sequenceNumber?: number): boolean {
		if (typeof sequenceNumber !== "number") {
			return true;
		}
		const last = this.nodeContext.db.getLastPeerSequence(peerId);
		return last === null || sequenceNumber > last;
	}

	private shouldBufferOutOfOrder(message: YapYapMessage): boolean {
		if (typeof message.sequenceNumber !== "number") {
			return false;
		}
		const last = this.nodeContext.db.getLastPeerSequence(message.from);
		const expected = (last ?? 0) + 1;
		return message.sequenceNumber > expected;
	}

	private bufferOutOfOrderMessage(message: YapYapMessage): void {
		const sequence = message.sequenceNumber;
		if (typeof sequence !== "number") {
			return;
		}
		if (!this.outOfOrderBuffer.has(message.from)) {
			this.outOfOrderBuffer.set(message.from, new Map<number, YapYapMessage>());
		}
		const peerBuffer = this.outOfOrderBuffer.get(message.from);
		if (!peerBuffer) {
			return;
		}
		peerBuffer.set(sequence, message);

		if (peerBuffer.size <= MAX_BUFFERED_OUT_OF_ORDER) {
			return;
		}
		const oldest = [...peerBuffer.keys()].sort((a, b) => a - b)[0];
		if (typeof oldest === "number") {
			peerBuffer.delete(oldest);
		}
	}

	private async flushBufferedMessagesForPeer(peerId: string): Promise<void> {
		const peerBuffer = this.outOfOrderBuffer.get(peerId);
		if (!peerBuffer || peerBuffer.size === 0) {
			return;
		}
		while (true) {
			const last = this.nodeContext.db.getLastPeerSequence(peerId);
			const expected = (last ?? 0) + 1;
			const next = peerBuffer.get(expected);
			if (!next) {
				break;
			}
			peerBuffer.delete(expected);
			await this.processAcceptedIncomingMessage(next);
		}
		if (peerBuffer.size === 0) {
			this.outOfOrderBuffer.delete(peerId);
		}
	}

	private async processAcceptedIncomingMessage(
		message: YapYapMessage,
	): Promise<void> {
		const db = this.nodeContext.db;
		const persistenceInput = {
			messageId: message.id,
			fromPeerId: message.from,
			messageData: message as unknown as Record<string, unknown>,
			ttl: DEFAULT_MESSAGE_TTL_MS,
			...(typeof message.sequenceNumber === "number"
				? { sequenceNumber: message.sequenceNumber }
				: {}),
			...(message.vectorClock ? { vectorClock: message.vectorClock } : {}),
		};
		const persistence = db.persistIncomingMessageAtomically(persistenceInput);
		this.rememberProcessedMessage(message.id);
		if (!persistence.applied) {
			if (message.type === "data") {
				await this.sendAck(message);
			}
			return;
		}
		await this.emitRouterEvent({
			id: `evt_${Date.now()}_${message.id}`,
			timestamp: Date.now(),
			type: Events.Message.Received,
			message: {
				id: message.id,
				from: message.from,
				to: message.to,
				content: this.getMessageContent(message),
				timestamp: message.timestamp,
			},
			wasDuplicate: false,
		});
		if (message.type === "data") {
			await this.sendAck(message);
		}
		if (this.nodeContext.onMessage) {
			await this.nodeContext.onMessage(message);
		}
	}

	private isVectorClockValid(message: YapYapMessage): boolean {
		if (!message.vectorClock) {
			return true;
		}
		const remoteCounter = message.vectorClock[message.from];
		if (typeof remoteCounter !== "number") {
			return true;
		}
		const localKnownCounter = this.nodeContext.db.getVectorClock(message.from);
		return remoteCounter >= localKnownCounter;
	}

	private applyOutgoingVectorClock(message: YapYapMessage): void {
		const selfId = this.nodeContext.getPeerId();
		const nextCounter = this.nodeContext.db.getVectorClock(selfId) + 1;
		this.nodeContext.db.updateVectorClock(selfId, nextCounter);

		if (typeof message.sequenceNumber !== "number") {
			message.sequenceNumber = nextCounter;
		}

		const merged = this.nodeContext.db.getAllVectorClocks();
		const existing = message.vectorClock ?? {};
		for (const [peerId, counter] of Object.entries(existing)) {
			if (typeof counter !== "number" || counter < 0) {
				continue;
			}
			merged[peerId] = Math.max(merged[peerId] ?? 0, counter);
		}
		merged[selfId] = Math.max(merged[selfId] ?? 0, nextCounter);
		message.vectorClock = merged;
	}

	private rememberProcessedMessage(messageId: string): void {
		this.processedIdsCache.set(messageId, Date.now());
		if (this.processedIdsCache.size <= DEDUP_CACHE_LIMIT) {
			return;
		}
		const oldest = this.processedIdsCache.keys().next().value;
		if (oldest) {
			this.processedIdsCache.delete(oldest);
		}
	}

	private findQueuedEntryByMessageId(messageId: string):
		| {
				queue: MessageQueueEntryInternal[];
				entry: MessageQueueEntryInternal;
				index: number;
		  }
		| undefined {
		for (const queue of this.nodeContext.messageQueues?.values() ?? []) {
			const index = queue.findIndex((queued) => {
				try {
					const msg = JSON.parse(queued.message_data) as YapYapMessage;
					return msg.id === messageId;
				} catch {
					return false;
				}
			});
			if (index === -1) {
				continue;
			}
			const entry = queue[index];
			if (!entry) {
				return undefined;
			}
			return { queue, entry, index };
		}
		return undefined;
	}

	private async sendAck(message: YapYapMessage): Promise<void> {
		const ack: AckMessage = {
			id: `ack_${Date.now()}`,
			type: "ack",
			from: this.nodeContext.getPeerId(),
			to: message.from,
			payload: {},
			timestamp: Date.now(),
			originalMessageId: message.id,
		};
		await this.send(ack);
	}

	private getMessageContent(message: YapYapMessage): string {
		if (typeof message.payload === "string") {
			return message.payload;
		}
		try {
			return JSON.stringify(message.payload);
		} catch {
			return String(message.payload);
		}
	}

	private async emitRouterEvent(event: YapYapEvent): Promise<void> {
		if (!this.nodeContext.emitEvent) {
			return;
		}
		try {
			await this.nodeContext.emitEvent(event);
		} catch {
			// Event emission is best-effort and must never break message flow.
		}
	}

	private classifyTransportError(error: unknown): string {
		const message = String(error).toLowerCase();
		if (message.includes("stream-dial-timeout")) {
			return "dial-timeout";
		}
		if (message.includes("stream-send-timeout")) {
			return "send-timeout";
		}
		if (message.includes("stream-close-timeout")) {
			return "close-timeout";
		}
		if (message.includes("reset") || message.includes("connreset")) {
			return "connection-reset";
		}
		if (
			message.includes("eof") ||
			message.includes("stream closed") ||
			message.includes("ended")
		) {
			return "eof";
		}
		return "transport-error";
	}

	private async withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
		label: string,
	): Promise<T> {
		let timeout: NodeJS.Timeout | undefined;
		try {
			return await Promise.race([
				promise,
				new Promise<T>((_, reject) => {
					timeout = setTimeout(() => {
						reject(new Error(label));
					}, timeoutMs);
				}),
			]);
		} finally {
			if (timeout) {
				clearTimeout(timeout);
			}
		}
	}

	private calculateBackoffDelay(attempts: number): number {
		return Math.min(RETRY_BASE_DELAY_MS * 2 ** attempts, RETRY_MAX_DELAY_MS);
	}

	private allowInboundFromPeer(peerId: string): boolean {
		const { tokensPerInterval, intervalMs, burst } =
			this.options.rateLimit ?? DEFAULT_RATE_LIMIT;
		const now = Date.now();
		const bucket = this.inboundBuckets.get(peerId) ?? {
			tokens: burst,
			lastRefillAt: now,
		};

		const elapsed = now - bucket.lastRefillAt;
		if (elapsed > 0) {
			const refill = (elapsed / intervalMs) * tokensPerInterval;
			bucket.tokens = Math.min(burst, bucket.tokens + refill);
			bucket.lastRefillAt = now;
		}

		if (bucket.tokens < 1) {
			this.inboundBuckets.set(peerId, bucket);
			return false;
		}

		bucket.tokens -= 1;
		this.inboundBuckets.set(peerId, bucket);
		return true;
	}

	private allowInboundByOriginKey(originKey: string): boolean {
		const { tokensPerInterval, intervalMs, burst } =
			this.options.originRateLimit ?? DEFAULT_ORIGIN_RATE_LIMIT;
		const now = Date.now();
		const bucket = this.inboundOriginBuckets.get(originKey) ?? {
			tokens: burst,
			lastRefillAt: now,
		};

		const elapsed = now - bucket.lastRefillAt;
		if (elapsed > 0) {
			const refill = (elapsed / intervalMs) * tokensPerInterval;
			bucket.tokens = Math.min(burst, bucket.tokens + refill);
			bucket.lastRefillAt = now;
		}

		if (bucket.tokens < 1) {
			this.inboundOriginBuckets.set(originKey, bucket);
			return false;
		}

		bucket.tokens -= 1;
		this.inboundOriginBuckets.set(originKey, bucket);
		return true;
	}

	private async transmit(message: YapYapMessage): Promise<void> {
		const libp2p = this.nodeContext.getLibp2p();
		if (!libp2p) throw new Error("libp2p not initialized");

		const peerId = peerIdFromString(message.to);
		const reconnectAttempts =
			this.options.transport?.reconnectAttempts ?? DEFAULT_RECONNECT_ATTEMPTS;
		let lastError: unknown;

		for (let attempt = 0; attempt <= reconnectAttempts; attempt++) {
			let stream: Stream | undefined;
			try {
				stream = await this.withTimeout(
					libp2p.dialProtocol(peerId, "/yapyap/message/1.0.0"),
					this.options.transport?.dialTimeoutMs ?? DEFAULT_DIAL_TIMEOUT_MS,
					"stream-dial-timeout",
				);
				const encoded = this.nodeContext.encodeResponse(message);
				await this.withTimeout(
					Promise.resolve(stream.send(encoded)),
					this.options.transport?.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS,
					"stream-send-timeout",
				);
				await this.withTimeout(
					this.nodeContext.safeClose(stream),
					this.options.transport?.closeTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS,
					"stream-close-timeout",
				);
				return;
			} catch (error) {
				lastError = error;
				if (stream) {
					try {
						await this.nodeContext.safeClose(stream);
					} catch {
						// Ignore close failures during retry flow.
					}
				}
				try {
					await (
						libp2p as unknown as { hangUp?: (peer: unknown) => Promise<void> }
					).hangUp?.(peerId);
				} catch {
					// Best effort: can fail on stale or half-open transport.
				}
				if (attempt >= reconnectAttempts) {
					break;
				}
			}
		}

		throw new Error(
			`${this.classifyTransportError(lastError)}:${String(lastError)}`,
		);
	}

	private async tryFallbackRelayRoutes(
		message: YapYapMessage,
		attempts: number,
		error: string,
	): Promise<boolean> {
		if (attempts < FALLBACK_RELAY_THRESHOLD_ATTEMPTS) {
			return false;
		}

		const candidates = this.selectReplicaPeers(message.to, MAX_FALLBACK_RELAYS);
		const deadlineAt = Date.now() + (message.ttl ?? DEFAULT_MESSAGE_TTL_MS);
		this.nodeContext.db.upsertReplicatedMessage(
			message.id,
			message.to,
			this.nodeContext.getPeerId(),
			deadlineAt,
		);
		const existingAssignments = this.nodeContext.db
			.getMessageReplicas(message.id)
			.filter(
				(replica: MessageReplicaEntry) =>
					replica.status !== "failed" &&
					!this.isPeerBlocked(replica.replica_peer_id),
			)
			.map((replica: MessageReplicaEntry) => replica.replica_peer_id);
		const relayCandidates =
			existingAssignments.length > 0
				? existingAssignments.slice(0, MAX_FALLBACK_RELAYS)
				: candidates;
		const assignedReplicaSet = new Set(existingAssignments);

		let relayed = false;
		for (const relayPeerId of relayCandidates) {
			if (!assignedReplicaSet.has(relayPeerId)) {
				this.nodeContext.db.assignMessageReplica(message.id, relayPeerId);
			}
			const relayPayloadBase = {
				targetPeerId: message.to,
				originalMessage: message,
				recoveryReason: "stuck-ack-recovery",
				lastTransportError: error,
				integrityHash: this.computeMessageHash(message),
			};
			const signedRelay =
				await this.nodeContext.signRelayEnvelope?.(relayPayloadBase);
			const relayMessage: YapYapMessage = {
				id: `relay_${message.id}_${Date.now()}`,
				type: "store-and-forward",
				from: this.nodeContext.getPeerId(),
				to: relayPeerId,
				payload: signedRelay
					? {
							...relayPayloadBase,
							signature: signedRelay.signature,
							signerPublicKey: signedRelay.signerPublicKey,
						}
					: relayPayloadBase,
				timestamp: Date.now(),
			};

			try {
				await this.transmit(relayMessage);
				this.nodeContext.db.markReplicaStored(message.id, relayPeerId);
				this.bumpPeerScore(relayPeerId, 2);
				relayed = true;
			} catch {
				this.nodeContext.db.markReplicaFailed(message.id, relayPeerId, error);
				this.bumpPeerScore(relayPeerId, -4);
				// Continue trying other candidates.
			}
		}

		return relayed;
	}

	private async handleStoreAndForwardMessage(
		message: YapYapMessage,
	): Promise<boolean> {
		const payload = message.payload;
		if (!this.isRelayEnvelopePayload(payload)) {
			if (this.isDeltaSyncPayload(payload)) {
				this.applyDeltaSyncPayload(payload);
				return true;
			}
			return false;
		}
		if (!(await this.isRelayEnvelopeValid(payload))) {
			this.bumpPeerScore(message.from, -5);
			return true;
		}

		const db = this.nodeContext.db;
		const original = payload.originalMessage;

		if (payload.targetPeerId === this.nodeContext.getPeerId()) {
			await this.receive(original);
			return true;
		}

		const deadlineAt = Date.now() + (original.ttl ?? DEFAULT_MESSAGE_TTL_MS);
		db.upsertReplicatedMessage(
			original.id,
			payload.targetPeerId,
			message.from,
			deadlineAt,
		);
		db.assignMessageReplica(original.id, this.nodeContext.getPeerId());
		db.markReplicaStored(original.id, this.nodeContext.getPeerId());
		db.upsertPendingMessage(
			original.id,
			original as unknown as Record<string, unknown>,
			payload.targetPeerId,
			deadlineAt,
		);
		return true;
	}

	private isRelayEnvelopePayload(
		payload: unknown,
	): payload is RelayEnvelopePayload {
		if (typeof payload !== "object" || payload === null) {
			return false;
		}
		const candidate = payload as Partial<RelayEnvelopePayload>;
		return (
			typeof candidate.targetPeerId === "string" &&
			typeof candidate.originalMessage === "object" &&
			candidate.originalMessage !== null
		);
	}

	private isDeltaSyncPayload(payload: unknown): payload is DeltaSyncPayload {
		if (typeof payload !== "object" || payload === null) {
			return false;
		}
		const candidate = payload as Partial<DeltaSyncPayload>;
		return (
			typeof candidate.originPeerId === "string" &&
			typeof candidate.sinceTimestamp === "number" &&
			Array.isArray(candidate.processedMessageIds) &&
			Array.isArray(candidate.pendingMessages) &&
			typeof candidate.vectorClock === "object" &&
			candidate.vectorClock !== null
		);
	}

	private async isRelayEnvelopeValid(
		payload: RelayEnvelopePayload,
	): Promise<boolean> {
		if (!payload.integrityHash) {
			return false;
		}
		if (
			payload.integrityHash !== this.computeMessageHash(payload.originalMessage)
		) {
			return false;
		}
		if (!payload.signature || !payload.signerPublicKey) {
			return false;
		}
		if (!this.nodeContext.verifyRelayEnvelope) {
			return false;
		}
		const envelope: {
			targetPeerId: string;
			originalMessage: YapYapMessage;
			integrityHash: string;
			recoveryReason?: string;
			lastTransportError?: string;
		} = {
			targetPeerId: payload.targetPeerId,
			originalMessage: payload.originalMessage,
			integrityHash: payload.integrityHash,
		};

		if (payload.recoveryReason) {
			envelope.recoveryReason = payload.recoveryReason;
		}

		if (payload.lastTransportError) {
			envelope.lastTransportError = payload.lastTransportError;
		}

		return this.nodeContext.verifyRelayEnvelope(
			envelope,
			payload.signature,
			payload.signerPublicKey,
		);
	}

	private computeMessageHash(message: YapYapMessage): string {
		return createHash("sha256").update(JSON.stringify(message)).digest("hex");
	}

	createDeltaSyncPayload(sinceTimestamp: number): DeltaSyncPayload {
		const db = this.nodeContext.db;
		const pending = db
			.getPendingMessagesSince(sinceTimestamp)
			.map((entry: PendingMessageEntry) => JSON.parse(entry.message_data) as YapYapMessage);
		return {
			originPeerId: this.nodeContext.getPeerId(),
			sinceTimestamp,
			timestamp: Date.now(),
			processedMessageIds: db.getProcessedMessageIdsSince(sinceTimestamp),
			pendingMessages: pending,
			vectorClock: db.getAllVectorClocks(),
		};
	}

	applyDeltaSyncPayload(payload: DeltaSyncPayload): void {
		const db = this.nodeContext.db;
		for (const [peerId, counter] of Object.entries(payload.vectorClock)) {
			if (typeof counter !== "number" || counter < 0) {
				continue;
			}
			db.updateVectorClock(peerId, counter);
		}

		for (const message of payload.pendingMessages) {
			if (db.isMessageProcessed(message.id)) {
				continue;
			}
			const deadlineAt = Date.now() + (message.ttl ?? DEFAULT_MESSAGE_TTL_MS);
			db.upsertPendingMessage(
				message.id,
				message as unknown as Record<string, unknown>,
				message.to,
				deadlineAt,
			);
		}
	}

	private async handoverPendingMessagesToPeer(peerId: string): Promise<void> {
		const db = this.nodeContext.db;
		const pending = db.getPendingMessagesForPeer(peerId, 20);
		for (const entry of pending) {
			try {
				const message = JSON.parse(entry.message_data) as YapYapMessage;
				await this.transmit(message);
				db.markPendingMessageDelivered(entry.message_id);
				db.markReplicatedMessageDelivered(entry.message_id);
			} catch (error) {
				const nextRetry =
					Date.now() + this.calculateBackoffDelay(entry.attempts);
				db.schedulePendingRetry(
					entry.message_id,
					nextRetry,
					`handover-failed:${String(error)}`,
				);
			}
		}
	}

	selectReplicaPeers(
		targetPeerId: string,
		replicaCount = DEFAULT_REPLICA_COUNT,
	): string[] {
		const unavailable = new Set([targetPeerId, this.nodeContext.getPeerId()]);
		const routingCandidates = this.nodeContext.db
			.getAllRoutingEntries()
			.filter(
				(entry: RoutingCacheEntry) =>
					entry.is_available &&
					!unavailable.has(entry.peer_id) &&
					!this.isPeerBlocked(entry.peer_id),
			)
			.map((entry: RoutingCacheEntry) => entry.peer_id);

		const sortedByDistance = routingCandidates.sort((a: string, b: string) => {
			const scoreDiff = this.getPeerScore(b) - this.getPeerScore(a);
			if (scoreDiff !== 0) {
				return scoreDiff;
			}
			return this.comparePeerDistance(targetPeerId, a, b);
		});
		const selected = sortedByDistance.slice(0, replicaCount);

		if (selected.length >= replicaCount) {
			return selected;
		}

		for (const peerId of this.nodeContext.getBootstrapPeerIds?.() ?? []) {
			if (
				unavailable.has(peerId) ||
				selected.includes(peerId) ||
				this.isPeerBlocked(peerId)
			) {
				continue;
			}
			selected.push(peerId);
			if (selected.length >= replicaCount) {
				break;
			}
		}

		return selected;
	}

	private comparePeerDistance(
		targetPeerId: string,
		aPeerId: string,
		bPeerId: string,
	): number {
		const target = this.getPeerDistanceBytes(targetPeerId);
		const a = this.getPeerDistanceBytes(aPeerId);
		const b = this.getPeerDistanceBytes(bPeerId);
		return this.lexicographicCompareXorDistance(target, a, b);
	}

	private getPeerDistanceBytes(peerId: string): Uint8Array {
		const parsed = peerIdFromString(peerId);
		const mhBytes = (parsed as { multihash?: { bytes?: Uint8Array } }).multihash
			?.bytes;
		if (mhBytes) {
			return mhBytes;
		}
		return Buffer.from(parsed.toString(), "utf8");
	}

	private lexicographicCompareXorDistance(
		target: Uint8Array,
		a: Uint8Array,
		b: Uint8Array,
	): number {
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

	getPeerScore(peerId: string): number {
		return this.peerScores.get(peerId) ?? 0;
	}

	private bumpPeerScore(peerId: string, delta: number): void {
		const next = Math.max(
			PEER_SCORE_MIN,
			Math.min(PEER_SCORE_MAX, this.getPeerScore(peerId) + delta),
		);
		this.peerScores.set(peerId, next);
	}

	private isPeerBlocked(peerId: string): boolean {
		return this.getPeerScore(peerId) <= PEER_SCORE_BLOCK_THRESHOLD;
	}

	/**
	 * Remove cross-module message handling
	 * All message operations should go through this router
	 */
	// Additional methods and event bus integration as needed

	/**
	 * Clean up router resources
	 */
	shutdown(): void {
		this.stopRetryScheduler();
		// Clear any internal state
		this.onMessage = undefined as unknown as (
			message: YapYapMessage,
		) => Promise<void>;
		this.processedIdsCache.clear();
		this.outOfOrderBuffer.clear();
		this.inboundBuckets.clear();
		this.inboundOriginBuckets.clear();
		this.peerScores.clear();
		this.nodeContext = undefined as unknown as NodeContext;
	}
}
