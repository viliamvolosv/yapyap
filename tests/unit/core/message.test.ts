import { describe, expect, test } from "bun:test";
import type {
	AckMessage,
	MessageQueueEntry,
	NakMessage,
	StoreAndForwardMessage,
	YapYapMessage,
} from "../../../src/core/message";

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

		expect(dataMessage.id).toBe("msg_123");
		expect(dataMessage.type).toBe("data");
		expect(dataMessage.payload.text).toBe("hello");

		const ackMessage: AckMessage = {
			id: "ack_123",
			type: "ack",
			from: "peer2",
			to: "peer1",
			payload: null,
			timestamp: now,
			originalMessageId: "msg_123",
		};

		expect(ackMessage.type).toBe("ack");
		expect(ackMessage.originalMessageId).toBe("msg_123");

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

		expect(nakMessage.type).toBe("nak");
		expect(nakMessage.reason).toBe("delivery-failed");

		const storeForwardMessage: StoreAndForwardMessage = {
			id: "sf_123",
			type: "store-and-forward",
			from: "peer1",
			to: "peer2",
			payload: null,
			timestamp: now,
			storedMessage: dataMessage,
		};

		expect(storeForwardMessage.type).toBe("store-and-forward");
		expect(storeForwardMessage.storedMessage.id).toBe("msg_123");
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

		expect(messageEntry.message.id).toBe("msg_456");
		expect(messageEntry.attempts).toBe(0);
	});
});
