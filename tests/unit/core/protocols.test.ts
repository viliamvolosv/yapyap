import { describe, expect, test } from "bun:test";
import {
	decodeMessage,
	encodeMessage,
	MAX_FRAME_SIZE_BYTES,
	MessageCodec,
	MessageFramer,
	PROTOCOL_HANDSHAKE,
	PROTOCOL_MESSAGE,
	PROTOCOL_ROUTE,
	PROTOCOL_SYNC,
} from "../../../src/core/protocols";

describe("core/protocols", () => {
	test("MessageCodec roundtrips payloads", () => {
		const payload = { a: 1, b: "x", nested: { ok: true } };
		const encoded = MessageCodec.encode(payload);
		const decoded = MessageCodec.decode<typeof payload>(encoded);
		expect(decoded).toEqual(payload);
	});

	test("encodeMessage/decodeMessage compatibility helpers roundtrip payloads", () => {
		const payload = { type: "data", id: "m1" };
		const encoded = encodeMessage(payload);
		const decoded = decodeMessage<typeof payload>(encoded);
		expect(decoded).toEqual(payload);
	});

	test("MessageFramer decodes full and partial frame buffers", () => {
		const frame1 = MessageFramer.encode({ id: "1", value: "a" });
		const frame2 = MessageFramer.encode({ id: "2", value: "b" });

		const joined = new Uint8Array(frame1.length + frame2.length);
		joined.set(frame1, 0);
		joined.set(frame2, frame1.length);

		const cutAt = joined.length - 3;
		const partial = joined.slice(0, cutAt);
		const remainderTail = joined.slice(cutAt);

		const firstPass = MessageFramer.decodeFrames(partial);
		expect(firstPass.frames).toHaveLength(1);
		expect(firstPass.remainder.length).toBeGreaterThan(0);

		const rebuilt = new Uint8Array(
			firstPass.remainder.length + remainderTail.length,
		);
		rebuilt.set(firstPass.remainder, 0);
		rebuilt.set(remainderTail, firstPass.remainder.length);

		const secondPass = MessageFramer.decodeFrames(rebuilt);
		expect(secondPass.frames).toHaveLength(1);
		expect(secondPass.remainder).toHaveLength(0);
	});

	test("MessageFramer rejects oversized frames on decode", () => {
		const oversizedFrame = new Uint8Array(4);
		const view = new DataView(oversizedFrame.buffer);
		view.setUint32(0, MAX_FRAME_SIZE_BYTES + 1, false);

		expect(() => MessageFramer.decodeFrames(oversizedFrame)).toThrow(
			"Frame too large",
		);
	});

	test("MessageFramer rejects oversized payloads on encode", () => {
		const oversized = new Uint8Array(MAX_FRAME_SIZE_BYTES + 1);
		expect(() => MessageFramer.encode(oversized)).toThrow("Frame too large");
	});

	test("protocol constants stay stable", () => {
		expect(PROTOCOL_MESSAGE).toBe("/yapyap/message/1.0.0");
		expect(PROTOCOL_HANDSHAKE).toBe("/yapyap/handshake/1.0.0");
		expect(PROTOCOL_ROUTE).toBe("/yapyap/route/1.0.0");
		expect(PROTOCOL_SYNC).toBe("/yapyap/sync/1.0.0");
	});
});
