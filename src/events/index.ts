/**
 * YapYap Event Bus - Public API
 * Exports all event types, classes, and utilities
 */

export type { EventBusOptions } from "./event-bus";
// Core EventBus
export { EventBus } from "./event-bus";
// Event Bus Utilities
export {
	createAsyncHandler,
	createBatchedEmitter,
	createDebugEmitter,
	createFilteredHandler,
	createLogHandler,
	createRateLimitedEmitter,
} from "./event-bus-utilities";
// Event Listener Types
export type {
	EventHandler,
	EventHandlerOptions,
	EventListenerRegistration,
	EventStats,
} from "./event-listener-types";
export { ListenerScope } from "./event-listener-types";
// Event Types
export type {
	BaseEvent,
	YapYapEvent,
} from "./event-types";
export { Events } from "./event-types";
