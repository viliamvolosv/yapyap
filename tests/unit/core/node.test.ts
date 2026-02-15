import assert from "node:assert";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { Libp2p } from "@libp2p/interface";
import { YapYapNode } from "../../../src/core/node.js";
import { DatabaseManager } from "../../../src/database.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("YapYapNode", () => {
	let dataDir: string;
	let db: DatabaseManager;

	beforeEach(async () => {
		dataDir = await createTempDir("yapyap-node-");
		db = new DatabaseManager({ dataDir });
	});

	afterEach(async () => {
		db.close();
		await cleanupTempDir(dataDir);
	});

	test("exposes core getters", () => {
		const node = new YapYapNode(db);
		assert.strictEqual(node.getDatabase(), db);
		expect(node.getNodeState()).toBeDefined();
		expect(node.getRoutingTable()).toBeDefined();
		assert.strictEqual(node.getPeerId(), "");
	});

	test("registers protocol handlers on init and shuts down cleanly", async () => {
		const node = new YapYapNode(db);
		const handled: string[] = [];

		const libp2pMock = {
			peerId: { toString: () => "12D3KooWNodePeerId12345678901234567890123" },
			handle: (protocol: string) => {
				handled.push(protocol);
			},
			getConnections: () => [],
		};

		await node.init(libp2pMock as unknown as Libp2p);
		expect(node.getPeerId()).toContain("12D3KooW");
		assert.ok(handled.includes("/yapyap/message/1.0.0"));
		assert.ok(handled.includes("/yapyap/handshake/1.0.0"));
		assert.ok(handled.includes("/yapyap/route/1.0.0"));
		assert.ok(handled.includes("/yapyap/sync/1.0.0"));

		await node.shutdown();
	});
});
