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
import { peerIdFromPrivateKey } from "@libp2p/peer-id";
import { ping } from "@libp2p/ping";
import { tcp } from "@libp2p/tcp";
import { webSockets } from "@libp2p/websockets";
import { multiaddr } from "@multiformats/multiaddr";
import { Command } from "commander";
import { createLibp2p } from "libp2p";
import pino from "pino";
import { ApiModule } from "../api/index.js";
import { getBootstrapAddrs } from "../config/index.js";
import { YapYapNode } from "../core/node.js";
import { DatabaseManager } from "../database/index.js";
import type { YapYapMessage } from "../message/message.js";

const DEFAULT_DATA_DIR = join(process.cwd(), "data");

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

	const envAddrs = getBootstrapAddrs(process.env.YAPYAP_BOOTSTRAP_ADDRS);
	if (envAddrs.length > 0) {
		return {
			addrs: envAddrs,
			source: process.env.YAPYAP_BOOTSTRAP_ADDRS ? "env" : "default",
		};
	}

	return { addrs: [], source: "none" };
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

/**
 * Makes an API request with retry logic for handling node startup delays.
 * Retries on connection errors and 503 Service Unavailable responses.
 */
async function apiRequest<T>(
	options: { apiUrl?: string; apiPort?: string; verbose?: boolean },
	path: string,
	method: "GET" | "POST" | "DELETE" = "GET",
	body?: Record<string, unknown>,
	retryConfig: { maxRetries?: number; retryDelayMs?: number } = {},
): Promise<ApiResponse<T>> {
	const { maxRetries = 3, retryDelayMs = 500 } = retryConfig;
	const baseUrl = resolveApiBaseUrl(options);
	const url = `${baseUrl}${path}`;
	const verbose = options.verbose === true;

	if (verbose) {
		console.error(`[verbose] API request: ${method} ${url}`);
	}

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		if (verbose) {
			console.error(`[verbose] Attempt ${attempt + 1}/${maxRetries + 1}`);
		}

		try {
			const startTime = Date.now();
			const response = await fetch(url, {
				method,
				headers: body ? { "Content-Type": "application/json" } : undefined,
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(5000), // 5 second timeout per request
			});
			const duration = Date.now() - startTime;

			if (verbose) {
				console.error(`[verbose] Response: ${response.status} (${duration}ms)`);
			}

			// Handle 503 Service Unavailable - node is still starting
			if (response.status === 503) {
				lastError = new Error(
					"Node is still starting (503 Service Unavailable)",
				);
				if (attempt < maxRetries) {
					const delay = retryDelayMs * (attempt + 1);
					if (verbose) {
						console.error(
							`[verbose] Node starting up, retrying in ${delay}ms...`,
						);
					}
					await sleep(delay);
					continue;
				}
				return {
					success: false,
					error: {
						message:
							"Node is still starting. Please wait a few seconds and try again.",
						details: { status: response.status, url },
					},
				};
			}

			let payload: ApiResponse<T> | null = null;
			const contentType = response.headers.get("content-type");

			// Check if response is JSON before parsing
			if (contentType?.includes("application/json")) {
				try {
					const rawPayload = await response.json();
					payload = rawPayload as ApiResponse<T>;
					if (verbose) {
						console.error(
							`[verbose] Response payload: ${JSON.stringify(payload).slice(0, 200)}...`,
						);
					}
				} catch (parseError) {
					// Response was JSON content-type but failed to parse
					return {
						success: false,
						error: {
							message: "Invalid JSON response from node API",
							details: {
								status: response.status,
								url,
								parseError:
									parseError instanceof Error
										? parseError.message
										: String(parseError),
							},
						},
					};
				}
			} else {
				// Non-JSON response (likely HTML error page or empty)
				const textBody = await response.text().catch(() => "");
				if (verbose) {
					console.error(
						`[verbose] Non-JSON response (${contentType}): ${textBody.slice(0, 100)}`,
					);
				}
				return {
					success: false,
					error: {
						message: `Unexpected API response format (status ${response.status})`,
						details: {
							status: response.status,
							url,
							contentType: contentType ?? "unknown",
							bodyPreview: textBody.slice(0, 200),
						},
					},
				};
			}

			// Payload is null after successful JSON parse - malformed API response
			if (!payload) {
				return {
					success: false,
					error: {
						message: "Empty response from node API",
						details: { status: response.status, url },
					},
				};
			}

			return payload;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			if (verbose) {
				console.error(`[verbose] Request error: ${lastError.message}`);
			}

			// Check if it's a connection error (node not running yet)
			const isConnectionError =
				lastError.name === "TypeError" &&
				(lastError.message.includes("fetch failed") ||
					lastError.message.includes("ECONNREFUSED") ||
					lastError.message.includes("ENOTFOUND"));

			const isTimeoutError =
				lastError.name === "TimeoutError" ||
				lastError.message.includes("timed out");

			// Retry on connection errors or timeouts
			if ((isConnectionError || isTimeoutError) && attempt < maxRetries) {
				const delay = retryDelayMs * (attempt + 1);
				if (verbose) {
					console.error(
						`[verbose] Connection error/timeout, retrying in ${delay}ms...`,
					);
				}
				await sleep(delay);
				continue;
			}

			// Non-retryable error or max retries reached
			if (verbose) {
				console.error(`[verbose] Max retries reached or non-retryable error`);
			}
			break;
		}
	}

	// All retries exhausted or non-retryable error
	const errorMessage = lastError?.message ?? "Unknown error occurred";
	const isConnectionError =
		errorMessage.includes("ECONNREFUSED") ||
		errorMessage.includes("fetch failed");

	return {
		success: false,
		error: {
			message: isConnectionError
				? "Cannot connect to YapYap node. Is it running? Try: yapyap start"
				: `API request failed: ${errorMessage}`,
			details: {
				url,
				attempts: maxRetries + 1,
				error: lastError?.name ?? "Unknown",
			},
		},
	};
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks if the node API is healthy and ready to accept requests.
 * Polls the /health endpoint with retry logic.
 */
async function waitForNodeHealth(
	options: { apiUrl?: string; apiPort?: string; verbose?: boolean },
	timeoutMs: number = 10000,
	pollIntervalMs: number = 500,
): Promise<{ healthy: boolean; error?: string }> {
	const startTime = Date.now();
	const verbose = options.verbose === true;

	if (verbose) {
		console.error(
			`[verbose] Waiting for node to be healthy (timeout: ${timeoutMs}ms)...`,
		);
	}

	let attempts = 0;
	while (Date.now() - startTime < timeoutMs) {
		attempts++;
		const response = await apiRequest<{ status: string; timestamp: number }>(
			options,
			"/health",
			"GET",
			undefined,
			{ maxRetries: 0, retryDelayMs: pollIntervalMs },
		);

		if (response.success && response.data.status === "ok") {
			if (verbose) {
				console.error(
					`[verbose] Node is healthy after ${attempts} attempts (${Date.now() - startTime}ms)`,
				);
			}
			return { healthy: true };
		}

		if (verbose && attempts % 5 === 0) {
			console.error(
				`[verbose] Still waiting for node... (${attempts} attempts, ${Date.now() - startTime}ms elapsed)`,
			);
		}

		await sleep(pollIntervalMs);
	}

	return {
		healthy: false,
		error: `Node did not become healthy within ${timeoutMs}ms`,
	};
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

/**
 * Prints user-friendly error messages for API failures.
 * Translates technical error details into actionable user guidance.
 */
function printApiError(resp: ApiResponse<unknown>): void {
	if (resp.success) return;

	const error = resp.error;
	const details = error.details as Record<string, unknown> | undefined;

	// Provide user-friendly messages based on error type
	let userMessage = error.message;
	let troubleshooting: string[] = [];

	// Connection errors
	if (error.message.includes("Cannot connect to YapYap node")) {
		userMessage = "Cannot connect to the YapYap node";
		troubleshooting = [
			"Make sure the node is running: yapyap start",
			"Check if the API port is correct (default: 3000)",
			"Use --api-port to specify a custom port if needed",
		];
	}

	// Node still starting
	if (error.message.includes("still starting")) {
		userMessage =
			"The node is still starting up. Please wait a moment and try again.";
		troubleshooting = [
			"Wait 5-10 seconds for the node to fully initialize",
			"Check node status with: yapyap status",
		];
	}

	// Timeout errors
	if (error.message.includes("timed out")) {
		userMessage = "Request timed out. The node may be busy or unreachable.";
		troubleshooting = [
			"Try again in a few seconds",
			"Check if your node is running: yapyap status",
		];
	}

	// Invalid JSON
	if (error.message.includes("Invalid JSON")) {
		userMessage = "Received an unexpected response from the node";
		troubleshooting = [
			"Try restarting the node: yapyap start",
			"If the problem persists, check the node logs: yapyap logs",
		];
	}

	// 404 errors
	if (details?.status === 404) {
		userMessage =
			"API endpoint not found. The node may be running an incompatible version.";
		troubleshooting = [
			"Check your YapYap version: yapyap version",
			"Try restarting with the latest version",
		];
	}

	// 500 errors
	if (details?.status === 500) {
		userMessage = "Internal node error. Check the node logs for details.";
		troubleshooting = [
			"View node logs: yapyap logs --tail 100",
			"Try restarting the node if the problem persists",
		];
	}

	console.error(`Error: ${userMessage}`);

	if (troubleshooting.length > 0) {
		console.error("\nTroubleshooting:");
		for (const tip of troubleshooting) {
			console.error(`  • ${tip}`);
		}
	}

	// Show technical details only if available and not already covered
	if (
		details &&
		Object.keys(details).length > 0 &&
		!userMessage.includes("technical")
	) {
		const { status, url, ...otherDetails } = details;
		if (status || url) {
			const techDetails: string[] = [];
			if (status) techDetails.push(`Status: ${status}`);
			if (url) techDetails.push(`URL: ${url}`);
			if (techDetails.length > 0) {
				console.error(`\nTechnical details: ${techDetails.join(" | ")}`);
			}
		}
		if (otherDetails && Object.keys(otherDetails).length > 0) {
			console.error(`Details: ${JSON.stringify(otherDetails)}`);
		}
	}
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

type PeerIdKeyArg = Parameters<typeof peerIdFromPrivateKey>[0];

async function getPeerIdFromPrivateKey(key: PrivateKey): Promise<string> {
	const peerId = await peerIdFromPrivateKey(key as unknown as PeerIdKeyArg);
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
	.option("--no-wait", "Skip waiting for node to be healthy")
	.option("--verbose", "Enable verbose output for debugging")
	.action(async (options) => {
		const logger = createLogger();

		// Wait for node to be healthy before querying
		if (!options.noWait) {
			const health = await waitForNodeHealth(
				{
					apiUrl: options.apiUrl,
					apiPort: options.apiPort,
					verbose: options.verbose,
				},
				10000,
			);
			if (!health.healthy) {
				logger.error(`Node is not ready: ${health.error}`);
				logger.info("Make sure the node is running: yapyap start");
				process.exit(1);
			}
		}

		try {
			const response = await apiRequest<{ contacts: unknown[] }>(
				{
					apiUrl: options.apiUrl,
					apiPort: options.apiPort,
					verbose: options.verbose,
				},
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
	.option("--no-wait", "Skip waiting for node to be healthy")
	.option("--verbose", "Enable verbose output for debugging")
	.action(async (options) => {
		const logger = createLogger();

		// Wait for node to be healthy before querying
		if (!options.noWait) {
			const health = await waitForNodeHealth(
				{
					apiUrl: options.apiUrl,
					apiPort: options.apiPort,
					verbose: options.verbose,
				},
				10000,
			);
			if (!health.healthy) {
				logger.error(`Node is not ready: ${health.error}`);
				logger.info("Make sure the node is running: yapyap start");
				process.exit(1);
			}
		}

		try {
			const response = await apiRequest<{ inbox: unknown[] }>(
				{
					apiUrl: options.apiUrl,
					apiPort: options.apiPort,
					verbose: options.verbose,
				},
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
	.option("--no-wait", "Skip waiting for node to be healthy")
	.option("--verbose", "Enable verbose output for debugging")
	.action(async (options) => {
		const logger = createLogger();

		// Wait for node to be healthy before querying
		if (!options.noWait) {
			const health = await waitForNodeHealth(
				{
					apiUrl: options.apiUrl,
					apiPort: options.apiPort,
					verbose: options.verbose,
				},
				10000,
			);
			if (!health.healthy) {
				logger.error(`Node is not ready: ${health.error}`);
				logger.info("Make sure the node is running: yapyap start");
				process.exit(1);
			}
		}

		const apiOptions = {
			apiUrl: options.apiUrl,
			apiPort: options.apiPort,
			verbose: options.verbose,
		};
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
	.option("--no-wait", "Skip waiting for node to be healthy")
	.option("--verbose", "Enable verbose output for debugging")
	.action(async (options) => {
		const logger = createLogger();

		// Wait for node to be healthy before querying (unless using --no-wait)
		if (!options.noWait && !options.discover && !options.dial) {
			const health = await waitForNodeHealth(
				{
					apiUrl: options.apiUrl,
					apiPort: options.apiPort,
					verbose: options.verbose,
				},
				10000,
			);
			if (!health.healthy) {
				logger.error(`Node is not ready: ${health.error}`);
				logger.info("Make sure the node is running: yapyap start");
				process.exit(1);
			}
		}

		try {
			const apiOptions = {
				apiUrl: options.apiUrl,
				apiPort: options.apiPort,
				verbose: options.verbose,
			};

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
