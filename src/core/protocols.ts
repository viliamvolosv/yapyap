import { decode, encode } from "msgpackr";
import type { RoutingHint } from "../protocols/route.js";
import { handleRouteMessage, RoutingTable } from "../protocols/route.js";
import { handleSyncMessage, NodeState } from "../protocols/sync.js";

/* -------------------------------------------------------------------------- */
/*                               Protocol IDs                                 */
/* -------------------------------------------------------------------------- */

export const PROTOCOL_VERSION = "1.0.0";

export const PROTOCOL_MSG = `/yapyap/msg/${PROTOCOL_VERSION}`;
export const PROTOCOL_MESSAGE = `/yapyap/message/${PROTOCOL_VERSION}`;
export const PROTOCOL_HANDSHAKE = `/yapyap/handshake/${PROTOCOL_VERSION}`;
export const PROTOCOL_ROUTE = `/yapyap/route/${PROTOCOL_VERSION}`;
export const PROTOCOL_SYNC = `/yapyap/sync/${PROTOCOL_VERSION}`;

export const PROTOCOLS = {
	MSG: PROTOCOL_MSG,
	PROTOCOL_HANDSHAKE,
	PROTOCOL_ROUTE,
	PROTOCOL_SYNC,
} as const;

export const MAX_FRAME_SIZE_BYTES = 256 * 1024; // 256 KB

/* -------------------------------------------------------------------------- */
/*                              Message Codec                                 */
/* -------------------------------------------------------------------------- */

export const MessageCodec = {
	/**
	 * Encode a message using msgpack
	 */
	encode<T>(message: T): Uint8Array {
		return encode(message);
	},

	/**
	 * Decode a msgpack buffer safely
	 */
	decode<T>(data: Uint8Array): T {
		try {
			return decode(data) as T;
		} catch (err) {
			throw new Error(`Message decode failed: ${String(err)}`);
		}
	},
};

/* -------------------------------------------------------------------------- */
/*                            Length-Prefix Framer                            */
/* -------------------------------------------------------------------------- */

export const MessageFramer = {
	/**
	 * Frame message (length + body)
	 */
	encode<T>(msg: T): Uint8Array {
		const payload = MessageCodec.encode(msg);
		if (payload.length > MAX_FRAME_SIZE_BYTES) {
			throw new Error(`Frame too large: ${payload.length} bytes`);
		}

		const buffer = new Uint8Array(4 + payload.length);
		const view = new DataView(buffer.buffer);

		view.setUint32(0, payload.length, false); // Big-endian
		buffer.set(payload, 4);

		return buffer;
	},

	/**
	 * Extract framed messages from buffer
	 */
	decodeFrames(buffer: Uint8Array): {
		frames: Uint8Array[];
		remainder: Uint8Array;
	} {
		const frames: Uint8Array[] = [];
		let offset = 0;

		while (buffer.length - offset >= 4) {
			const view = new DataView(
				buffer.buffer,
				buffer.byteOffset + offset,
				buffer.byteLength - offset,
			);

			const size = view.getUint32(0, false);
			if (size > MAX_FRAME_SIZE_BYTES) {
				throw new Error(`Frame too large: ${size} bytes`);
			}

			if (buffer.length - offset < size + 4) break;

			const start = offset + 4;
			const end = start + size;

			frames.push(buffer.slice(start, end));

			offset = end;
		}

		return {
			frames,
			remainder: buffer.slice(offset),
		};
	},

	/**
	 * Decode a single framed message
	 */
	decode<T>(data: Uint8Array): T {
		if (data.length < 4) {
			throw new Error("Invalid framed message: insufficient data");
		}

		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const messageLength = view.getUint32(0, false);

		if (messageLength > MAX_FRAME_SIZE_BYTES) {
			throw new Error(`Frame too large: ${messageLength} bytes`);
		}

		if (data.length < 4 + messageLength) {
			throw new Error("Invalid framed message: incomplete data");
		}

		const messageBytes = data.slice(4, 4 + messageLength);
		return MessageCodec.decode<T>(messageBytes);
	},

	/**
	 * Split raw buffer into complete messages with error handling
	 */
	splitMessages<T>(buffer: Uint8Array): {
		messages: T[];
		remaining: Uint8Array;
	} {
		let offset = 0;
		const messages: T[] = [];

		while (offset + 4 <= buffer.length) {
			const view = new DataView(
				buffer.buffer,
				buffer.byteOffset + offset,
				buffer.byteLength - offset,
			);
			const messageLength = view.getUint32(0, false);

			if (messageLength > MAX_FRAME_SIZE_BYTES) {
				throw new Error(`Frame too large: ${messageLength} bytes`);
			}

			if (offset + 4 + messageLength > buffer.length) {
				break;
			}

			const messageBytes = buffer.slice(offset + 4, offset + 4 + messageLength);
			try {
				const message = MessageCodec.decode<T>(messageBytes);
				messages.push(message);
				offset += 4 + messageLength;
			} catch (error) {
				console.error("Error decoding message:", error);
				offset += 4 + messageLength;
			}
		}

		const remaining = buffer.slice(offset);
		return { messages, remaining };
	},
};

/* -------------------------------------------------------------------------- */
/*                           Backward Compatibility                           */
/* -------------------------------------------------------------------------- */

/**
 * Legacy helpers (optional)
 */

export function encodeMessage<T>(message: T): Uint8Array {
	return MessageCodec.encode(message);
}

export function decodeMessage<T>(data: Uint8Array): T {
	return MessageCodec.decode<T>(data);
}

/* -------------------------------------------------------------------------- */
/*                           Protocol Handlers                                */
/* -------------------------------------------------------------------------- */

/**
 * Export protocol handlers for use in node.ts
 */
export { handleRouteMessage, handleSyncMessage };
export { RoutingTable };
export { NodeState };
export type { RoutingHint };
