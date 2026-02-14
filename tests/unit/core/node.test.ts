import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Libp2p } from "@libp2p/interface";
import { YapYapNode } from "../../../src/core/node";
import { DatabaseManager } from "../../../src/database";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils";

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
		expect(node.getDatabase()).toBe(db);
		expect(node.getNodeState()).toBeDefined();
		expect(node.getRoutingTable()).toBeDefined();
		expect(node.getPeerId()).toBe("");
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
		expect(handled).toContain("/yapyap/message/1.0.0");
		expect(handled).toContain("/yapyap/handshake/1.0.0");
		expect(handled).toContain("/yapyap/route/1.0.0");
		expect(handled).toContain("/yapyap/sync/1.0.0");

		await node.shutdown();
	});
});
