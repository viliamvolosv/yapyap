import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { generateKeyPair } from "@libp2p/crypto/keys";
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
import { APP_VERSION, BUILD_ENV, BUILD_TIME } from "./version.js";

const logger = pino({
	level: process.env.YAPYAP_LOG_LEVEL || "info",
	...(process.env.YAPYAP_PRETTY_LOG === "true" && {
		transport: {
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "HH:MM:ss",
			},
		},
	}),
});

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
	.option(
		"--data-dir <path>",
		"Custom data directory",
		join(process.cwd(), "data"),
	)
	.option("--api-port <number>", "Override API port")
	.option("--network <bootstrap>", "Bootstrap node addresses")
	.option("--listen <multiaddr>", "Libp2p listen multiaddr")
	.option("--verbose", "Enable verbose logging")
	.action(async (options) => {
		try {
			logger.info("Starting YapYap node...");

			const dataDir: string = options.dataDir;

			if (!existsSync(dataDir)) {
				mkdirSync(dataDir, { recursive: true });
				logger.info(`Created data directory: ${dataDir}`);
			}

			const db = new DatabaseManager({ dataDir });

			const privateKey = await generateKeyPair("Ed25519");

			const listenMultiaddr =
				options.listen ||
				process.env.YAPYAP_LISTEN_ADDR ||
				"/ip4/0.0.0.0/tcp/0";
			const bootstrapRaw =
				options.network || process.env.YAPYAP_BOOTSTRAP_ADDRS;
			const bootstrapAddrs = (bootstrapRaw || "")
				.split(",")
				.map((s: string) => s.trim())
				.filter(Boolean);

			const libp2p = await createLibp2p({
				privateKey,
				addresses: { listen: [listenMultiaddr] },
				transports: [tcp(), webSockets()],
				connectionEncrypters: [noise()],
				streamMuxers: [yamux()],
				connectionManager: {
					maxConnections: 1000,
				},
			});

			const node = new YapYapNode(db);
			await node.init(libp2p);

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
			logger.info({ listenMultiaddr, bootstrapAddrs }, "Network config");

			const connectBootstrapPeers = async () => {
				for (const addr of bootstrapAddrs) {
					try {
						await libp2p.dial(multiaddr(addr));
						logger.debug({ addr }, "Bootstrapped peer dialed");
					} catch (error) {
						logger.debug(
							{
								addr,
								error: error instanceof Error ? error.message : String(error),
							},
							"Bootstrap dial failed",
						);
					}
				}
			};

			if (bootstrapAddrs.length > 0) {
				await connectBootstrapPeers();
			}
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
	.option("--encrypted", "Encrypt message (default: true)")
	.option("--alias <name>", "Alias for the contact")
	.action(async (options) => {
		try {
			const dataDir = join(process.cwd(), "data");
			const db = new DatabaseManager({ dataDir });

			const privateKey = await generateKeyPair("Ed25519");

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
				logger.error(`Peer ${options.to} not found or missing public key`);
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
				finalPayload = await node.encryptMessage(payload, publicKey);
			}

			const message: YapYapMessage = {
				id: randomUUID(),
				type: "data",
				from: node.getPeerId(),
				to: options.to,
				payload: finalPayload,
				timestamp: Date.now(),
			};

			await node.messageRouter.send(message);

			logger.info("Message sent successfully");

			await node.shutdown();
			process.exit(0);
		} catch (error) {
			logger.error({
				msg: "Failed to send message",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

/* =======================================================
   GET PEER ID
======================================================= */

program
	.command("get-peer-id")
	.description("Display your node's Peer ID and public key")
	.option(
		"--data-dir <path>",
		"Custom data directory",
		join(process.cwd(), "data"),
	)
	.action(async (options) => {
		try {
			const dataDir: string = options.dataDir;
			const db = new DatabaseManager({ dataDir });

			const nodeKey = db.getCurrentNodeKey();

			if (!nodeKey || !nodeKey.public_key) {
				console.error("No node keys found. Please start the node first.");
				console.error("Run: ./yapyap start");
				process.exit(1);
			}

			// Display Peer ID (libp2p multiaddr-encoded version)
			const peerId = nodeKey.public_key;

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
			console.log(`Peer ID: ${peerId}`);
			console.log();
			console.log(
				"This Peer ID is your permanent identity in the YapYap network.",
			);
			console.log("Share it with others so they can send you messages.");
			console.log();
			console.log("To use this Peer ID:");
			console.log(
				"  - Send messages: ./yapyap send-message --to <peer-id> --payload <text>",
			);
			console.log("  - Add to contacts: POST to /api/database/contacts");
			console.log();
			console.log("To start your node (daemon mode):");
			console.log(`  - ./yapyap start --data-dir ${dataDir}`);
			console.log();

			db.close();
			process.exit(0);
		} catch (error) {
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
		console.log(`Build time: ${BUILD_TIME}`);
		console.log(`Build environment: ${BUILD_ENV}`);
		console.log(`Platform: ${process.platform}-${process.arch}`);
		process.exit(0);
	});

/* =======================================================
   LOGS (Node-safe version — no Bun dependency)
======================================================= */

program
	.command("logs")
	.description("View logs")
	.option("--tail <number>", "Show last N lines", "50")
	.option("--filter <pattern>", "Filter logs by pattern")
	.action(async (options) => {
		try {
			const logFilePath = join(process.cwd(), "data", "yapyap.log");

			const content = readFileSync(logFilePath, "utf-8");
			const lines = content.split("\n");
			const tailLines = lines.slice(-Number(options.tail));

			tailLines.forEach((line) => {
				if (!options.filter || line.includes(options.filter)) {
					logger.info(line);
				}
			});

			process.exit(0);
		} catch (error) {
			logger.error({
				msg: "Failed to view logs",
				error: error instanceof Error ? error.message : String(error),
			});
			process.exit(1);
		}
	});

program.parse(process.argv);
