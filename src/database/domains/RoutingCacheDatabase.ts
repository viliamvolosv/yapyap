import type Database from "better-sqlite3";
import type { RoutingCacheEntry } from "../index.js";

export class RoutingCacheDatabase {
	constructor(private db: Database) {}

	// Save or update a routing cache entry
	saveRoutingEntry(entry: Omit<RoutingCacheEntry, "last_seen">): void {
		const now = Date.now();
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO routing_cache
      (peer_id, multiaddrs, last_seen, is_available, ttl)
      VALUES (?, ?, ?, ?, ?)
    `);
		stmt.run(
			entry.peer_id,
			JSON.stringify(entry.multiaddrs),
			now,
			entry.is_available,
			entry.ttl,
		);
	}

	// Get a routing cache entry by peer ID
	getRoutingEntry(peerId: string): RoutingCacheEntry | null {
		const stmt = this.db.prepare(`
      SELECT * FROM routing_cache WHERE peer_id = ?
    `);
		const result = stmt.get(peerId);
		if (!result) return null;
		const row = result as {
			peer_id: string;
			multiaddrs: string;
			last_seen: number;
			is_available: number;
			ttl: number;
		};
		return {
			peer_id: row.peer_id,
			multiaddrs: row.multiaddrs ? JSON.parse(row.multiaddrs) : [],
			last_seen: row.last_seen ?? 0,
			is_available: Boolean(row.is_available),
			ttl: row.ttl ?? 0,
		};
	}

	// Get all routing cache entries
	getAllRoutingEntries(): RoutingCacheEntry[] {
		const stmt = this.db.prepare(`
      SELECT * FROM routing_cache
    `);
		const rows = stmt.all();
		return rows.map((row: unknown) => ({
			peer_id: (row as { peer_id: string }).peer_id,
			multiaddrs: (row as { multiaddrs: string }).multiaddrs
				? JSON.parse((row as { multiaddrs: string }).multiaddrs)
				: [],
			last_seen: (row as { last_seen: number }).last_seen ?? 0,
			is_available: Boolean((row as { is_available: number }).is_available),
			ttl: (row as { ttl: number }).ttl ?? 0,
		}));
	}

	// Delete stale routing cache entries (uses row TTL)
	deleteStaleRoutingEntries(): number {
		const now = Date.now();
		const stmt = this.db.prepare(`
      DELETE FROM routing_cache WHERE ? > last_seen + ttl
    `);
		const result = stmt.run(now);
		return result.changes;
	}
}
