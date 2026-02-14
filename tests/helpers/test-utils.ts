import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function createTempDir(prefix: string): Promise<string> {
	// Add a random suffix to ensure uniqueness even if called rapidly
	const uniquePrefix = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
	return mkdtemp(join(tmpdir(), uniquePrefix));
}

export async function cleanupTempDir(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
	// Wait 100ms to allow OS to release file handles (fixes SQLite I/O errors in tests)
	await sleep(100);
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(
				new Error(`Timeout waiting for ${label} (timeout: ${timeoutMs}ms)`),
			);
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
	}
}

export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	options: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<void> {
	const timeoutMs = options.timeoutMs ?? 60000;
	const intervalMs = options.intervalMs ?? 100;
	const label = options.label ?? "condition";
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await condition()) {
			return;
		}
		await sleep(intervalMs);
	}

	throw new Error(`Timeout waiting for ${label} (timeout: ${timeoutMs}ms)`);
}
