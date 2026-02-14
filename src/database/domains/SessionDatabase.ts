import type { Database } from "bun:sqlite";
import type { Session } from "../index";

type SessionRow = {
	id: string;
	peer_id: string;
	public_key: string;
	private_key: string;
	created_at: number | null;
	expires_at: number | null;
	last_used: number | null;
	is_active: number | null;
};

export class SessionDatabase {
	constructor(private db: Database) {}

	// Save or update a session
	saveSession(session: Omit<Session, "created_at">): void {
		const now = Date.now();
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions
      (id, peer_id, public_key, private_key, created_at, expires_at, last_used, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
		stmt.run(
			session.id,
			session.peer_id,
			session.public_key,
			session.private_key,
			now,
			session.expires_at,
			now,
			session.is_active,
		);
	}

	// Get a session by ID
	getSession(id: string): Session | null {
		const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `);
		const result = stmt.get(id);
		if (!result) return null;
		const row = result as SessionRow;
		return {
			id: row.id,
			peer_id: row.peer_id,
			public_key: row.public_key,
			private_key: row.private_key,
			created_at: row.created_at ?? 0,
			expires_at: row.expires_at ?? 0,
			last_used: row.last_used ?? 0,
			is_active: Boolean(row.is_active),
		};
	}

	// Get all active sessions
	getAllActiveSessions(): Session[] {
		const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE is_active = 1
    `);
		const rows = stmt.all() as SessionRow[];
		return rows.map((row) => ({
			id: row.id,
			peer_id: row.peer_id,
			public_key: row.public_key,
			private_key: row.private_key,
			created_at: row.created_at ?? 0,
			expires_at: row.expires_at ?? 0,
			last_used: row.last_used ?? 0,
			is_active: Boolean(row.is_active),
		}));
	}

	// Update session last used timestamp
	updateSessionLastUsed(id: string): void {
		const now = Date.now();
		const stmt = this.db.prepare(`
      UPDATE sessions SET last_used = ? WHERE id = ?
    `);
		stmt.run(now, id);
	}

	// Invalidate a session
	invalidateSession(id: string): void {
		const stmt = this.db.prepare(`
      UPDATE sessions SET is_active = 0 WHERE id = ?
    `);
		stmt.run(id);
	}

	// Delete expired sessions (uses expires_at field)
	deleteExpiredSessions(): number {
		const now = Date.now();
		const stmt = this.db.prepare(`
      DELETE FROM sessions WHERE ? > expires_at
    `);
		const result = stmt.run(now);
		return result.changes;
	}
}
