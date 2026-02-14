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
	MessageCodec,
	MessageFramer,
	NodeState,
	PROTOCOL_HANDSHAKE,
	PROTOCOL_ROUTE,
	PROTOCOL_SYNC,
	RoutingTable,
} from "../core/protocols";
import type { YapYapMessage } from "../message/message";
import {
	type HandshakeMessage,
	handleHandshakeMessage,
} from "../protocols/handshake";
import {
	handleRouteMessage,
	type RouteAnnounceMessage,
	type RouteQueryMessage,
	type RouteResultMessage,
} from "../protocols/route";
import {
	handleSyncMessage,
	type SyncRequestMessage,
	type SyncResponseMessage,
} from "../protocols/sync";

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

	private privateKey?: import("@libp2p/interface").PrivateKey;
	protected connectionTimer?: NodeJS.Timer;

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
	}

	async stop(): Promise<void> {
		if (!this.libp2p) return;

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
