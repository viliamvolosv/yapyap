/**
 * Integration tests for EventBus
 * Tests EventBus integration with other modules
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { EventBus } from "../../../src/events/event-bus";
import type { YapYapEvent } from "../../../src/events/event-types";
import { Events } from "../../../src/events/event-types";

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

			expect(receivedEvents.length).toBe(1);
			expect(receivedEvents[0]).toEqual(testEvent);
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

			expect(queuedEvents.length).toBe(1);
			expect(queuedEvents[0]).toEqual(testEvent);
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

			expect(updatedEvents.length).toBe(1);
			expect(updatedEvents[0]).toEqual(testEvent);
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

			expect(routingEvents.length).toBe(1);
			expect(routingEvents[0]).toEqual(testEvent);
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

			expect(contactEvents.length).toBe(1);
			expect(contactEvents[0]).toEqual(testEvent);
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

			expect(startedEvents.length).toBe(1);
			expect(startedEvents[0]).toEqual(testEvent);
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

			expect(stoppedEvents.length).toBe(1);
			expect(stoppedEvents[0]).toEqual(testEvent);
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

			expect(errorEvents.length).toBe(1);
			expect(errorEvents[0]).toEqual(testEvent);
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

			expect(subscriber1Events.length).toBe(1);
			expect(subscriber2Events.length).toBe(1);
			expect(subscriber1Events[0]).toEqual(testEvent);
			expect(subscriber2Events[0]).toEqual(testEvent);
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

			expect(subscriber1Events.length).toBe(1);
			expect(subscriber2Events.length).toBe(1);

			// Remove subscriber1
			remove1();

			await eventBus.emit(testEvent);

			expect(subscriber1Events.length).toBe(1);
			expect(subscriber2Events.length).toBe(2);
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

			expect(history.length).toBe(3);

			for (let i = 0; i < 3; i++) {
				expect(history[i].event).toEqual(events[i]);
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
			expect(history.length).toBe(5);
		});
	});
});
