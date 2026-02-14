/**
 * Event Types for the YapYap Event Bus
 * Defines all event types used throughout the application with strict TypeScript typing
 */

/**
 * Base event interface for all events in the system
 */
export interface BaseEvent {
	/**
	 * Unique identifier for the event
	 */
	id: string;

	/**
	 * Timestamp when the event was created
	 */
	timestamp: number;

	/**
	 * Type of the event (used for event bus routing)
	 */
	type: string;
}

/**
 * Event namespace prefixes for organizing events
 */
export namespace Events {
	/**
	 * Message-related events
	 */
	export const Message = {
		/**
		 * Emitted when a message is received and processed
		 */
		Received: "message.received",
		/**
		 * Emitted when a message is queued for sending
		 */
		Queued: "database.message.queued",
		/**
		 * Emitted when a message is sent
		 */
		Sent: "message.sent",
		/**
		 * Emitted when a message is delivered to peer
		 */
		Delivered: "message.delivered",
		/**
		 * Emitted when message delivery fails
		 */
		Failed: "message.failed",
		/**
		 * Emitted when an ACK is received
		 */
		AckReceived: "ack.received",
		/**
		 * Emitted when a NAK is received
		 */
		NakReceived: "nak.received",
	};

	/**
	 * Database-related events
	 */
	export const Database = {
		/**
		 * Emitted when a message is queued for sending
		 */
		MessageQueued: "database.message.queued",
		/**
		 * Emitted when a message status is updated
		 */
		MessageUpdated: "database.message.updated",
		/**
		 * Emitted when a routing entry is updated
		 */
		RoutingUpdated: "database.routing.updated",
		/**
		 * Emitted when a contact is saved
		 */
		ContactSaved: "database.contact.saved",
	};

	/**
	 * Network-related events
	 */
	export const Network = {
		/**
		 * Emitted when a peer connects
		 */
		PeerConnected: "network.peer.connected",
		/**
		 * Emitted when a peer disconnects
		 */
		PeerDisconnected: "network.peer.disconnected",
		/**
		 * Emitted when a network stream is opened
		 */
		StreamOpened: "network.stream.opened",
		/**
		 * Emitted when a network stream is closed
		 */
		StreamClosed: "network.stream.closed",
	};

	/**
	 * Routing-related events
	 */
	export const Routing = {
		/**
		 * Emitted when a peer is discovered
		 */
		PeerDiscovered: "routing.peer.discovered",
		/**
		 * Emitted when routing table is updated
		 */
		TableUpdated: "routing.table.updated",
		/**
		 * Emitted when routing reputation is updated
		 */
		ReputationUpdated: "routing.reputation.updated",
	};

	/**
	 * Crypto/Session-related events
	 */
	export const Crypto = {
		/**
		 * Emitted when a session is created
		 */
		SessionCreated: "crypto.session.created",
		/**
		 * Emitted when a session expires
		 */
		SessionExpired: "crypto.session.expired",
	};

	/**
	 * Node lifecycle events
	 */
	export const Node = {
		/**
		 * Emitted when the node starts
		 */
		Started: "node.started",
		/**
		 * Emitted when the node stops
		 */
		Stopped: "node.stopped",
		/**
		 * Emitted when the node encounters an error
		 */
		Error: "node.error",
	};
}

/**
 * Message received event payload
 */
export interface MessageReceivedEvent extends BaseEvent {
	type: typeof Events.Message.Received;
	/**
	 * The message that was received
	 */
	message: {
		id: string;
		from: string;
		to: string;
		content: string;
		timestamp: number;
	};
	/**
	 * Whether the message was already known
	 */
	wasDuplicate: boolean;
}

/**
 * Message queued event payload
 */
export interface MessageQueuedEvent extends BaseEvent {
	type: typeof Events.Message.Queued;
	/**
	 * The message that was queued
	 */
	message: {
		id: string;
		to: string;
		content: string;
		timestamp: number;
	};
}

/**
 * Message sent event payload
 */
export interface MessageSentEvent extends BaseEvent {
	type: typeof Events.Message.Sent;
	/**
	 * The message that was sent
	 */
	message: {
		id: string;
		to: string;
		content: string;
		timestamp: number;
	};
}

/**
 * Message delivered event payload
 */
export interface MessageDeliveredEvent extends BaseEvent {
	type: typeof Events.Message.Delivered;
	/**
	 * The message that was delivered
	 */
	message: {
		id: string;
		to: string;
		peer: string;
	};
}

/**
 * Message failed event payload
 */
export interface MessageFailedEvent extends BaseEvent {
	type: typeof Events.Message.Failed;
	/**
	 * The message that failed
	 */
	message: {
		id: string;
		to: string;
		error: string;
	};
}

/**
 * ACK received event payload
 */
export interface AckReceivedEvent extends BaseEvent {
	type: typeof Events.Message.AckReceived;
	/**
	 * The message ID that was acknowledged
	 */
	messageId: string;
	/**
	 * The peer that sent the ACK
	 */
	peer: string;
	/**
	 * Timestamp when ACK was received
	 */
	timestamp: number;
}

/**
 * NAK received event payload
 */
export interface NakReceivedEvent extends BaseEvent {
	type: typeof Events.Message.NakReceived;
	/**
	 * The message ID that was negatively acknowledged
	 */
	messageId: string;
	/**
	 * The peer that sent the NAK
	 */
	peer: string;
	/**
	 * Error message
	 */
	error: string;
}

/**
 * Database message updated event payload
 */
export interface DatabaseMessageUpdatedEvent extends BaseEvent {
	type: typeof Events.Database.MessageUpdated;
	/**
	 * The message ID
	 */
	messageId: string;
	/**
	 * Previous status
	 */
	previousStatus: string;
	/**
	 * New status
	 */
	newStatus: string;
}

/**
 * Database routing updated event payload
 */
export interface DatabaseRoutingUpdatedEvent extends BaseEvent {
	type: typeof Events.Database.RoutingUpdated;
	/**
	 * Routing entry that was updated
	 */
	peer: string;
	/**
	 * Updated routing information
	 */
	routing: {
		peer: string;
		lastSeen: number;
		reputation: number;
	};
}

/**
 * Database contact saved event payload
 */
export interface DatabaseContactSavedEvent extends BaseEvent {
	type: typeof Events.Database.ContactSaved;
	/**
	 * Contact that was saved
	 */
	contact: {
		id: string;
		name: string;
		peerId: string;
	};
}

/**
 * Network peer connected event payload
 */
export interface NetworkPeerConnectedEvent extends BaseEvent {
	type: typeof Events.Network.PeerConnected;
	/**
	 * The peer that connected
	 */
	peer: string;
	/**
	 * Connection details
	 */
	connection: {
		remoteAddress: string;
		port: number;
		timestamp: number;
	};
}

/**
 * Network peer disconnected event payload
 */
export interface NetworkPeerDisconnectedEvent extends BaseEvent {
	type: typeof Events.Network.PeerDisconnected;
	/**
	 * The peer that disconnected
	 */
	peer: string;
	/**
	 * Reason for disconnection
	 */
	reason: string;
}

/**
 * Network stream opened event payload
 */
export interface NetworkStreamOpenedEvent extends BaseEvent {
	type: typeof Events.Network.StreamOpened;
	/**
	 * The peer associated with the stream
	 */
	peer: string;
	/**
	 * Stream identifier
	 */
	streamId: string;
}

/**
 * Network stream closed event payload
 */
export interface NetworkStreamClosedEvent extends BaseEvent {
	type: typeof Events.Network.StreamClosed;
	/**
	 * The peer associated with the stream
	 */
	peer: string;
	/**
	 * Stream identifier
	 */
	streamId: string;
	/**
	 * Reason for closing
	 */
	reason: string;
}

/**
 * Routing peer discovered event payload
 */
export interface RoutingPeerDiscoveredEvent extends BaseEvent {
	type: typeof Events.Routing.PeerDiscovered;
	/**
	 * The peer that was discovered
	 */
	peer: string;
	/**
	 * Discovered routing information
	 */
	routing: {
		peer: string;
		lastSeen: number;
		reputation: number;
	};
}

/**
 * Routing table updated event payload
 */
export interface RoutingTableUpdatedEvent extends BaseEvent {
	type: typeof Events.Routing.TableUpdated;
	/**
	 * Number of entries in the routing table
	 */
	entryCount: number;
	/**
	 * Updated routing information
	 */
	routing: {
		peer: string;
		lastSeen: number;
		reputation: number;
	}[];
}

/**
 * Routing reputation updated event payload
 */
export interface RoutingReputationUpdatedEvent extends BaseEvent {
	type: typeof Events.Routing.ReputationUpdated;
	/**
	 * The peer whose reputation was updated
	 */
	peer: string;
	/**
	 * Old reputation value
	 */
	oldReputation: number;
	/**
	 * New reputation value
	 */
	newReputation: number;
}

/**
 * Crypto session created event payload
 */
export interface CryptoSessionCreatedEvent extends BaseEvent {
	type: typeof Events.Crypto.SessionCreated;
	/**
	 * Session identifier
	 */
	sessionId: string;
	/**
	 * Associated peer
	 */
	peer: string;
	/**
	 * Session details
	 */
	session: {
		sessionId: string;
		peer: string;
		createdAt: number;
		expiresAt: number;
	};
}

/**
 * Crypto session expired event payload
 */
export interface CryptoSessionExpiredEvent extends BaseEvent {
	type: typeof Events.Crypto.SessionExpired;
	/**
	 * Session identifier
	 */
	sessionId: string;
	/**
	 * Associated peer
	 */
	peer: string;
}

/**
 * Node started event payload
 */
export interface NodeStartedEvent extends BaseEvent {
	type: typeof Events.Node.Started;
	/**
	 * Node identifier
	 */
	nodeId: string;
	/**
	 * Startup timestamp
	 */
	startedAt: number;
}

/**
 * Node stopped event payload
 */
export interface NodeStoppedEvent extends BaseEvent {
	type: typeof Events.Node.Stopped;
	/**
	 * Node identifier
	 */
	nodeId: string;
	/**
	 * Shutdown timestamp
	 */
	stoppedAt: number;
}

/**
 * Node error event payload
 */
export interface NodeErrorEvent extends BaseEvent {
	type: typeof Events.Node.Error;
	/**
	 * Node identifier
	 */
	nodeId: string;
	/**
	 * Error message
	 */
	error: string;
	/**
	 * Error stack trace
	 */
	stack?: string;
}

/**
 * Union type of all event types
 */
export type YapYapEvent =
	| MessageReceivedEvent
	| MessageQueuedEvent
	| MessageSentEvent
	| MessageDeliveredEvent
	| MessageFailedEvent
	| AckReceivedEvent
	| NakReceivedEvent
	| DatabaseMessageUpdatedEvent
	| DatabaseRoutingUpdatedEvent
	| DatabaseContactSavedEvent
	| NetworkPeerConnectedEvent
	| NetworkPeerDisconnectedEvent
	| NetworkStreamOpenedEvent
	| NetworkStreamClosedEvent
	| RoutingPeerDiscoveredEvent
	| RoutingTableUpdatedEvent
	| RoutingReputationUpdatedEvent
	| CryptoSessionCreatedEvent
	| CryptoSessionExpiredEvent
	| NodeStartedEvent
	| NodeStoppedEvent
	| NodeErrorEvent;
