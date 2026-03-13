import assert from "node:assert";
import { describe, test } from "node:test";
import { createTemporaryDatabase, CONTRACT_TTL_MS } from "./utils.js";

describe("Contract - Public API", () => {
	test("Given duplicate message IDs, When persisted, Then only the first insert applies", () => {
		const { manager, cleanup } = createTemporaryDatabase();
		try {
			const input = {
				messageId: "public-contract-msg",
				fromPeerId: "peer-contract",
				toPeerId: "peer-target",
				sequenceNumber: 1,
				messageData: { text: "contract message" },
				ttl: CONTRACT_TTL_MS,
			};

			const first = manager.persistIncomingMessageAtomically(input);
			assert.strictEqual(first.applied, true, "First insert should apply");
			assert.strictEqual(
				first.duplicate,
				false,
				"First insert is not duplicate",
			);

			const second = manager.persistIncomingMessageAtomically(input);
			assert.strictEqual(second.applied, false, "Duplicate should not apply");
			assert.strictEqual(second.duplicate, true, "Duplicate should be flagged");

			const countRow = manager
				.getDatabase()
				.prepare(
					"SELECT COUNT(*) as count FROM processed_messages WHERE message_id = ?",
				)
				.get(input.messageId) as { count: number };
			assert.strictEqual(
				countRow.count,
				1,
				"Only one processed row should exist",
			);
		} finally {
			cleanup();
		}
	});

	test("Given pending messages, When ACK/NACK terminal states recorded, Then they leave retry queues", () => {
		const { manager, cleanup } = createTemporaryDatabase();
		try {
			const baseMessage = {
				messageId: "public-contract-delivered",
				messageData: { text: "ack message" },
			};
			manager.queueMessage(
				baseMessage.messageId,
				baseMessage.messageData,
				"peer-target",
				Date.now() + CONTRACT_TTL_MS,
			);
			manager.markPendingMessageDelivered(baseMessage.messageId);
			const delivered = manager.getPendingMessage(baseMessage.messageId);
			assert.strictEqual(
				delivered?.status,
				"delivered",
				"ACK transitions to delivered",
			);
			assert.strictEqual(
				manager.getRetryablePendingMessages().length,
				0,
				"Delivered entries should not be eligible for retries",
			);

			const failMessageId = "public-contract-failed";
			manager.queueMessage(
				failMessageId,
				{ text: "nak message" },
				"peer-target",
				Date.now() + CONTRACT_TTL_MS,
			);
			manager.markPendingMessageFailed(failMessageId, "nak-reason");
			const failed = manager.getPendingMessage(failMessageId);
			assert.strictEqual(failed?.status, "failed", "NAK transitions to failed");
			assert.strictEqual(
				failed?.last_error,
				"nak-reason",
				"Failure reason should be recorded",
			);
			assert.strictEqual(
				manager.getRetryablePendingMessages().length,
				0,
				"Failed entries should not remain in the retry queue",
			);
		} finally {
			cleanup();
		}
	});
});
