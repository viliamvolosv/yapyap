import assert from "node:assert";
import { describe, test } from "node:test";
import type {
	AckMessage,
	MessageQueueEntry,
	NakMessage,
	StoreAndForwardMessage,
	YapYapMessage,
} from "../../../src/core/message.js";

describe("message types", () => {
	test("define data and control message shapes", () => {
		const now = Date.now();

		const dataMessage: YapYapMessage = {
			id: "msg_123",
			type: "data",
			from: "peer1",
			to: "peer2",
			payload: { text: "hello" },
			timestamp: now,
		};

		assert.strictEqual(dataMessage.id, "msg_123");
		assert.strictEqual(dataMessage.type, "data");
		assert.strictEqual(dataMessage.payload.text, "hello");

		const ackMessage: AckMessage = {
			id: "ack_123",
			type: "ack",
			from: "peer2",
			to: "peer1",
			payload: null,
			timestamp: now,
			originalMessageId: "msg_123",
		};

		assert.strictEqual(ackMessage.type, "ack");
		assert.strictEqual(ackMessage.originalMessageId, "msg_123");

		const nakMessage: NakMessage = {
			id: "nak_123",
			type: "nak",
			from: "peer2",
			to: "peer1",
			payload: null,
			timestamp: now,
			originalMessageId: "msg_123",
			reason: "delivery-failed",
		};

		assert.strictEqual(nakMessage.type, "nak");
		assert.strictEqual(nakMessage.reason, "delivery-failed");

		const storeForwardMessage: StoreAndForwardMessage = {
			id: "sf_123",
			type: "store-and-forward",
			from: "peer1",
			to: "peer2",
			payload: null,
			timestamp: now,
			storedMessage: dataMessage,
		};

		assert.strictEqual(storeForwardMessage.type, "store-and-forward");
		assert.strictEqual(storeForwardMessage.storedMessage.id, "msg_123");
	});

	test("defines a queue entry shape", () => {
		const now = Date.now();

		const messageEntry: MessageQueueEntry = {
			message: {
				id: "msg_456",
				type: "data",
				from: "peer1",
				to: "peer2",
				payload: { text: "queued" },
				timestamp: now,
			},
			queuedAt: now,
			attempts: 0,
		};

		assert.strictEqual(messageEntry.message.id, "msg_456");
		assert.strictEqual(messageEntry.attempts, 0);
	});
});
