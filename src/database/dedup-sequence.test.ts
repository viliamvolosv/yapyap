import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { DatabaseManager } from "./index.js";

describe("DatabaseManager dedup + sequence", () => {
	let dataDir: string | undefined;
	let db: DatabaseManager | undefined;

	afterEach(() => {
		db?.close();
		if (dataDir) {
			rmSync(dataDir, { recursive: true, force: true });
		}
	});

	test("marks message as processed and detects duplicates", () => {
		dataDir = mkdtempSync(join(tmpdir(), "yapyap-dedup-"));
		db = new DatabaseManager({ dataDir });

		assert.strictEqual(db.isMessageProcessed("msg-1"), false);
		db.markMessageProcessed("msg-1", "peer-a", 7);
		assert.strictEqual(db.isMessageProcessed("msg-1"), true);
	});

	test("tracks and updates per-peer sequence numbers", () => {
		dataDir = mkdtempSync(join(tmpdir(), "yapyap-seq-"));
		db = new DatabaseManager({ dataDir });

		assert.strictEqual(db.getLastPeerSequence("peer-a"), null);
		db.updatePeerSequence("peer-a", 5);
		assert.strictEqual(db.getLastPeerSequence("peer-a"), 5);

		db.updatePeerSequence("peer-a", 6);
		assert.strictEqual(db.getLastPeerSequence("peer-a"), 6);
	});

	test("tracks and merges lightweight vector clocks", () => {
		dataDir = mkdtempSync(join(tmpdir(), "yapyap-vclock-"));
		db = new DatabaseManager({ dataDir });

		assert.strictEqual(db.getVectorClock("peer-a"), 0);
		db.updateVectorClock("peer-a", 2);
		assert.strictEqual(db.getVectorClock("peer-a"), 2);
		db.updateVectorClock("peer-a", 1);
		assert.strictEqual(db.getVectorClock("peer-a"), 2);

		db.updateVectorClock("peer-b", 7);
		assert.deepStrictEqual(db.getAllVectorClocks(), {
			"peer-a": 2,
			"peer-b": 7,
		});
	});

	test("stores and retries pending messages", () => {
		dataDir = mkdtempSync(join(tmpdir(), "yapyap-pending-"));
		db = new DatabaseManager({ dataDir });

		const messageId = "pending-1";
		db.queueMessage(
			messageId,
			{ id: messageId, type: "data" },
			"peer-a",
			Date.now() + 60_000,
		);

		const retryable = db.getRetryablePendingMessages();
		assert.ok(retryable.some((entry) => entry.message_id === messageId));

		db.schedulePendingRetry(messageId, Date.now() + 1_000, "network");
		const afterRetrySchedule = db.getRetryablePendingMessages();
		assert.ok(
			!afterRetrySchedule.some((entry) => entry.message_id === messageId),
		);
		const forPeer = db.getPendingMessagesForPeer("peer-a");
		assert.strictEqual(
			forPeer.some((entry) => entry.message_id === messageId),
			true,
		);

		db.markPendingMessageDelivered(messageId);
		const cleaned = db.deleteExpiredPendingMessages();
		assert.strictEqual(cleaned >= 1, true);
	});

	test("returns delta windows for processed and pending messages", () => {
		dataDir = mkdtempSync(join(tmpdir(), "yapyap-delta-window-"));
		db = new DatabaseManager({ dataDir });

		const before = Date.now() - 10;
		db.markMessageProcessed("proc-1", "peer-a", 1);
		db.queueMessage(
			"pend-1",
			{
				id: "pend-1",
				type: "data",
				from: "peer-a",
				to: "peer-b",
				payload: {},
				timestamp: Date.now(),
			},
			"peer-b",
			Date.now() + 60_000,
		);

		const processed = db.getProcessedMessageIdsSince(before);
		const pending = db.getPendingMessagesSince(before);
		const byIds = db.getPendingMessagesByIds(["pend-1"]);

		assert.ok(processed.includes("proc-1"));
		assert.strictEqual(
			pending.some((entry) => entry.message_id === "pend-1"),
			true,
		);
		assert.strictEqual(byIds.length, 1);
	});

	test("persists incoming message atomically and updates sequence/vector clock", () => {
		dataDir = mkdtempSync(join(tmpdir(), "yapyap-atomic-incoming-"));
		db = new DatabaseManager({ dataDir });

		const result = db.persistIncomingMessageAtomically({
			messageId: "incoming-1",
			fromPeerId: "peer-remote",
			toPeerId: "peer-local",
			sequenceNumber: 4,
			messageData: {
				id: "incoming-1",
				type: "data",
				from: "peer-remote",
				to: "peer-local",
				payload: { ok: true },
				timestamp: Date.now(),
			},
			ttl: 60_000,
			vectorClock: { "peer-remote": 4, "peer-x": 2 },
		});

		assert.strictEqual(result.applied, true);
		assert.strictEqual(result.duplicate, false);
		assert.strictEqual(db.isMessageProcessed("incoming-1"), true);
		assert.strictEqual(db.getLastPeerSequence("peer-remote"), 4);
		assert.strictEqual(db.getVectorClock("peer-remote"), 4);
		assert.strictEqual(db.getVectorClock("peer-x"), 2);
	});

	test("atomic incoming persistence drops duplicate side effects", () => {
		dataDir = mkdtempSync(join(tmpdir(), "yapyap-atomic-dupe-"));
		db = new DatabaseManager({ dataDir });

		const first = db.persistIncomingMessageAtomically({
			messageId: "incoming-dupe",
			fromPeerId: "peer-remote",
			toPeerId: "peer-local",
			sequenceNumber: 1,
			messageData: {
				id: "incoming-dupe",
				type: "data",
				from: "peer-remote",
				to: "peer-local",
				payload: {},
				timestamp: Date.now(),
			},
			ttl: 60_000,
		});
		const second = db.persistIncomingMessageAtomically({
			messageId: "incoming-dupe",
			fromPeerId: "peer-remote",
			toPeerId: "peer-local",
			sequenceNumber: 2,
			messageData: {
				id: "incoming-dupe",
				type: "data",
				from: "peer-remote",
				to: "peer-local",
				payload: {},
				timestamp: Date.now(),
			},
			ttl: 60_000,
		});

		assert.strictEqual(first.applied, true);
		assert.strictEqual(second.applied, false);
		assert.strictEqual(second.duplicate, true);
		assert.strictEqual(db.getLastPeerSequence("peer-remote"), 1);
	});

	test("tracks replica ownership and assignments", () => {
		dataDir = mkdtempSync(join(tmpdir(), "yapyap-replicas-"));
		db = new DatabaseManager({ dataDir });

		db.upsertReplicatedMessage(
			"msg-replica",
			"peer-target",
			"peer-source",
			Date.now() + 60_000,
		);
		db.assignMessageReplica("msg-replica", "peer-r1");
		db.assignMessageReplica("msg-replica", "peer-r2");
		db.markReplicaStored("msg-replica", "peer-r1");
		db.markReplicaFailed("msg-replica", "peer-r2", "offline");

		const replicas = db.getMessageReplicas("msg-replica");
		assert.strictEqual(replicas.length, 2);
		assert.strictEqual(
			replicas.some((r) => r.replica_peer_id === "peer-r1"),
			true,
		);
		assert.strictEqual(
			replicas.some((r) => r.replica_peer_id === "peer-r2"),
			true,
		);

		db.markReplicatedMessageDelivered("msg-replica");
		const deleted = db.deleteExpiredReplicatedMessages(Date.now() + 61_000);
		assert.strictEqual(deleted >= 1, true);
	});

	test("applies LWW for contacts and routing entries", () => {
		dataDir = mkdtempSync(join(tmpdir(), "yapyap-lww-"));
		db = new DatabaseManager({ dataDir });

		db.saveContactLww({
			peer_id: "peer-contact",
			alias: "new",
			last_seen: 100,
			metadata: JSON.stringify({ v: 2 }),
			is_trusted: true,
		});
		db.saveContactLww({
			peer_id: "peer-contact",
			alias: "old",
			last_seen: 90,
			metadata: JSON.stringify({ v: 1 }),
			is_trusted: false,
		});
		const contact = db.getContact("peer-contact");
		assert.strictEqual(contact?.alias, "new");
		assert.strictEqual(contact?.is_trusted, true);

		db.saveRoutingEntryLww({
			peer_id: "peer-route",
			multiaddrs: ["/ip4/1.1.1.1/tcp/1"],
			last_seen: 100,
			is_available: true,
			ttl: 60_000,
		});
		db.saveRoutingEntryLww({
			peer_id: "peer-route",
			multiaddrs: ["/ip4/2.2.2.2/tcp/2"],
			last_seen: 90,
			is_available: false,
			ttl: 60_000,
		});
		const route = db.getRoutingEntry("peer-route");
		assert.deepStrictEqual(route?.multiaddrs, ["/ip4/1.1.1.1/tcp/1"]);
		assert.strictEqual(route?.is_available, true);
	});
});
