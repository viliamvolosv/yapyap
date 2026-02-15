import assert from "node:assert";
import * as cp from "node:child_process";
import { describe, test } from "node:test";

describe("CLI", () => {
	test("prints help successfully", async () => {
		const proc = cp.spawn("node", ["src/cli/index.ts", "--help"], {
			stdio: ["ignore", "pipe", "pipe"],
		});

		const [stdout, stderr] = await Promise.all([
			new Promise<string>((resolve) => {
				let data = "";
				proc.stdout.on("data", (chunk) => (data += chunk));
				proc.stdout.on("end", () => resolve(data));
			}),
			new Promise<string>((resolve) => {
				let data = "";
				proc.stderr.on("data", (chunk) => (data += chunk));
				proc.stderr.on("end", () => resolve(data));
			}),
		]);
		const exitCode = await new Promise<number>((resolve) => {
			proc.on("close", resolve);
		});

		assert.strictEqual(exitCode, 0);
		assert.ok(stdout.includes("YapYap Messenger"));
		assert.ok(stdout.includes("start"));
		assert.ok(stdout.includes("send-message"));
		assert.strictEqual(stderr, "");
	});
});
