/**
 * Type-safe event listener interfaces for the YapYap Event Bus
 * Provides strict typing for event handlers and listener management
 */

import type { YapYapEvent } from "./event-types.js";

/**
 * Base event map type.
 * Maps event type strings to concrete YapYapEvent subtypes.
 */
export type EventMap = Record<string, YapYapEvent>;

/**
 * Type-safe event handler function
 */
export type EventHandler<T extends YapYapEvent, R = void> = (
	event: T,
) => R | Promise<R>;

/**
 * Typed event emitter interface
 */
export interface TypedEventEmitter<TEvents extends EventMap> {
	/**
	 * Add a listener for a specific event type
	 */
	addListener<K extends keyof TEvents>(
		eventType: K,
		handler: EventHandler<TEvents[K]>,
	): () => void;

	/**
	 * Remove a listener
	 */
	removeListener<K extends keyof TEvents>(
		eventType: K,
		handler: EventHandler<TEvents[K]>,
	): void;

	/**
	 * Remove all listeners for a specific event type
	 */
	removeAllListeners<K extends keyof TEvents>(eventType: K): void;

	/**
	 * Emit an event
	 */
	emit<K extends keyof TEvents>(event: TEvents[K]): Promise<void>;

	/**
	 * Check if listeners exist
	 */
	hasListeners<K extends keyof TEvents>(eventType: K): boolean;

	/**
	 * Get number of listeners
	 */
	getListenerCount<K extends keyof TEvents>(eventType: K): number;

	/**
	 * Get listeners for event type
	 */
	getListeners<K extends keyof TEvents>(
		eventType: K,
	): ReadonlyArray<EventHandler<TEvents[K]>>;

	/**
	 * Get all registered event types
	 */
	getRegisteredEventTypes(): Array<keyof TEvents>;
}

/**
 * Listener scope for automatic cleanup
 */
export class ListenerScope<TEvents extends EventMap> {
	private readonly listenerMap = new Map<
		keyof TEvents,
		Set<EventHandler<TEvents[keyof TEvents]>>
	>();

	private destroyed = false;

	public addListener<K extends keyof TEvents>(
		eventType: K,
		handler: EventHandler<TEvents[K]>,
	): () => void {
		if (this.destroyed) {
			throw new Error(
				"Cannot add listeners to a destroyed ListenerScope. Create a new scope instead.",
			);
		}

		let handlers = this.listenerMap.get(eventType);
		if (!handlers) {
			handlers = new Set<EventHandler<TEvents[keyof TEvents]>>();
			this.listenerMap.set(eventType, handlers);
		}

		(handlers as Set<EventHandler<TEvents[K]>>).add(handler);

		return () => {
			this.removeListener(eventType, handler);
		};
	}

	public removeListener<K extends keyof TEvents>(
		eventType: K,
		handler: EventHandler<TEvents[K]>,
	): void {
		const handlers = this.listenerMap.get(eventType);
		if (!handlers) return;

		(handlers as Set<EventHandler<TEvents[K]>>).delete(handler);

		if (handlers.size === 0) {
			this.listenerMap.delete(eventType);
		}
	}

	public removeAllListeners(): void {
		if (this.destroyed) return;
		this.listenerMap.clear();
	}

	public destroy(): void {
		this.destroyed = true;
		this.listenerMap.clear();
	}

	public getListenerCount<K extends keyof TEvents>(eventType?: K): number {
		if (eventType) {
			return this.listenerMap.get(eventType)?.size ?? 0;
		}

		let total = 0;
		for (const handlers of this.listenerMap.values()) {
			total += handlers.size;
		}
		return total;
	}

	public getRegisteredEventTypes(): Array<keyof TEvents> {
		return Array.from(this.listenerMap.keys());
	}

	public isDestroyed(): boolean {
		return this.destroyed;
	}
}

/**
 * Event handler registration options
 */
export interface EventHandlerOptions {
	once?: boolean;
	synchronous?: boolean;
}

/**
 * Event listener registration result
 */
export interface EventListenerRegistration<K extends string = string> {
	eventType: K;
	remove: () => void;
	once: boolean;
}

/**
 * Event statistics for debugging
 */
export interface EventStats {
	totalEvents: number;
	totalListeners: number;

	eventTypes: {
		[eventType: string]: {
			listenerCount: number;
			emittedCount: number;
		};
	};

	history: {
		[eventType: string]: {
			events: Array<{ event: YapYapEvent; timestamp: number }>;
		};
	};
}
