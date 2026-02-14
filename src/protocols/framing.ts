/**
 * Message framing utilities for YapYap protocol implementations
 * Implements proper message framing for the /yapyap/msg/1.0.0 protocol
 */

import { decodeMessage, encodeMessage } from "../core/protocols";
import type { YapYapMessage } from "../message/message";

export const MessageFramer = {
	/**
	 * Encode a message with proper framing (4-byte big-endian length prefix)
	 */
	encode(message: YapYapMessage): Uint8Array {
		const encoded = encodeMessage(message);
		const messageWithLength = new Uint8Array(encoded.length + 4);
		const lengthBuffer = new DataView(new ArrayBuffer(4));
		lengthBuffer.setUint32(0, encoded.length, false); // Big-endian
		messageWithLength.set(new Uint8Array(lengthBuffer.buffer), 0);
		messageWithLength.set(encoded, 4);
		return messageWithLength;
	},

	/**
	 * Decode a framed message
	 */
	decode(data: Uint8Array): YapYapMessage {
		if (data.length < 4) {
			throw new Error("Invalid framed message: insufficient data");
		}

		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const messageLength = view.getUint32(0, false);

		if (data.length < 4 + messageLength) {
			throw new Error("Invalid framed message: incomplete data");
		}

		const messageBytes = data.slice(4, 4 + messageLength);
		return decodeMessage(messageBytes);
	},

	/**
	 * Split raw data into complete messages
	 */
	splitMessages(buffer: Uint8Array): {
		messages: YapYapMessage[];
		remaining: Uint8Array;
	} {
		let offset = 0;
		const messages: YapYapMessage[] = [];

		while (offset + 4 <= buffer.length) {
			const view = new DataView(
				buffer.buffer,
				buffer.byteOffset + offset,
				buffer.byteLength - offset,
			);
			const messageLength = view.getUint32(0, false);

			if (offset + 4 + messageLength > buffer.length) {
				// Incomplete message, keep remaining data
				break;
			}

			const messageBytes = buffer.slice(offset + 4, offset + 4 + messageLength);
			try {
				const message = decodeMessage<YapYapMessage>(messageBytes);
				messages.push(message);
				offset += 4 + messageLength;
			} catch (error) {
				console.error("Error decoding message:", error);
				// Skip this message and continue with the next one
				offset += 4 + messageLength;
			}
		}

		const remaining = buffer.slice(offset);
		return { messages, remaining };
	},
};
