import assert from "node:assert";
import { describe, test } from "node:test";
import { createTemporaryStorage } from "./utils.js";

function safeSearch(storage: ReturnType<typeof createTemporaryStorage>["storage"], query: string) {
	try {
		return storage.search.searchContacts(query);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Search "${query}" failed: ${message}`);
	}
}

describe("Contract - Storage Search Index", () => {
	test("Given contacts updated, When search queries run, Then alias and metadata changes are reflected", async () => {
		const { storage, cleanup } = createTemporaryStorage();
		try {
			storage.contacts.saveContact({
				peer_id: "peer-search-idx",
				alias: "initialalias",
				metadata: "tester",
				is_trusted: false,
			});
			assert.strictEqual(
				safeSearch(storage, "initialalias").length,
				1,
				"Initial alias should be searchable",
			);
			storage.contacts.saveContact({
				peer_id: "peer-search-idx",
				alias: "updatedalias",
				metadata: "writer",
				is_trusted: false,
			});
			assert.strictEqual(
				safeSearch(storage, "initialalias").length,
				0,
				"Old alias should no longer be returned",
			);
			assert.strictEqual(
				safeSearch(storage, "updatedalias").length,
				1,
				"Updated alias should be searchable",
			);
			assert.strictEqual(
				safeSearch(storage, "tester").length,
				0,
				"Previous metadata should drop out of the index",
			);
			assert.strictEqual(
				safeSearch(storage, "writer").length,
				1,
				"New metadata should appear in the index",
			);
		} finally {
			await cleanup();
		}
	});

	test("Given contact deletion, When search queries run, Then no results remain", async () => {
		const { storage, cleanup } = createTemporaryStorage();
		try {
			storage.contacts.saveContact({
				peer_id: "peer-to-delete",
				alias: "todelete",
				metadata: "deletable",
				is_trusted: false,
			});
			assert.strictEqual(
				safeSearch(storage, "todelete").length,
				1,
				"Contact should appear in search results",
			);
			storage.manager.deleteContact("peer-to-delete");
			assert.strictEqual(
				safeSearch(storage, "todelete").length,
				0,
				"Deleted contact should be removed from the index",
			);
		} finally {
			await cleanup();
		}
	});
});
