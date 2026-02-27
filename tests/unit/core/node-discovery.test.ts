import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { YapYapNode } from "../../../src/core/node.js";
import { DatabaseManager } from "../../../src/database/index.js";

describe("YapYapNode - Peer Discovery", () => {
	let tempDir: string;
	let db: DatabaseManager;
	let node: YapYapNode;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "yapyap-node-test-"));
		db = new DatabaseManager({ dataDir: tempDir });
		node = new YapYapNode(db);
	});

	afterEach(() => {
		try {
			db.close();
		} catch {
			// Ignore close errors
		}
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("getDiscoveredPeers", () => {
		test("returns empty array when no peers cached", () => {
			const peers = node.getDiscoveredPeers();
			assert.deepStrictEqual(peers, []);
		});

		test("returns cached peers from database", () => {
			// Populate database with test data
			db.savePeerMultiaddrs("12D3KooWPeer1", ["/ip4/192.168.1.1/tcp/4001"]);
			db.savePeerMultiaddrs("12D3KooWPeer2", [
				"/ip4/192.168.1.2/tcp/4002",
				"/ip4/10.0.0.1/tcp/4001",
			]);

			const peers = node.getDiscoveredPeers();
			assert.strictEqual(peers.length, 2);

			const peerIds = peers.map((p) => p.peer_id).sort();
			assert.deepStrictEqual(
				peerIds,
				["12D3KooWPeer1", "12D3KooWPeer2"].sort(),
			);
		});

		test("includes multiaddrs and last_seen", () => {
			const before = Date.now();
			db.savePeerMultiaddrs("12D3KooWPeer1", ["/ip4/192.168.1.1/tcp/4001"]);

			const peers = node.getDiscoveredPeers();
			assert.strictEqual(peers.length, 1);
			assert.deepStrictEqual(peers[0].multiaddrs, [
				"/ip4/192.168.1.1/tcp/4001",
			]);
			assert.ok(peers[0].last_seen >= before);
		});
	});

	describe("getDiscoveredPeerCount", () => {
		test("returns 0 when no peers", () => {
			const count = node.getDiscoveredPeerCount();
			assert.strictEqual(count, 0);
		});

		test("returns count of available peers", () => {
			db.savePeerMultiaddrs("peer1", ["/ip4/192.168.1.1/tcp/4001"]);
			db.savePeerMultiaddrs("peer2", ["/ip4/192.168.1.2/tcp/4001"]);
			db.savePeerMultiaddrs("peer3", ["/ip4/192.168.1.3/tcp/4001"]);
			db.markPeerUnavailable("peer3");

			const count = node.getDiscoveredPeerCount();
			assert.strictEqual(count, 2);
		});
	});

	describe("dialPeer", () => {
		test("returns false when libp2p not initialized", async () => {
			const result = await node.dialPeer("12D3KooWTestPeer");
			assert.strictEqual(result, false);
		});

		test("returns false for invalid peer ID format", async () => {
			// Node is not initialized with libp2p, so should return false
			const result = await node.dialPeer("invalid-peer-id");
			assert.strictEqual(result, false);
		});
	});

	describe("dialCachedPeers", () => {
		test("returns 0 when no cached peers", async () => {
			const dialed = await node.dialCachedPeers();
			assert.strictEqual(dialed, 0);
		});

		test("returns 0 when libp2p not initialized", async () => {
			db.savePeerMultiaddrs("12D3KooWPeer1", ["/ip4/192.168.1.1/tcp/4001"]);

			const dialed = await node.dialCachedPeers();
			assert.strictEqual(dialed, 0);
		});
	});

	describe("triggerPeerDiscovery", () => {
		test("does not throw when libp2p not initialized", async () => {
			// Should not throw, just silently return
			await assert.doesNotReject(async () => {
				await node.triggerPeerDiscovery();
			});
		});
	});
});
