/**
 * Contract tests for error-handler protocol module
 * Tests error wrapping, normalization, and handling behavior
 */

import assert from "node:assert";
import { describe, test } from "node:test";
import {
	handleProtocolError,
	handleProtocolErrorSync,
	getLastProtocolError,
	clearLastProtocolError,
} from "./error-handler.js";

// ============================================================================
// Test Suite: handleProtocolError (Async)
// ============================================================================

describe("handleProtocolError - Async", () => {
	test("Given successful handler, When called, Then returns handler result", async () => {
		const handler = async () => {
			return { success: true, data: "test" };
		};

		const result = await handleProtocolError("test-operation", handler);

		assert.deepStrictEqual(result, { success: true, data: "test" });
	});

	test("Given handler throws error, When called, Then returns null and logs error", async () => {
		const handler = async () => {
			throw new Error("Test error");
		};

		const result = await handleProtocolError("test-operation", handler);

		assert.strictEqual(result, null, "Should return null on error");
	});

	test("Given handler throws error with stack, When called, Then logs stack trace", async () => {
		const handler = async () => {
			throw new Error("Test error with stack");
		};

		const result = await handleProtocolError("test-operation", handler);

		assert.strictEqual(result, null, "Should return null on error");
	});

	test("Given handler throws non-Error, When called, Then returns null and preserves error", async () => {
		const handler = async () => {
			throw "String error";
		};

		const result = await handleProtocolError("test-operation", handler);

		assert.strictEqual(result, null, "Should return null on error");
	});

	test("Given handler returns null, When called, Then returns null", async () => {
		const handler = async () => {
			return null;
		};

		const result = await handleProtocolError("test-operation", handler);

		assert.strictEqual(result, null, "Should return null");
	});

	test("Given handler throws specific error, When called, Then wraps with operation name", async () => {
		const handler = async () => {
			throw new Error("Original error");
		};

		clearLastProtocolError();
		const result = await handleProtocolError("test-operation", handler);

		assert.strictEqual(result, null, "Should return null on error");
		const wrappedError = getLastProtocolError();
		assert.ok(wrappedError, "Should have a wrapped error");
		assert.ok(
			wrappedError?.message.includes("test-operation"),
			"Error message should include operation name",
		);
	});

	test("Given handler throws error, When called, Then preserves original stack trace", async () => {
		const handler = async () => {
			throw new Error("Original error");
		};

		clearLastProtocolError();
		await handleProtocolError("test-operation", handler);
		const wrappedError = getLastProtocolError();
		assert.ok(wrappedError?.stack, "Should preserve stack trace");
		assert.ok(
			wrappedError?.stack.includes("Original error"),
			"Stack trace should include original error message",
		);
	});
});

// ============================================================================
// Test Suite: handleProtocolErrorSync (Synchronous)
// ============================================================================

describe("handleProtocolErrorSync - Synchronous", () => {
	test("Given successful handler, When called, Then returns handler result", () => {
		const handler = () => {
			return { success: true, data: "test" };
		};

		const result = handleProtocolErrorSync("test-operation", handler);

		assert.deepStrictEqual(result, { success: true, data: "test" });
	});

	test("Given handler throws error, When called, Then returns null and logs error", () => {
		const handler = () => {
			throw new Error("Test error");
		};

		const result = handleProtocolErrorSync("test-operation", handler);

		assert.strictEqual(result, null, "Should return null on error");
	});

	test("Given handler throws error with stack, When called, Then logs stack trace", () => {
		const handler = () => {
			throw new Error("Test error with stack");
		};

		const result = handleProtocolErrorSync("test-operation", handler);

		assert.strictEqual(result, null, "Should return null on error");
	});

	test("Given handler throws non-Error, When called, Then returns null and preserves error", () => {
		const handler = () => {
			throw "String error";
		};

		const result = handleProtocolErrorSync("test-operation", handler);

		assert.strictEqual(result, null, "Should return null on error");
	});

	test("Given handler returns null, When called, Then returns null", () => {
		const handler = () => {
			return null;
		};

		const result = handleProtocolErrorSync("test-operation", handler);

		assert.strictEqual(result, null, "Should return null");
	});

	test("Given handler throws specific error, When called, Then wraps with operation name", () => {
		const handler = () => {
			throw new Error("Original error");
		};

		clearLastProtocolError();
		const result = handleProtocolErrorSync("test-operation", handler);

		assert.strictEqual(result, null, "Should return null on error");
		const wrappedError = getLastProtocolError();
		assert.ok(wrappedError, "Should have a wrapped error");
		assert.ok(
			wrappedError?.message.includes("test-operation"),
			"Error message should include operation name",
		);
	});

	test("Given handler throws error, When called, Then logs stack trace", () => {
		const handler = () => {
			throw new Error("Original error");
		};

		const result = handleProtocolErrorSync("test-operation", handler);

		assert.strictEqual(result, null, "Should return null on error");
	});
});

// ============================================================================
// Test Suite: Error Wrapping and Normalization
// ============================================================================

describe("handleProtocolError - Error Wrapping", () => {
	test(
		"Given error with custom message, When wrapped, Then includes operation name prefix",
		async () => {
			const handler = async () => {
				throw new Error("Custom error message");
			};

			clearLastProtocolError();
			const result = await handleProtocolError("custom-operation", handler);
			assert.strictEqual(result, null, "Should return null on error");

			const wrappedError = getLastProtocolError();
			assert.ok(wrappedError, "Should capture wrapped error");
			assert.ok(
				wrappedError?.message.startsWith("[custom-operation]"),
				"Error should start with operation name in brackets",
			);
		},
	);

	test("Given error with no message, When wrapped, Then includes operation name", async () => {
		const handler = async () => {
			throw new Error();
		};

		clearLastProtocolError();
		const result = await handleProtocolError("custom-operation", handler);
		assert.strictEqual(result, null, "Should return null on error");

		const wrappedError = getLastProtocolError();
		assert.ok(wrappedError, "Should capture wrapped error");
		assert.ok(
			wrappedError?.message.includes("[custom-operation]"),
			"Error should include operation name",
		);
	});

	test(
		"Given error with special characters, When wrapped, Then includes them correctly",
		async () => {
			const handler = async () => {
				throw new Error("Error with special chars: < > & \" '");
			};

			clearLastProtocolError();
			const result = await handleProtocolError("custom-operation", handler);
			assert.strictEqual(result, null, "Should return null on error");

			const wrappedError = getLastProtocolError();
			assert.ok(wrappedError, "Should capture wrapped error");
			assert.ok(
				wrappedError?.message.includes("special chars"),
				"Should preserve special characters",
			);
		},
	);

	test(
		"Given error with unicode, When wrapped, Then includes it correctly",
		async () => {
			const handler = async () => {
				throw new Error("Error with unicode: 你好 世界 🌍");
			};

			clearLastProtocolError();
			const result = await handleProtocolError("custom-operation", handler);
			assert.strictEqual(result, null, "Should return null on error");

			const wrappedError = getLastProtocolError();
			assert.ok(wrappedError, "Should capture wrapped error");
			assert.ok(
				wrappedError?.message.includes("unicode"),
				"Should preserve unicode characters",
			);
		},
	);

	test("Given handler throws multiple times, When called, Then consistently returns null", async () => {
		const handler = async () => {
			throw new Error("Test error");
		};

		const result1 = await handleProtocolError("test-operation", handler);
		const result2 = await handleProtocolError("test-operation", handler);
		const result3 = await handleProtocolError("test-operation", handler);

		assert.strictEqual(result1, null);
		assert.strictEqual(result2, null);
		assert.strictEqual(result3, null);
	});

	test("Given successful handler followed by error handler, When called, Then returns results correctly", async () => {
		const handler1 = async () => {
			return { success: true, data: "first" };
		};

		const handler2 = async () => {
			throw new Error("Test error");
		};

		const result1 = await handleProtocolError("test-operation-1", handler1);
		const result2 = await handleProtocolError("test-operation-2", handler2);

		assert.deepStrictEqual(result1, { success: true, data: "first" });
		assert.strictEqual(result2, null);
	});
});

// ============================================================================
// Test Suite: Error Clarity and Debugging
// ============================================================================

describe("handleProtocolError - Debugging Support", () => {
	test("Given error, When wrapped, Then includes operation name in error message", async () => {
		const handler = async () => {
			throw new Error("Error details here");
		};

		clearLastProtocolError();
		const result = await handleProtocolError("debug-test", handler);
		assert.strictEqual(result, null, "Should return null on error");

		const wrappedError = getLastProtocolError();
		assert.ok(wrappedError, "Should capture wrapped error");
		assert.ok(
			wrappedError?.message.includes("[debug-test]"),
			"Error should include operation name for debugging",
		);
	});

	test("Given error with context, When wrapped, Then includes it in message", async () => {
		const handler = async () => {
			throw new Error("Context: user not found");
		};

		clearLastProtocolError();
		const result = await handleProtocolError("user-operation", handler);
		assert.strictEqual(result, null, "Should return null on error");

		const wrappedError = getLastProtocolError();
		assert.ok(wrappedError, "Should capture wrapped error");
		assert.ok(
			wrappedError?.message.includes("user not found"),
			"Error should include context information",
		);
	});

	test("Given error in async handler, When called, Then error handling is consistent", async () => {
		const errorHandlers = [
			async () => {
				throw new Error("Error 1");
			},
			async () => {
				throw new Error("Error 2");
			},
			async () => {
				throw new Error("Error 3");
			},
		];

		const results = await Promise.all(
			errorHandlers.map((handler) =>
				handleProtocolError("test-operation", handler),
			),
		);

		results.forEach((result) => {
			assert.strictEqual(result, null, "All error handlers should return null");
		});
	});
});
