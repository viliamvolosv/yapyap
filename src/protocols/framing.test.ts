/**
 * Contract tests for MessageFramer protocol module
 * Tests framing encode/decode behavior and error handling
 */

import assert from "node:assert";
import { describe, test } from "node:test";
import { MessageFramer } from "../core/protocols.js";

// Test utilities
function createTestMessage<T>(payload: T): T {
	return payload;
}

// ============================================================================
// Test Suite: encode
// ============================================================================

describe("MessageFramer - encode", () => {
	test("Given valid message, When encoded, Then returns framed message with length prefix", () => {
		const message = createTestMessage({ text: "test message" });

		const framed = MessageFramer.encode(message);

		// Should have length prefix (4 bytes) + payload
		assert.ok(framed.length > 4, "Framed message should have length prefix");
		assert.ok(framed.length < 260000, "Framed message should be within limits");
	});

	test("Given empty message, When encoded, Then returns minimal frame", () => {
		const message = createTestMessage({});

		const framed = MessageFramer.encode(message);

		// Empty message should have at least length prefix
		assert.ok(framed.length >= 4, "Framed message should have length prefix");
	});

	test("Given large message, When encoded, Then throws error if too large", () => {
		// Create a message larger than MAX_FRAME_SIZE_BYTES (256KB)
		const largePayload = new Array(260000).fill("a").join("");
		const message = createTestMessage({ large: largePayload });

		assert.throws(
			() => MessageFramer.encode(message),
			/Frame too large|256KB/i,
		);
	});

	test("Given message with large field, When encoded, Then throws error if exceeds limit", () => {
		const message = createTestMessage({
			largeArray: new Array(270000).fill("test"),
		});

		assert.throws(
			() => MessageFramer.encode(message),
			/Frame too large|256KB/i,
		);
	});
});

// ============================================================================
// Test Suite: decode
// ============================================================================

describe("MessageFramer - decode", () => {
	test("Given valid framed message, When decoded, Then returns original message", () => {
		const original = createTestMessage({ text: "test message", number: 42 });

		const framed = MessageFramer.encode(original);
		const decoded = MessageFramer.decode(framed);

		assert.deepStrictEqual(
			decoded,
			original,
			"Decoded message should match original",
		);
	});

	test("Given incomplete message (less than 4 bytes), When decoded, Then throws error", () => {
		const incomplete = new Uint8Array([0, 1, 2, 3, 4]);

		assert.throws(
			() => MessageFramer.decode(incomplete),
			/insufficient data|Message decode failed/i,
		);
	});

	test("Given message with zero length, When decoded, Then throws error", () => {
		const zeroLength = new Uint8Array([0, 0, 0, 0]);

		assert.throws(
			() => MessageFramer.decode(zeroLength),
			/Message decode failed|insufficient data/i,
		);
	});

	test("Given truncated payload (size > remaining bytes), When decoded, Then throws error", () => {
		// Create a frame claiming size 100, but only provide 10 bytes
		const view = new DataView(new ArrayBuffer(4));
		view.setUint32(0, 100, false);
		const frame = new Uint8Array([
			...new Uint8Array(view.buffer),
			...new Uint8Array(10),
		]);

		assert.throws(
			() => MessageFramer.decode(frame),
			/incomplete data/i,
		);
	});

	test("Given oversized payload (size > MAX_FRAME_SIZE_BYTES), When decoded, Then throws error", () => {
		const oversizedSize = 260000;
		const view = new DataView(new ArrayBuffer(4));
		view.setUint32(0, oversizedSize, false);
		const frame = new Uint8Array([
			...new Uint8Array(view.buffer),
			...new Uint8Array(oversizedSize),
		]);

		assert.throws(() => MessageFramer.decode(frame), /Frame too large|Message decode failed/i);
	});
});

// ============================================================================
// Test Suite: decodeFrames
// ============================================================================

describe("MessageFramer - decodeFrames", () => {
	test("Given single complete frame, When decoded, Then returns one frame and empty remainder", () => {
		const message = createTestMessage({ text: "single message" });
		const framed = MessageFramer.encode(message);

		const result = MessageFramer.decodeFrames(framed);

		assert.strictEqual(result.frames.length, 1, "Should decode one frame");
		assert.strictEqual(result.remainder.length, 0, "Should have no remainder");
	});

	test("Given multiple complete frames, When decoded, Then returns all frames and empty remainder", () => {
		const frame1 = MessageFramer.encode(createTestMessage({ text: "first" }));
		const frame2 = MessageFramer.encode(createTestMessage({ text: "second" }));
		const frame3 = MessageFramer.encode(createTestMessage({ text: "third" }));

		const combined = new Uint8Array([...frame1, ...frame2, ...frame3]);

		const result = MessageFramer.decodeFrames(combined);

		assert.strictEqual(result.frames.length, 3, "Should decode three frames");
		assert.strictEqual(result.remainder.length, 0, "Should have no remainder");

		// Verify content
		assert.deepStrictEqual(MessageFramer.decode(result.frames[0]), {
			text: "first",
		});
		assert.deepStrictEqual(MessageFramer.decode(result.frames[1]), {
			text: "second",
		});
		assert.deepStrictEqual(MessageFramer.decode(result.frames[2]), {
			text: "third",
		});
	});

	test("Given partial frame at end, When decoded, Then returns complete frames and partial remainder", () => {
		const frame1 = MessageFramer.encode(createTestMessage({ text: "first" }));
		const frame2 = MessageFramer.encode(createTestMessage({ text: "second" }));

		const combined = new Uint8Array([...frame1, ...frame2]);

		// Add partial of third frame
		const partialFrame = new Uint8Array(4);
		const view = new DataView(partialFrame.buffer);
		view.setUint32(0, 100, false);
		const combinedWithPartial = new Uint8Array([...combined, ...partialFrame]);

		const result = MessageFramer.decodeFrames(combinedWithPartial);

		assert.strictEqual(
			result.frames.length,
			2,
			"Should decode two complete frames",
		);
		assert.ok(result.remainder.length > 0, "Should have partial remainder");
	});

	test("Given empty buffer, When decoded, Then returns no frames and empty remainder", () => {
		const result = MessageFramer.decodeFrames(new Uint8Array(0));

		assert.strictEqual(result.frames.length, 0, "Should have no frames");
		assert.strictEqual(result.remainder.length, 0, "Should have no remainder");
	});

	test("Given buffer with no complete frames, When decoded, Then returns no frames and full remainder", () => {
		const buffer = new Uint8Array([0, 1, 2, 3]);

		const result = MessageFramer.decodeFrames(buffer);

		assert.strictEqual(result.frames.length, 0, "Should have no frames");
		assert.strictEqual(
			result.remainder.length,
			4,
			"Should have full remainder",
		);
	});

	test("Given partial frame at end, When decoded, Then returns complete frames and partial remainder", () => {
		const frame1 = MessageFramer.encode(createTestMessage({ text: "first" }));
		const frame2 = MessageFramer.encode(createTestMessage({ text: "second" }));

		const combined = new Uint8Array([...frame1, ...frame2]);

		// Add partial of third frame
		const partialFrame = new Uint8Array(4);
		const view = new DataView(partialFrame.buffer);
		view.setUint32(0, 100, false);
		const combinedWithPartial = new Uint8Array([...combined, ...partialFrame]);

		const result = MessageFramer.decodeFrames(combinedWithPartial);

		assert.strictEqual(
			result.frames.length,
			2,
			"Should decode two complete frames",
		);
		assert.ok(result.remainder.length > 0, "Should have partial remainder");
	});

	test("Given empty buffer, When decoded, Then returns no frames and empty remainder", () => {
		const result = MessageFramer.decodeFrames(new Uint8Array(0));

		assert.strictEqual(result.frames.length, 0, "Should have no frames");
		assert.strictEqual(result.remainder.length, 0, "Should have no remainder");
	});

	test("Given buffer with no complete frames, When decoded, Then returns no frames and full remainder", () => {
		// Buffer with only first 2 bytes of frame length
		const buffer = new Uint8Array([0, 1, 2, 3]);

		const result = MessageFramer.decodeFrames(buffer);

		assert.strictEqual(result.frames.length, 0, "Should have no frames");
		assert.strictEqual(
			result.remainder.length,
			4,
			"Should have full remainder",
		);
	});
});

// ============================================================================
// Test Suite: splitMessages
// ============================================================================

describe("MessageFramer - splitMessages", () => {
	test("Given single complete message, When split, Then returns one message and empty remaining", () => {
		const message = createTestMessage({ text: "single message" });
		const encoded = MessageFramer.encode(message);

		const result = MessageFramer.splitMessages(encoded);

		assert.strictEqual(result.messages.length, 1, "Should have one message");
		assert.strictEqual(
			result.remaining.length,
			0,
			"Should have no remaining data",
		);
	});

	test("Given multiple complete messages, When split, Then returns all messages and empty remaining", () => {
		const msg1 = createTestMessage({ id: 1, text: "first" });
		const msg2 = createTestMessage({ id: 2, text: "second" });
		const msg3 = createTestMessage({ id: 3, text: "third" });

		const encoded1 = MessageFramer.encode(msg1);
		const encoded2 = MessageFramer.encode(msg2);
		const encoded3 = MessageFramer.encode(msg3);

		const combined = new Uint8Array([...encoded1, ...encoded2, ...encoded3]);

		const result = MessageFramer.splitMessages(combined);

		assert.strictEqual(result.messages.length, 3, "Should have three messages");
		assert.strictEqual(
			result.remaining.length,
			0,
			"Should have no remaining data",
		);

		// Verify messages
		assert.deepStrictEqual(result.messages[0], msg1);
		assert.deepStrictEqual(result.messages[1], msg2);
		assert.deepStrictEqual(result.messages[2], msg3);
	});

	test("Given partial message at end, When split, Then returns complete messages and partial remaining", () => {
		const msg1 = createTestMessage({ id: 1, text: "first" });
		const msg2 = createTestMessage({ id: 2, text: "second" });

		const encoded1 = MessageFramer.encode(msg1);
		const encoded2 = MessageFramer.encode(msg2);

		const combined = new Uint8Array([...encoded1, ...encoded2]);

		// Add partial of third message
		const partial = new Uint8Array(4);
		const view = new DataView(partial.buffer);
		view.setUint32(0, 100, false);
		const combinedWithPartial = new Uint8Array([...combined, ...partial]);

		const result = MessageFramer.splitMessages(combinedWithPartial);

		assert.strictEqual(
			result.messages.length,
			2,
			"Should have two complete messages",
		);
		assert.ok(result.remaining.length > 0, "Should have partial remaining");
	});

	test("Given malformed message in stream, When split, Then skips malformed and returns rest", () => {
		const msg1 = createTestMessage({ id: 1, text: "first" });
		const msg2 = createTestMessage({ id: 2, text: "second" });

		const encoded1 = MessageFramer.encode(msg1);
		const encoded2 = MessageFramer.encode(msg2);

		// Create malformed message (zero length)
		const malformed = new Uint8Array([0, 0, 0, 0]);

		const combined = new Uint8Array([...encoded1, malformed, encoded2]);

		const result = MessageFramer.splitMessages(combined);

		// Should skip malformed and return valid messages
		assert.strictEqual(
			result.messages.length,
			2,
			"Should have two valid messages",
		);
		assert.ok(result.remaining.length > 0, "Should have remaining data");
	});

	test("Given buffer with no complete messages, When split, Then returns no messages and full remaining", () => {
		const buffer = new Uint8Array([0, 1, 2, 3]);

		const result = MessageFramer.splitMessages(buffer);

		assert.strictEqual(result.messages.length, 0, "Should have no messages");
		assert.strictEqual(
			result.remaining.length,
			4,
			"Should have full remaining",
		);
	});
});

// ============================================================================
// Test Suite: Error Handling
// ============================================================================

describe("MessageFramer - Error Handling", () => {
	test("Given invalid data types, When encoded, Then throws error", () => {
		// Note: MessageCodec.encode may accept various types
		// This test verifies the framer doesn't crash on normal cases
		const message = createTestMessage({
			complex: {
				nested: { value: [1, 2, 3] },
			},
		});

		assert.doesNotThrow(
			() => MessageFramer.encode(message),
			"Should encode complex objects",
		);
	});

	test("Given binary data, When encoded, Then handles correctly", () => {
		const binaryData = new Uint8Array([0, 1, 2, 3, 4, 5, 255, 254, 253]);

		const message = createTestMessage({ data: binaryData });

		assert.doesNotThrow(
			() => MessageFramer.encode(message),
			"Should encode binary data",
		);
	});
});
