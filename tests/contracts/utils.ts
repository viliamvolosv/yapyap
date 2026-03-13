import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseManager } from "../../src/database/index.js";
import { StorageModule } from "../../src/storage/StorageModule.js";

export const CONTRACT_TTL_MS = 60 * 60 * 1000;

export function createTemporaryDatabase() {
	const dir = join(
		tmpdir(),
		`yapyap-contract-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	const manager = new DatabaseManager({ dataDir: dir });
	return {
		manager,
		cleanup: () => {
			manager.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

export function createTemporaryStorage() {
	const dir = join(
		tmpdir(),
		`yapyap-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(dir, { recursive: true });
	const storage = new StorageModule({ dataDir: dir });
	return {
		storage,
		cleanup: async () => {
			await storage.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
