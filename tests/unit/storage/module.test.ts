import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { StorageModule } from "../../../src/storage/StorageModule";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils";

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
		expect(storage.contacts).toBeDefined();
		expect(storage.messages).toBeDefined();
		expect(storage.routing).toBeDefined();
		expect(storage.sessions).toBeDefined();
		expect(storage.keys).toBeDefined();
		expect(storage.metadata).toBeDefined();
		expect(storage.search).toBeDefined();
		expect(storage.manager).toBeDefined();
	});

	test("persists and retrieves records across core domains", () => {
		const keyId = storage.keys.saveNodeKey("pub-1", "priv-1");
		expect(keyId).toBeGreaterThan(0);
		expect(storage.keys.getNodeKey("pub-1")?.private_key).toBe("priv-1");

		storage.contacts.saveContact({
			peer_id: "peer-a",
			alias: "Alice",
			metadata: "{}",
			is_trusted: true,
		});
		expect(storage.contacts.getContact("peer-a")?.alias).toBe("Alice");

		storage.routing.saveRoutingEntry({
			peer_id: "peer-a",
			multiaddrs: ["/ip4/127.0.0.1/tcp/9000"],
			is_available: true,
			ttl: 60_000,
		});
		expect(storage.routing.getRoutingEntry("peer-a")?.multiaddrs).toEqual([
			"/ip4/127.0.0.1/tcp/9000",
		]);

		const messageId = storage.messages.queueMessage(
			{ id: "m1", payload: { text: "hello" } },
			"peer-a",
			60_000,
		);
		expect(storage.messages.getMessageQueueEntry(messageId)?.status).toBe(
			"pending",
		);

		storage.messages.updateMessageStatus(messageId, "delivered");
		expect(storage.messages.getMessageQueueEntry(messageId)?.status).toBe(
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
		expect(storage.sessions.getSession("sess-1")?.is_active).toBe(true);

		storage.metadata.savePeerMetadata("peer-a", "public_key", "abcd");
		expect(storage.metadata.getPeerMetadata("peer-a", "public_key")).toBe(
			"abcd",
		);
	});
});
