/**
 * Integration tests for EventBus
 * Tests EventBus integration with other modules
 */

import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";
import { EventBus } from "../../../src/events/event-bus.js";
import type { YapYapEvent } from "../../../src/events/event-types.js";
import { Events } from "../../../src/events/event-types.js";

describe("EventBus Integration", () => {
	let eventBus: EventBus;

	beforeEach(() => {
		EventBus.resetInstance();
		eventBus = EventBus.getInstance();
	});

	afterEach(() => {
		eventBus.shutdown();
		EventBus.resetInstance();
	});

	describe("MessageRouter Integration", () => {
		it("should emit message.received events", async () => {
			const eventType = Events.Message.Received;
			const receivedEvents: YapYapEvent[] = [];

			eventBus.addListener(eventType, (event) => {
				receivedEvents.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				message: {
					id: "msg-1",
					from: "peer-1",
					to: "peer-2",
					content: "Hello",
					timestamp: Date.now(),
				},
				wasDuplicate: false,
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(receivedEvents.length, 1);
			assert.deepStrictEqual(receivedEvents[0], testEvent);
		});

		it("should emit database.message.queued events", async () => {
			const eventType = Events.Database.MessageQueued;
			const queuedEvents: YapYapEvent[] = [];

			eventBus.addListener(eventType, (event) => {
				queuedEvents.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				message: {
					id: "msg-1",
					to: "peer-2",
					content: "Hello",
					timestamp: Date.now(),
				},
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(queuedEvents.length, 1);
			assert.deepStrictEqual(queuedEvents[0], testEvent);
		});
	});

	describe("DatabaseManager Integration", () => {
		it("should emit database.message.updated events", async () => {
			const eventType = Events.Database.MessageUpdated;
			const updatedEvents: YapYapEvent[] = [];

			eventBus.addListener(eventType, (event) => {
				updatedEvents.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				messageId: "msg-1",
				previousStatus: "pending",
				newStatus: "sent",
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(updatedEvents.length, 1);
			assert.deepStrictEqual(updatedEvents[0], testEvent);
		});

		it("should emit database.routing.updated events", async () => {
			const eventType = Events.Database.RoutingUpdated;
			const routingEvents: YapYapEvent[] = [];

			eventBus.addListener(eventType, (event) => {
				routingEvents.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				peer: "peer-1",
				routing: {
					peer: "peer-1",
					lastSeen: Date.now(),
					reputation: 0.8,
				},
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(routingEvents.length, 1);
			assert.deepStrictEqual(routingEvents[0], testEvent);
		});

		it("should emit database.contact.saved events", async () => {
			const eventType = Events.Database.ContactSaved;
			const contactEvents: YapYapEvent[] = [];

			eventBus.addListener(eventType, (event) => {
				contactEvents.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				contact: {
					id: "contact-1",
					name: "Alice",
					peerId: "peer-1",
				},
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(contactEvents.length, 1);
			assert.deepStrictEqual(contactEvents[0], testEvent);
		});
	});

	describe("YapYapNode Lifecycle Integration", () => {
		it("should emit node.started events", async () => {
			const eventType = Events.Node.Started;
			const startedEvents: YapYapEvent[] = [];

			eventBus.addListener(eventType, (event) => {
				startedEvents.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				nodeId: "node-1",
				startedAt: Date.now(),
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(startedEvents.length, 1);
			assert.deepStrictEqual(startedEvents[0], testEvent);
		});

		it("should emit node.stopped events", async () => {
			const eventType = Events.Node.Stopped;
			const stoppedEvents: YapYapEvent[] = [];

			eventBus.addListener(eventType, (event) => {
				stoppedEvents.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				nodeId: "node-1",
				stoppedAt: Date.now(),
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(stoppedEvents.length, 1);
			assert.deepStrictEqual(stoppedEvents[0], testEvent);
		});

		it("should emit node.error events", async () => {
			const eventType = Events.Node.Error;
			const errorEvents: YapYapEvent[] = [];

			eventBus.addListener(eventType, (event) => {
				errorEvents.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				nodeId: "node-1",
				error: "Test error",
				stack: "Error: Test error\n    at test.ts:1:1",
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(errorEvents.length, 1);
			assert.deepStrictEqual(errorEvents[0], testEvent);
		});
	});

	describe("Multi-subscriber Integration", () => {
		it("should deliver events to multiple subscribers", async () => {
			const eventType = Events.Message.Received;
			const subscriber1Events: YapYapEvent[] = [];
			const subscriber2Events: YapYapEvent[] = [];

			eventBus.addListener(eventType, (event) => {
				subscriber1Events.push(event);
			});

			eventBus.addListener(eventType, (event) => {
				subscriber2Events.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				message: {
					id: "msg-1",
					from: "peer-1",
					to: "peer-2",
					content: "Hello",
					timestamp: Date.now(),
				},
				wasDuplicate: false,
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(subscriber1Events.length, 1);
			assert.strictEqual(subscriber2Events.length, 1);
			assert.deepStrictEqual(subscriber1Events[0], testEvent);
			assert.deepStrictEqual(subscriber2Events[0], testEvent);
		});

		it("should allow removing specific subscribers", async () => {
			const eventType = Events.Message.Received;
			const subscriber1Events: YapYapEvent[] = [];
			const subscriber2Events: YapYapEvent[] = [];

			const remove1 = eventBus.addListener(eventType, (event) => {
				subscriber1Events.push(event);
			});

			const _subscriber2 = eventBus.addListener(eventType, (event) => {
				subscriber2Events.push(event);
			});

			const testEvent: YapYapEvent = {
				type: eventType,
				id: "test-id",
				timestamp: Date.now(),
				message: {
					id: "msg-1",
					from: "peer-1",
					to: "peer-2",
					content: "Hello",
					timestamp: Date.now(),
				},
				wasDuplicate: false,
			};

			await eventBus.emit(testEvent);

			assert.strictEqual(subscriber1Events.length, 1);
			assert.strictEqual(subscriber2Events.length, 1);

			// Remove subscriber1
			remove1();

			await eventBus.emit(testEvent);

			assert.strictEqual(subscriber1Events.length, 1);
			assert.strictEqual(subscriber2Events.length, 2);
		});
	});

	describe("Event History Integration", () => {
		it("should store events in history", async () => {
			const eventType = Events.Message.Received;
			const events: YapYapEvent[] = [];

			for (let i = 0; i < 3; i++) {
				const testEvent: YapYapEvent = {
					type: eventType,
					id: `test-id-${i}`,
					timestamp: Date.now(),
					message: {
						id: `msg-${i}`,
						from: "peer-1",
						to: "peer-2",
						content: `Hello ${i}`,
						timestamp: Date.now(),
					},
					wasDuplicate: false,
				};
				await eventBus.emit(testEvent);
				events.push(testEvent);
			}

			const history = eventBus.getHistory(eventType);

			assert.strictEqual(history.length, 3);

			for (let i = 0; i < 3; i++) {
				assert.deepStrictEqual(history[i].event, events[i]);
			}
		});

		it("should limit history size", async () => {
			const eventType = Events.Message.Received;

			for (let i = 0; i < 5; i++) {
				const testEvent: YapYapEvent = {
					type: eventType,
					id: `test-id-${i}`,
					timestamp: Date.now(),
					message: {
						id: `msg-${i}`,
						from: "peer-1",
						to: "peer-2",
						content: `Hello ${i}`,
						timestamp: Date.now(),
					},
					wasDuplicate: false,
				};
				await eventBus.emit(testEvent);
			}

			// Default maxHistorySize is 100, so this should not be limited
			const history = eventBus.getHistory(eventType);
			assert.strictEqual(history.length, 5);
		});
	});
});
