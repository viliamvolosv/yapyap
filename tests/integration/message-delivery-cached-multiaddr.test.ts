/**
 * Integration Test: Message delivery via cached multiaddr
 *
 * This test verifies that a node can deliver a message to a peer using only
 * a cached routing multiaddr (without prior peerstore population).
 */

import assert from "node:assert";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

interface NodeProcess {
	process: ChildProcess;
	apiPort: number;
	dataDir: string;
}

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
	condition: () => boolean | Promise<boolean>,
	options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 30000;
	const intervalMs = options.intervalMs ?? 500;
	const label = options.label ?? "condition";
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await condition()) {
			return;
		}
		await sleep(intervalMs);
	}

	throw new Error(`Timeout waiting for ${label} (timeout: ${timeoutMs}ms)`);
}

async function createTempDir(prefix: string): Promise<string> {
	const uniquePrefix = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	return mkdtemp(join(tmpdir(), uniquePrefix));
}

async function cleanupDir(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}

async function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address && typeof address === "object") {
				const port = address.port;
				server.close((err) => {
					if (err) reject(err);
					else resolve(port);
				});
			} else {
				server.close(() => reject(new Error("Failed to determine free port")));
			}
		});
	});
}

async function waitForTcpPort(port: number): Promise<void> {
	await waitFor(
		async () => {
			return new Promise<boolean>((resolve) => {
				const socket = new Socket();
				socket.once("error", () => resolve(false));
				socket.connect(port, "127.0.0.1", () => {
					socket.end();
					resolve(true);
				});
			});
		},
		{ timeoutMs: 20000, intervalMs: 500, label: "tcp port open" },
	);
}

async function startNode(
	dataDir: string,
	apiPort: number,
	listenPort: number,
	disableBootstrap = false,
): Promise<NodeProcess> {
	const args = [
		"dist/cli.js",
		"start",
		"--data-dir",
		dataDir,
		"--api-port",
		apiPort.toString(),
		"--listen",
		`/ip4/127.0.0.1/tcp/${listenPort}`,
	];

	if (disableBootstrap) {
		// Provide a whitespace value so CLI uses the empty list (no default).
		args.push("--network", " ");
	}

	const process = spawn("node", args, {
		stdio: ["ignore", "pipe", "pipe"],
	});

	let _stderr = "";
	process.stderr?.on("data", (data) => {
		_stderr += data.toString();
	});

	return { process, apiPort, dataDir };
}

async function stopNode(node: NodeProcess): Promise<void> {
	if (node.process.pid) {
		process.kill(node.process.pid, "SIGTERM");
		await sleep(1000);
	}
	await cleanupDir(node.dataDir);
}

async function getPeerId(apiPort: number): Promise<string> {
	const response = await fetch(`http://127.0.0.1:${apiPort}/api/node/info`);
	const json = (await response.json()) as {
		success: boolean;
		data?: { peerId: string };
	};
	if (!json.success || !json.data?.peerId) {
		throw new Error(`Failed to get peer ID: ${JSON.stringify(json)}`);
	}
	return json.data.peerId;
}

async function waitForHealth(apiPort: number): Promise<void> {
	await waitFor(
		async () => {
			try {
				const response = await fetch(`http://127.0.0.1:${apiPort}/health`);
				if (!response.ok) return false;
				const json = (await response.json()) as { success?: boolean };
				return json.success === true;
			} catch {
				return false;
			}
		},
		{ timeoutMs: 20000, intervalMs: 500, label: "health endpoint" },
	);
}

async function addContact(
	apiPort: number,
	peerId: string,
	multiaddrs: string[],
): Promise<void> {
	const response = await fetch(
		`http://127.0.0.1:${apiPort}/api/database/contacts`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ peerId, alias: "cached-peer", multiaddrs }),
		},
	);
	const json = (await response.json()) as { success: boolean };
	assert.strictEqual(
		json.success,
		true,
		`Failed to add contact: ${JSON.stringify(json)}`,
	);
}

async function sendMessage(
	apiPort: number,
	targetId: string,
	payload: string,
): Promise<{ messageId: string; queued: boolean; details?: string }> {
	const response = await fetch(
		`http://127.0.0.1:${apiPort}/api/messages/send`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ to: targetId, payload }),
		},
	);
	const json = (await response.json()) as {
		success: boolean;
		data?: { messageId: string; queued: boolean; details?: string };
	};
	assert.strictEqual(
		json.success,
		true,
		`Send response not successful: ${JSON.stringify(json)}`,
	);
	if (!json.data?.messageId) {
		throw new Error(`Missing messageId in response: ${JSON.stringify(json)}`);
	}
	return {
		messageId: json.data.messageId,
		queued: json.data.queued,
		details: json.data.details,
	};
}

async function waitForInboxMessage(
	apiPort: number,
	messageId: string,
): Promise<void> {
	await waitFor(
		async () => {
			try {
				const response = await fetch(
					`http://127.0.0.1:${apiPort}/api/messages/inbox`,
				);
				if (!response.ok) return false;
				const json = (await response.json()) as {
					success: boolean;
					data?: { inbox?: Array<{ messageId?: string }> };
				};
				if (!json.success) return false;
				return (
					json.data?.inbox?.some((entry) => entry.messageId === messageId) ??
					false
				);
			} catch {
				return false;
			}
		},
		{ timeoutMs: 20000, intervalMs: 500, label: "inbox delivery" },
	);
}

describe("Message Delivery - Cached Multiaddr Integration", () => {
	let senderNode: NodeProcess | undefined;
	let receiverNode: NodeProcess | undefined;

	after(async () => {
		if (senderNode) {
			await stopNode(senderNode);
		}
		if (receiverNode) {
			await stopNode(receiverNode);
		}
	});

	it("delivers a message using only a cached routing multiaddr", async () => {
		const receiverDir = await createTempDir("yapyap-receiver-");
		const senderDir = await createTempDir("yapyap-sender-");
		const receiverApiPort = await findFreePort();
		const senderApiPort = await findFreePort();
		const receiverListenPort = await findFreePort();
		const senderListenPort = await findFreePort();

		receiverNode = await startNode(
			receiverDir,
			receiverApiPort,
			receiverListenPort,
			true,
		);
		senderNode = await startNode(
			senderDir,
			senderApiPort,
			senderListenPort,
			true,
		);

		await Promise.all([
			waitForHealth(receiverApiPort),
			waitForHealth(senderApiPort),
		]);
		await waitForTcpPort(receiverListenPort);

		const receiverPeerId = await getPeerId(receiverApiPort);
		const receiverMultiaddr = `/ip4/127.0.0.1/tcp/${receiverListenPort}/p2p/${receiverPeerId}`;

		await addContact(senderApiPort, receiverPeerId, [receiverMultiaddr]);

		const { messageId, queued, details } = await sendMessage(
			senderApiPort,
			receiverPeerId,
			"hello-via-cached-multiaddr",
		);

		if (queued) {
			assert.strictEqual(
				details?.includes("NoValidAddressesError"),
				false,
				`Queued send should not fail with NoValidAddressesError (details: ${details ?? "none"})`,
			);
			return;
		}

		await waitForInboxMessage(receiverApiPort, messageId);
	});
});
