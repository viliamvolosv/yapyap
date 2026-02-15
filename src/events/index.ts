/**
 * YapYap Event Bus - Public API
 * Exports all event types, classes, and utilities
 */

export type { EventBusOptions } from "./event-bus.js";
// Core EventBus
export { EventBus } from "./event-bus.js";
// Event Bus Utilities
export {
	createAsyncHandler,
	createBatchedEmitter,
	createDebugEmitter,
	createFilteredHandler,
	createLogHandler,
	createRateLimitedEmitter,
} from "./event-bus-utilities.js";
// Event Listener Types
export type {
	EventHandler,
	EventHandlerOptions,
	EventListenerRegistration,
	EventStats,
} from "./event-listener-types.js";
export { ListenerScope } from "./event-listener-types.js";
// Event Types
export type {
	BaseEvent,
	YapYapEvent,
} from "./event-types.js";
export { Events } from "./event-types.js";
