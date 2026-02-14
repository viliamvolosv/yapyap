import type { Database } from "bun:sqlite";
import type { Contact } from "../index";

export class SearchDatabase {
	constructor(private db: Database) {}

	// Search contacts using full-text search
	searchContacts(query: string): Contact[] {
		const stmt = this.db.prepare(`
      SELECT * FROM contacts WHERE peer_id IN (
        SELECT rowid FROM search_index WHERE search_index MATCH ?
      )
    `);
		const results = stmt.all(query) as Contact[];
		return results;
	}
}
