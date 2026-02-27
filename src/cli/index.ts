import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { noise } from "@chainsafe/libp2p-noise";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { yamux } from "@chainsafe/libp2p-yamux";
import { autoNAT } from "@libp2p/autonat";
import { circuitRelayServer } from "@libp2p/circuit-relay-v2";
import { generateKeyPair, privateKeyFromRaw } from "@libp2p/crypto/keys";
import { identify } from "@libp2p/identify";
import type { PrivateKey } from "@libp2p/interface";
import { kadDHT } from "@libp2p/kad-dht";
import { createFromPrivKey } from "@libp2p/peer-id-factory";
import { ping } from "@libp2p/ping";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { multiaddr } from "@multiformats/multiaddr";
import { Command } from "commander";
import { createLibp2p } from "libp2p";
import pino from "pino";
import { ApiModule } from "../api/index.js";
import { YapYapNode } from "../core/node.js";
import { DatabaseManager } from "../database/index.js";
import type { YapYapMessage } from "../message/message.js";

const DEFAULT_DATA_DIR = join(process.cwd(), "data");
const DEFAULT_BOOTSTRAP_ADDRS: string[] = parseBootstrapAddrs(
	process.env.YAPYAP_DEFAULT_BOOTSTRAP_ADDRS,
);

type ApiResponse<T> =
	| { success: true; data: T }
	| { success: false; error: { message: string; details?: unknown } };

function findPackageRoot(startDir: string): string {
	let current = startDir;
	while (true) {
		const candidate = join(current, "package.json");
		if (existsSync(candidate)) return current;
		const parent = dirname(current);
		if (parent === current) return startDir;
		current = parent;
	}
}

function loadPackageVersion(): string {
	const root = findPackageRoot(__dirname);
	try {
		const packageJson = JSON.parse(
			readFileSync(join(root, "package.json"), "utf-8"),
		);
		return typeof packageJson.version === "string"
			? packageJson.version
			: "0.0.0";
	} catch {
		return "0.0.0";
	}
}

const APP_VERSION = loadPackageVersion();

function createLogger(dataDir?: string) {
	const logFilePath = dataDir ? join(dataDir, "yapyap.log") : undefined;
	const pretty = process.env.YAPYAP_PRETTY_LOG === "true";
	const transport = pretty
		? pino.transport({
				target: "pino-pretty",
				options: { colorize: true, translateTime: "HH:MM:ss" },
			})
		: undefined;

	const streams = [{ stream: transport ?? process.stdout }];

	if (logFilePath) {
		streams.push({
			stream: pino.destination({ dest: logFilePath, mkdir: true, sync: false }),
		});
	}

	return pino(
		{ level: process.env.YAPYAP_LOG_LEVEL || "info" },
		pino.multistream(streams),
	);
}

function resolveDataDir(dataDir?: string): string {
	return dataDir || DEFAULT_DATA_DIR;
}

function parseBootstrapAddrs(raw?: string): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function resolveBootstrapAddrs(options: { cliNetwork?: string }): {
	addrs: string[];
	source: string;
} {
	if (options.cliNetwork) {
		return { addrs: parseBootstrapAddrs(options.cliNetwork), source: "cli" };
	}

	const envAddrs = parseBootstrapAddrs(process.env.YAPYAP_BOOTSTRAP_ADDRS);
	if (envAddrs.length > 0) {
		return { addrs: envAddrs, source: "env" };
	}

	return { addrs: DEFAULT_BOOTSTRAP_ADDRS, source: "default" };
}

function resolveApiBaseUrl(options: { apiUrl?: string; apiPort?: string }) {
	if (options.apiUrl) return options.apiUrl.replace(/\/$/, "");
	const port = options.apiPort
		? Number(options.apiPort)
		: process.env.YAPYAP_API_PORT
			? Number(process.env.YAPYAP_API_PORT)
			: 3000;
	return `http://127.0.0.1:${port}`;
}

async function apiRequest<T>(
	options: { apiUrl?: string; apiPort?: string },
	path: string,
	method: "GET" | "POST" | "DELETE" = "GET",
	body?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
	const baseUrl = resolveApiBaseUrl(options);
	const response = await fetch(`${baseUrl}${path}`, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});

	let payload: ApiResponse<T> | null = null;
	try {
		payload = (await response.json()) as ApiResponse<T>;
	} catch {
		payload = null;
	}

	if (!payload) {
		return {
			success: false,
			error: {
				message: `Unexpected API response (status ${response.status})`,
			},
		};
	}

	return payload;
}

function parseJsonArg(value?: string): Record<string, unknown> | undefined {
	if (!value) return undefined;
	try {
		const parsed = JSON.parse(value);
		if (typeof parsed === "object" && parsed !== null) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return undefined;
	}
	return undefined;
}

function printApiError(resp: ApiResponse<unknown>): void {
	if (resp.success) return;
	const details = resp.error.details
		? ` (${JSON.stringify(resp.error.details)})`
		: "";
	console.error(`${resp.error.message}${details}`);
}

async function getOrCreateNodeKey(db: DatabaseManager): Promise<PrivateKey> {
	const existing = db.getCurrentNodeKey();
	if (existing?.private_key) {
		const raw = Buffer.from(existing.private_key, "hex");
		return privateKeyFromRaw(new Uint8Array(raw));
	}

	const generated = await generateKeyPair("Ed25519");
	const publicKeyHex = Buffer.from(generated.publicKey.raw).toString("hex");
	const privateKeyHex = Buffer.from(generated.raw).toString("hex");
	db.saveNodeKey(publicKeyHex, privateKeyHex);
	return generated;
}

type PeerIdKeyArg = Parameters<typeof createFromPrivKey>[0];

async function getPeerIdFromPrivateKey(key: PrivateKey): Promise<string> {
	const peerId = await createFromPrivKey(key as unknown as PeerIdKeyArg);
	return peerId.toString();
}

const program = new Command();

program
	.name("yapyap")
	.description("YapYap Messenger - Decentralized P2P messaging CLI")
	.version(APP_VERSION);

/* =======================================================
   START COMMAND
======================================================= */

program
	.command("start")
	.description("Start the YapYap node")
	.option("--data-dir <path>", "Custom data directory", DEFAULT_DATA_DIR)
	.option("--api-port <number>", "Override API port")
	.option("--network <bootstrap>", "Bootstrap node addresses")
	.option("--listen <multiaddr>", "Libp2p listen multiaddr")
	.option("--verbose", "Enable verbose logging")
	.action(async (options) => {
		try {
			const dataDir: string = resolveDataDir(options.dataDir);
			const logger = createLogger(dataDir);

			if (options.verbose) {
				logger.level = "debug";
			}

			logger.info("Starting YapYap node...");

			if (!existsSync(dataDir)) {
				mkdirSync(dataDir, { recursive: true });
				logger.info(`Created data directory: ${dataDir}`);
			}

			const db = new DatabaseManager({ dataDir });

			const privateKey = await getOrCreateNodeKey(db);

			const listenMultiaddr =
				options.listen ||
				process.env.YAPYAP_LISTEN_ADDR ||
				"/ip4/0.0.0.0/tcp/0";
			const { addrs: bootstrapAddrs, source: bootstrapSource } =
				resolveBootstrapAddrs({
					cliNetwork: options.network,
				});

			const libp2p = await createLibp2p({
				privateKey,
				addresses: { listen: [listenMultiaddr] },
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
				connectionManager: {
					maxConnections: 1000,
				},
			});

			const node = new YapYapNode(db);
			await node.init(libp2p);
			node.setBootstrapAddrs(bootstrapAddrs);

			const publicKeyHex = Buffer.from(privateKey.publicKey.raw).toString(
				"hex",
			);
			const privateKeyHex = Buffer.from(privateKey.raw).toString("hex");
			db.saveNodeKey(publicKeyHex, privateKeyHex);

			const api = new ApiModule(node);
			await api.init(options.apiPort ? Number(options.apiPort) : undefined);

			logger.info("YapYap node started successfully");
			logger.info(`API server running on port ${api.apiPort}`);
			logger.info(`Peer ID: ${node.getPeerId()}`);
			logger.info(
				{ listenMultiaddr, bootstrapAddrs, bootstrapSource },
				"Network config",
			);

			let warnedNoBootstrap = false;
			const connectBootstrapPeers = async () => {
				if (bootstrapAddrs.length === 0) {
					if (!warnedNoBootstrap) {
						logger.warn(
							"No bootstrap peers configured. Use --network or set YAPYAP_BOOTSTRAP_ADDRS.",
						);
						warnedNoBootstrap = true;
					}
					return;
				}
				for (const addr of bootstrapAddrs) {
					try {
						await libp2p.dial(multiaddr(addr));
						logger.info({ addr }, "Bootstrap peer connected");
					} catch (error) {
						logger.warn(
							{
								addr,
								error: error instanceof Error ? error.message : String(error),
							},
							"Bootstrap dial failed",
						);
					}
				}
			};

			await connectBootstrapPeers();
			const bootstrapInterval = setInterval(() => {
				void connectBootstrapPeers();
			}, 5000);

			const shutdown = async () => {
				logger.info("Shutting down YapYap node...");
				clearInterval(bootstrapInterval);
				await api.stop();
				await node.shutdown();
				db.close();
				process.exit(0);
			};

			process.once("SIGINT", () => {
				void shutdown();
			});
			process.once("SIGTERM", () => {
				void shutdown();
			});

			// Keep process alive while node and API are running.
			await new Promise(() => {});
		} catch (error) {
			const logger = createLogger();
			logger.error({
				msg: "Failed to start YapYap node",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

/* =======================================================
   SEND MESSAGE
======================================================= */

program
	.command("send-message")
	.description("Send a message to a peer")
	.requiredOption("--to <peer-id>", "Target peer ID")
	.requiredOption("--payload <string>", "Message content")
	.option("--data-dir <path>", "Custom data directory", DEFAULT_DATA_DIR)
	.option("--encrypted", "Encrypt message (default: true)")
	.option("--alias <name>", "Alias for the contact")
	.action(async (options) => {
		const logger = createLogger();
		try {
			const dataDir = resolveDataDir(options.dataDir);
			const db = new DatabaseManager({ dataDir });

			const privateKey = await getOrCreateNodeKey(db);

			const libp2p = await createLibp2p({
				privateKey,
				addresses: { listen: ["/ip4/0.0.0.0/tcp/0"] },
				transports: [tcp(), webSockets()],
				connectionEncrypters: [noise()],
				streamMuxers: [yamux()],
			});

			const node = new YapYapNode(db);
			await node.init(libp2p);

			const peerKey = await db.getPeerMetadata(options.to, "public_key");

			if (!peerKey || typeof peerKey !== "string") {
				logger.error(
					`Cannot send message: peer ${options.to} not found or missing public key.`,
				);
				logger.info("");
				logger.info("Action required:");
				logger.info(
					`  1. Ask the recipient for their public key (run: yapyap get-peer-id)`,
				);
				logger.info(`  2. Add them as a contact with:`);
				logger.info(
					`     yapyap contact add --peer-id ${options.to} --public-key <hex>`,
				);
				logger.info("");
				logger.info("The public key is needed to encrypt messages end-to-end.");
				await node.shutdown();
				process.exit(1);
			}

			const payload: Record<string, unknown> = {
				content: options.payload,
			};

			const encrypted = options.encrypted !== false;

			let finalPayload: unknown = payload;

			if (encrypted) {
				const publicKey = Buffer.from(peerKey, "hex");
				try {
					finalPayload = await node.encryptMessage(payload, publicKey);
				} catch (encryptError) {
					logger.error(
						"Failed to encrypt message. Check that the public key is valid.",
					);
					logger.error(
						`Encryption error: ${encryptError instanceof Error ? encryptError.message : String(encryptError)}`,
					);
					logger.info("");
					logger.info("To send without encryption, use --encrypted=false");
					await node.shutdown();
					process.exit(1);
				}
			}

			const message: YapYapMessage = {
				id: randomUUID(),
				type: "data",
				from: node.getPeerId(),
				to: options.to,
				payload: finalPayload,
				timestamp: Date.now(),
			};

			try {
				await node.messageRouter.send(message);
				logger.info("Message sent successfully");
				logger.info(`Message ID: ${message.id}`);
				logger.info(`Recipient: ${options.to}`);
				logger.info("");
				logger.info("Tip: The recipient can view the message with:");
				logger.info(`  yapyap receive --api-port <port>`);
			} catch (sendError) {
				logger.warn("Message queued for delivery (recipient may be offline)");
				logger.warn(
					`Queue error: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
				);
				logger.info("");
				logger.info("The message will be retried automatically.");
				logger.info("Check status with: yapyap status");
			}

			await node.shutdown();
			process.exit(0);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			logger.error(`Failed to send message: ${errorMsg}`);
			logger.info("");
			logger.info("Troubleshooting:");
			logger.info("  - Ensure your node is running: yapyap start");
			logger.info("  - Verify the recipient's peer ID is correct");
			logger.info("  - Check network connectivity");
			process.exit(1);
		}
	});

/* =======================================================
   CONTACTS
======================================================= */

const contact = program.command("contact").description("Manage contacts");

contact
	.command("add")
	.description("Add or update a contact")
	.requiredOption("--peer-id <peer-id>", "Target peer ID")
	.option("--alias <name>", "Alias for the contact")
	.option("--public-key <hex>", "Peer public key (hex)")
	.option("--metadata <json>", "Extra metadata JSON")
	.option("--multiaddr <addr...>", "Multiaddr list for routing cache")
	.option("--trusted", "Mark contact as trusted")
	.option("--api-url <url>", "Override API base URL")
	.option("--api-port <number>", "Override API port")
	.action(async (options) => {
		const logger = createLogger();
		try {
			const metadata = parseJsonArg(options.metadata);
			if (options.metadata && !metadata) {
				console.error("Invalid JSON for --metadata");
				process.exit(1);
			}

			const response = await apiRequest<{
				message: string;
				contact: unknown;
			}>(
				{ apiUrl: options.apiUrl, apiPort: options.apiPort },
				"/api/database/contacts",
				"POST",
				{
					peerId: options.peerId,
					alias: options.alias,
					metadata,
					isTrusted: options.trusted === true,
					publicKey: options.publicKey,
					multiaddrs: options.multiaddr,
				},
			);

			if (!response.success) {
				printApiError(response);
				process.exit(1);
			}

			logger.info("Contact saved successfully");
			console.log(JSON.stringify(response.data, null, 2));
		} catch (error) {
			logger.error({
				msg: "Failed to add contact",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

contact
	.command("list")
	.description("List contacts")
	.option("--api-url <url>", "Override API base URL")
	.option("--api-port <number>", "Override API port")
	.action(async (options) => {
		const logger = createLogger();
		try {
			const response = await apiRequest<{ contacts: unknown[] }>(
				{ apiUrl: options.apiUrl, apiPort: options.apiPort },
				"/api/database/contacts",
				"GET",
			);

			if (!response.success) {
				printApiError(response);
				process.exit(1);
			}

			console.log(JSON.stringify(response.data, null, 2));
		} catch (error) {
			logger.error({
				msg: "Failed to list contacts",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

contact
	.command("remove")
	.description("Remove a contact")
	.requiredOption("--peer-id <peer-id>", "Target peer ID")
	.option("--api-url <url>", "Override API base URL")
	.option("--api-port <number>", "Override API port")
	.action(async (options) => {
		const logger = createLogger();
		try {
			const response = await apiRequest<{ message: string; peerId: string }>(
				{ apiUrl: options.apiUrl, apiPort: options.apiPort },
				`/api/database/contacts/${options.peerId}`,
				"DELETE",
			);

			if (!response.success) {
				printApiError(response);
				process.exit(1);
			}

			logger.info("Contact removed");
			console.log(JSON.stringify(response.data, null, 2));
		} catch (error) {
			logger.error({
				msg: "Failed to remove contact",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

/* =======================================================
   RECEIVE / STATUS
======================================================= */

program
	.command("receive")
	.description("Show inbox messages")
	.option("--api-url <url>", "Override API base URL")
	.option("--api-port <number>", "Override API port")
	.action(async (options) => {
		const logger = createLogger();
		try {
			const response = await apiRequest<{ inbox: unknown[] }>(
				{ apiUrl: options.apiUrl, apiPort: options.apiPort },
				"/api/messages/inbox",
				"GET",
			);

			if (!response.success) {
				printApiError(response);
				process.exit(1);
			}

			console.log(JSON.stringify(response.data, null, 2));
		} catch (error) {
			logger.error({
				msg: "Failed to fetch inbox",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

program
	.command("status")
	.description("Show node health and peer connections")
	.option("--api-url <url>", "Override API base URL")
	.option("--api-port <number>", "Override API port")
	.action(async (options) => {
		const logger = createLogger();
		try {
			const apiOptions = { apiUrl: options.apiUrl, apiPort: options.apiPort };
			const info = await apiRequest<unknown>(apiOptions, "/api/node/info");
			const peers = await apiRequest<unknown>(apiOptions, "/api/peers");

			if (!info.success) {
				printApiError(info);
				process.exit(1);
			}

			if (!peers.success) {
				printApiError(peers);
				process.exit(1);
			}

			console.log(
				JSON.stringify(
					{
						node: info.data,
						peers: peers.data,
					},
					null,
					2,
				),
			);
		} catch (error) {
			logger.error({
				msg: "Failed to get status",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

/* =======================================================
   DISCOVERED PEERS
======================================================= */

program
	.command("peers")
	.description("Show discovered/cached peers from database")
	.option("--api-url <url>", "Override API base URL")
	.option("--api-port <number>", "Override API port")
	.option("--discover", "Trigger peer discovery")
	.option("--dial", "Dial all cached peers")
	.action(async (options) => {
		const logger = createLogger();
		try {
			const apiOptions = { apiUrl: options.apiUrl, apiPort: options.apiPort };

			if (options.discover) {
				const resp = await apiRequest<unknown>(
					apiOptions,
					"/api/peers/discover",
					"POST",
				);
				if (!resp.success) {
					printApiError(resp);
					process.exit(1);
				}
				console.log("Peer discovery triggered");
				console.log(JSON.stringify(resp.data, null, 2));
				return;
			}

			if (options.dial) {
				const resp = await apiRequest<unknown>(
					apiOptions,
					"/api/peers/dial-cached",
					"POST",
				);
				if (!resp.success) {
					printApiError(resp);
					process.exit(1);
				}
				console.log(JSON.stringify(resp.data, null, 2));
				return;
			}

			const resp = await apiRequest<unknown>(
				apiOptions,
				"/api/peers/discovered",
			);
			if (!resp.success) {
				printApiError(resp);
				process.exit(1);
			}

			console.log(JSON.stringify(resp.data, null, 2));
		} catch (error) {
			logger.error({
				msg: "Failed to get discovered peers",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

/* =======================================================
   API DOCS
======================================================= */

program
	.command("api-docs")
	.description("Print API documentation URL")
	.option("--api-url <url>", "Override API base URL")
	.option("--api-port <number>", "Override API port")
	.action((options) => {
		const baseUrl = resolveApiBaseUrl(options);
		console.log(`${baseUrl}/api/docs`);
		process.exit(0);
	});

/* =======================================================
   GET PEER ID
======================================================= */

program
	.command("get-peer-id")
	.description("Display your node's Peer ID and public key")
	.option("--data-dir <path>", "Custom data directory", DEFAULT_DATA_DIR)
	.action(async (options) => {
		try {
			const dataDir: string = resolveDataDir(options.dataDir);
			const db = new DatabaseManager({ dataDir });

			const nodeKey = db.getCurrentNodeKey();

			if (!nodeKey || !nodeKey.public_key) {
				console.error("No node keys found. Please start the node first.");
				console.error("Run: ./yapyap start");
				process.exit(1);
			}

			const privateKey = nodeKey.private_key
				? privateKeyFromRaw(
						new Uint8Array(Buffer.from(nodeKey.private_key, "hex")),
					)
				: undefined;
			const peerId = privateKey
				? await getPeerIdFromPrivateKey(privateKey)
				: "";
			const publicKeyHex = nodeKey.public_key;

			console.log(
				"╔══════════════════════════════════════════════════════════╗",
			);
			console.log(
				"║                    YapYap Node Identity                   ║",
			);
			console.log(
				"╚══════════════════════════════════════════════════════════╝",
			);
			console.log();
			console.log(`Peer ID (libp2p): ${peerId || "Unavailable"}`);
			console.log();
			console.log(`Public Key (Ed25519 hex): ${publicKeyHex}`);
			console.log();
			console.log("Share your Peer ID so others can send you messages.");
			console.log();
			console.log("To use this Peer ID:");
			console.log(
				"  - Send messages: ./yapyap send-message --to <peer-id> --payload <text>",
			);
			console.log(
				"  - Add to contacts: ./yapyap contact add --peer-id <peer-id> --public-key <hex>",
			);
			console.log();
			console.log("To start your node (daemon mode):");
			console.log(`  - ./yapyap start --data-dir ${dataDir}`);
			console.log();

			db.close();
			process.exit(0);
		} catch (error) {
			const logger = createLogger();
			logger.error({
				msg: "Failed to get peer ID",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

/* =======================================================
   BUILD INFO
======================================================= */

program
	.command("version")
	.description("Display version information")
	.action(() => {
		console.log(`YapYap Messenger v${APP_VERSION}`);
		console.log(`Platform: ${process.platform}-${process.arch}`);
		process.exit(0);
	});

/* =======================================================
   LOGS (Node-safe version — no Bun dependency)
======================================================= */

program
	.command("logs")
	.description("View logs")
	.option("--data-dir <path>", "Custom data directory", DEFAULT_DATA_DIR)
	.option("--tail <number>", "Show last N lines", "50")
	.option("--filter <pattern>", "Filter logs by pattern")
	.action(async (options) => {
		try {
			const dataDir = resolveDataDir(options.dataDir);
			const logFilePath = join(dataDir, "yapyap.log");

			const content = readFileSync(logFilePath, "utf-8");
			const lines = content.split("\n");
			const tailLines = lines.slice(-Number(options.tail));

			tailLines.forEach((line) => {
				if (!options.filter || line.includes(options.filter)) {
					console.log(line);
				}
			});

			process.exit(0);
		} catch (error) {
			const logger = createLogger();
			logger.error({
				msg: "Failed to view logs",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

program.parse(process.argv);
