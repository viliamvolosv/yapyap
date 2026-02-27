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
type ApiSuccess<T> = { success: true; data: T };
type ApiError = {
	success: false;
	error: { message: string; details?: unknown };
};
type ApiResponse<T> = ApiSuccess<T> | ApiError;

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
			return this.ok({ status: "ok", timestamp: Date.now() });
		}

		if (method === "GET" && path === "/api/docs") {
			return this.ok(this.getOpenApiSpec());
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
				return this.fail(404, "API endpoint not found");
			}
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : "Unknown error";
			console.error("API error:", error);
			if (error instanceof Error && error.stack) console.error(error.stack);
			console.error(`Request method: ${method}, URL: ${url.toString()}`);
			return this.fail(500, "Internal server error", errorMessage);
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

	private ok<T>(data: T, status = 200): Response {
		const payload: ApiResponse<T> = { success: true, data };
		return this.jsonResponse(payload, status);
	}

	private fail(status: number, message: string, details?: unknown): Response {
		const payload: ApiResponse<never> = {
			success: false,
			error: details ? { message, details } : { message },
		};
		return this.jsonResponse(payload, status);
	}

	private getOpenApiSpec(): JsonObject {
		return {
			openapi: "3.0.3",
			info: {
				title: "YapYap API",
				description:
					"YapYap is a decentralized, peer-to-peer messenger node API. It provides endpoints for managing contacts, sending/receiving messages, and monitoring node health.",
				version: "0.0.6",
				license: {
					name: "MIT",
					url: "https://github.com/viliamvolosv/yapyap/blob/main/LICENSE",
				},
			},
			servers: [
				{
					url: "http://127.0.0.1:{port}",
					variables: {
						port: {
							default: "3000",
							description: "API server port",
						},
					},
				},
			],
			components: {
				schemas: {
					ApiResponse: {
						type: "object",
						properties: {
							success: { type: "boolean", enum: [true] },
							data: { type: "object" },
						},
						required: ["success", "data"],
					},
					ApiError: {
						type: "object",
						properties: {
							success: { type: "boolean", enum: [false] },
							error: {
								type: "object",
								properties: {
									message: { type: "string" },
									details: { type: "object", nullable: true },
								},
								required: ["message"],
							},
						},
						required: ["success", "error"],
					},
					PeerId: {
						type: "string",
						description: "libp2p Peer ID string",
						example: "12D3KooWExample...",
					},
					Multiaddr: {
						type: "string",
						description: "Multiaddr connection string",
						example: "/ip4/192.168.1.1/tcp/4001/p2p/12D3KooWExample",
					},
					Contact: {
						type: "object",
						properties: {
							peer_id: { $ref: "#/components/schemas/PeerId" },
							alias: { type: "string", description: "Contact alias/name" },
							last_seen: {
								type: "integer",
								description: "Unix timestamp in milliseconds",
							},
							metadata: {
								type: "string",
								description: "JSON string with additional metadata",
							},
							is_trusted: {
								type: "boolean",
								description: "Whether the contact is marked as trusted",
							},
						},
						required: ["peer_id"],
					},
					YapYapMessage: {
						type: "object",
						properties: {
							id: { type: "string", format: "uuid" },
							type: { type: "string", enum: ["data", "ping", "pong"] },
							from: { $ref: "#/components/schemas/PeerId" },
							to: { $ref: "#/components/schemas/PeerId" },
							payload: { type: "object" },
							timestamp: {
								type: "integer",
								description: "Unix timestamp in milliseconds",
							},
						},
						required: ["id", "type", "from", "to", "payload", "timestamp"],
					},
					InboxEntry: {
						type: "object",
						properties: {
							messageId: { type: "string" },
							fromPeerId: { $ref: "#/components/schemas/PeerId" },
							processedAt: { type: "integer" },
							message: { $ref: "#/components/schemas/YapYapMessage" },
						},
					},
					OutboxEntry: {
						type: "object",
						properties: {
							messageId: { type: "string" },
							targetPeerId: { $ref: "#/components/schemas/PeerId" },
							status: { type: "string", enum: ["pending", "sent", "failed"] },
							attempts: { type: "integer" },
							createdAt: { type: "integer" },
							nextRetryAt: { type: "integer", nullable: true },
							message: { $ref: "#/components/schemas/YapYapMessage" },
						},
					},
					PeerInfo: {
						type: "object",
						properties: {
							peerId: { $ref: "#/components/schemas/PeerId" },
							isAvailable: { type: "boolean" },
							lastSeen: { type: "integer" },
							isInbound: { type: "boolean" },
						},
					},
					NodeInfo: {
						type: "object",
						properties: {
							peerId: { $ref: "#/components/schemas/PeerId" },
							connectedPeersCount: { type: "integer" },
							inboundPeersCount: { type: "integer" },
							uptime: { type: "number" },
							bootstrap: {
								type: "object",
								description: "Bootstrap peer health status",
								properties: {
									configured: {
										type: "array",
										items: { type: "string" },
										description: "Configured bootstrap multiaddrs",
									},
									connected: {
										type: "integer",
										description:
											"Number of bootstrap peers currently connected",
									},
									total: {
										type: "integer",
										description: "Total number of configured bootstrap peers",
									},
									healthy: {
										type: "boolean",
										description:
											"True if at least one bootstrap peer is connected (or none configured)",
									},
								},
							},
						},
						required: [
							"peerId",
							"connectedPeersCount",
							"inboundPeersCount",
							"uptime",
						],
					},
				},
				parameters: {
					PeerIdParam: {
						name: "peerId",
						in: "path",
						required: true,
						schema: { $ref: "#/components/schemas/PeerId" },
						description: "The libp2p Peer ID",
					},
				},
				responses: {
					SuccessResponse: {
						description: "Successful response",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/ApiResponse" },
							},
						},
					},
					ErrorResponse: {
						description: "Error response",
						content: {
							"application/json": {
								schema: { $ref: "#/components/schemas/ApiError" },
							},
						},
					},
				},
			},
			paths: {
				"/health": {
					get: {
						summary: "Health check",
						description: "Check if the API server is running",
						operationId: "healthCheck",
						tags: ["Health"],
						responses: {
							"200": {
								description: "API is healthy",
								content: {
									"application/json": {
										schema: {
											type: "object",
											properties: {
												status: { type: "string", example: "ok" },
												timestamp: { type: "integer" },
											},
										},
									},
								},
							},
						},
					},
				},
				"/api/node/info": {
					get: {
						summary: "Get node information",
						description: "Retrieve basic information about the local node",
						operationId: "getNodeInfo",
						tags: ["Node"],
						responses: {
							"200": {
								description: "Node information",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: { $ref: "#/components/schemas/NodeInfo" },
													},
												},
											],
										},
									},
								},
							},
						},
					},
				},
				"/api/node/stats": {
					get: {
						summary: "Get node statistics",
						description:
							"Retrieve statistics about connected peers and message queues",
						operationId: "getNodeStats",
						tags: ["Node"],
						responses: {
							"200": {
								description: "Node statistics",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																connectedPeers: {
																	type: "array",
																	items: {
																		$ref: "#/components/schemas/PeerId",
																	},
																},
																inboundPeers: {
																	type: "array",
																	items: {
																		$ref: "#/components/schemas/PeerId",
																	},
																},
																routingMetrics: { type: "object" },
																messageQueues: { type: "array" },
															},
														},
													},
												},
											],
										},
									},
								},
							},
						},
					},
				},
				"/api/node/config": {
					get: {
						summary: "Get node configuration",
						description: "Retrieve the current node configuration",
						operationId: "getNodeConfig",
						tags: ["Node"],
						responses: {
							"200": {
								description: "Node configuration",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																dataDir: { type: "string", nullable: true },
																network: { type: "string", nullable: true },
															},
														},
													},
												},
											],
										},
									},
								},
							},
						},
					},
				},
				"/api/node/stop": {
					post: {
						summary: "Stop the node",
						description:
							"Gracefully shutdown the YapYap node (development only)",
						operationId: "stopNode",
						tags: ["Node"],
						responses: {
							"200": {
								description: "Shutdown initiated",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																message: {
																	type: "string",
																	example: "Node shutdown initiated",
																},
															},
														},
													},
												},
											],
										},
									},
								},
							},
							"403": { $ref: "#/components/responses/ErrorResponse" },
						},
					},
				},
				"/api/peers": {
					get: {
						summary: "List connected peers",
						description: "Get a list of all currently connected peers",
						operationId: "getPeers",
						tags: ["Peers"],
						responses: {
							"200": {
								description: "List of connected peers",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "array",
															items: {
																type: "object",
																properties: {
																	peerId: {
																		$ref: "#/components/schemas/PeerId",
																	},
																	lastSeen: { type: "integer" },
																	isAvailable: { type: "boolean" },
																},
															},
														},
													},
												},
											],
										},
									},
								},
							},
						},
					},
				},
				"/api/peers/{peerId}": {
					get: {
						summary: "Get peer information",
						description: "Get information about a specific peer",
						operationId: "getPeerInfo",
						tags: ["Peers"],
						parameters: [
							{
								name: "peerId",
								in: "path",
								required: true,
								schema: { $ref: "#/components/schemas/PeerId" },
							},
						],
						responses: {
							"200": {
								description: "Peer information",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: { $ref: "#/components/schemas/PeerInfo" },
													},
												},
											],
										},
									},
								},
							},
							"404": { $ref: "#/components/responses/ErrorResponse" },
						},
					},
					post: {
						summary: "Dial a peer",
						description: "Establish a connection to a peer",
						operationId: "dialPeer",
						tags: ["Peers"],
						parameters: [
							{
								name: "peerId",
								in: "path",
								required: true,
								schema: { $ref: "#/components/schemas/PeerId" },
							},
						],
						responses: {
							"200": {
								description: "Dial request sent",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																message: {
																	type: "string",
																	example: "Dial request sent",
																},
																peerId: { $ref: "#/components/schemas/PeerId" },
															},
														},
													},
												},
											],
										},
									},
								},
							},
							"500": { $ref: "#/components/responses/ErrorResponse" },
						},
					},
					delete: {
						summary: "Disconnect a peer",
						description: "Disconnect from a specific peer",
						operationId: "disconnectPeer",
						tags: ["Peers"],
						parameters: [
							{
								name: "peerId",
								in: "path",
								required: true,
								schema: { $ref: "#/components/schemas/PeerId" },
							},
						],
						responses: {
							"200": {
								description: "Peer disconnected",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																message: {
																	type: "string",
																	example: "Disconnected from peer",
																},
																peerId: { $ref: "#/components/schemas/PeerId" },
															},
														},
													},
												},
											],
										},
									},
								},
							},
							"500": { $ref: "#/components/responses/ErrorResponse" },
						},
					},
				},
				"/api/messages/send": {
					post: {
						summary: "Send a message",
						description:
							"Send a message to a peer. The message will be encrypted if the recipient's public key is available.",
						operationId: "sendMessage",
						tags: ["Messages"],
						requestBody: {
							required: true,
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["payload"],
										properties: {
											targetId: {
												$ref: "#/components/schemas/PeerId",
												description: "Target peer ID (alternative: 'to')",
											},
											to: {
												$ref: "#/components/schemas/PeerId",
												description: "Target peer ID (alternative: 'targetId')",
											},
											payload: {
												type: "object",
												description: "Message payload to send",
											},
										},
									},
								},
							},
						},
						responses: {
							"200": {
								description: "Message sent successfully",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																message: { type: "string" },
																messageId: { type: "string", format: "uuid" },
																targetId: {
																	$ref: "#/components/schemas/PeerId",
																},
																queued: { type: "boolean" },
																timestamp: { type: "integer" },
															},
														},
													},
												},
											],
										},
									},
								},
							},
							"202": {
								description: "Message queued for retry",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																message: { type: "string" },
																messageId: { type: "string", format: "uuid" },
																targetId: {
																	$ref: "#/components/schemas/PeerId",
																},
																queued: { type: "boolean", example: true },
																details: { type: "string" },
																timestamp: { type: "integer" },
															},
														},
													},
												},
											],
										},
									},
								},
							},
							"400": { $ref: "#/components/responses/ErrorResponse" },
						},
					},
				},
				"/api/messages/inbox": {
					get: {
						summary: "Get inbox messages",
						description:
							"Retrieve received messages from the local message store",
						operationId: "getInboxMessages",
						tags: ["Messages"],
						responses: {
							"200": {
								description: "List of received messages",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																inbox: {
																	type: "array",
																	items: {
																		$ref: "#/components/schemas/InboxEntry",
																	},
																},
															},
														},
													},
												},
											],
										},
									},
								},
							},
						},
					},
				},
				"/api/messages/outbox": {
					get: {
						summary: "Get outbox messages",
						description:
							"Retrieve sent messages and their delivery status from the local message store",
						operationId: "getOutboxMessages",
						tags: ["Messages"],
						responses: {
							"200": {
								description: "List of sent messages",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																outbox: {
																	type: "array",
																	items: {
																		$ref: "#/components/schemas/OutboxEntry",
																	},
																},
															},
														},
													},
												},
											],
										},
									},
								},
							},
						},
					},
				},
				"/api/database/contacts": {
					get: {
						summary: "List contacts",
						description: "Retrieve all stored contacts",
						operationId: "getContacts",
						tags: ["Contacts"],
						responses: {
							"200": {
								description: "List of contacts",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																contacts: {
																	type: "array",
																	items: {
																		$ref: "#/components/schemas/Contact",
																	},
																},
															},
														},
													},
												},
											],
										},
									},
								},
							},
						},
					},
					post: {
						summary: "Add or update a contact",
						description:
							"Add a new contact or update an existing one. Supports storing metadata and routing information.",
						operationId: "addOrUpdateContact",
						tags: ["Contacts"],
						requestBody: {
							required: true,
							content: {
								"application/json": {
									schema: {
										type: "object",
										required: ["peerId"],
										properties: {
											peerId: { $ref: "#/components/schemas/PeerId" },
											alias: {
												type: "string",
												description: "Human-readable alias for the contact",
											},
											metadata: {
												type: "object",
												description: "Additional metadata as key-value pairs",
											},
											isTrusted: {
												type: "boolean",
												description: "Mark contact as trusted",
											},
											publicKey: {
												type: "string",
												description:
													"Peer's public key in hex format (for encryption)",
											},
											multiaddrs: {
												type: "array",
												items: { type: "string" },
												description: "Known multiaddrs for routing",
											},
										},
									},
								},
							},
						},
						responses: {
							"200": {
								description: "Contact saved successfully",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																message: { type: "string" },
																contact: {
																	$ref: "#/components/schemas/Contact",
																},
															},
														},
													},
												},
											],
										},
									},
								},
							},
							"400": { $ref: "#/components/responses/ErrorResponse" },
							"500": { $ref: "#/components/responses/ErrorResponse" },
						},
					},
				},
				"/api/database/contacts/{peerId}": {
					get: {
						summary: "Get contact details",
						description: "Retrieve details for a specific contact",
						operationId: "getContactDetails",
						tags: ["Contacts"],
						parameters: [
							{
								name: "peerId",
								in: "path",
								required: true,
								schema: { $ref: "#/components/schemas/PeerId" },
							},
						],
						responses: {
							"200": {
								description: "Contact details",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: { $ref: "#/components/schemas/Contact" },
													},
												},
											],
										},
									},
								},
							},
							"404": { $ref: "#/components/responses/ErrorResponse" },
						},
					},
					delete: {
						summary: "Remove a contact",
						description: "Delete a contact from the database",
						operationId: "removeContact",
						tags: ["Contacts"],
						parameters: [
							{
								name: "peerId",
								in: "path",
								required: true,
								schema: { $ref: "#/components/schemas/PeerId" },
							},
						],
						responses: {
							"200": {
								description: "Contact removed",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																message: { type: "string" },
																peerId: { $ref: "#/components/schemas/PeerId" },
															},
														},
													},
												},
											],
										},
									},
								},
							},
						},
					},
				},
				"/api/database/messages": {
					get: {
						summary: "List message queue entries",
						description: "Retrieve messages from the outgoing message queue",
						operationId: "getMessageQueueEntries",
						tags: ["Database"],
						responses: {
							"200": {
								description: "List of message queue entries",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																messages: { type: "array" },
															},
														},
													},
												},
											],
										},
									},
								},
							},
						},
					},
				},
				"/api/database/routing": {
					get: {
						summary: "List routing cache entries",
						description: "Retrieve cached routing information",
						operationId: "getRoutingCacheEntries",
						tags: ["Database"],
						responses: {
							"200": {
								description: "List of routing cache entries",
								content: {
									"application/json": {
										schema: {
											allOf: [
												{ $ref: "#/components/schemas/ApiResponse" },
												{
													properties: {
														data: {
															type: "object",
															properties: {
																entries: { type: "array" },
															},
														},
													},
												},
											],
										},
									},
								},
							},
						},
					},
				},
			},
			tags: [
				{ name: "Health", description: "Health check endpoints" },
				{
					name: "Node",
					description: "Node information and management",
				},
				{ name: "Peers", description: "Peer connection management" },
				{
					name: "Messages",
					description: "Sending and receiving messages",
				},
				{
					name: "Contacts",
					description: "Contact management (peers database)",
				},
				{
					name: "Database",
					description: "Direct database access for messages and routing",
				},
			],
		};
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
				return this.fail(403, "Forbidden");
			// Start shutdown process asynchronously after sending response
			setImmediate(async () => {
				try {
					// Stop API module first
					await this.stop();
					// Stop the YapYap node (libp2p, message router, database)
					await this.yapyapNode.stop();
					// Exit process
					process.exit(0);
				} catch (error) {
					console.error("Error during stop:", error);
					process.exit(1);
				}
			});
			return this.ok({ message: "Node shutdown initiated" });
		}
		return this.fail(404, "Endpoint not found");
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
		return this.fail(404, "Endpoint not found");
	}

	private async handleMessageRequest(
		request: Request,
		path: string,
		method: string,
	): Promise<Response> {
		if (method === "POST" && path === "/api/messages/send") {
			const body = await this.parseJsonBody(request);
			if (!body) {
				return this.fail(400, "Invalid JSON body");
			}
			return this.sendMessage(body);
		} else if (method === "GET") {
			if (path === "/api/messages/inbox") return this.getInboxMessages();
			if (path === "/api/messages/outbox") return this.getOutboxMessages();
			const messageId = this.getPathParam(path, 2);
			if (messageId) return this.getMessageDetails(messageId);
		}
		return this.fail(404, "Endpoint not found");
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
				return this.fail(400, "Invalid JSON body");
			}
			return this.addOrUpdateContact(body);
		} else if (
			method === "DELETE" &&
			path.includes("/api/database/contacts/")
		) {
			const peerId = this.getPathParam(path, 3);
			if (peerId) return this.removeContact(peerId);
		}
		return this.fail(404, "Endpoint not found");
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

		// Get bootstrap configuration and check health
		const bootstrapAddrs = this.yapyapNode.getBootstrapAddrs();
		const connectedPeerIds = new Set(
			connections.map((c) => c.remotePeer.toString()),
		);

		// Check how many bootstrap peers are connected
		let bootstrapConnected = 0;
		for (const addr of bootstrapAddrs) {
			try {
				const { multiaddr } = await import("@multiformats/multiaddr");
				const ma = multiaddr(addr);
				// Extract peer ID from multiaddr by parsing the path
				// Multiaddr format: /ip4/1.2.3.4/tcp/4001/p2p/<peer-id>
				const parts = ma.toString().split("/");
				const p2pIndex = parts.indexOf("p2p");
				if (p2pIndex !== -1 && parts[p2pIndex + 1]) {
					const peerIdFromAddr = parts[p2pIndex + 1];
					if (connectedPeerIds.has(peerIdFromAddr)) {
						bootstrapConnected++;
					}
				}
			} catch {
				// Ignore invalid addresses
			}
		}

		return this.ok({
			peerId,
			connectedPeersCount,
			inboundPeersCount,
			routingMetrics: {},
			uptime: process.uptime(),
			bootstrap: {
				configured: bootstrapAddrs,
				connected: bootstrapConnected,
				total: bootstrapAddrs.length,
				healthy: bootstrapAddrs.length === 0 || bootstrapConnected > 0,
			},
		});
	}

	private async getNodeStats(): Promise<Response> {
		const libp2p = this.yapyapNode.getLibp2p();
		const connections = libp2p ? libp2p.getConnections() : [];
		return this.ok({
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
		return this.ok(config);
	}

	private async getPeers(): Promise<Response> {
		const libp2p = this.yapyapNode.getLibp2p();
		const connections = libp2p ? libp2p.getConnections() : [];
		const peers = connections.map((c) => ({
			peerId: c.remotePeer.toString(),
			lastSeen: Date.now(),
			isAvailable: true,
		}));
		return this.ok(peers);
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

		return this.ok({
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
			return this.ok({ message: "Dial request sent", peerId });
		} catch (error) {
			return this.fail(
				500,
				"Failed to dial",
				error instanceof Error ? error.message : String(error),
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
			return this.ok({ message: "Disconnected from peer", peerId });
		} catch (error) {
			return this.fail(
				500,
				"Failed to disconnect peer",
				error instanceof Error ? error.message : String(error),
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
			return this.fail(400, "Missing targetId/to or payload");
		}

		try {
			const { peerIdFromString } = await import("@libp2p/peer-id");
			peerIdFromString(targetId);
		} catch {
			return this.fail(400, "Invalid target peerId");
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
			return this.ok({
				message: "Message sent successfully",
				messageId: message.id,
				targetId,
				queued: false,
				timestamp: Date.now(),
			});
		} catch (error) {
			// Router persists first; transport failures should not look like request failures.
			return this.ok(
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
			.getRecentProcessedMessages(200)
			.filter(
				(entry: unknown) =>
					(entry as { to_peer_id: string }).to_peer_id === selfPeerId,
			)
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
					messageId: (entry as { message_id: string }).message_id,
					fromPeerId: (entry as { from_peer_id: string }).from_peer_id,
					processedAt: (entry as { processed_at: number }).processed_at,
					message,
				};
			});
		return this.ok({ inbox });
	}

	private async getOutboxMessages(): Promise<Response> {
		const selfPeerId = this.yapyapNode.getPeerId();
		const outbox = this.yapyapNode
			.getDatabase()
			.getRecentPendingMessages(200)
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
					messageId: (entry as { message_id: string }).message_id,
					targetPeerId: (entry as { target_peer_id: string }).target_peer_id,
					status: (entry as { status: string }).status,
					attempts: (entry as { attempts: number }).attempts,
					createdAt: (entry as { created_at: number }).created_at,
					nextRetryAt: (entry as { next_retry_at: number }).next_retry_at,
					message,
				};
			})
			.filter(
				(entry: unknown) =>
					(entry as { message?: YapYapMessage }).message?.from === selfPeerId,
			);
		return this.ok({ outbox });
	}

	private async getMessageDetails(_messageId: string): Promise<Response> {
		return this.fail(404, "Message not found");
	}

	private async getContacts(): Promise<Response> {
		const contacts = this.yapyapNode.getDatabase().getAllContacts();
		return this.ok({ contacts });
	}

	private async getContactDetails(_peerId: string): Promise<Response> {
		const contact = this.yapyapNode.getDatabase().getContact(_peerId);
		if (!contact) {
			return this.fail(404, "Contact not found");
		}
		return this.ok(contact);
	}

	private async addOrUpdateContact(body: JsonObject): Promise<Response> {
		try {
			const peerId = typeof body.peerId === "string" ? body.peerId : undefined;
			if (!peerId) {
				return this.fail(400, "Missing peerId");
			}

			const alias = typeof body.alias === "string" ? body.alias : "";
			const metadataObj = isJsonObject(body.metadata) ? body.metadata : {};
			const isTrusted = body.isTrusted === true;
			const publicKey =
				typeof body.publicKey === "string" ? body.publicKey : undefined;
			const multiaddrs = Array.isArray(body.multiaddrs)
				? body.multiaddrs.filter((addr) => typeof addr === "string")
				: [];

			const metadata = JSON.stringify(metadataObj);
			const contact = {
				peer_id: peerId,
				alias,
				last_seen: Date.now(),
				metadata,
				is_trusted: isTrusted,
			};
			this.yapyapNode.getDatabase().saveContactLww(contact);

			if (publicKey) {
				this.yapyapNode
					.getDatabase()
					.savePeerMetadata(peerId, "public_key", publicKey);
			}

			if (multiaddrs.length > 0) {
				this.yapyapNode.getDatabase().saveRoutingEntryLww({
					peer_id: peerId,
					multiaddrs,
					last_seen: Date.now(),
					is_available: true,
					ttl: 60 * 60 * 1000,
				});
			}

			return this.ok({
				message: "Contact saved successfully",
				contact,
			});
		} catch (error) {
			return this.fail(
				500,
				"Failed to save contact",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	private async removeContact(peerId: string): Promise<Response> {
		this.yapyapNode.getDatabase().deleteContact(peerId);
		return this.ok({
			message: "Contact removed successfully",
			peerId,
		});
	}

	private async getMessageQueueEntries(): Promise<Response> {
		return this.ok({ messages: [] });
	}

	private async getRoutingCacheEntries(): Promise<Response> {
		return this.ok({ entries: [] });
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
