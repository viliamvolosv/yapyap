import type { Database } from "better-sqlite3";
import type { Contact } from "../index.js";

type ContactRow = {
	peer_id: string | null;
	alias: string | null;
	last_seen: number | null;
	metadata: string | null;
	is_trusted: number | null;
};

export class ContactsDatabase {
	constructor(private db: Database) {}

	// Save a contact
	saveContact(contact: Omit<Contact, "last_seen">): void {
		const now = Date.now();
		const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO contacts
      (peer_id, alias, last_seen, metadata, is_trusted)
      VALUES (?, ?, ?, ?, ?)
    `);
		stmt.run(
			contact.peer_id,
			contact.alias,
			now,
			contact.metadata,
			contact.is_trusted,
		);
	}

	// Get a single contact by peer ID
	getContact(peerId: string): Contact | null {
		const stmt = this.db.prepare(`
      SELECT * FROM contacts WHERE peer_id = ?
    `);
		const result = stmt.get(peerId);
		if (!result) return null;
		const row = result as {
			peer_id: string;
			alias: string;
			last_seen: number;
			metadata: string;
			is_trusted: number;
		};
		return {
			peer_id: row.peer_id ?? "",
			alias: row.alias ?? "",
			last_seen: row.last_seen ?? 0,
			metadata: row.metadata ?? "",
			is_trusted: Boolean(row.is_trusted),
		};
	}

	// Get all contacts
	getAllContacts(): Contact[] {
		const stmt = this.db.prepare(`
      SELECT * FROM contacts ORDER BY last_seen DESC
    `);
		const rows = stmt.all() as ContactRow[];
		return rows.map((row) => ({
			peer_id: row.peer_id ?? "",
			alias: row.alias ?? "",
			last_seen: row.last_seen ?? 0,
			metadata: row.metadata ?? "",
			is_trusted: Boolean(row.is_trusted),
		}));
	}

	// Update contact last seen timestamp
	updateContactLastSeen(peerId: string): void {
		const now = Date.now();
		const stmt = this.db.prepare(`
      UPDATE contacts SET last_seen = ? WHERE peer_id = ?
    `);
		stmt.run(now, peerId);
	}
}
