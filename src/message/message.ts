/**
 * Message types and interfaces for YapYap node communication
 */

export interface YapYapMessage {
	/**
	 * Unique identifier for the message
	 */
	id: string;

	/**
	 * Type of message (e.g., 'data', 'ack', 'nak', 'store-and-forward')
	 */
	type: "data" | "ack" | "nak" | "store-and-forward";

	/**
	 * The sender's peer ID
	 */
	from: string;

	/**
	 * The recipient's peer ID
	 */
	to: string;

	/**
	 * Message payload/data - using unknown for flexibility but type-safe
	 */
	payload: unknown;

	/**
	 * Timestamp when the message was created
	 */
	timestamp: number;

	/**
	 * Optional: Message sequence number for ordering
	 */
	sequenceNumber?: number;

	/**
	 * Optional: Message expiration time (in milliseconds)
	 */
	ttl?: number;

	/**
	 * Optional: lightweight vector clock (peerId -> counter)
	 */
	vectorClock?: Record<string, number>;

	/**
	 * Optional: Encryption information for end-to-end encryption
	 */
	encryptionInfo?: string;

	/**
	 * Optional: Message signature for authenticity
	 */
	signature?: string;
}

export interface AckMessage extends YapYapMessage {
	type: "ack";
	originalMessageId: string;
	relayEnvelope?: {
		signature: string;
		signerPublicKey: string;
		originalTargetPeerId: string;
	};
}

export interface NakMessage extends YapYapMessage {
	type: "nak";
	/**
	 * The ID of the original message that was not received
	 */
	originalMessageId: string;
	/**
	 * Reason for the NAK (e.g., 'delivery-failed', 'timeout', 'unavailable')
	 */
	reason?: string;
}

export interface StoreAndForwardMessage extends YapYapMessage {
	type: "store-and-forward";
	/**
	 * The message that was stored for later delivery
	 */
	storedMessage: YapYapMessage;
}

/**
 * Message queue entry for offline message storage
 */
export interface MessageQueueEntry {
	/**
	 * The message to be queued
	 */
	message: YapYapMessage;

	/**
	 * Timestamp when the message was queued
	 */
	queuedAt: number;

	/**
	 * Number of delivery attempts made
	 */
	attempts: number;
}
