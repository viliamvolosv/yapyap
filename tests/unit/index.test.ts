import { describe, expect, test } from "bun:test";
import * as eventsPublicApi from "../../src/events/index";
import * as yapyapRoot from "../../src/index";

describe("Public module exports", () => {
	test("root index exports main symbols", () => {
		expect(typeof yapyapRoot.YapYapNode).toBe("function");
		expect(typeof yapyapRoot.EventBus).toBe("function");
		expect(typeof yapyapRoot.Events).toBe("object");
		expect(typeof yapyapRoot.createLogHandler).toBe("function");
	});

	test("events public index exports EventBus surface", () => {
		expect(typeof eventsPublicApi.EventBus).toBe("function");
		expect(typeof eventsPublicApi.ListenerScope).toBe("function");
		expect(typeof eventsPublicApi.createRateLimitedEmitter).toBe("function");
		expect(typeof eventsPublicApi.Events).toBe("object");
	});
});
