import crypto from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type { YapYapNode } from "../core/node.js";
import type { YapYapMessage } from "../message/message.js";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null;
}

export class ApiModule {
	private yapyapNode: YapYapNode;
	private apiServer?: Server;
	private wss?: WebSocketServer;
	private websocketClients = new Set<WebSocket>();
	private heartbeatInterval?: NodeJS.Timeout;
	private actualPort?: number;

	constructor(yapyapNode: YapYapNode) {
		this.yapyapNode = yapyapNode;
	}

	private getPathParam(path: string, index: number): string | undefined {
		return path.split("/").filter(Boolean)[index];
	}

	async init(portOverride?: number): Promise<void> {
		await this.startApiServer(portOverride);
	}

	private async startApiServer(portOverride?: number): Promise<void> {
		let port =
			portOverride ??
			(process.env.YAPYAP_API_PORT
				? parseInt(process.env.YAPYAP_API_PORT, 10)
				: undefined) ??
			3000;

		let retries = 0;
		const maxRetries = 5;
		const baseDelayMs = 100;

		while (retries <= maxRetries) {
			try {
				await new Promise<void>((resolve, reject) => {
					this.apiServer = createServer(
						async (req: IncomingMessage, res: ServerResponse) => {
							const request = await this.nodeRequestToFetchRequest(req);
							const response = await this.handleRequest(request);
							this.writeFetchResponseToNode(response, res);
						},
					);

					this.wss = new WebSocketServer({ noServer: true });

					this.apiServer.on("upgrade", (request, socket, head) => {
						this.wss?.handleUpgrade(request, socket, head, (ws) => {
							this.wss?.emit("connection", ws, request);
						});
					});

					this.wss.on("connection", (ws: WebSocket) => {
						this.websocketClients.add(ws);

						ws.on("message", (data) => {
							this.handleWebSocketMessage(ws, data);
						});

						ws.on("close", () => {
							this.websocketClients.delete(ws);
						});
					});

					this.apiServer.on("error", (error: NodeJS.ErrnoException) => {
						if (error.code === "EADDRINUSE" && retries < maxRetries) {
							reject(error);
						} else {
							reject(error);
						}
					});

					this.apiServer.listen(port, () => {
						const addr = this.apiServer?.address();
						this.actualPort =
							typeof addr === "object" && addr !== null ? addr.port : port;
						console.log(`API server started on port ${this.actualPort}`);
						resolve();
					});
				});

				this.heartbeatInterval = setInterval(() => {
					for (const ws of this.websocketClients) {
						if (ws.readyState !== WebSocket.OPEN) {
							ws.close();
							this.websocketClients.delete(ws);
						}
					}
				}, 30000);

				return; // Success
			} catch (error) {
				if (
					error instanceof Error &&
					error.message.includes("EADDRINUSE") &&
					retries < maxRetries
				) {
					console.warn(
						`Port ${port} in use, trying next available port (attempt ${retries + 1}/${maxRetries})`,
					);
					port = 0; // Let OS assign a port
					retries++;
					await new Promise((resolve) =>
						setTimeout(resolve, baseDelayMs * 2 ** (retries - 1)),
					);
				} else {
					throw error;
				}
			}
		}

		throw new Error(`Failed to start API server after ${maxRetries} attempts`);
	}

	private async nodeRequestToFetchRequest(
		req: IncomingMessage,
	): Promise<Request> {
		const protocol = (req.socket as Socket & { encrypted?: boolean }).encrypted
			? "https"
			: "http";
		const host = req.headers.host || "localhost";
		const url = `${protocol}://${host}${req.url}`;

		const body = await new Promise<Buffer>((resolve) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk) => chunks.push(chunk));
			req.on("end", () => resolve(Buffer.concat(chunks)));
		});

		return new Request(url, {
			method: req.method,
			headers: req.headers as HeadersInit,
			body: body.length > 0 ? (body as BodyInit) : undefined,
		});
	}

	private writeFetchResponseToNode(
		fetchResponse: Response,
		res: ServerResponse,
	): void {
		res.statusCode = fetchResponse.status;
		fetchResponse.headers.forEach((value, key) => {
			res.setHeader(key, value);
		});

		if (fetchResponse.body) {
			fetchResponse.arrayBuffer().then((buffer) => {
				res.end(Buffer.from(buffer));
			});
		} else {
			res.end();
		}
	}

	public get apiPort(): number | undefined {
		return this.actualPort;
	}

	public async handleRequest(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		const method = request.method;

		if (method === "GET" && path === "/health") {
			return this.jsonResponse({ status: "ok", timestamp: Date.now() });
		}

		if (method === "OPTIONS") {
			return this.jsonResponse("", 200, true);
		}

		try {
			if (path.startsWith("/api/node")) {
				return await this.handleNodeRequest(path, method);
			} else if (path.startsWith("/api/peers")) {
				return await this.handlePeerRequest(path, method);
			} else if (path.startsWith("/api/messages")) {
				return await this.handleMessageRequest(request, path, method);
			} else if (path.startsWith("/api/database")) {
				return await this.handleDatabaseRequest(request, path, method);
			} else {
				return this.jsonResponse({ error: "API endpoint not found" }, 404);
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			console.error("API error:", error);
			if (error instanceof Error && error.stack) console.error(error.stack);
			console.error(`Request method: ${method}, URL: ${url.toString()}`);
			return this.jsonResponse(
				{ error: "Internal server error", message: errorMessage },
				500,
			);
		}
	}

	private jsonResponse(data: unknown, status = 200, isEmpty = false): Response {
		const headers = new Headers({
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		});

		return new Response(isEmpty ? "" : JSON.stringify(data), {
			status,
			headers,
		});
	}

	private async handleNodeRequest(
		path: string,
		method: string,
	): Promise<Response> {
		if (method === "GET") {
			if (path === "/api/node/info") return this.getNodeInfo();
			if (path === "/api/node/stats") return this.getNodeStats();
			if (path === "/api/node/config") return this.getNodeConfig();
		} else if (method === "POST" && path === "/api/node/stop") {
			if (process.env.NODE_ENV !== "development")
				return this.jsonResponse("Forbidden", 403, true);
			await this.stop();
			setTimeout(() => {
				process.exit(0);
			}, 50);
			return this.jsonResponse({ message: "API stopped successfully" });
		}
		return this.jsonResponse({ error: "Endpoint not found" }, 404);
	}

	private async handlePeerRequest(
		path: string,
		method: string,
	): Promise<Response> {
		if (method === "GET") {
			if (path === "/api/peers") return this.getPeers();
			const peerId = this.getPathParam(path, 2);
			if (peerId) return this.getPeerInfo(peerId);
		} else if (method === "POST") {
			const peerId = this.getPathParam(path, 2);
			if (peerId) return this.dialPeer(peerId);
		} else if (method === "DELETE") {
			const peerId = this.getPathParam(path, 2);
			if (peerId) return this.disconnectPeer(peerId);
		}
		return this.jsonResponse({ error: "Endpoint not found" }, 404);
	}

	private async handleMessageRequest(
		request: Request,
		path: string,
		method: string,
	): Promise<Response> {
		if (method === "POST" && path === "/api/messages/send") {
			const body = await this.parseJsonBody(request);
			if (!body) {
				return this.jsonResponse({ error: "Invalid JSON body" }, 400);
			}
			return this.sendMessage(body);
		} else if (method === "GET") {
			if (path === "/api/messages/inbox") return this.getInboxMessages();
			if (path === "/api/messages/outbox") return this.getOutboxMessages();
			const messageId = this.getPathParam(path, 2);
			if (messageId) return this.getMessageDetails(messageId);
		}
		return this.jsonResponse({ error: "Endpoint not found" }, 404);
	}

	private async handleDatabaseRequest(
		request: Request,
		path: string,
		method: string,
	): Promise<Response> {
		if (method === "GET") {
			if (path === "/api/database/contacts") return this.getContacts();
			if (path === "/api/database/messages")
				return this.getMessageQueueEntries();
			if (path === "/api/database/routing")
				return this.getRoutingCacheEntries();
			const peerId = this.getPathParam(path, 3);
			if (peerId) return this.getContactDetails(peerId);
		} else if (method === "POST" && path === "/api/database/contacts") {
			const body = await this.parseJsonBody(request);
			if (!body) {
				return this.jsonResponse({ error: "Invalid JSON body" }, 400);
			}
			return this.addOrUpdateContact(body);
		} else if (
			method === "DELETE" &&
			path.includes("/api/database/contacts/")
		) {
			const peerId = this.getPathParam(path, 3);
			if (peerId) return this.removeContact(peerId);
		}
		return this.jsonResponse({ error: "Endpoint not found" }, 404);
	}

	private async parseJsonBody(request: Request): Promise<JsonObject | null> {
		try {
			const parsed = await request.json();
			if (!isJsonObject(parsed)) {
				return null;
			}
			return parsed;
		} catch {
			return null;
		}
	}

	private parseJsonString(value: string): JsonObject | null {
		try {
			const parsed = JSON.parse(value);
			return isJsonObject(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	private async getNodeInfo(): Promise<Response> {
		const libp2p = this.yapyapNode.getLibp2p();
		const peerId = this.yapyapNode.getPeerId();
		const connections = libp2p ? libp2p.getConnections() : [];
		const connectedPeersCount = connections.length;
		const inboundPeersCount = connections.filter(
			(c) => c.direction === "inbound",
		).length;

		return this.jsonResponse({
			peerId,
			connectedPeersCount,
			inboundPeersCount,
			routingMetrics: {},
			uptime: process.uptime(),
		});
	}

	private async getNodeStats(): Promise<Response> {
		const libp2p = this.yapyapNode.getLibp2p();
		const connections = libp2p ? libp2p.getConnections() : [];
		return this.jsonResponse({
			connectedPeers: connections.map((c) => c.remotePeer.toString()),
			inboundPeers: connections
				.filter((c) => c.direction === "inbound")
				.map((c) => c.remotePeer.toString()),
			routingMetrics: {},
			messageQueues: [],
		});
	}

	private async getNodeConfig(): Promise<Response> {
		const config = { dataDir: undefined, network: undefined };
		return this.jsonResponse(config);
	}

	private async getPeers(): Promise<Response> {
		const libp2p = this.yapyapNode.getLibp2p();
		const connections = libp2p ? libp2p.getConnections() : [];
		const peers = connections.map((c) => ({
			peerId: c.remotePeer.toString(),
			lastSeen: Date.now(),
			isAvailable: true,
		}));
		return this.jsonResponse(peers);
	}

	private async getPeerInfo(peerId: string): Promise<Response> {
		const libp2p = this.yapyapNode.getLibp2p();
		const connections = libp2p ? libp2p.getConnections() : [];
		const isAvailable = connections.some(
			(c) => c.remotePeer.toString() === peerId,
		);
		const isInbound = connections.some(
			(c) => c.remotePeer.toString() === peerId && c.direction === "inbound",
		);

		return this.jsonResponse({
			peerId,
			isAvailable,
			lastSeen: Date.now(),
			isInbound,
		});
	}

	private async dialPeer(peerId: string): Promise<Response> {
		try {
			const { peerIdFromString } = await import("@libp2p/peer-id");
			const peerIdObj = peerIdFromString(peerId);
			const libp2p = this.yapyapNode.getLibp2p();
			if (!libp2p) throw new Error("libp2p not initialized");
			await libp2p.dial(peerIdObj);
			return this.jsonResponse({ message: "Dial request sent", peerId });
		} catch (error) {
			return this.jsonResponse(
				{
					error: "Failed to dial",
					details: error instanceof Error ? error.message : String(error),
				},
				500,
			);
		}
	}

	private async disconnectPeer(peerId: string): Promise<Response> {
		try {
			const { peerIdFromString } = await import("@libp2p/peer-id");
			const peerIdObj = peerIdFromString(peerId);
			const libp2p = this.yapyapNode.getLibp2p();
			if (!libp2p) throw new Error("libp2p not initialized");
			await libp2p.hangUp(peerIdObj);
			return this.jsonResponse({ message: "Disconnected from peer", peerId });
		} catch (error) {
			return this.jsonResponse(
				{
					error: "Failed to disconnect peer",
					details: error instanceof Error ? error.message : String(error),
				},
				500,
			);
		}
	}

	private async sendMessage(body: JsonObject): Promise<Response> {
		const targetId =
			typeof body.targetId === "string"
				? body.targetId
				: typeof body.to === "string"
					? body.to
					: undefined;
		const payload = body.payload;
		if (!targetId || payload === undefined) {
			return this.jsonResponse(
				{ error: "Missing targetId/to or payload" },
				400,
			);
		}

		try {
			const { peerIdFromString } = await import("@libp2p/peer-id");
			peerIdFromString(targetId);
		} catch {
			return this.jsonResponse({ error: "Invalid target peerId" }, 400);
		}

		const message: YapYapMessage = {
			id: crypto.randomUUID(),
			type: "data",
			from: this.yapyapNode.getPeerId(),
			to: targetId,
			payload,
			timestamp: Date.now(),
		};

		try {
			await this.yapyapNode.messageRouter.send(message);
			return this.jsonResponse({
				message: "Message sent successfully",
				messageId: message.id,
				targetId,
				queued: false,
				timestamp: Date.now(),
			});
		} catch (error) {
			// Router persists first; transport failures should not look like request failures.
			return this.jsonResponse(
				{
					message: "Message queued for retry",
					messageId: message.id,
					targetId,
					queued: true,
					details: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				},
				202,
			);
		}
	}

	private async getInboxMessages(): Promise<Response> {
		const selfPeerId = this.yapyapNode.getPeerId();
		const inbox = this.yapyapNode
			.getDatabase()
			.getRecentMessageQueueEntries(200)
			.map((entry: unknown) => {
				let message: YapYapMessage | null = null;
				try {
					message = JSON.parse(
						(entry as { message_data: string }).message_data,
					) as YapYapMessage;
				} catch {
					message = null;
				}
				return {
					id: (entry as { id: string }).id,
					targetPeerId: (entry as { target_peer_id: string }).target_peer_id,
					status: (entry as { status: string }).status,
					attempts: (entry as { attempts: number }).attempts,
					queuedAt: (entry as { queued_at: number }).queued_at,
					message,
				};
			})
			.filter(
				(entry: unknown) =>
					(entry as { message?: YapYapMessage }).message?.to === selfPeerId,
			);
		return this.jsonResponse({ inbox });
	}

	private async getOutboxMessages(): Promise<Response> {
		const selfPeerId = this.yapyapNode.getPeerId();
		const outbox = this.yapyapNode
			.getDatabase()
			.getRecentMessageQueueEntries(200)
			.map((entry: unknown) => {
				let message: YapYapMessage | null = null;
				try {
					message = JSON.parse(
						(entry as { message_data: string }).message_data,
					) as YapYapMessage;
				} catch {
					message = null;
				}
				return {
					id: (entry as { id: string }).id,
					targetPeerId: (entry as { target_peer_id: string }).target_peer_id,
					status: (entry as { status: string }).status,
					attempts: (entry as { attempts: number }).attempts,
					queuedAt: (entry as { queued_at: number }).queued_at,
					nextRetryAt: (entry as { next_retry_at: number }).next_retry_at,
					message,
				};
			})
			.filter(
				(entry: unknown) =>
					(entry as { message?: YapYapMessage }).message?.from === selfPeerId,
			);
		return this.jsonResponse({ outbox });
	}

	private async getMessageDetails(_messageId: string): Promise<Response> {
		return this.jsonResponse({ error: "Message not found" }, 404);
	}

	private async getContacts(): Promise<Response> {
		const contacts = this.yapyapNode.getDatabase().getAllContacts();
		return this.jsonResponse({ contacts });
	}

	private async getContactDetails(_peerId: string): Promise<Response> {
		const contact = this.yapyapNode.getDatabase().getContact(_peerId);
		if (!contact) {
			return this.jsonResponse({ error: "Contact not found" }, 404);
		}
		return this.jsonResponse(contact);
	}

	private async addOrUpdateContact(body: JsonObject): Promise<Response> {
		try {
			const peerId = typeof body.peerId === "string" ? body.peerId : undefined;
			if (!peerId) {
				return this.jsonResponse({ error: "Missing peerId" }, 400);
			}

			const metadata = JSON.stringify(
				isJsonObject(body.metadata) ? body.metadata : {},
			);
			const contact = {
				peer_id: peerId,
				alias: typeof body.alias === "string" ? body.alias : "",
				last_seen: Date.now(),
				metadata,
				is_trusted: body.isTrusted === true,
			};
			this.yapyapNode.getDatabase().saveContactLww(contact);

			return this.jsonResponse({
				message: "Contact saved successfully",
				contact,
			});
		} catch (error) {
			return this.jsonResponse(
				{
					error: "Failed to save contact",
					details: error instanceof Error ? error.message : String(error),
				},
				500,
			);
		}
	}

	private async removeContact(peerId: string): Promise<Response> {
		this.yapyapNode.getDatabase().deleteContact(peerId);
		return this.jsonResponse({
			message: "Contact removed successfully",
			peerId,
		});
	}

	private async getMessageQueueEntries(): Promise<Response> {
		return this.jsonResponse({ messages: [] });
	}

	private async getRoutingCacheEntries(): Promise<Response> {
		return this.jsonResponse({ entries: [] });
	}

	private handleWebSocketMessage(
		ws: WebSocket,
		message: Buffer | ArrayBuffer | Buffer[],
	): void {
		try {
			let data: JsonObject | null = null;
			let messageStr: string;

			if (Buffer.isBuffer(message)) {
				messageStr = message.toString("utf8");
			} else if (message instanceof ArrayBuffer) {
				messageStr = new TextDecoder().decode(message);
			} else if (Array.isArray(message)) {
				messageStr = Buffer.concat(message).toString("utf8");
			} else {
				throw new Error("Unsupported WebSocket message type");
			}

			data = this.parseJsonString(messageStr);

			if (!data) {
				throw new Error("Invalid JSON in WebSocket message");
			}

			const eventType = typeof data.type === "string" ? data.type : undefined;

			switch (eventType) {
				case "ping":
					ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
					break;
				default:
					console.log("Received WebSocket message:", data);
			}
		} catch (error) {
			console.error("WebSocket message parsing error:", error);
		}
	}

	async sendRealTimeEvent(eventType: string, data: JsonObject): Promise<void> {
		const event = JSON.stringify({
			type: eventType,
			data,
			timestamp: Date.now(),
		});
		this.websocketClients.forEach((client) => {
			if (client.readyState === WebSocket.OPEN) client.send(event);
		});
	}

	async stop(): Promise<void> {
		if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);

		this.websocketClients.forEach((client) => {
			client.close();
		});

		if (this.wss) {
			this.wss.close();
		}

		if (this.apiServer) {
			await new Promise<void>((resolve) => {
				this.apiServer?.close(() => {
					console.log("API module stopped");
					resolve();
				});
			});
		}
	}
}
