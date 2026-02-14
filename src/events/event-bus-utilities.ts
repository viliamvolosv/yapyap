/**
 * Convenience utilities for the YapYap Event Bus
 */

import type { EventBus } from "./event-bus";
import type { EventHandler, EventMap } from "./event-listener-types";
import type { YapYapEvent } from "./event-types";

/**
 * Create a logging event handler for a specific event type
 */
export function createLogHandler<
	TEvents extends EventMap,
	K extends keyof TEvents,
>(
	eventBus: EventBus<TEvents>,
	eventType: K,
	options: {
		logPayload?: boolean;
		logId?: boolean;
		logFn?: (message: string) => void;
	} = {},
): () => void {
	const { logPayload = true, logId = true, logFn = console.log } = options;

	const handler: EventHandler<TEvents[K]> = (event) => {
		const parts: string[] = [`[${String(event.type)}]`];

		if (logId && "id" in event) {
			parts.push(`id: ${(event as YapYapEvent).id}`);
		}

		if (logPayload) {
			const relevantFields = Object.entries(event as object)
				.filter(
					([key]) => key !== "type" && key !== "id" && key !== "timestamp",
				)
				.slice(0, 5);

			if (relevantFields.length > 0) {
				const fields = relevantFields
					.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
					.join(", ");
				parts.push(fields);
			}
		}

		logFn(parts.join(" "));
	};

	return eventBus.addListener(eventType, handler);
}

/**
 * Create a rate-limited emitter
 */
export function createRateLimitedEmitter<TEvents extends EventMap>(
	eventBus: EventBus<TEvents>,
	options: {
		maxEventsPerSecond: number;
		onRateLimitExceeded?: () => void;
	},
) {
	let lastEmitTime = 0;
	let eventQueue: TEvents[keyof TEvents][] = [];
	let isProcessing = false;

	const { maxEventsPerSecond, onRateLimitExceeded } = options;

	async function processQueue(): Promise<void> {
		if (isProcessing || eventQueue.length === 0) return;

		isProcessing = true;

		while (eventQueue.length > 0) {
			const now = Date.now();
			const elapsed = now - lastEmitTime;

			const minInterval = 1000 / maxEventsPerSecond;

			if (elapsed < minInterval) {
				if (onRateLimitExceeded) onRateLimitExceeded();
				await new Promise((r) => setTimeout(r, minInterval - elapsed));
			}

			const event = eventQueue.shift();
			if (event) {
				lastEmitTime = Date.now();
				await eventBus.emit(event);
			}
		}

		isProcessing = false;
	}

	return {
		emit: async (event: TEvents[keyof TEvents]): Promise<void> => {
			eventQueue.push(event);
			if (!isProcessing) {
				await processQueue();
			}
		},

		stop: async (): Promise<void> => {
			await processQueue();
		},

		getQueueSize: () => eventQueue.length,

		clearQueue: () => {
			eventQueue = [];
		},
	};
}

/**
 * Create a debug emitter wrapper
 */
export function createDebugEmitter<TEvents extends EventMap>(
	eventBus: EventBus<TEvents>,
	options: {
		eventTypes?: Array<keyof TEvents>;
		debugLogFn?: (message: string) => void;
	},
) {
	const { eventTypes, debugLogFn = console.debug } = options;

	return {
		emit: async <K extends keyof TEvents>(event: TEvents[K]): Promise<void> => {
			if (eventTypes && !eventTypes.includes(event.type as K)) {
				await eventBus.emit(event);
				return;
			}

			debugLogFn(
				JSON.stringify(
					{
						eventType: event.type,
						timestamp: new Date().toISOString(),
						payload: event,
					},
					null,
					2,
				),
			);

			await eventBus.emit(event);
		},

		stop: (): void => {
			/* no-op */
		},
	};
}

/**
 * Create a filtered handler
 */
export function createFilteredHandler<
	TEvents extends EventMap,
	K extends keyof TEvents,
>(
	eventBus: EventBus<TEvents>,
	options: {
		eventType: K;
		filter: (event: TEvents[K]) => boolean;
		handler: EventHandler<TEvents[K]>;
		once?: boolean;
	},
): () => void {
	const { eventType, filter, handler, once } = options;

	const filteredHandler: EventHandler<TEvents[K]> = async (event) => {
		if (!filter(event)) return;

		await handler(event);

		if (once) {
			eventBus.removeListener(eventType, filteredHandler);
		}
	};

	return once
		? eventBus.once(eventType, filteredHandler)
		: eventBus.addListener(eventType, filteredHandler);
}

/**
 * Create a batched emitter
 */
export function createBatchedEmitter<TEvents extends EventMap>(
	eventBus: EventBus<TEvents>,
	options: {
		maxBatchSize: number;
		maxBatchTime: number;
		eventTypes?: Array<keyof TEvents>;
	},
) {
	const { maxBatchSize, maxBatchTime, eventTypes } = options;

	let batch: TEvents[keyof TEvents][] = [];
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	async function flushBatch(): Promise<void> {
		if (batch.length === 0) return;

		const eventsToEmit = batch;
		batch = [];

		for (const event of eventsToEmit) {
			await eventBus.emit(event);
		}
	}

	return {
		emit: async <K extends keyof TEvents>(event: TEvents[K]): Promise<void> => {
			if (eventTypes && !eventTypes.includes(event.type as K)) {
				await eventBus.emit(event);
				return;
			}

			batch.push(event);

			if (batch.length >= maxBatchSize) {
				await flushBatch();
			} else if (!timeoutId) {
				timeoutId = setTimeout(async () => {
					await flushBatch();
					timeoutId = null;
				}, maxBatchTime);
			}
		},

		stop: async (): Promise<void> => {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			await flushBatch();
		},

		getBatchSize: () => batch.length,

		clearBatch: () => {
			batch = [];
		},
	};
}

/**
 * Wrap handler to ensure async execution
 */
export function createAsyncHandler<T extends YapYapEvent>(
	handler: EventHandler<T>,
): EventHandler<T> {
	return async (event) => {
		await handler(event);
	};
}
