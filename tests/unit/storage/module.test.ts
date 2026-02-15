import assert from "node:assert";
import { afterEach, beforeEach, describe, test } from "node:test";
import { StorageModule } from "../../../src/storage/StorageModule.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("StorageModule", () => {
	let dataDir: string;
	let storage: StorageModule;

	beforeEach(async () => {
		dataDir = await createTempDir("yapyap-storage");
		storage = new StorageModule({ dataDir });
	});

	afterEach(async () => {
		await storage.close();
		await cleanupTempDir(dataDir);
	});

	test("exposes main domain databases", () => {
		assert.notStrictEqual(storage.contacts, undefined);
		assert.notStrictEqual(storage.messages, undefined);
		assert.notStrictEqual(storage.routing, undefined);
		assert.notStrictEqual(storage.sessions, undefined);
		assert.notStrictEqual(storage.keys, undefined);
		assert.notStrictEqual(storage.metadata, undefined);
		assert.notStrictEqual(storage.search, undefined);
		assert.notStrictEqual(storage.manager, undefined);
	});

	test("persists and retrieves records across core domains", () => {
		const keyId = storage.keys.saveNodeKey("pub-1", "priv-1");
		assert.ok(keyId > 0);
		assert.strictEqual(storage.keys.getNodeKey("pub-1")?.private_key, "priv-1");

		storage.contacts.saveContact({
			peer_id: "peer-a",
			alias: "Alice",
			metadata: "{}",
			is_trusted: true,
		});
		assert.strictEqual(storage.contacts.getContact("peer-a")?.alias, "Alice");

		storage.routing.saveRoutingEntry({
			peer_id: "peer-a",
			multiaddrs: ["/ip4/127.0.0.1/tcp/9000"],
			is_available: true,
			ttl: 60_000,
		});
		assert.deepStrictEqual(
			storage.routing.getRoutingEntry("peer-a")?.multiaddrs,
			["/ip4/127.0.0.1/tcp/9000"],
		);

		const messageId = storage.messages.queueMessage(
			{ id: "m1", payload: { text: "hello" } },
			"peer-a",
			60_000,
		);
		assert.strictEqual(
			storage.messages.getMessageQueueEntry(messageId)?.status,
			"pending",
		);

		storage.messages.updateMessageStatus(messageId, "delivered");
		assert.strictEqual(
			storage.messages.getMessageQueueEntry(messageId)?.status,
			"delivered",
		);

		const expiresAt = Date.now() + 60_000;
		storage.sessions.saveSession({
			id: "sess-1",
			peer_id: "peer-a",
			public_key: "pub",
			private_key: "priv",
			expires_at: expiresAt,
			last_used: Date.now(),
			is_active: true,
		});
		assert.strictEqual(storage.sessions.getSession("sess-1")?.is_active, true);

		storage.metadata.savePeerMetadata("peer-a", "public_key", "abcd");
		assert.strictEqual(
			storage.metadata.getPeerMetadata("peer-a", "public_key"),
			"abcd",
		);
	});
});
