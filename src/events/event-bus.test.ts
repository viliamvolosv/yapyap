/**
 * Unit tests for EventBus
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventBus } from "./event-bus";
import { ListenerScope } from "./event-listener-types";
import type { YapYapEvent } from "./event-types";

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

			expect(instance1).toBe(instance2);
		});

		it("should allow instance reset", () => {
			const instance1 = EventBus.getInstance();
			EventBus.resetInstance();
			const instance2 = EventBus.getInstance();

			expect(instance1).not.toBe(instance2);
		});
	});

	describe("Event Listener Registration", () => {
		it("should add a listener to an event type", () => {
			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			const remove = eventBus.addListener(eventType, handler);

			expect(eventBus.hasListeners(eventType)).toBe(true);
			expect(eventBus.getListenerCount(eventType)).toBe(1);

			remove();
			expect(eventBus.hasListeners(eventType)).toBe(false);
		});

		it("should allow multiple listeners for the same event type", () => {
			const eventType = "test.event";
			const handler1 = (_event: YapYapEvent) => {};
			const handler2 = (_event: YapYapEvent) => {};
			const handler3 = (_event: YapYapEvent) => {};

			eventBus.addListener(eventType, handler1);
			eventBus.addListener(eventType, handler2);
			eventBus.addListener(eventType, handler3);

			expect(eventBus.getListenerCount(eventType)).toBe(3);
		});

		it("should return a removal function when adding a listener", () => {
			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			const remove = eventBus.addListener(eventType, handler);

			expect(typeof remove).toBe("function");

			remove();
			expect(eventBus.hasListeners(eventType)).toBe(false);
		});

		it("should remove a specific listener when calling the removal function", () => {
			const eventType = "test.event";
			const handler1 = (_event: YapYapEvent) => {};
			const handler2 = (_event: YapYapEvent) => {};

			eventBus.addListener(eventType, handler1);
			const remove = eventBus.addListener(eventType, handler2);

			expect(eventBus.getListenerCount(eventType)).toBe(2);

			remove();
			expect(eventBus.getListenerCount(eventType)).toBe(1);
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

			expect(eventBus.hasListeners(eventType)).toBe(false);
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

			expect(eventBus.hasListeners(eventType)).toBe(true);
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
			expect(eventBus.hasListeners(eventType)).toBe(false);
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

			expect(results).toEqual(["handler1", "handler2", "handler3"]);
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
			expect(history.length).toBe(1);
			const firstEvent = history[0];
			expect(firstEvent).toBeDefined();
			if (firstEvent) {
				expect(firstEvent.event).toEqual(testEvent);
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
			expect(history.length).toBe(3);
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

			expect(eventBus.getHistory(eventType1).length).toBe(1);
			expect(eventBus.getHistory(eventType2).length).toBe(1);

			eventBus.clearHistory(eventType1);

			expect(eventBus.getHistory(eventType1)?.length).toBe(0);
			expect(eventBus.getHistory(eventType2)?.length).toBe(1);
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

			expect(eventBus.getHistory(eventType1)?.length).toBe(1);
			expect(eventBus.getHistory(eventType2)?.length).toBe(1);

			eventBus.clearHistory();

			expect(eventBus.getHistory(eventType1)?.length).toBe(0);
			expect(eventBus.getHistory(eventType2)?.length).toBe(0);
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

			expect(historyTimes).toEqual(times);
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

			expect(stats.totalListeners).toBe(3);
			expect(stats.totalEvents).toBe(2);
			expect(stats.eventTypes[eventType1]?.listenerCount).toBe(2);
			expect(stats.eventTypes[eventType1]?.emittedCount).toBe(2);
			expect(stats.eventTypes[eventType2]?.listenerCount).toBe(1);
			expect(stats.eventTypes[eventType2]?.emittedCount).toBe(1);
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
			expect(results).toEqual(["called"]);
			expect(eventBus.hasListeners(eventType)).toBe(false);

			// Should not call again
			await eventBus.emit(testEvent);
			expect(results.length).toBe(1);
		});
	});

	describe("ListenerScope", () => {
		it("should create a listener scope", () => {
			const scope = new ListenerScope();

			expect(scope).toBeInstanceOf(ListenerScope);
			expect(scope.isDestroyed()).toBe(false);
		});

		it("should add listeners to a scope", () => {
			const scope = eventBus.createListenerScope();

			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			scope.addListener(eventType, handler);

			expect(scope.getListenerCount(eventType)).toBe(1);
		});

		it("should remove listeners when scope is destroyed", () => {
			const scope = eventBus.createListenerScope();

			const eventType = "test.event";
			const handler = (_event: YapYapEvent) => {};

			scope.addListener(eventType, handler);

			scope.destroy();

			expect(scope.isDestroyed()).toBe(true);
			expect(eventBus.hasListeners(eventType)).toBe(false);
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

			expect(scope.getListenerCount()).toBe(0);

			scope.addListener("test.event1", () => {});
			expect(scope.getListenerCount()).toBe(1);

			scope.addListener("test.event2", () => {});
			expect(scope.getListenerCount()).toBe(2);

			scope.destroy();
			expect(scope.getListenerCount()).toBe(0);
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

			expect(eventBus.hasListeners(eventType)).toBe(false);
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

			expect(eventBus.getHistory(eventType)?.length).toBe(0);
		});

		it("isShutdown should return true after shutdown", () => {
			eventBus.shutdown();

			expect(eventBus.isShutdown()).toBe(true);
		});
	});
});
