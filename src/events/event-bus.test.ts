/**
import assert from "node:assert";
 * Unit tests for EventBus
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import { EventBus } from "./event-bus.js";
import { ListenerScope } from "./event-listener-types.js";
import type { YapYapEvent } from "./event-types.js";

describe("EventBus", () => {
	let eventBus: EventBus<Record<string, YapYapEvent>>;

	beforeEach(() => {
		EventBus.resetInstance();
		eventBus = EventBus.getInstance<Record<string, YapYapEvent>>();
	});

	afterEach(() => {
		eventBus.shutdown();
		EventBus.resetInstance();
	});

	describe("Singleton Pattern", () => {
		it("should create a singleton instance", () => {
			const instance1 = EventBus.getInstance();
			const instance2 = EventBus.getInstance();

			assert.strictEqual(instance1, instance2);
		});

		it("should allow instance reset", () => {
			const instance1 = EventBus.getInstance();
			EventBus.resetInstance();
			const instance2 = EventBus.getInstance();

			assert.notStrictEqual(instance1, instance2);
		});
	});

	describe("Event Listener Registration", () => {
		it("should add a listener to an event type", () => {
			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			const remove = eventBus.addListener(eventType, handler);

			assert.strictEqual(eventBus.hasListeners(eventType), true);
			assert.strictEqual(eventBus.getListenerCount(eventType), 1);

			remove();
			assert.strictEqual(eventBus.hasListeners(eventType), false);
		});

		it("should allow multiple listeners for the same event type", () => {
			const eventType = "test.event";
			const handler1 = (_event: YapYapEvent) => {};
			const handler2 = (_event: YapYapEvent) => {};
			const handler3 = (_event: YapYapEvent) => {};

			eventBus.addListener(eventType, handler1);
			eventBus.addListener(eventType, handler2);
			eventBus.addListener(eventType, handler3);

			assert.strictEqual(eventBus.getListenerCount(eventType), 3);
		});

		it("should return a removal function when adding a listener", () => {
			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			const remove = eventBus.addListener(eventType, handler);

			assert.strictEqual(typeof remove, "function");

			remove();
			assert.strictEqual(eventBus.hasListeners(eventType), false);
		});

		it("should remove a specific listener when calling the removal function", () => {
			const eventType = "test.event";
			const handler1 = (_event: YapYapEvent) => {};
			const handler2 = (_event: YapYapEvent) => {};

			eventBus.addListener(eventType, handler1);
			const remove = eventBus.addListener(eventType, handler2);

			assert.strictEqual(eventBus.getListenerCount(eventType), 2);

			remove();
			assert.strictEqual(eventBus.getListenerCount(eventType), 1);
		});

		it("should remove all listeners when removeAllListeners is called", () => {
			const eventType = "test.event";
			const handler1 = (_event: YapYapEvent) => {};
			const handler2 = (_event: YapYapEvent) => {};
			const handler3 = (_event: YapYapEvent) => {};

			eventBus.addListener(eventType, handler1);
			eventBus.addListener(eventType, handler2);
			eventBus.addListener(eventType, handler3);

			eventBus.removeAllListeners(eventType);

			assert.strictEqual(eventBus.hasListeners(eventType), false);
		});

		it("should throw error when adding listener after shutdown", () => {
			eventBus.shutdown();

			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			expect(() => {
				eventBus.addListener(eventType, handler);
			}).toThrow("Cannot add listeners after shutdown");
		});
	});

	describe("Event Emission", () => {
		it("should emit events to all registered listeners", async () => {
			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {
				// Simulate processing
			};

			eventBus.addListener(eventType, handler);

			const testEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			await eventBus.emit(testEvent);

			assert.strictEqual(eventBus.hasListeners(eventType), true);
		});

		it("should not emit events if no listeners are registered", async () => {
			const eventType = "test.event";

			const testEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			await eventBus.emit(testEvent);

			// Should not throw
			assert.strictEqual(eventBus.hasListeners(eventType), false);
		});

		it("should execute multiple listeners for the same event", async () => {
			const eventType = "test.event";
			const results: unknown[] = [];

			const handler1 = (_event: YapYapEvent) => {
				results.push("handler1");
			};

			const handler2 = (_event: YapYapEvent) => {
				results.push("handler2");
			};

			const handler3 = (_event: YapYapEvent) => {
				results.push("handler3");
			};

			eventBus.addListener(eventType, handler1);
			eventBus.addListener(eventType, handler2);
			eventBus.addListener(eventType, handler3);

			const testEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			await eventBus.emit(testEvent);

			assert.deepStrictEqual(results, ["handler1", "handler2", "handler3"]);
		});

		it("should handle errors in event handlers gracefully", async () => {
			const eventType = "test.event";
			const error = new Error("Handler error");

			const failingHandler = (_event: YapYapEvent) => {
				throw error;
			};

			const successHandler = (_event: YapYapEvent) => {
				// Should still execute
			};

			eventBus.addListener(eventType, failingHandler);
			eventBus.addListener(eventType, successHandler);

			const testEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			// Should not throw
			await eventBus.emit(testEvent);
		});

		it("should emit events after shutdown", async () => {
			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			eventBus.addListener(eventType, handler);
			eventBus.shutdown();

			const testEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			// Should not throw
			await eventBus.emit(testEvent);
		});
	});

	describe("Event History", () => {
		it("should store events in history", async () => {
			const eventType = "test.event";

			const testEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			await eventBus.emit(testEvent);

			const history = eventBus.getHistory(eventType);
			assert.strictEqual(history.length, 1);
			const firstEvent = history[0];
			assert.notStrictEqual(firstEvent, undefined);
			if (firstEvent) {
				assert.deepStrictEqual(firstEvent.event, testEvent);
			}
		});

		it("should limit history size to maxHistorySize", async () => {
			EventBus.resetInstance();
			const eventBus = EventBus.getInstance<Record<string, YapYapEvent>>({
				maxHistorySize: 3,
			});
			const eventType = "test.event";

			for (let i = 0; i < 5; i++) {
				const testEvent = {
					type: eventType,
					id: `test-id-${i}`,
					timestamp: Date.now(),
				} as unknown as YapYapEvent;
				await eventBus.emit(testEvent);
			}

			const history = eventBus.getHistory(eventType);
			assert.strictEqual(history.length, 3);
		});

		it("should clear history for a specific event type", async () => {
			const eventType1 = "test.event1";
			const eventType2 = "test.event2";

			const testEvent1 = {
				type: eventType1,
				id: "test-id-1",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			const testEvent2 = {
				type: eventType2,
				id: "test-id-2",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			await eventBus.emit(testEvent1);
			await eventBus.emit(testEvent2);

			assert.strictEqual(eventBus.getHistory(eventType1).length, 1);
			assert.strictEqual(eventBus.getHistory(eventType2).length, 1);

			eventBus.clearHistory(eventType1);

			assert.strictEqual(eventBus.getHistory(eventType1)?.length, 0);
			assert.strictEqual(eventBus.getHistory(eventType2)?.length, 1);
		});

		it("should clear all history", async () => {
			const eventType1 = "test.event1";
			const eventType2 = "test.event2";

			const testEvent1 = {
				type: eventType1,
				id: "test-id-1",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			const testEvent2 = {
				type: eventType2,
				id: "test-id-2",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			await eventBus.emit(testEvent1);
			await eventBus.emit(testEvent2);

			assert.strictEqual(eventBus.getHistory(eventType1)?.length, 1);
			assert.strictEqual(eventBus.getHistory(eventType2)?.length, 1);

			eventBus.clearHistory();

			assert.strictEqual(eventBus.getHistory(eventType1)?.length, 0);
			assert.strictEqual(eventBus.getHistory(eventType2)?.length, 0);
		});

		it("should return events in timestamp order", async () => {
			const eventType = "test.event";
			const times: number[] = [];

			for (let i = 0; i < 3; i++) {
				const testEvent = {
					type: eventType,
					id: `test-id-${i}`,
					timestamp: Date.now() + i,
				} as unknown as YapYapEvent;
				await eventBus.emit(testEvent);
				times.push(testEvent.timestamp);
			}

			const history = eventBus.getHistory(eventType);
			const historyTimes = history.map(
				(item: { event: YapYapEvent; timestamp: number }) =>
					item.event.timestamp,
			);

			assert.deepStrictEqual(historyTimes, times);
		});
	});

	describe("Event Statistics", () => {
		it("should return correct statistics", async () => {
			const eventType1 = "test.event1";
			const eventType2 = "test.event2";

			const testEvent1 = {
				type: eventType1,
				id: "test-id-1",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			const testEvent2 = {
				type: eventType2,
				id: "test-id-2",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			eventBus.addListener(eventType1, () => {});
			eventBus.addListener(eventType1, () => {});
			eventBus.addListener(eventType2, () => {});

			await eventBus.emit(testEvent1);
			await eventBus.emit(testEvent1);
			await eventBus.emit(testEvent2);

			const stats = eventBus.getStats();

			assert.strictEqual(stats.totalListeners, 3);
			assert.strictEqual(stats.totalEvents, 2);
			assert.strictEqual(stats.eventTypes[eventType1]?.listenerCount, 2);
			assert.strictEqual(stats.eventTypes[eventType1]?.emittedCount, 2);
			assert.strictEqual(stats.eventTypes[eventType2]?.listenerCount, 1);
			assert.strictEqual(stats.eventTypes[eventType2]?.emittedCount, 1);
		});
	});

	describe("Once Listener", () => {
		it("should remove listener after first emission", async () => {
			const eventType = "test.event";
			const results: string[] = [];

			const handler = (_event: YapYapEvent) => {
				results.push("called");
			};

			eventBus.once(eventType, handler);

			const testEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			await eventBus.emit(testEvent);
			assert.deepStrictEqual(results, ["called"]);
			assert.strictEqual(eventBus.hasListeners(eventType), false);

			// Should not call again
			await eventBus.emit(testEvent);
			assert.strictEqual(results.length, 1);
		});
	});

	describe("ListenerScope", () => {
		it("should create a listener scope", () => {
			const scope = new ListenerScope();

			assert.ok(scope instanceof ListenerScope);
			assert.strictEqual(scope.isDestroyed(), false);
		});

		it("should add listeners to a scope", () => {
			const scope = eventBus.createListenerScope();

			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			scope.addListener(eventType, handler);

			assert.strictEqual(scope.getListenerCount(eventType), 1);
		});

		it("should remove listeners when scope is destroyed", () => {
			const scope = eventBus.createListenerScope();

			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			scope.addListener(eventType, handler);

			scope.destroy();

			assert.strictEqual(scope.isDestroyed(), true);
			assert.strictEqual(eventBus.hasListeners(eventType), false);
		});

		it("should throw error when adding listeners after scope is destroyed", () => {
			const scope = eventBus.createListenerScope();
			scope.destroy();

			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			expect(() => {
				scope.addListener(eventType, handler);
			}).toThrow();
		});

		it("should track total listener count", () => {
			const scope = eventBus.createListenerScope();

			assert.strictEqual(scope.getListenerCount(), 0);

			scope.addListener("test.event1", () => {});
			assert.strictEqual(scope.getListenerCount(), 1);

			scope.addListener("test.event2", () => {});
			assert.strictEqual(scope.getListenerCount(), 2);

			scope.destroy();
			assert.strictEqual(scope.getListenerCount(), 0);
		});
	});

	describe("Shutdown", () => {
		it("should prevent adding listeners after shutdown", () => {
			eventBus.shutdown();

			expect(() => {
				eventBus.addListener("test.event", () => {});
			}).toThrow("Cannot add listeners after shutdown");
		});

		it("should prevent emitting events after shutdown", async () => {
			eventBus.shutdown();

			const testEvent = {
				type: "test.event",
				id: "test-id",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			// Should not throw
			await eventBus.emit(testEvent);
		});

		it("should clear all listeners on shutdown", async () => {
			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			eventBus.addListener(eventType, handler);

			eventBus.shutdown();

			assert.strictEqual(eventBus.hasListeners(eventType), false);
		});

		it("should clear all history on shutdown", async () => {
			const eventType = "test.event";

			const testEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
			} as unknown as YapYapEvent;

			await eventBus.emit(testEvent);

			eventBus.shutdown();

			assert.strictEqual(eventBus.getHistory(eventType)?.length, 0);
		});

		it("isShutdown should return true after shutdown", () => {
			eventBus.shutdown();

			assert.strictEqual(eventBus.isShutdown(), true);
		});
	});
});
