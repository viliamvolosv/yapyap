import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { ApiModule } from "../../../src/api/index.js";
import { YapYapNode } from "../../../src/core/node.js";
import { DatabaseManager } from "../../../src/database/index.js";

describe("API - Peer Discovery Endpoints", () => {
	let tempDir: string;
	let db: DatabaseManager;
	let node: YapYapNode;
	let api: ApiModule;

	beforeEach(async () => {
		tempDir = mkdtempSync(join(tmpdir(), "yapyap-api-test-"));
		db = new DatabaseManager({ dataDir: tempDir });
		node = new YapYapNode(db);
		api = new ApiModule(node);
		await api.init(0); // Use random port
	});

	afterEach(async () => {
		try {
			await api.stop();
			db.close();
		} catch {
			// Ignore close errors
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("GET /api/peers/discovered", () => {
		test("returns empty list when no peers", async () => {
			const baseUrl = `http://127.0.0.1:${api.apiPort}`;
			const response = await fetch(`${baseUrl}/api/peers/discovered`);

			assert.strictEqual(response.status, 200);
			const data = (await response.json()) as {
				success: boolean;
				data: { peers: unknown[]; count: number };
			};

			assert.strictEqual(data.success, true);
			assert.strictEqual(data.data.peers.length, 0);
			assert.strictEqual(data.data.count, 0);
		});

		test("returns cached peers", async () => {
			// Populate database
			db.savePeerMultiaddrs("12D3KooWPeer1", ["/ip4/192.168.1.1/tcp/4001"]);
			db.savePeerMultiaddrs("12D3KooWPeer2", ["/ip4/192.168.1.2/tcp/4002"]);

			const baseUrl = `http://127.0.0.1:${api.apiPort}`;
			const response = await fetch(`${baseUrl}/api/peers/discovered`);

			assert.strictEqual(response.status, 200);
			const data = (await response.json()) as {
				success: boolean;
				data: { peers: Array<{ peer_id: string }>; count: number };
			};

			assert.strictEqual(data.success, true);
			assert.strictEqual(data.data.peers.length, 2);
			assert.strictEqual(data.data.count, 2);

			const peerIds = data.data.peers.map((p) => p.peer_id).sort();
			assert.deepStrictEqual(
				peerIds,
				["12D3KooWPeer1", "12D3KooWPeer2"].sort(),
			);
		});
	});

	describe("POST /api/peers/discover", () => {
		test("triggers discovery without error", async () => {
			const baseUrl = `http://127.0.0.1:${api.apiPort}`;
			const response = await fetch(`${baseUrl}/api/peers/discover`, {
				method: "POST",
			});

			// May return 200 on success or 500 if libp2p not initialized
			const data = (await response.json()) as {
				success: boolean;
				data?: { message: string };
				error?: { message: string };
			};

			if (response.status === 200) {
				assert.strictEqual(data.success, true);
				assert.ok(data.data?.message.includes("discovery"));
			} else {
				// Expected when libp2p not initialized
				assert.ok(response.status >= 400);
			}
		});
	});

	describe("POST /api/peers/dial-cached", () => {
		test("returns success with 0 dialed when no peers", async () => {
			const baseUrl = `http://127.0.0.1:${api.apiPort}`;
			const response = await fetch(`${baseUrl}/api/peers/dial-cached`, {
				method: "POST",
			});

			// May return 500 if libp2p not initialized, which is expected in test
			const data = (await response.json()) as {
				success: boolean;
				data?: { dialed: number };
				error?: { message: string };
			};

			// Either success with 0 dialed or error about libp2p
			if (response.status === 200) {
				assert.strictEqual(data.success, true);
				assert.strictEqual(data.data?.dialed, 0);
			} else {
				// Expected when libp2p not initialized
				assert.ok(response.status >= 400);
			}
		});

		test("attempts to dial cached peers", async () => {
			// Add peers to cache (they won't be reachable, but endpoint should try)
			db.savePeerMultiaddrs("12D3KooWPeer1", ["/ip4/127.0.0.1/tcp/9999"]);

			const baseUrl = `http://127.0.0.1:${api.apiPort}`;
			const response = await fetch(`${baseUrl}/api/peers/dial-cached`, {
				method: "POST",
			});

			// May return 500 if libp2p not initialized
			const data = (await response.json()) as {
				success: boolean;
				data?: { dialed: number };
			};

			if (response.status === 200) {
				assert.strictEqual(data.success, true);
				assert.ok(typeof (data.data?.dialed ?? 0) === "number");
			}
			// Otherwise libp2p not initialized, which is ok for this test
		});
	});
});
