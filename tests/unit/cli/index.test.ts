import { describe, expect, test } from "bun:test";

describe("CLI", () => {
	test("prints help successfully", async () => {
		const proc = Bun.spawn({
			cmd: ["bun", "run", "src/cli/index.ts", "--help"],
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);
		const exitCode = await proc.exited;

		expect(exitCode).toBe(0);
		expect(stdout).toContain("YapYap Messenger");
		expect(stdout).toContain("start");
		expect(stdout).toContain("send-message");
		expect(stderr).toBe("");
	});
});
