import assert from "node:assert";
import { describe, test } from "node:test";
import { createTemporaryDatabase, CONTRACT_TTL_MS } from "./utils.js";

const PEER_ID = "peer-invariant";

describe("Contract - State Invariants", () => {
	test("Given decreasing sequence numbers, When persisted, Then the stored sequence counter never regresses", () => {
		const { manager, cleanup } = createTemporaryDatabase();
		try {
			manager.persistIncomingMessageAtomically({
				messageId: "invariant-seq-1",
				fromPeerId: PEER_ID,
				toPeerId: "peer-target",
				sequenceNumber: 5,
				messageData: { text: "sequence five" },
				ttl: CONTRACT_TTL_MS,
			});
			assert.strictEqual(
				manager.getLastPeerSequence(PEER_ID),
				5,
				"First sequence should be recorded",
			);

			manager.persistIncomingMessageAtomically({
				messageId: "invariant-seq-2",
				fromPeerId: PEER_ID,
				toPeerId: "peer-target",
				sequenceNumber: 3,
				messageData: { text: "sequence three" },
				ttl: CONTRACT_TTL_MS,
			});
			assert.strictEqual(
				manager.getLastPeerSequence(PEER_ID),
				5,
				"Lower sequence should not regress the stored counter",
			);
		} finally {
			cleanup();
		}
	});

	test("Given vector clock snapshots that decrease, When persisted, Then counters remain non-decreasing", () => {
		const { manager, cleanup } = createTemporaryDatabase();
		try {
			manager.persistIncomingMessageAtomically({
				messageId: "invariant-vector-1",
				fromPeerId: PEER_ID,
				toPeerId: "peer-target",
				sequenceNumber: 1,
				messageData: { text: "vector two" },
				ttl: CONTRACT_TTL_MS,
				vectorClock: { [PEER_ID]: 2 },
			});
			assert.strictEqual(
				manager.getVectorClock(PEER_ID),
				2,
				"Vector clock should reflect the higher counter",
			);

			manager.persistIncomingMessageAtomically({
				messageId: "invariant-vector-2",
				fromPeerId: PEER_ID,
				toPeerId: "peer-target",
				sequenceNumber: 2,
				messageData: { text: "vector one" },
				ttl: CONTRACT_TTL_MS,
				vectorClock: { [PEER_ID]: 1 },
			});
			assert.strictEqual(
				manager.getVectorClock(PEER_ID),
				2,
				"Vector clock should not decrease after lower counter",
			);
		} finally {
			cleanup();
		}
	});

	test("Given an encrypted payload, When persisted, Then plaintext fields are never stored", () => {
		const { manager, cleanup } = createTemporaryDatabase();
		try {
			const encryptedPayload = {
				ciphertext: "cipher-34",
				metadata: "allowed metadata",
			};
			manager.persistIncomingMessageAtomically({
				messageId: "invariant-encrypted",
				fromPeerId: PEER_ID,
				toPeerId: "peer-target",
				messageData: { payload: encryptedPayload },
				ttl: CONTRACT_TTL_MS,
			});
			const row = manager
				.getDatabase()
				.prepare(
					"SELECT message_data FROM processed_messages WHERE message_id = ?",
				)
				.get("invariant-encrypted");
			assert.ok(row, "Processed message row should exist");
			const stored = JSON.parse(row.message_data) as {
				payload: Record<string, unknown>;
			};
			assert.strictEqual(
				stored.payload.ciphertext,
				encryptedPayload.ciphertext,
				"Ciphertext must be preserved",
			);
			assert.strictEqual(
				stored.payload.metadata,
				encryptedPayload.metadata,
				"Allowed metadata should persist",
			);
			assert.strictEqual(
				Reflect.has(stored.payload, "plaintext"),
				false,
				"Plaintext fields must never be persisted for encrypted payloads",
			);
		} finally {
			cleanup();
		}
	});
});
