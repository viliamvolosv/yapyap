import type Database from "better-sqlite3";
import type { MessageQueueEntry } from "../index.js";

export class MessageQueueDatabase {
	constructor(private db: Database) {}

	// Add a new message to the queue
	queueMessage(
		messageData: Record<string, unknown>,
		targetPeerId: string,
		ttl: number,
	): number {
		const now = Date.now();
		const stmt = this.db.prepare(`
      INSERT INTO message_queue (message_data, target_peer_id, queued_at, ttl, next_retry_at)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `);
		const result = stmt.run(
			JSON.stringify(messageData),
			targetPeerId,
			now,
			ttl,
			now, // first retry attempt
		);
		return Number(result.lastInsertRowid);
	}

	// Get a single message by ID
	getMessageQueueEntry(id: number): MessageQueueEntry | null {
		const stmt = this.db.prepare(`
      SELECT * FROM message_queue WHERE id = ?
    `);
		const result = stmt.get(id);
		return result as MessageQueueEntry | null;
	}

	// Get all pending messages
	getAllPendingMessages(): MessageQueueEntry[] {
		const stmt = this.db.prepare(`
      SELECT * FROM message_queue WHERE status = 'pending' ORDER BY queued_at ASC
    `);
		return stmt.all() as MessageQueueEntry[];
	}

	// Update status and increment attempts
	updateMessageStatus(id: number, status: MessageQueueEntry["status"]): void {
		const stmt = this.db.prepare(`
      UPDATE message_queue SET status = ?, attempts = attempts + 1 WHERE id = ?
    `);
		stmt.run(status, id);
	}

	// Set the next retry timestamp for a message
	setNextRetryAt(id: number, nextRetryAt: number): void {
		const stmt = this.db.prepare(`
      UPDATE message_queue SET next_retry_at = ? WHERE id = ?
    `);
		stmt.run(nextRetryAt, id);
	}

	// Delete messages whose TTL has expired (using the row TTL)
	deleteExpiredMessages(): number {
		const now = Date.now();
		const stmt = this.db.prepare(`
      DELETE FROM message_queue WHERE ? > queued_at + ttl
    `);
		return stmt.run(now).changes;
	}
}
