// Refactored node.ts
// YapYapNodeOptions interface for database initialization
export interface YapYapNodeOptions {
	dataDir?: string;
}

// NOTE: This is a fully refactored and consolidated version
// focusing on DRY, separation of concerns, and maintainability.

import type { Connection, Libp2p, PeerId, Stream } from "@libp2p/interface";
import { peerIdFromString } from "@libp2p/peer-id";
import {
	decryptE2EMessage,
	type EncryptionKeyPair,
	encryptE2EMessage,
	generateEphemeralKeyPair,
	generateIdentityKeyPair,
	signMessage,
	verifySignature,
} from "../crypto/index.js";
import { SessionManager } from "../crypto/session-manager.js";
import type { DatabaseManager } from "../database/index.js";
import { EventBus } from "../events/event-bus.js";
import { Events, type YapYapEvent } from "../events/event-types.js";
import type { AckMessage, YapYapMessage } from "../message/message.js";
import { MessageRouter } from "../message/message-router.js";
// ...existing fields...
import type { HandshakeMessage } from "../protocols/handshake.js";
import type {
	RouteAnnounceMessage,
	RouteQueryMessage,
	RouteResultMessage,
} from "../protocols/route.js";
import type {
	SyncRequestMessage,
	SyncResponseMessage,
} from "../protocols/sync.js";
import {
	decodeMessage,
	MAX_FRAME_SIZE_BYTES,
	MessageFramer,
	NodeState,
	PROTOCOL_HANDSHAKE,
	PROTOCOL_ROUTE,
	PROTOCOL_SYNC,
	PROTOCOL_VERSION,
	RoutingTable,
} from "./protocols.js";

/* -------------------------------------------------------------------------- */
/*                                Type Guards                                 */
/* -------------------------------------------------------------------------- */

interface EncryptedPayload {
	encrypted: true;
	ciphertext: string;
	nonce: string;
	ephemeralPublicKey: string;
	signature: string;
}

interface RelayEnvelopeSigningPayload {
	targetPeerId: string;
	originalMessage: YapYapMessage;
	recoveryReason?: string;
	lastTransportError?: string;
	integrityHash?: string;
}

function isEncryptedPayload(p: unknown): p is EncryptedPayload {
	return (
		typeof p === "object" &&
		p !== null &&
		"encrypted" in p &&
		p.encrypted === true
	);
}

const STREAM_IDLE_TIMEOUT_MS = 30_000;
const MAX_RECEIVE_BUFFER_BYTES = MAX_FRAME_SIZE_BYTES * 2;
const BUFFER_THRESHOLD_BYTES = Math.floor(MAX_RECEIVE_BUFFER_BYTES * 0.75);
const HANDSHAKE_MAX_ATTEMPTS = 3;
const HANDSHAKE_RETRY_BASE_MS = 250;
const HANDSHAKE_CAPABILITIES = ["e2e"];

/* -------------------------------------------------------------------------- */
/*                               Node Service                                 */
/* -------------------------------------------------------------------------- */

export class YapYapNode {
	/**
	 * Get database manager instance (for API modules)
	 */
	public getDatabase(): DatabaseManager {
		return this.db;
	}

	/**
	 * Get the libp2p instance (for API access)
	 */
	public getLibp2p(): Libp2p | undefined {
		return this.libp2p;
	}

	/**
	 * Get the node's PeerId as string
	 */
	public getPeerId(): string {
		return this.libp2p?.peerId?.toString() ?? "";
	}

	public async waitForPeerPublicKey(
		peerId: string,
		timeoutMs = 5_000,
		forceRefresh = false,
	): Promise<void> {
		const existing = await this.fetchRecipientPublicKey(peerId);
		const currentVersion = this.peerKeyVersions.get(peerId) ?? 0;
		const pendingVersion =
			this.peerKeyRefreshPendingVersion.get(peerId) ?? currentVersion;
		const shouldWait =
			!existing || (forceRefresh && currentVersion <= pendingVersion);

		if (!shouldWait) {
			return;
		}
		if (forceRefresh && !this.shouldRefreshPeerPublicKey(peerId)) {
			return;
		}

		return new Promise((resolve, reject) => {
			let timer: NodeJS.Timeout;
			const onReady = () => {
				if (timer) clearTimeout(timer);
				resolve();
			};

			timer = setTimeout(() => {
				this.removePeerKeyWaiter(peerId, onReady);
				reject(new Error("peer key timeout"));
			}, timeoutMs);

			const waiters = this.peerKeyWaiters.get(peerId) ?? [];
			waiters.push(onReady);
			this.peerKeyWaiters.set(peerId, waiters);
		});
	}

	private removePeerKeyWaiter(peerId: string, fn: () => void) {
		const waiters = this.peerKeyWaiters.get(peerId);
		if (!waiters) return;
		this.peerKeyWaiters.set(
			peerId,
			waiters.filter((w) => w !== fn),
		);
	}

	private signalPeerKeyAvailable(peerId: string) {
		const waiters = this.peerKeyWaiters.get(peerId);
		if (!waiters) return;
		for (const waiter of waiters) {
			waiter();
		}
		this.peerKeyWaiters.delete(peerId);
	}

	private markPeerKeyRefreshPending(peerId: string) {
		this.peerKeyRefreshPending.add(peerId);
		const currentVersion = this.peerKeyVersions.get(peerId) ?? 0;
		this.peerKeyRefreshPendingVersion.set(peerId, currentVersion);
	}

	private clearPeerKeyRefresh(peerId: string) {
		this.peerKeyRefreshPending.delete(peerId);
		this.peerKeyRefreshPendingVersion.delete(peerId);
	}

	public shouldRefreshPeerPublicKey(peerId: string): boolean {
		return this.peerKeyRefreshPending.has(peerId);
	}

	/**
	 * Get the node state instance
	 */
	public getNodeState(): NodeState {
		return this.nodeState;
	}

	/**
	 * Get the routing table instance
	 */
	public getRoutingTable(): RoutingTable {
		return this.routingTable;
	}

	/**
	 * Set bootstrap addresses (called during node initialization)
	 */
	public setBootstrapAddrs(addrs: string[]): void {
		this.bootstrapAddrs = addrs;
	}

	/**
	 * Get bootstrap addresses
	 */
	public getBootstrapAddrs(): string[] {
		return this.bootstrapAddrs;
	}

	/**
	 * Record a successful bootstrap dial attempt for health tracking
	 */
	public recordBootstrapDialSuccess(peerId: string): void {
		if (!peerId) return;
		this.bootstrapDialSuccesses.add(peerId);
	}

	public recordBootstrapAddressDialSuccess(addr: string): void {
		if (!addr) return;
		this.bootstrapDialSuccessAddrs.add(addr);
	}

	/**
	 * Get peer IDs that were successfully contacted via bootstrap
	 */
	public getBootstrapDialSuccessPeerIds(): string[] {
		return [...this.bootstrapDialSuccesses];
	}

	public getBootstrapDialSuccessAddrs(): string[] {
		return [...this.bootstrapDialSuccessAddrs];
	}

	/**
	 * Get discovered/cached peers from database
	 */
	public getDiscoveredPeers(): Array<{
		peer_id: string;
		multiaddrs: string[];
		last_seen: number;
	}> {
		return this.db.getAllCachedPeers();
	}

	/**
	 * Get count of discovered peers
	 */
	public getDiscoveredPeerCount(): number {
		return this.db.getCachedPeerCount();
	}

	/**
	 * Get discovered peer information for a specific peer ID
	 */
	public getDiscoveredPeer(peerId: string):
		| {
				peer_id: string;
				multiaddrs: string[];
				last_seen: number;
		  }
		| undefined {
		return this.db.getAllCachedPeers().find((p) => p.peer_id === peerId);
	}

	/**
	 * Trigger DHT peer discovery manually
	 */
	public async triggerPeerDiscovery(): Promise<void> {
		// DHT discovery runs automatically, but this can be called
		// to force an immediate discovery cycle
		if (!this.libp2p) return;

		const dht = this.libp2p.services.dht as {
			getClosestPeers?: (peerId: Uint8Array) => AsyncIterable<{
				id: import("@libp2p/interface").PeerId;
				multiaddrs?: import("@multiformats/multiaddr").Multiaddr[];
			}>;
		};

		if (!dht?.getClosestPeers) return;

		const randomBytes = new Uint8Array(32);
		crypto.getRandomValues(randomBytes);

		try {
			const peers = dht.getClosestPeers(randomBytes);
			for await (const peer of peers) {
				this.routingTable.updatePeer(peer.id.toString(), {});
				if (peer.multiaddrs?.length) {
					this.db.savePeerMultiaddrs(
						peer.id.toString(),
						peer.multiaddrs.map((m) => m.toString()),
					);
				}
			}
		} catch (err) {
			console.warn("Manual peer discovery failed:", err);
		}
	}

	/**
	 * Dial a specific peer by ID
	 */
	public async dialPeer(peerId: string): Promise<boolean> {
		if (!this.libp2p) return false;

		try {
			const { peerIdFromString } = await import("@libp2p/peer-id");
			await this.libp2p.dial(peerIdFromString(peerId));
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Dial all cached peers
	 */
	public async dialCachedPeers(): Promise<number> {
		if (!this.libp2p) return 0;

		const cachedPeers = this.db.getAllCachedPeers();
		let dialed = 0;

		for (const { peer_id, multiaddrs } of cachedPeers) {
			try {
				const { peerIdFromString } = await import("@libp2p/peer-id");
				const { multiaddr } = await import("@multiformats/multiaddr");
				const peerIdObj = peerIdFromString(peer_id);

				// Try to dial via cached multiaddrs first
				if (multiaddrs && multiaddrs.length > 0) {
					try {
						const ma = multiaddr(multiaddrs[0]);
						await this.libp2p.dial(ma);
						dialed++;
						continue;
					} catch (err) {
						// Fall back to peer ID dial if cached multiaddr fails
						console.warn(
							`Failed to dial peer ${peer_id} using cached multiaddr: ${err instanceof Error ? err.message : String(err)}. Falling back to peer ID dial.`,
						);
					}
				}

				// Fall back to peer ID dial
				await this.libp2p.dial(peerIdObj);
				dialed++;
			} catch {
				// Peer may be offline
			}
		}

		return dialed;
	}

	/**
	 * Get libp2p instance (for API module)
	 */
	private libp2p?: Libp2p;
	private db: DatabaseManager;
	private sessions: SessionManager;
	private pendingAcks: Map<string, { timeout: NodeJS.Timeout }> = new Map();
	private eventBus = EventBus.getInstance<Record<string, YapYapEvent>>();

	private identity?: EncryptionKeyPair;
	private encryptionKeyPair?: EncryptionKeyPair;
	private handshakeInProgress = new Set<string>();
	private peerKeyWaiters = new Map<string, (() => void)[]>();
	private peerKeyRefreshPending = new Set<string>();
	private peerKeyVersions = new Map<string, number>();
	private peerKeyRefreshPendingVersion = new Map<string, number>();

	public messageRouter: MessageRouter;
	private nodeState: NodeState;
	private routingTable: RoutingTable;
	private bootstrapAddrs: string[] = [];
	private readonly bootstrapDialSuccesses = new Set<string>();
	private readonly bootstrapDialSuccessAddrs = new Set<string>();

	constructor(db: DatabaseManager) {
		this.db = db;
		this.sessions = new SessionManager(this.db);
		this.nodeState = new NodeState();
		this.routingTable = new RoutingTable();
		this.messageRouter = new MessageRouter({
			db: this.db,
			getLibp2p: () => this.libp2p,
			getPeerId: this.getPeerId.bind(this),
			fetchRecipientPublicKey: this.fetchRecipientPublicKey.bind(this),
			getNodeKeyPair: this.getNodeKeyPair.bind(this),
			encryptMessage: this.encryptMessage.bind(this),
			encodeResponse: this.encodeResponse,
			safeClose: this.safeClose,
			pendingAcks: this.pendingAcks,
			onMessage: this.handleIncomingMessage.bind(this),
			emitEvent: this.emitEvent.bind(this),
			signRelayEnvelope: this.signRelayEnvelope.bind(this),
			verifyRelayEnvelope: this.verifyRelayEnvelope.bind(this),
			getBootstrapPeerIds: this.getBootstrapPeerIds.bind(this),
			getThrottleKeyForPeer: this.getThrottleKeyForPeer.bind(this),
			getDiscoveredPeers: this.getDiscoveredPeers.bind(this),
			waitForPeerPublicKey: this.waitForPeerPublicKey.bind(this),
			shouldRefreshPeerPublicKey: this.shouldRefreshPeerPublicKey.bind(this),
		});
	}

	/* ------------------------------------------------------------------------ */
	/*                               Initialization                             */
	/* ------------------------------------------------------------------------ */

	async init(libp2p: Libp2p) {
		this.libp2p = libp2p;
		this.identity = await generateIdentityKeyPair();
		const storedEncryptionKey = this.db.getEncryptionKey();
		if (storedEncryptionKey) {
			this.encryptionKeyPair = {
				publicKey: Buffer.from(storedEncryptionKey.public_key, "hex"),
				privateKey: Buffer.from(storedEncryptionKey.private_key, "hex"),
			};
		} else {
			this.encryptionKeyPair = await generateEphemeralKeyPair();
			this.db.saveEncryptionKey(
				Buffer.from(this.encryptionKeyPair.publicKey).toString("hex"),
				Buffer.from(this.encryptionKeyPair.privateKey).toString("hex"),
			);
		}

		this.registerProtocols();
		this.registerPeerEvents();
		await this.emitEvent({
			id: `evt_${Date.now()}_node_started`,
			type: Events.Node.Started,
			timestamp: Date.now(),
			nodeId: this.getPeerId(),
			startedAt: Date.now(),
		});

		// Router owns retry lifecycle.
		this.messageRouter.startRetryScheduler();
	}

	async stop(): Promise<void> {
		// Stop the retry scheduler first
		this.messageRouter.stopRetryScheduler();

		// Clear all pending ACK timeouts
		for (const [messageId, ackEntry] of this.pendingAcks.entries()) {
			clearTimeout(ackEntry.timeout);
			this.pendingAcks.delete(messageId);
		}

		// Stop libp2p
		if (this.libp2p) {
			await this.libp2p.stop();
		}

		// Close database connections
		this.db.close();

		// Emit node stopped event (best effort)
		await this.emitEvent({
			id: `evt_${Date.now()}_node_stopped`,
			type: Events.Node.Stopped,
			timestamp: Date.now(),
			nodeId: this.getPeerId(),
			stoppedAt: Date.now(),
		});
	}

	private registerProtocols() {
		if (!this.libp2p) return;

		// Ensure router owns message stream
		this.libp2p.handle("/yapyap/message/1.0.0", this.handleMessageStream);
		this.libp2p.handle(PROTOCOL_HANDSHAKE, this.handleHandshake);
		this.libp2p.handle(PROTOCOL_ROUTE, this.handleRoute);
		this.libp2p.handle(PROTOCOL_SYNC, this.handleSync);
	}

	private registerPeerEvents() {
		if (!this.libp2p) return;

		this.libp2p.addEventListener("peer:connect", (e) => {
			const peerId = e.detail.toString();
			console.log("Peer connected:", peerId);

			// Create E2E session for encrypted communication
			this.sessions
				.getOrCreateSession(peerId)
				.catch((err) => console.error("Failed to create E2E session:", err));
			if (peerId !== this.getPeerId()) {
				this.markPeerKeyRefreshPending(peerId);
				void this.performHandshake(peerId).catch((err) =>
					console.warn("Handshake failed for peer", peerId, err),
				);
			}
		});

		this.libp2p.addEventListener("peer:disconnect", (e) => {
			const peerId = e.detail.toString();
			console.log("Peer disconnected:", peerId);

			// Mark peer as unavailable in database
			this.db.markPeerUnavailable(peerId);
		});
	}

	private async performHandshake(peerId: string): Promise<void> {
		if (!this.libp2p || !this.encryptionKeyPair?.publicKey) {
			return;
		}
		if (this.handshakeInProgress.has(peerId)) {
			return;
		}

		const handshakePayload: HandshakeMessage = {
			type: "hello",
			version: PROTOCOL_VERSION,
			capabilities: HANDSHAKE_CAPABILITIES,
			timestamp: Date.now(),
			publicKey: this.encryptionKeyPair.publicKey,
			e2eCapabilities: {
				supported: true,
				keyExchange: "X25519",
				encryption: "AES-GCM",
				signature: "Ed25519",
			},
		};

		this.handshakeInProgress.add(peerId);
		try {
			const peerIdObj = peerIdFromString(peerId);

			for (let attempt = 1; attempt <= HANDSHAKE_MAX_ATTEMPTS; attempt++) {
				let stream: Stream | undefined;
				try {
					stream = await this.libp2p.dialProtocol(
						peerIdObj,
						PROTOCOL_HANDSHAKE,
					);
					await stream.send(MessageFramer.encode(handshakePayload));

					for await (const chunk of stream) {
						if (!(chunk instanceof Uint8Array)) continue;
						const decoded = decodeMessage<HandshakeMessage>(chunk);
						await this.processHandshake(decoded, peerIdObj);
						break;
					}

					return;
				} catch (error) {
					if (attempt === HANDSHAKE_MAX_ATTEMPTS) {
						throw error;
					}
					await new Promise((resolve) =>
						setTimeout(resolve, HANDSHAKE_RETRY_BASE_MS * attempt),
					);
				} finally {
					if (stream) {
						await this.safeClose(stream);
					}
				}
			}
		} finally {
			this.handshakeInProgress.delete(peerId);
			this.clearPeerKeyRefresh(peerId);
		}
	}

	/* ------------------------------------------------------------------------ */
	/*                            Message Stream Handler                        */
	/* ------------------------------------------------------------------------ */

	private handleMessageStream = async (
		stream: Stream,
		connection: Connection,
	) => {
		await this.handleFramedStream<YapYapMessage, AckMessage>(
			stream,
			connection,
			decodeMessage,
			async (msg, _peer) => {
				// Route all incoming messages through the router
				await this.messageRouter.receive(msg);
				// ACK handled by router
				return null;
			},
			this.encodeResponse,
			"Message",
		);
	};

	private handleIncomingMessage = async (message: YapYapMessage) => {
		// Application-level event bus, extend as needed
		// For now, log or process
		console.log("Received message via router:", message);
		// TODO: Integrate with higher-level handlers
	};

	async shutdown() {
		// Shutdown message router
		if (this.messageRouter) {
			this.messageRouter.shutdown();
		}
		await this.emitEvent({
			id: `evt_${Date.now()}_node_stopped`,
			type: Events.Node.Stopped,
			timestamp: Date.now(),
			nodeId: this.getPeerId(),
			stoppedAt: Date.now(),
		});
	}

	/* ------------------------------------------------------------------------ */
	/*                            Generic Stream Handler                         */
	/* ------------------------------------------------------------------------ */

	private handleFramedStream = async <TMsg, TRes>(
		stream: Stream,
		connection: Connection,
		decode: (data: Uint8Array) => TMsg,
		handler: (msg: TMsg, peer: PeerId) => Promise<TRes | null>,
		encode?: (res: TRes, peer: PeerId) => Uint8Array,
		label = "Stream",
	): Promise<void> => {
		let buffer: Uint8Array = new Uint8Array(0);
		let idleTimer: NodeJS.Timeout | undefined;

		const armIdleWatchdog = () => {
			if (idleTimer) {
				clearTimeout(idleTimer);
			}
			idleTimer = setTimeout(() => {
				void this.safeClose(stream);
			}, STREAM_IDLE_TIMEOUT_MS);
		};

		try {
			armIdleWatchdog();
			for await (const chunk of stream) {
				armIdleWatchdog();
				const data = chunk instanceof Uint8Array ? chunk : chunk.subarray();

				buffer = this.concat(buffer, data);
				if (buffer.length > MAX_RECEIVE_BUFFER_BYTES) {
					stream.abort(
						new Error(
							`Receive buffer exceeded limit (${MAX_RECEIVE_BUFFER_BYTES} bytes)`,
						),
					);
					return;
				}

				if (buffer.length > BUFFER_THRESHOLD_BYTES) {
					await this.applyBackpressure(buffer.length, label);
				}

				buffer = await this.processFrames(
					buffer,
					decode,
					handler,
					encode,
					connection,
					stream,
					label,
				);
			}
		} catch (err) {
			console.error(`[${label}] error:`, err);
		} finally {
			if (idleTimer) {
				clearTimeout(idleTimer);
			}
			await this.safeClose(stream);
		}
	};

	private async applyBackpressure(
		bufferSize: number,
		label: string,
	): Promise<void> {
		console.warn(
			`[${label}] backpressure: buffer at ${bufferSize} bytes, waiting for processing`,
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	private async processFrames<TMsg, TRes>(
		buffer: Uint8Array,
		decode: (data: Uint8Array) => TMsg,
		handler: (msg: TMsg, peer: PeerId) => Promise<TRes | null>,
		encode: ((res: TRes, peer: PeerId) => Uint8Array) | undefined,
		connection: Connection,
		stream: Stream,
		label: string,
	): Promise<Uint8Array> {
		while (buffer.length >= 4) {
			const view = new DataView(
				buffer.buffer,
				buffer.byteOffset,
				buffer.byteLength,
			);

			const size = view.getUint32(0, false);
			if (size > MAX_FRAME_SIZE_BYTES) {
				throw new Error(`Frame too large: ${size} bytes`);
			}

			if (buffer.length < size + 4) break;

			const frame = buffer.slice(4, 4 + size);
			buffer = buffer.slice(4 + size);

			try {
				const msg = decode(frame);

				const res = await handler(msg, connection.remotePeer);

				if (res && encode) {
					const encoded = encode(res, connection.remotePeer);
					await stream.send(encoded);
				}
			} catch (err) {
				console.error(`[${label}] frame error:`, err);
				break;
			}
		}

		return buffer;
	}

	/* ------------------------------------------------------------------------ */
	/*                            Protocol Handlers                             */
	/* ------------------------------------------------------------------------ */

	private handleHandshake = async (stream: Stream, connection: Connection) => {
		await this.handleFramedStream<HandshakeMessage, YapYapMessage>(
			stream,
			connection,
			decodeMessage,
			this.processHandshake,
			this.encodeResponse,
			"Handshake",
		);
	};

	private handleRoute = async (stream: Stream, connection: Connection) => {
		await this.handleFramedStream<
			RouteAnnounceMessage | RouteQueryMessage | RouteResultMessage,
			YapYapMessage
		>(
			stream,
			connection,
			decodeMessage,
			async (_msg, _peer) => null,
			this.encodeResponse,
			"Route",
		);
	};

	private handleSync = async (stream: Stream, connection: Connection) => {
		await this.handleFramedStream<
			SyncRequestMessage | SyncResponseMessage,
			YapYapMessage
		>(
			stream,
			connection,
			decodeMessage,
			async (_msg, _peer) => null,
			this.encodeResponse,
			"Sync",
		);
	};

	/* ------------------------------------------------------------------------ */
	/*                            Message Processors                            */
	/* ------------------------------------------------------------------------ */

	private processHandshake = async (
		msg: HandshakeMessage,
		peer: PeerId,
	): Promise<YapYapMessage | null> => {
		if (!msg.publicKey) {
			throw new Error("Handshake message missing public key");
		}

		const peerId = peer.toString();

		// Store peer's X25519 public key for E2E encryption
		const publicKeyHex = Buffer.from(msg.publicKey).toString("hex");
		await this.db.savePeerMetadata(peerId, "public_key", publicKeyHex);
		const nextVersion = (this.peerKeyVersions.get(peerId) ?? 0) + 1;
		this.peerKeyVersions.set(peerId, nextVersion);
		this.signalPeerKeyAvailable(peerId);
		this.clearPeerKeyRefresh(peerId);

		// Create E2E session for encrypted communication
		await this.sessions.createSession(peerId);

		return this.buildResponse(peer, {
			type: "handshake_ack",
			ok: true,
		});
	};

	/* ------------------------------------------------------------------------ */
	/*                              Encryption                                  */
	/* ------------------------------------------------------------------------ */

	async encryptMessage(
		payload: unknown,
		recipient: Uint8Array,
	): Promise<EncryptedPayload> {
		if (!this.identity?.privateKey) {
			throw new Error("Identity key pair not initialized");
		}
		const encrypted = await encryptE2EMessage(
			JSON.stringify(payload),
			recipient,
			this.identity.privateKey,
		);
		const toHex = (value?: Uint8Array): string =>
			value ? Buffer.from(value).toString("hex") : "";

		return {
			encrypted: true,
			ciphertext: toHex(encrypted.ciphertext),
			nonce: toHex(encrypted.nonce),
			ephemeralPublicKey: toHex(encrypted.ephemeralPublicKey),
			signature: toHex(encrypted.signature),
		};
	}

	async decryptMessage(msg: YapYapMessage): Promise<unknown | null> {
		if (!isEncryptedPayload(msg.payload)) return null;
		if (!this.encryptionKeyPair?.privateKey) return null;
		let senderPublicKey: Buffer | null = null;
		const senderNodeKey = await this.db.getNodeKey(msg.from);
		if (senderNodeKey?.public_key) {
			senderPublicKey = Buffer.from(senderNodeKey.public_key, "hex");
		}
		const decrypted = await decryptE2EMessage(
			{
				ciphertext: Buffer.from(msg.payload.ciphertext, "hex"),
				nonce: Buffer.from(msg.payload.nonce, "hex"),
				ephemeralPublicKey: Buffer.from(msg.payload.ephemeralPublicKey, "hex"),
				signature: Buffer.from(msg.payload.signature, "hex"),
			},
			senderPublicKey,
			this.encryptionKeyPair.privateKey,
		);
		return JSON.parse(decrypted);
	}

	/**
	 * Fetch recipient's public key for E2EE encryption
	 * @param peerId Peer ID (string)
	 * @returns Promise<Buffer> recipient public key
	 */
	async fetchRecipientPublicKey(peerId: string): Promise<Buffer | null> {
		// Try to get node key from DB
		const nodeKey = this.db.getNodeKey(peerId);
		if (nodeKey?.public_key) {
			return Buffer.from(nodeKey.public_key, "hex");
		}
		const metadataKey = await this.db.getPeerMetadata(peerId, "public_key");
		if (typeof metadataKey === "string") {
			return Buffer.from(metadataKey, "hex");
		}
		// Optionally: fallback to session public key
		const sessions = this.db.getAllActiveSessions();
		const session = sessions.find(
			(s: { peer_id: string }) => s.peer_id === peerId,
		);
		if (session?.public_key) {
			return Buffer.from(session.public_key, "hex");
		}
		return null;
	}

	/**
	 * Get this node's key pair (for E2EE sender keys)
	 */
	getNodeKeyPair(): {
		privateKey: Buffer | undefined;
		publicKey: Buffer | undefined;
	} {
		if (!this.identity) return { privateKey: undefined, publicKey: undefined };
		return {
			privateKey: Buffer.from(this.identity.privateKey),
			publicKey: Buffer.from(this.identity.publicKey),
		};
	}

	getEncryptionPublicKeyHex(): string | null {
		if (!this.encryptionKeyPair?.publicKey) {
			return null;
		}
		return Buffer.from(this.encryptionKeyPair.publicKey).toString("hex");
	}

	/**
	 * Get recipient's public key for encryption
	 */
	async getPeerPublicKey(peerId: string): Promise<string | null> {
		const key = await this.db.getPeerMetadata(peerId, "public_key");
		return key && typeof key === "string" ? key : null;
	}

	/* ------------------------------------------------------------------------ */
	/*                              Messaging                                   */
	/* ------------------------------------------------------------------------ */

	private buildResponse(peer: PeerId, payload: unknown): YapYapMessage {
		if (!this.libp2p) {
			throw new Error("libp2p not ready");
		}

		return {
			id: `resp_${Date.now()}`,
			type: "data",
			from: this.libp2p.peerId.toString(),
			to: peer.toString(),
			payload,
			timestamp: Date.now(),
		};
	}

	private encodeResponse = (msg: YapYapMessage): Uint8Array => {
		return MessageFramer.encode(msg);
	};

	/* ------------------------------------------------------------------------ */
	/*                               Utilities                                  */
	/* ------------------------------------------------------------------------ */

	private concat(a: Uint8Array, b: Uint8Array): Uint8Array {
		const out = new Uint8Array(a.length + b.length);
		out.set(a, 0);
		out.set(b, a.length);
		return out;
	}

	private async safeClose(stream: Stream) {
		try {
			await stream.close();
		} catch {
			/* ignore */
		}
	}

	private getBootstrapPeerIds(): string[] {
		const raw = process.env.YAPYAP_BOOTSTRAP_PEERS;
		if (!raw) {
			return [];
		}
		return raw
			.split(",")
			.map((peerId) => peerId.trim())
			.filter((peerId) => peerId.length > 0);
	}

	private getThrottleKeyForPeer(peerId: string): string | undefined {
		// Placeholder for future transport/IP mapping.
		// For now, throttle key falls back to peer ID.
		return peerId;
	}

	private async signRelayEnvelope(
		payload: RelayEnvelopeSigningPayload,
	): Promise<{ signature: string; signerPublicKey: string } | null> {
		if (!this.identity) {
			return null;
		}
		const serialized = Buffer.from(JSON.stringify(payload), "utf8");
		const signature = await signMessage(serialized, this.identity.privateKey);
		return {
			signature: Buffer.from(signature).toString("hex"),
			signerPublicKey: Buffer.from(this.identity.publicKey).toString("hex"),
		};
	}

	private async verifyRelayEnvelope(
		payload: RelayEnvelopeSigningPayload,
		signatureHex: string,
		signerPublicKeyHex: string,
	): Promise<boolean> {
		try {
			const serialized = Buffer.from(JSON.stringify(payload), "utf8");
			return await verifySignature(
				serialized,
				Buffer.from(signatureHex, "hex"),
				Buffer.from(signerPublicKeyHex, "hex"),
			);
		} catch {
			return false;
		}
	}

	private async emitEvent(event: YapYapEvent): Promise<void> {
		try {
			await this.eventBus.emit(event);
		} catch {
			// Event emission is best-effort and should not fail core operations.
		}
	}
}
