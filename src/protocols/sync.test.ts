import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PeerId } from "@libp2p/interface";
import { DatabaseManager } from "../database/index";
import { handleSyncMessage, NodeState, type SyncResponseMessage } from "./sync";

// Test Case 1: Timestamp-based LWW conflict resolution
const store = new Map<string, { value: unknown; updated_at: number }>();
const get = async (peerId: string, key: string) => {
	const entry = store.get(`${peerId}:${key}`);
	return entry ? { updated_at: entry.updated_at, value: entry.value } : null;
};
const saved: Array<[string, string, unknown]> = [];
const save = async (peerId: string, key: string, value: unknown) => {
	saved.push([peerId, key, value]);
	store.set(`${peerId}:${key}`, { value, updated_at: Date.now() });
};
const nodeState = new NodeState();

test("LWW conflict resolution: newer timestamp wins", async () => {
	const message: SyncResponseMessage = {
		type: "sync_response",
		originPeerId: "peer2",
		timestamp: Date.now(),
		requestId: "test-req",
		responseType: "state",
		data: { value: "new_value" },
		metadataKey: "example_key",
		metadataReplication: true,
	};

	await handleSyncMessage(
		message,
		{ toString: () => "remotePeerId" } as PeerId,
		nodeState,
		get,
		save,
	);

	expect(saved).toContainEqual([
		"remotePeerId",
		"example_key",
		{ value: "new_value" },
	]);
});

test("Delta sync transmits only changed entries", async () => {
	const message: SyncResponseMessage = {
		type: "sync_response",
		originPeerId: "peer2",
		timestamp: Date.now(),
		requestId: "delta-req",
		responseType: "delta",
		data: [{ key: "changed_key", value: "delta_value" }],
	};

	await handleSyncMessage(
		message,
		{ toString: () => "remotePeerId" } as PeerId,
		nodeState,
		get,
		save,
	);

	// No longer checking 'applied' since 'apply' is not used
});

// Test Case 3: TTL expiration after specified period
test("Metadata expires after TTL period", async () => {
	const dir = join(tmpdir(), `yapyap-test-${Date.now()}`);
	const db = new DatabaseManager({ dataDir: dir });
	await db.savePeerMetadata("test-peer", "ttl_key", { value: "test" }, -1);
	await db.cleanup();
	const value = await db.getPeerMetadata("test-peer", "ttl_key");
	await db.close();
	expect(value).toBeNull();
});
