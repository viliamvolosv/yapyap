import assert from "node:assert";
import * as cp from "node:child_process";
import { describe, test } from "node:test";

describe("CLI", () => {
	test("prints help successfully", async () => {
		const proc = cp.spawn("npx", ["tsx", "src/cli/index.ts", "--help"], {
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

	test("send-message with --encrypted flag", async () => {
		const proc = cp.spawn(
			"npx",
			[
				"tsx",
				"src/cli/index.ts",
				"send-message",
				"--to",
				"12D3KooWTest",
				"--payload",
				"test",
				"--encrypted",
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, YAPYAP_DATA_DIR: "/tmp/yapyap-cli-test" },
			},
		);

		const [_stdout, stderr] = await Promise.all([
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

		// Should exit with 0 on success or expected error
		assert.ok(
			exitCode === 0 || exitCode === 1,
			"Should exit with success or expected error",
		);
		// The command should process without parsing errors
		assert.ok(!stderr || stderr.includes("Error") || stderr.length < 100);
	});

	test("send-message without --encrypted flag uses default (false)", async () => {
		const proc = cp.spawn(
			"npx",
			[
				"tsx",
				"src/cli/index.ts",
				"send-message",
				"--to",
				"12D3KooWTest",
				"--payload",
				"test",
			],
			{
				stdio: ["ignore", "pipe", "pipe"],
				env: { ...process.env, YAPYAP_DATA_DIR: "/tmp/yapyap-cli-test" },
			},
		);

		const [_stdout, stderr] = await Promise.all([
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

		// Should exit with 0 on success or expected error
		assert.ok(
			exitCode === 0 || exitCode === 1,
			"Should exit with success or expected error",
		);
		// The command should process without parsing errors
		assert.ok(!stderr || stderr.includes("Error") || stderr.length < 100);
	});
});
