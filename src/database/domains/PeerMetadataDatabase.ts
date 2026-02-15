import type Database from "better-sqlite3";
import type { MetadataValue } from "../index.js";

export class PeerMetadataDatabase {
	constructor(private db: Database) {}

	// Save or update peer metadata (always uses row TTL: 86400 seconds = 24 hours)
	savePeerMetadata(peerId: string, key: string, value: MetadataValue): void {
		const now = Date.now();
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO peer_metadata
      (peer_id, key, value, updated_at, ttl)
      VALUES (?, ?, ?, ?, ?)
    `);
		stmt.run(peerId, key, JSON.stringify(value), now, 86400);
	}

	// Get a single metadata value for a peer
	getPeerMetadata(peerId: string, key: string): MetadataValue | null {
		const stmt = this.db.prepare(`
      SELECT value FROM peer_metadata WHERE peer_id = ? AND key = ?
    `);
		const result = stmt.get(peerId, key) as { value: string } | undefined;
		return result ? JSON.parse(result.value) : null;
	}

	// Get all metadata values for a peer
	getAllPeerMetadata(peerId: string): { key: string; value: MetadataValue }[] {
		const stmt = this.db.prepare(`
      SELECT key, value FROM peer_metadata WHERE peer_id = ?
    `);
		const results = stmt.all(peerId) as { key: string; value: string }[];
		return results.map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
	}

	// Delete expired peer metadata (uses row TTL)
	deleteExpiredPeerMetadata(): number {
		const now = Date.now();
		const stmt = this.db.prepare(`
      DELETE FROM peer_metadata WHERE ? > (updated_at + ttl)
    `);
		const result = stmt.run(now);
		return result.changes;
	}
}
