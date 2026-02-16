// Refactored NetworkModule.ts
// Focus: DRY stream handling, centralized framing, safer lifecycle

import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";

import { autoNAT } from "@libp2p/autonat";
import { circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { privateKeyFromRaw } from "@libp2p/crypto/keys";
import { identify } from "@libp2p/identify";
import type { Connection, Libp2p, PeerId, Stream } from "@libp2p/interface";
import { kadDHT } from "@libp2p/kad-dht";
import { ping } from "@libp2p/ping";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import type { Multiaddr } from "@multiformats/multiaddr";
import { multiaddr } from "@multiformats/multiaddr";
import { createLibp2p } from "libp2p";
import {
	MAX_FRAME_SIZE_BYTES,
	MessageCodec,
	MessageFramer,
	NodeState,
	PROTOCOL_HANDSHAKE,
	PROTOCOL_ROUTE,
	PROTOCOL_SYNC,
	RoutingTable,
} from "../core/protocols.js";
import type { YapYapMessage } from "../message/message.js";
import type { HandshakeMessage } from "../protocols/handshake.js";
import { handleHandshakeMessage } from "../protocols/handshake.js";
import type {
	RouteAnnounceMessage,
	RouteQueryMessage,
	RouteResultMessage,
} from "../protocols/route.js";
import { handleRouteMessage } from "../protocols/route.js";
import type {
	SyncRequestMessage,
	SyncResponseMessage,
} from "../protocols/sync.js";
import { handleSyncMessage } from "../protocols/sync.js";

const MAX_RECEIVE_BUFFER_BYTES = MAX_FRAME_SIZE_BYTES * 2;
const BUFFER_THRESHOLD_BYTES = Math.floor(MAX_RECEIVE_BUFFER_BYTES * 0.75);

/* -------------------------------------------------------------------------- */
/*                              Connection Health                             */
/* -------------------------------------------------------------------------- */

export interface ConnectionHealthConfig {
	healthCheckIntervalMs: number;
	connectionIdleTimeoutMs: number;
	pingTimeoutMs: number;
	stalledThresholdCount: number;
}

export interface ConnectionHealthState {
	peerId: PeerId;
	lastActivityMs: number;
	isHealthy: boolean;
	stalledCount: number;
	lastCheckMs: number;
}

const DEFAULT_HEALTH_CONFIG: ConnectionHealthConfig = {
	healthCheckIntervalMs: 30_000,
	connectionIdleTimeoutMs: 120_000,
	pingTimeoutMs: 5_000,
	stalledThresholdCount: 2,
};

export class ConnectionHealthMonitor {
	private libp2p: Libp2p;
	private config: ConnectionHealthConfig;
	private connectionStates: Map<string, ConnectionHealthState> = new Map();
	private healthCheckTimer?: NodeJS.Timeout;
	private onUnhealthyPeer?: (peerId: PeerId) => void | Promise<void>;

	constructor(
		libp2p: Libp2p,
		config: Partial<ConnectionHealthConfig> = {},
		onUnhealthyPeer?: (peerId: PeerId) => void | Promise<void>,
	) {
		this.libp2p = libp2p;
		this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
		this.onUnhealthyPeer = onUnhealthyPeer;
	}

	start(): void {
		this.healthCheckTimer = setInterval(() => {
			this.checkAllConnections().catch(console.error);
		}, this.config.healthCheckIntervalMs);
	}

	stop(): void {
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
			this.healthCheckTimer = undefined;
		}
		this.connectionStates.clear();
	}

	async checkAllConnections(): Promise<void> {
		const connections = this.libp2p.getConnections();
		const now = Date.now();

		for (const conn of connections) {
			const peerIdStr = conn.remotePeer.toString();
			let state = this.connectionStates.get(peerIdStr);

			if (!state) {
				state = {
					peerId: conn.remotePeer,
					lastActivityMs: now,
					isHealthy: true,
					stalledCount: 0,
					lastCheckMs: now,
				};
				this.connectionStates.set(peerIdStr, state);
			}

			const idleTime = now - state.lastActivityMs;
			const isIdle = idleTime > this.config.connectionIdleTimeoutMs;

			if (isIdle || !state.isHealthy) {
				const healthy = await this.pingPeer(conn.remotePeer);

				if (healthy) {
					state.lastActivityMs = now;
					state.isHealthy = true;
					state.stalledCount = 0;
				} else {
					state.stalledCount++;
					state.lastCheckMs = now;

					if (
						state.stalledCount >= this.config.stalledThresholdCount ||
						isIdle
					) {
						state.isHealthy = false;
						console.warn(
							`Connection health: peer ${peerIdStr} marked unhealthy (stalled: ${state.stalledCount}, idle: ${idleTime}ms)`,
						);

						if (this.onUnhealthyPeer) {
							await this.onUnhealthyPeer(conn.remotePeer);
						}
					}
				}
			}
		}
	}

	private async pingPeer(peerId: PeerId): Promise<boolean> {
		try {
			const pingSvc = (
				this.libp2p as unknown as {
					services?: { ping?: { ping: (peer: PeerId) => Promise<number> } };
				}
			).services?.ping;
			if (pingSvc) {
				await this.withTimeout(
					pingSvc.ping(peerId),
					this.config.pingTimeoutMs,
					"Ping timeout",
				);
				return true;
			}
		} catch {
			// Ping failed, connection may be half-open
		}
		return false;
	}

	private async withTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
		_errorMsg: string,
	): Promise<T> {
		let timeoutHandle: NodeJS.Timeout | undefined;

		const timeoutPromise = new Promise<never>((_, reject) => {
			timeoutHandle = setTimeout(() => {
				reject(new Error(`Ping timeout after ${timeoutMs}ms`));
			}, timeoutMs);
		});

		try {
			return await Promise.race([promise, timeoutPromise]);
		} finally {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
		}
	}

	updateActivity(peerId: PeerId): void {
		const state = this.connectionStates.get(peerId.toString());
		if (state) {
			state.lastActivityMs = Date.now();
			state.isHealthy = true;
			state.stalledCount = 0;
		}
	}

	getConnectionState(peerId: PeerId): ConnectionHealthState | undefined {
		return this.connectionStates.get(peerId.toString());
	}

	isConnectionHealthy(peerId: PeerId): boolean {
		const state = this.connectionStates.get(peerId.toString());
		return state?.isHealthy ?? false;
	}

	async hangUpUnhealthyPeer(peerId: PeerId): Promise<boolean> {
		const state = this.connectionStates.get(peerId.toString());
		if (!state || state.isHealthy) {
			return false;
		}

		try {
			await (
				this.libp2p as unknown as { hangUp?: (peer: PeerId) => Promise<void> }
			).hangUp?.(peerId);
			this.connectionStates.delete(peerId.toString());
			return true;
		} catch (err) {
			console.warn(`Failed to hangUp peer ${peerId}:`, err);
			return false;
		}
	}
}

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

type ProtocolHandler<TMsg, TRes> = (
	msg: TMsg,
	peer: PeerId,
) => Promise<TRes | null>;

/* -------------------------------------------------------------------------- */
/*                              Network Module                                */
/* -------------------------------------------------------------------------- */

export class NetworkModule {
	public libp2p?: Libp2p;
	public bootstrapAddrs: Multiaddr[] = [];
	public routingTable: RoutingTable;
	public nodeState: NodeState;
	public healthMonitor?: ConnectionHealthMonitor;

	private privateKey?: import("@libp2p/interface").PrivateKey;
	protected connectionTimer?: NodeJS.Timeout;

	private readonly DEFAULT_LISTEN = ["/ip4/0.0.0.0/tcp/0"];

	constructor(privateKeyRaw?: Uint8Array) {
		if (privateKeyRaw) {
			this.privateKey = privateKeyFromRaw(privateKeyRaw);
		}
		this.routingTable = new RoutingTable();
		this.nodeState = new NodeState();
	}

	/* ------------------------------------------------------------------------ */
	/*                                 Startup                                  */
	/* ------------------------------------------------------------------------ */

	async start(
		options: {
			privateKey?: import("@libp2p/interface").PrivateKey | undefined;
			listenAddresses?: string[];
			bootstrap?: string[];
			connectionCheckIntervalMs?: number;
			healthCheckConfig?: Partial<ConnectionHealthConfig>;
		} = {},
	): Promise<void> {
		if (options.privateKey) {
			this.privateKey = options.privateKey;
		}

		const listen = options.listenAddresses ?? this.DEFAULT_LISTEN;

		const libp2pOptions = {
			addresses: { listen },
			transports: [tcp(), webSockets()],
			connectionEncrypters: [noise()],
			streamMuxers: [yamux()],
			services: {
				dht: kadDHT(),
				identify: identify(),
				ping: ping(),
				autonat: autoNAT(),
				relay: circuitRelayServer(),
			},
			...(this.privateKey ? { privateKey: this.privateKey } : {}),
		};

		this.libp2p = await createLibp2p(libp2pOptions);

		this.initBootstrap(options.bootstrap);
		this.registerProtocols();
		this.registerEvents();

		if (options.connectionCheckIntervalMs) {
			this.startConnectionMonitor(options.connectionCheckIntervalMs);
		}

		if (options.healthCheckConfig?.healthCheckIntervalMs) {
			this.healthMonitor = new ConnectionHealthMonitor(
				this.libp2p,
				options.healthCheckConfig,
				async (peerId) => {
					try {
						await (
							this.libp2p as unknown as {
								hangUp?: (peer: PeerId) => Promise<void>;
							}
						).hangUp?.(peerId);
					} catch {
						// Best effort cleanup
					}
				},
			);
			this.healthMonitor.start();
		}
	}

	async stop(): Promise<void> {
		if (!this.libp2p) return;

		if (this.healthMonitor) {
			this.healthMonitor.stop();
			this.healthMonitor = undefined;
		}

		try {
			await this.libp2p.stop();
		} catch (err) {
			console.warn("libp2p stop failed:", err);
		}

		if (this.connectionTimer) {
			clearInterval(this.connectionTimer);
		}

		this.libp2p = undefined as unknown as import("@libp2p/interface").Libp2p;
		this.bootstrapAddrs = [];
	}

	/* ------------------------------------------------------------------------ */
	/*                              Initialization                              */
	/* ------------------------------------------------------------------------ */

	protected initBootstrap(addrs?: string[]) {
		if (!addrs?.length || !this.libp2p) return;

		for (const addr of addrs) {
			try {
				this.bootstrapAddrs.push(multiaddr(addr));
			} catch {
				console.warn("Invalid bootstrap address:", addr);
			}
		}

		if (this.bootstrapAddrs.length === 0) return;

		// Access DHT service with proper typing
		const dht = this.libp2p.services.dht as {
			bootstrap?: () => Promise<void>;
		};

		dht?.bootstrap?.().catch(console.warn);

		for (const addr of this.bootstrapAddrs) {
			this.libp2p
				.dial(addr)
				.catch((err) => console.warn("Bootstrap dial failed:", err));
		}
	}

	private registerProtocols() {
		if (!this.libp2p) return;

		this.libp2p.handle(
			PROTOCOL_HANDSHAKE,
			this.createStreamHandler(this.processHandshake, "Handshake"),
		);

		this.libp2p.handle(
			PROTOCOL_ROUTE,
			this.createStreamHandler(this.processRoute, "Route"),
		);

		this.libp2p.handle(
			PROTOCOL_SYNC,
			this.createStreamHandler(this.processSync, "Sync"),
		);

		// Message protocol is handled by YapYapNode.messageRouter
		// This placeholder is removed to avoid duplicate handling
	}

	private registerEvents() {
		if (!this.libp2p) return;

		this.libp2p.addEventListener("peer:connect", (e) => {
			console.log("Peer connected:", e.detail.toString());
		});

		this.libp2p.addEventListener("peer:disconnect", (e) => {
			console.log("Peer disconnected:", e.detail.toString());
		});

		this.libp2p.addEventListener("connection:open", (e) => {
			console.log("Connection opened:", e.detail.remotePeer.toString());
		});

		this.libp2p.addEventListener("connection:close", (e) => {
			console.log("Connection closed:", e.detail.remotePeer.toString());
		});
	}

	private startConnectionMonitor(interval: number) {
		this.connectionTimer = setInterval(() => {
			if (!this.libp2p) return;

			const count = this.libp2p.getConnections().length;
			console.log("Active connections:", count);
		}, interval);
	}

	/* ------------------------------------------------------------------------ */
	/*                          Generic Stream Handler                           */
	/* ------------------------------------------------------------------------ */

	private createStreamHandler<TMsg, TRes>(
		handler: ProtocolHandler<TMsg, TRes>,
		label: string,
	) {
		return async (stream: Stream, connection: Connection) => {
			await this.handleFramedStream(stream, connection, handler, label);
		};
	}

	private async handleFramedStream<TMsg, TRes>(
		stream: Stream,
		connection: Connection,
		handler: ProtocolHandler<TMsg, TRes>,
		label: string,
	) {
		let buffer: Uint8Array = new Uint8Array(0);

		console.log(`[${label}] opened from ${connection.remotePeer}`);

		try {
			for await (const chunk of stream) {
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
					await this.applyBackpressure(stream, buffer.length, label);
				}

				buffer = await this.processFrames(
					buffer,
					handler,
					stream,
					connection,
					label,
				);
			}
		} catch (err) {
			console.error(`[${label}] stream error:`, err);
		} finally {
			await this.safeClose(stream);

			console.log(`[${label}] closed from ${connection.remotePeer}`);
		}
	}

	private async applyBackpressure(
		_stream: Stream,
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
		handler: ProtocolHandler<TMsg, TRes>,
		stream: Stream,
		connection: Connection,
		label: string,
	): Promise<Uint8Array> {
		const { frames, remainder } = MessageFramer.decodeFrames(buffer);

		for (const frame of frames) {
			try {
				const msg = MessageCodec.decode<YapYapMessage>(frame);

				const res = await handler(msg.payload as TMsg, connection.remotePeer);

				if (res) {
					await stream.send(this.buildResponse(res, connection.remotePeer));
				}
			} catch (err) {
				console.error(`[${label}] frame error:`, err);
				break;
			}
		}

		return remainder;
	}

	/* ------------------------------------------------------------------------ */
	/*                          Protocol Processors                              */
	/* ------------------------------------------------------------------------ */

	private processHandshake: ProtocolHandler<HandshakeMessage, YapYapMessage> =
		async (msg, peer) => {
			return handleHandshakeMessage(
				msg,
				peer,
				new Uint8Array(),
				new Uint8Array(),
			);
		};

	private processRoute: ProtocolHandler<
		RouteAnnounceMessage | RouteQueryMessage | RouteResultMessage,
		RouteResultMessage
	> = async (msg, peer) => {
		const broadcast = this.createRouteBroadcaster(peer);

		return handleRouteMessage(msg, peer, this.routingTable, broadcast);
	};

	private processSync: ProtocolHandler<
		SyncRequestMessage | SyncResponseMessage,
		SyncResponseMessage
	> = async (msg, peer) => {
		return handleSyncMessage(msg, peer, this.nodeState);
	};

	/* ------------------------------------------------------------------------ */
	/*                               Utilities                                  */
	/* ------------------------------------------------------------------------ */

	protected buildResponse(payload: unknown, peer: PeerId): Uint8Array {
		if (!this.libp2p) throw new Error("libp2p not ready");

		const msg: YapYapMessage = {
			id: `resp_${Date.now()}`,
			type: "data",
			from: this.libp2p.peerId.toString(),
			to: peer.toString(),
			payload,
			timestamp: Date.now(),
		};

		return MessageFramer.encode(msg);
	}

	private createRouteBroadcaster(exclude: PeerId) {
		return async (msg: RouteAnnounceMessage) => {
			if (!this.libp2p) return;

			for (const conn of this.libp2p.getConnections()) {
				const peer = conn.remotePeer;

				if (peer.equals(exclude)) continue;

				try {
					const stream = await this.libp2p.dialProtocol(peer, PROTOCOL_ROUTE);

					const framed = this.buildResponse(msg, peer);

					await stream.send(framed);
					await stream.close();
				} catch (err) {
					console.warn("Route broadcast failed:", err);
				}
			}
		};
	}

	private concat(a: Uint8Array, b: Uint8Array): Uint8Array {
		if (!a.length) return b;
		if (!b.length) return a;

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

	/* ------------------------------------------------------------------------ */
	/*                                Getters                                   */
	/* ------------------------------------------------------------------------ */

	get peerId(): string | undefined {
		return this.libp2p?.peerId.toString();
	}

	get isRunning(): boolean {
		return !!this.libp2p;
	}
}
