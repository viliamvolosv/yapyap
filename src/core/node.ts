// Refactored node.ts
// YapYapNodeOptions interface for database initialization
export interface YapYapNodeOptions {
	dataDir?: string;
}

// NOTE: This is a fully refactored and consolidated version
// focusing on DRY, separation of concerns, and maintainability.

import type { Connection, Libp2p, PeerId, Stream } from "@libp2p/interface";
import {
	decryptE2EMessage,
	type EncryptionKeyPair,
	encryptE2EMessage,
	generateEphemeralKeyPair,
	generateIdentityKeyPair,
	signMessage,
	verifySignature,
} from "../crypto";
import { SessionManager } from "../crypto/session-manager";
import type { DatabaseManager } from "../database";
import { EventBus } from "../events/event-bus";
import { type YapYapEvent, Events } from "../events/event-types";
import type { AckMessage, YapYapMessage } from "../message/message";
import type { MessageQueueEntryInternal } from "../message/message-router";
import { MessageRouter } from "../message/message-router";
// ...existing fields...
import type { HandshakeMessage } from "../protocols/handshake";
import type {
	RouteAnnounceMessage,
	RouteQueryMessage,
	RouteResultMessage,
} from "../protocols/route";
import type {
	SyncRequestMessage,
	SyncResponseMessage,
} from "../protocols/sync";
import {
	decodeMessage,
	MAX_FRAME_SIZE_BYTES,
	MessageFramer,
	NodeState,
	PROTOCOL_HANDSHAKE,
	PROTOCOL_ROUTE,
	PROTOCOL_SYNC,
	RoutingTable,
} from "./protocols";

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
	private libp2p?: Libp2p;
	private db: DatabaseManager;
	private sessions: SessionManager;
	private messageQueues: Map<string, MessageQueueEntryInternal[]> = new Map();
	private pendingAcks: Map<string, { timeout: NodeJS.Timeout }> = new Map();
	private eventBus = EventBus.getInstance<Record<string, YapYapEvent>>();

	private identity?: EncryptionKeyPair;
	private encryptionKeyPair?: EncryptionKeyPair;

	public messageRouter: MessageRouter;
	private nodeState: NodeState;
	private routingTable: RoutingTable;

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
			messageQueues: this.messageQueues,
			pendingAcks: this.pendingAcks,
			onMessage: this.handleIncomingMessage.bind(this),
			emitEvent: this.emitEvent.bind(this),
			signRelayEnvelope: this.signRelayEnvelope.bind(this),
			verifyRelayEnvelope: this.verifyRelayEnvelope.bind(this),
			getBootstrapPeerIds: this.getBootstrapPeerIds.bind(this),
			getThrottleKeyForPeer: this.getThrottleKeyForPeer.bind(this),
		});
	}

	/* ------------------------------------------------------------------------ */
	/*                               Initialization                             */
	/* ------------------------------------------------------------------------ */

	async init(libp2p: Libp2p) {
		this.libp2p = libp2p;
		this.identity = await generateIdentityKeyPair();
		this.encryptionKeyPair = await generateEphemeralKeyPair();

		this.registerProtocols();
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

	private registerProtocols() {
		if (!this.libp2p) return;

		// Ensure router owns message stream
		this.libp2p.handle("/yapyap/message/1.0.0", this.handleMessageStream);
		this.libp2p.handle(PROTOCOL_HANDSHAKE, this.handleHandshake);
		this.libp2p.handle(PROTOCOL_ROUTE, this.handleRoute);
		this.libp2p.handle(PROTOCOL_SYNC, this.handleSync);
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
					throw new Error(
						`Receive buffer exceeded limit (${MAX_RECEIVE_BUFFER_BYTES} bytes)`,
					);
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

		await this.sessions.createSession(peer.toString());

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
		if (!this.encryptionKeyPair) {
			throw new Error("Encryption key pair not initialized");
		}
		const encrypted = await encryptE2EMessage(
			JSON.stringify(payload),
			recipient,
			this.encryptionKeyPair.privateKey,
		);
		return {
			encrypted: true,
			ciphertext: Buffer.isBuffer(encrypted.ciphertext)
				? encrypted.ciphertext.toString("hex")
				: String(encrypted.ciphertext),
			nonce: Buffer.isBuffer(encrypted.nonce)
				? encrypted.nonce.toString("hex")
				: String(encrypted.nonce),
			ephemeralPublicKey: encrypted.ephemeralPublicKey
				? Buffer.isBuffer(encrypted.ephemeralPublicKey)
					? encrypted.ephemeralPublicKey.toString("hex")
					: String(encrypted.ephemeralPublicKey)
				: "",
			signature: encrypted.signature
				? Buffer.isBuffer(encrypted.signature)
					? encrypted.signature.toString("hex")
					: String(encrypted.signature)
				: "",
		};
	}

	async decryptMessage(msg: YapYapMessage): Promise<unknown | null> {
		if (!isEncryptedPayload(msg.payload)) return null;
		if (!this.identity) return null;
		const senderNodeKey = await this.db.getNodeKey(msg.from);
		if (!senderNodeKey || !senderNodeKey.public_key) return null;
		const senderPublicKey = Buffer.from(senderNodeKey.public_key, "hex");
		const decrypted = await decryptE2EMessage(
			{
				ciphertext: Buffer.from(msg.payload.ciphertext, "hex"),
				nonce: Buffer.from(msg.payload.nonce, "hex"),
				ephemeralPublicKey: Buffer.from(msg.payload.ephemeralPublicKey, "hex"),
				signature: Buffer.from(msg.payload.signature, "hex"),
			},
			senderPublicKey,
			this.identity.privateKey,
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
		// Optionally: fallback to session public key
		const sessions = this.db.getAllActiveSessions();
		const session = sessions.find((s) => s.peer_id === peerId);
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
