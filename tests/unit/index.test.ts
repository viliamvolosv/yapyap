import assert from "node:assert";
import { describe, test } from "node:test";
import * as eventsPublicApi from "../../src/events/index.js";
import * as yapyapRoot from "../../src/index.js";

describe("Public module exports", () => {
	test("root index exports main symbols", () => {
		assert.strictEqual(typeof yapyapRoot.YapYapNode, "function");
		assert.strictEqual(typeof yapyapRoot.EventBus, "function");
		assert.strictEqual(typeof yapyapRoot.Events, "object");
		assert.strictEqual(typeof yapyapRoot.createLogHandler, "function");
	});

	test("events public index exports EventBus surface", () => {
		assert.strictEqual(typeof eventsPublicApi.EventBus, "function");
		assert.strictEqual(typeof eventsPublicApi.ListenerScope, "function");
		assert.strictEqual(
			typeof eventsPublicApi.createRateLimitedEmitter,
			"function",
		);
		assert.strictEqual(typeof eventsPublicApi.Events, "object");
	});
});
