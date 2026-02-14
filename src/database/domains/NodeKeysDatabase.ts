import type { Database } from "bun:sqlite";
import type { NodeKey } from "../index";

export class NodeKeysDatabase {
	constructor(private db: Database) {}

	// Save or update a node key
	saveNodeKey(publicKey: string, privateKey: string): number {
		const now = Date.now();
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO node_keys (public_key, private_key, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      RETURNING id
    `);
		const result = stmt.run(publicKey, privateKey, now, now);
		return Number(result.lastInsertRowid);
	}

	// Get a node key by public key
	getNodeKey(publicKey: string): NodeKey | null {
		const stmt = this.db.prepare(`
      SELECT * FROM node_keys WHERE public_key = ?
    `);
		const result = stmt.get(publicKey);
		return result as NodeKey | null;
	}

	// Get all node keys
	getAllNodeKeys(): NodeKey[] {
		const stmt = this.db.prepare(`
      SELECT * FROM node_keys
    `);
		return stmt.all() as NodeKey[];
	}
}
