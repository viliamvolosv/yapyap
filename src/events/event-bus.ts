/**
 * Core EventBus implementation for the YapYap Event Bus
 * Provides a type-safe, pub/sub event system with history and debugging capabilities
 */

import {
	type EventHandler,
	type EventMap,
	type EventStats,
	ListenerScope,
	type TypedEventEmitter,
} from "./event-listener-types";
import type { YapYapEvent } from "./event-types";

/**
 * Configuration options for EventBus
 */
export interface EventBusOptions {
	maxHistorySize?: number;
	debug?: boolean;
	logHandler?: (message: string) => void;
}

/**
 * Default EventBus implementation
 */
export class EventBus<TEvents extends EventMap>
	implements TypedEventEmitter<TEvents>
{
	private static instance: EventBus<EventMap> | null = null;

	/**
	 * Strongly typed listener registry
	 */
	private registry: {
		[K in keyof TEvents]?: Set<EventHandler<TEvents[K]>>;
	} = {};

	private history: {
		[K in keyof TEvents]?: Array<{ event: TEvents[K]; timestamp: number }>;
	} = {};

	private readonly maxHistorySize: number;
	private readonly debug: boolean;
	private readonly logHandler: (message: string) => void;

	private isShuttingDown = false;

	private constructor(options: EventBusOptions = {}) {
		this.maxHistorySize = options.maxHistorySize ?? 100;
		this.debug = options.debug ?? false;
		this.logHandler = options.logHandler ?? (() => {});
	}

	/**
	 * Singleton accessor
	 */
	public static getInstance<TEvents extends EventMap>(
		options?: EventBusOptions,
	): EventBus<TEvents> {
		if (!EventBus.instance) {
			EventBus.instance = new EventBus<TEvents>(
				options,
			) as unknown as EventBus<EventMap>;
		}
		return EventBus.instance as unknown as EventBus<TEvents>;
	}

	public static resetInstance(): void {
		EventBus.instance = null;
	}

	public addListener<K extends keyof TEvents>(
		eventType: K,
		handler: EventHandler<TEvents[K]>,
	): () => void {
		if (this.isShuttingDown) {
			throw new Error("Cannot add listeners after shutdown");
		}

		if (!this.registry[eventType]) {
			this.registry[eventType] = new Set();
		}

		this.registry[eventType]?.add(handler);

		this.log(`Listener added for event: ${String(eventType)}`);

		return () => {
			this.removeListener(eventType, handler);
		};
	}

	public removeListener<K extends keyof TEvents>(
		eventType: K,
		handler: EventHandler<TEvents[K]>,
	): void {
		const handlers = this.registry[eventType];
		if (!handlers) return;

		handlers.delete(handler);

		if (handlers.size === 0) {
			delete this.registry[eventType];
		}

		this.log(`Listener removed for event: ${String(eventType)}`);
	}

	public removeAllListeners<K extends keyof TEvents>(eventType: K): void {
		delete this.registry[eventType];
		this.log(`All listeners removed for event: ${String(eventType)}`);
	}

	public async emit<K extends keyof TEvents>(event: TEvents[K]): Promise<void> {
		if (this.isShuttingDown) return;

		const eventType = event.type as K;
		const handlers = this.registry[eventType];

		if (handlers && handlers.size > 0) {
			this.log(`Emitting event: ${String(eventType)}`);

			const promises = Array.from(handlers).map(async (handler) => {
				try {
					await handler(event);
				} catch (error) {
					this.log(`Error in event handler for ${String(eventType)}`, error);
				}
			});

			await Promise.allSettled(promises);
		}

		this.updateHistory(eventType, event);
	}

	public hasListeners<K extends keyof TEvents>(eventType: K): boolean {
		return !!this.registry[eventType]?.size;
	}

	public getListenerCount<K extends keyof TEvents>(eventType: K): number {
		return this.registry[eventType]?.size ?? 0;
	}

	public getListeners<K extends keyof TEvents>(
		eventType: K,
	): ReadonlyArray<EventHandler<TEvents[K]>> {
		const handlers = this.registry[eventType];
		return handlers ? Array.from(handlers) : [];
	}

	public getRegisteredEventTypes(): Array<keyof TEvents> {
		return Object.keys(this.registry) as Array<keyof TEvents>;
	}

	private updateHistory<K extends keyof TEvents>(
		eventType: K,
		event: TEvents[K],
	): void {
		if (!this.history[eventType]) {
			this.history[eventType] = [];
		}

		const eventHistory = this.history[eventType];
		if (!eventHistory) return;

		eventHistory.push({ event, timestamp: Date.now() });

		while (eventHistory.length > this.maxHistorySize) {
			eventHistory.shift();
		}
	}

	public getHistory<K extends keyof TEvents>(
		eventType: K,
		limit?: number,
	): Array<{ event: TEvents[K]; timestamp: number }> {
		const eventHistory = this.history[eventType] ?? [];
		return limit ? eventHistory.slice(-limit) : eventHistory;
	}

	public clearHistory<K extends keyof TEvents>(eventType?: K): void {
		if (eventType) {
			delete this.history[eventType];
		} else {
			this.history = {};
		}
	}

	public once<K extends keyof TEvents>(
		eventType: K,
		handler: EventHandler<TEvents[K]>,
	): () => void {
		const wrapper: EventHandler<TEvents[K]> = async (event) => {
			const result = await handler(event);
			this.removeListener(eventType, wrapper);
			return result;
		};

		return this.addListener(eventType, wrapper);
	}

	public createListenerScope(): ListenerScope<TEvents> {
		return new ListenerScope<TEvents>();
	}

	public shutdown(): void {
		if (this.isShuttingDown) return;

		this.isShuttingDown = true;
		this.registry = {};
		this.history = {};
		this.log("EventBus shutdown");
	}

	public isShutdown(): boolean {
		return this.isShuttingDown;
	}

	public getStats(): EventStats {
		const eventTypes: EventStats["eventTypes"] = {};
		const history: EventStats["history"] = {};

		let totalListeners = 0;

		for (const key of Object.keys(this.registry)) {
			const k = key as keyof TEvents;
			const handlers = this.registry[k];
			if (!handlers) continue;

			totalListeners += handlers.size;

			eventTypes[key] = {
				listenerCount: handlers.size,
				emittedCount: this.history[k]?.length ?? 0,
			};

			history[key] = {
				events: (this.history[k] ?? []) as {
					event: YapYapEvent;
					timestamp: number;
				}[],
			};
		}

		return {
			totalEvents: Object.keys(this.history).length,
			totalListeners,
			eventTypes,
			history,
		};
	}

	private log(message: string, error?: unknown): void {
		if (!this.debug) return;

		const timestamp = new Date().toISOString();
		const logMessage = `[EventBus] [${timestamp}] ${message}`;

		this.logHandler(logMessage);

		if (error) {
			console.error(error);
		}
	}
}
