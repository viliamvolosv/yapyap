import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { YapYapNodeOptions } from "../core/node.js";
import { yapyapSchema } from "./schema.js";

export interface NodeKey {
	id: number;
	public_key: string;
	private_key: string; // Encrypted
	created_at: number;
	updated_at: number;
}

export interface RoutingCacheEntry {
	peer_id: string;
	multiaddrs: string[]; // JSON array
	last_seen: number;
	is_available: boolean;
	ttl: number;
}

type RoutingCacheRow = {
	peer_id: string;
	multiaddrs: string | null;
	last_seen: number | null;
	is_available: number | null;
	ttl: number | null;
};
export interface MessageQueueEntry {
	id: number;
	message_data: string; // JSON string
	target_peer_id: string;
	queued_at: number;
	attempts: number;
	status: "pending" | "processing" | "delivered" | "failed";
	ttl: number;
	next_retry_at?: number;
}

export interface PendingMessageEntry {
	message_id: string;
	target_peer_id: string;
	message_data: string;
	status: "pending" | "delivered" | "failed";
	attempts: number;
	next_retry_at: number;
	created_at: number;
	updated_at: number;
	deadline_at: number;
	last_error?: string;
}

export interface ReplicatedMessageEntry {
	message_id: string;
	original_target_peer_id: string;
	source_peer_id: string;
	status: "pending" | "delivered" | "failed";
	created_at: number;
	updated_at: number;
	deadline_at: number;
}

export interface MessageReplicaEntry {
	id: number;
	message_id: string;
	replica_peer_id: string;
	status: "assigned" | "stored" | "delivered" | "failed";
	assigned_at: number;
	updated_at: number;
	last_error?: string;
}

export interface Contact {
	peer_id: string;
	alias: string;
	last_seen: number;
	metadata: string; // JSON string
	is_trusted: boolean;
}

type ContactRow = {
	peer_id: string | null;
	alias: string | null;
	last_seen: number | null;
	metadata: string | null;
	is_trusted: number | null;
};

export interface PeerMetadata {
	peer_id: string;
	key: string;
	value: string; // JSON string
	updated_at: number;
}

export type MetadataValue = unknown;

export interface Session {
	id: string;
	peer_id: string;
	public_key: string;
	private_key: string;
	created_at: number;
	expires_at: number;
	last_used: number;
	is_active: boolean;
	noise_session_info?: string;
}

type SessionRow = {
	id: string;
	peer_id: string;
	public_key: string;
	private_key: string;
	created_at: number | null;
	expires_at: number | null;
	last_used: number | null;
	is_active: number | null;
	noise_session_info?: string | null;
};

export interface ProcessedMessage {
	message_id: string;
	from_peer_id: string;
	sequence_number?: number;
	processed_at: number;
}

export interface PeerSequence {
	peer_id: string;
	last_sequence: number;
	updated_at: number;
}

export interface PeerVectorClock {
	peer_id: string;
	counter: number;
	updated_at: number;
}

export interface PersistIncomingMessageInput {
	messageId: string;
	fromPeerId: string;
	sequenceNumber?: number;
	messageData: Record<string, unknown>;
	ttl: number;
	vectorClock?: Record<string, number>;
}

export interface PersistIncomingMessageResult {
	applied: boolean;
	queueMessageId?: number;
	duplicate: boolean;
}

export class DatabaseManager {
	private db: Database.Database;
	private readonly dbPath: string;

	constructor(options: YapYapNodeOptions) {
		const dataDir = options.dataDir || join(process.cwd(), "data");

		if (!existsSync(dataDir)) {
			mkdirSync(dataDir, { recursive: true });
		}

		this.dbPath = join(dataDir, "yapyap.db");

		// Open SQLite DB synchronously
		this.db = new Database(this.dbPath);

		// Enable WAL mode for better concurrency
		this.db.exec("PRAGMA journal_mode=WAL;");

		// Create tables synchronously
		this.createTables();
	}

	private createTables(): void {
		this.db.exec(yapyapSchema.node_keys);
		this.db.exec(yapyapSchema.routing_cache);
		this.db.exec(yapyapSchema.message_queue);
		this.db.exec(yapyapSchema.pending_messages);
		this.db.exec(yapyapSchema.replicated_messages);
		this.db.exec(yapyapSchema.message_replicas);
		this.db.exec(yapyapSchema.processed_messages);
		this.db.exec(yapyapSchema.peer_sequences);
		this.db.exec(yapyapSchema.peer_vector_clocks);
		this.db.exec(yapyapSchema.contacts);
		this.db.exec(yapyapSchema.peer_metadata);
		this.db.exec(yapyapSchema.sessions);
		this.db.exec(yapyapSchema.search_index);

		for (const idx of yapyapSchema.indexes) {
			this.db.exec(idx);
		}
	}

	close(): void {
		this.db.close();
	}

	public getDatabase(): Database.Database {
		return this.db;
	}

	// Node Keys Methods
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

	getNodeKey(publicKey: string): NodeKey | null {
		const stmt = this.db.prepare(`
      SELECT * FROM node_keys WHERE public_key = ?
    `);

		const result = stmt.get(publicKey);
		return result as NodeKey | null;
	}

	/**
	 * Get the current node's public key
	 * Returns the first (and only) node key in the database
	 */
	getCurrentNodeKey(): NodeKey | null {
		const stmt = this.db.prepare(`SELECT * FROM node_keys LIMIT 1`);
		const result = stmt.get();
		return result as NodeKey | null;
	}

	getAllNodeKeys(): NodeKey[] {
		const stmt = this.db.prepare(`SELECT * FROM node_keys`);
		return stmt.all() as NodeKey[];
	}

	// Routing Cache Methods
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

	saveRoutingEntryLww(entry: RoutingCacheEntry): void {
		this.db
			.prepare(
				`INSERT INTO routing_cache (peer_id, multiaddrs, last_seen, is_available, ttl)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(peer_id) DO UPDATE SET
           multiaddrs = excluded.multiaddrs,
           last_seen = excluded.last_seen,
           is_available = excluded.is_available,
           ttl = excluded.ttl
         WHERE excluded.last_seen >= routing_cache.last_seen`,
			)
			.run(
				entry.peer_id,
				JSON.stringify(entry.multiaddrs),
				entry.last_seen,
				entry.is_available ? 1 : 0,
				entry.ttl,
			);
	}

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
			peer_id: row.peer_id ?? "",
			multiaddrs: row.multiaddrs ? JSON.parse(row.multiaddrs) : [],
			last_seen: row.last_seen ?? 0,
			is_available: Boolean(row.is_available),
			ttl: row.ttl ?? 0,
		};
	}

	getAllRoutingEntries(): RoutingCacheEntry[] {
		const rows = this.db
			.prepare(`SELECT * FROM routing_cache`)
			.all() as RoutingCacheRow[];
		return rows.map((row) => ({
			peer_id: row.peer_id ?? "",
			multiaddrs: row.multiaddrs ? JSON.parse(row.multiaddrs) : [],
			last_seen: row.last_seen ?? 0,
			is_available: Boolean(row.is_available),
			ttl: row.ttl ?? 0,
		}));
	}

	deleteStaleRoutingEntries(): number {
		const now = Date.now();
		const stmt = this.db.prepare(`
      DELETE FROM routing_cache
      WHERE ? > last_seen + ttl
    `);
		return stmt.run(now).changes;
	}

	// Message Queue Methods
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
			now,
		);
		return Number(result.lastInsertRowid);
	}

	getMessageQueueEntry(id: number): MessageQueueEntry | null {
		const stmt = this.db.prepare(`SELECT * FROM message_queue WHERE id = ?`);
		const result = stmt.get(id);
		return result as MessageQueueEntry | null;
	}

	getAllPendingMessages(): MessageQueueEntry[] {
		return this.db
			.prepare(
				`SELECT * FROM message_queue WHERE status = 'pending' ORDER BY queued_at ASC`,
			)
			.all() as MessageQueueEntry[];
	}

	getRecentMessageQueueEntries(limit = 200): MessageQueueEntry[] {
		return this.db
			.prepare(`SELECT * FROM message_queue ORDER BY queued_at DESC LIMIT ?`)
			.all(limit) as MessageQueueEntry[];
	}

	updateMessageStatus(id: number, status: MessageQueueEntry["status"]): void {
		this.db
			.prepare(
				`UPDATE message_queue SET status = ?, attempts = attempts + 1 WHERE id = ?`,
			)
			.run(status, id);
	}

	setNextRetryAt(id: number, nextRetryAt: number): void {
		this.db
			.prepare(`UPDATE message_queue SET next_retry_at = ? WHERE id = ?`)
			.run(nextRetryAt, id);
	}

	deleteExpiredMessages(): number {
		const now = Date.now();
		return this.db
			.prepare(`DELETE FROM message_queue WHERE ? > queued_at + ttl`)
			.run(now).changes;
	}

	upsertPendingMessage(
		messageId: string,
		messageData: Record<string, unknown>,
		targetPeerId: string,
		deadlineAt: number,
	): void {
		const now = Date.now();
		this.db
			.prepare(
				`INSERT INTO pending_messages
         (message_id, target_peer_id, message_data, status, attempts, next_retry_at, created_at, updated_at, deadline_at)
         VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET
           target_peer_id = excluded.target_peer_id,
           message_data = excluded.message_data,
           status = 'pending',
           updated_at = excluded.updated_at,
           deadline_at = excluded.deadline_at`,
			)
			.run(
				messageId,
				targetPeerId,
				JSON.stringify(messageData),
				now,
				now,
				now,
				deadlineAt,
			);
	}

	getRetryablePendingMessages(now = Date.now()): PendingMessageEntry[] {
		return this.db
			.prepare(
				`SELECT * FROM pending_messages
         WHERE status = 'pending' AND next_retry_at <= ? AND deadline_at > ?
         ORDER BY next_retry_at ASC`,
			)
			.all(now, now) as PendingMessageEntry[];
	}

	getPendingMessagesForPeer(
		targetPeerId: string,
		limit = 50,
		now = Date.now(),
	): PendingMessageEntry[] {
		return this.db
			.prepare(
				`SELECT * FROM pending_messages
         WHERE status = 'pending' AND target_peer_id = ? AND deadline_at > ?
         ORDER BY created_at ASC
         LIMIT ?`,
			)
			.all(targetPeerId, now, limit) as PendingMessageEntry[];
	}

	markPendingMessageDelivered(messageId: string): void {
		this.db
			.prepare(
				`UPDATE pending_messages
         SET status = 'delivered', updated_at = ?, last_error = NULL
         WHERE message_id = ?`,
			)
			.run(Date.now(), messageId);
	}

	markPendingMessageFailed(messageId: string, reason?: string): void {
		this.db
			.prepare(
				`UPDATE pending_messages
         SET status = 'failed', updated_at = ?, last_error = ?
         WHERE message_id = ?`,
			)
			.run(Date.now(), reason ?? null, messageId);
	}

	schedulePendingRetry(
		messageId: string,
		nextRetryAt: number,
		reason?: string,
	): void {
		this.db
			.prepare(
				`UPDATE pending_messages
         SET status = 'pending',
             attempts = attempts + 1,
             next_retry_at = ?,
             updated_at = ?,
             last_error = ?
         WHERE message_id = ?`,
			)
			.run(nextRetryAt, Date.now(), reason ?? null, messageId);
	}

	deleteExpiredPendingMessages(now = Date.now()): number {
		return this.db
			.prepare(
				`DELETE FROM pending_messages
         WHERE deadline_at <= ? OR status IN ('delivered', 'failed')`,
			)
			.run(now).changes;
	}

	upsertReplicatedMessage(
		messageId: string,
		originalTargetPeerId: string,
		sourcePeerId: string,
		deadlineAt: number,
	): void {
		const now = Date.now();
		this.db
			.prepare(
				`INSERT INTO replicated_messages
         (message_id, original_target_peer_id, source_peer_id, status, created_at, updated_at, deadline_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?)
         ON CONFLICT(message_id) DO UPDATE SET
           original_target_peer_id = excluded.original_target_peer_id,
           source_peer_id = excluded.source_peer_id,
           updated_at = excluded.updated_at,
           deadline_at = excluded.deadline_at`,
			)
			.run(messageId, originalTargetPeerId, sourcePeerId, now, now, deadlineAt);
	}

	assignMessageReplica(messageId: string, replicaPeerId: string): void {
		const now = Date.now();
		this.db
			.prepare(
				`INSERT INTO message_replicas
         (message_id, replica_peer_id, status, assigned_at, updated_at)
         VALUES (?, ?, 'assigned', ?, ?)
         ON CONFLICT(message_id, replica_peer_id) DO UPDATE SET
           status = 'assigned',
           updated_at = excluded.updated_at,
           last_error = NULL`,
			)
			.run(messageId, replicaPeerId, now, now);
	}

	markReplicaStored(messageId: string, replicaPeerId: string): void {
		this.db
			.prepare(
				`UPDATE message_replicas
         SET status = 'stored', updated_at = ?, last_error = NULL
         WHERE message_id = ? AND replica_peer_id = ?`,
			)
			.run(Date.now(), messageId, replicaPeerId);
	}

	markReplicaFailed(
		messageId: string,
		replicaPeerId: string,
		reason?: string,
	): void {
		this.db
			.prepare(
				`UPDATE message_replicas
         SET status = 'failed', updated_at = ?, last_error = ?
         WHERE message_id = ? AND replica_peer_id = ?`,
			)
			.run(Date.now(), reason ?? null, messageId, replicaPeerId);
	}

	getMessageReplicas(messageId: string): MessageReplicaEntry[] {
		return this.db
			.prepare(
				`SELECT * FROM message_replicas
         WHERE message_id = ?
         ORDER BY assigned_at ASC`,
			)
			.all(messageId) as MessageReplicaEntry[];
	}

	markReplicatedMessageDelivered(messageId: string): void {
		this.db
			.prepare(
				`UPDATE replicated_messages
         SET status = 'delivered', updated_at = ?
         WHERE message_id = ?`,
			)
			.run(Date.now(), messageId);
	}

	markReplicatedMessageFailed(messageId: string): void {
		this.db
			.prepare(
				`UPDATE replicated_messages
         SET status = 'failed', updated_at = ?
         WHERE message_id = ?`,
			)
			.run(Date.now(), messageId);
	}

	deleteExpiredReplicatedMessages(now = Date.now()): number {
		return this.db
			.prepare(
				`DELETE FROM replicated_messages
         WHERE deadline_at <= ? OR status IN ('delivered', 'failed')`,
			)
			.run(now).changes;
	}

	// Deduplication + Sequence Methods
	markMessageProcessed(
		messageId: string,
		fromPeerId: string,
		sequenceNumber?: number,
	): void {
		const now = Date.now();
		this.db
			.prepare(
				`INSERT OR REPLACE INTO processed_messages (message_id, from_peer_id, sequence_number, processed_at)
         VALUES (?, ?, ?, ?)`,
			)
			.run(messageId, fromPeerId, sequenceNumber ?? null, now);
	}

	isMessageProcessed(messageId: string): boolean {
		const result = this.db
			.prepare(`SELECT 1 FROM processed_messages WHERE message_id = ? LIMIT 1`)
			.get(messageId);
		return Boolean(result);
	}

	getProcessedMessageIdsSince(sinceTimestamp: number, limit = 200): string[] {
		const rows = this.db
			.prepare(
				`SELECT message_id FROM processed_messages
         WHERE processed_at > ?
         ORDER BY processed_at ASC
         LIMIT ?`,
			)
			.all(sinceTimestamp, limit) as Array<{ message_id: string }>;
		return rows.map((row) => row.message_id);
	}

	getPendingMessagesSince(
		sinceTimestamp: number,
		limit = 200,
	): PendingMessageEntry[] {
		return this.db
			.prepare(
				`SELECT * FROM pending_messages
         WHERE created_at > ? AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT ?`,
			)
			.all(sinceTimestamp, limit) as PendingMessageEntry[];
	}

	getPendingMessagesByIds(messageIds: string[]): PendingMessageEntry[] {
		if (messageIds.length === 0) {
			return [];
		}
		const placeholders = messageIds.map(() => "?").join(", ");
		return this.db
			.prepare(
				`SELECT * FROM pending_messages
         WHERE message_id IN (${placeholders})`,
			)
			.all(...messageIds) as PendingMessageEntry[];
	}

	getLastPeerSequence(peerId: string): number | null {
		const result = this.db
			.prepare(`SELECT last_sequence FROM peer_sequences WHERE peer_id = ?`)
			.get(peerId) as { last_sequence: number } | undefined;
		return result?.last_sequence ?? null;
	}

	updatePeerSequence(peerId: string, sequenceNumber: number): void {
		const now = Date.now();
		this.db
			.prepare(
				`INSERT INTO peer_sequences (peer_id, last_sequence, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(peer_id) DO UPDATE SET
           last_sequence = excluded.last_sequence,
           updated_at = excluded.updated_at`,
			)
			.run(peerId, sequenceNumber, now);
	}

	getVectorClock(peerId: string): number {
		const result = this.db
			.prepare(`SELECT counter FROM peer_vector_clocks WHERE peer_id = ?`)
			.get(peerId) as { counter: number } | undefined;
		return result?.counter ?? 0;
	}

	getAllVectorClocks(): Record<string, number> {
		const rows = this.db
			.prepare(`SELECT peer_id, counter FROM peer_vector_clocks`)
			.all() as Array<{ peer_id: string; counter: number }>;
		const clocks: Record<string, number> = {};
		for (const row of rows) {
			clocks[row.peer_id] = row.counter;
		}
		return clocks;
	}

	updateVectorClock(peerId: string, counter: number): void {
		const now = Date.now();
		this.db
			.prepare(
				`INSERT INTO peer_vector_clocks (peer_id, counter, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(peer_id) DO UPDATE SET
           counter = CASE
             WHEN excluded.counter > peer_vector_clocks.counter THEN excluded.counter
             ELSE peer_vector_clocks.counter
           END,
           updated_at = excluded.updated_at`,
			)
			.run(peerId, counter, now);
	}

	persistIncomingMessageAtomically(
		input: PersistIncomingMessageInput,
	): PersistIncomingMessageResult {
		const now = Date.now();
		const tx = this.db.transaction(
			(payload: PersistIncomingMessageInput): PersistIncomingMessageResult => {
				const processedInsert = this.db
					.prepare(
						`INSERT INTO processed_messages (message_id, from_peer_id, sequence_number, processed_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(message_id) DO NOTHING`,
					)
					.run(
						payload.messageId,
						payload.fromPeerId,
						payload.sequenceNumber ?? null,
						now,
					);

				if (processedInsert.changes === 0) {
					return { applied: false, duplicate: true };
				}

				const queued = this.db
					.prepare(
						`INSERT INTO message_queue (message_data, target_peer_id, queued_at, ttl, next_retry_at)
             VALUES (?, ?, ?, ?, ?)`,
					)
					.run(
						JSON.stringify(payload.messageData),
						payload.fromPeerId,
						now,
						payload.ttl,
						now,
					);
				const queueMessageId = Number(queued.lastInsertRowid);

				this.db
					.prepare(
						`UPDATE message_queue
             SET status = 'delivered', attempts = attempts + 1
             WHERE id = ?`,
					)
					.run(queueMessageId);

				if (typeof payload.sequenceNumber === "number") {
					this.db
						.prepare(
							`INSERT INTO peer_sequences (peer_id, last_sequence, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(peer_id) DO UPDATE SET
                 last_sequence = CASE
                   WHEN excluded.last_sequence > peer_sequences.last_sequence THEN excluded.last_sequence
                   ELSE peer_sequences.last_sequence
                 END,
                 updated_at = excluded.updated_at`,
						)
						.run(payload.fromPeerId, payload.sequenceNumber, now);
				}

				if (payload.vectorClock) {
					for (const [peerId, counter] of Object.entries(payload.vectorClock)) {
						if (typeof counter !== "number" || counter < 0) {
							continue;
						}
						this.db
							.prepare(
								`INSERT INTO peer_vector_clocks (peer_id, counter, updated_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(peer_id) DO UPDATE SET
                   counter = CASE
                     WHEN excluded.counter > peer_vector_clocks.counter THEN excluded.counter
                     ELSE peer_vector_clocks.counter
                   END,
                   updated_at = excluded.updated_at`,
							)
							.run(peerId, counter, now);
					}
				} else if (typeof payload.sequenceNumber === "number") {
					this.db
						.prepare(
							`INSERT INTO peer_vector_clocks (peer_id, counter, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(peer_id) DO UPDATE SET
                 counter = CASE
                   WHEN excluded.counter > peer_vector_clocks.counter THEN excluded.counter
                   ELSE peer_vector_clocks.counter
                 END,
                 updated_at = excluded.updated_at`,
						)
						.run(payload.fromPeerId, payload.sequenceNumber, now);
				}

				return {
					applied: true,
					queueMessageId,
					duplicate: false,
				};
			},
		);

		return tx(input);
	}

	deleteOldProcessedMessages(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
		const cutoff = Date.now() - maxAgeMs;
		return this.db
			.prepare(`DELETE FROM processed_messages WHERE processed_at < ?`)
			.run(cutoff).changes;
	}

	// Contacts Methods
	saveContact(contact: Omit<Contact, "last_seen">): void {
		const now = Date.now();
		this.db
			.prepare(`
      INSERT OR REPLACE INTO contacts
      (peer_id, alias, last_seen, metadata, is_trusted)
      VALUES (?, ?, ?, ?, ?)
    `)
			.run(
				contact.peer_id,
				contact.alias,
				now,
				contact.metadata,
				contact.is_trusted ? 1 : 0,
			);
	}

	saveContactLww(contact: Contact): void {
		this.db
			.prepare(
				`INSERT INTO contacts (peer_id, alias, last_seen, metadata, is_trusted)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(peer_id) DO UPDATE SET
           alias = excluded.alias,
           last_seen = excluded.last_seen,
           metadata = excluded.metadata,
           is_trusted = excluded.is_trusted
         WHERE excluded.last_seen >= contacts.last_seen`,
			)
			.run(
				contact.peer_id,
				contact.alias,
				contact.last_seen,
				contact.metadata,
				contact.is_trusted ? 1 : 0,
			);
	}

	getContact(peerId: string): Contact | null {
		const result = this.db
			.prepare(`SELECT * FROM contacts WHERE peer_id = ?`)
			.get(peerId);
		if (!result) return null;
		const row = result as ContactRow;
		return {
			peer_id: row.peer_id ?? "",
			alias: row.alias ?? "",
			last_seen: row.last_seen ?? 0,
			metadata: row.metadata ?? "",
			is_trusted: Boolean(row.is_trusted),
		};
	}

	getAllContacts(): Contact[] {
		const rows = this.db
			.prepare(`SELECT * FROM contacts ORDER BY last_seen DESC`)
			.all() as ContactRow[];
		return rows.map((row) => ({
			peer_id: row.peer_id ?? "",
			alias: row.alias ?? "",
			last_seen: row.last_seen ?? 0,
			metadata: row.metadata ?? "",
			is_trusted: Boolean(row.is_trusted),
		}));
	}

	updateContactLastSeen(peerId: string): void {
		this.db
			.prepare(`UPDATE contacts SET last_seen = ? WHERE peer_id = ?`)
			.run(Date.now(), peerId);
	}

	deleteContact(peerId: string): number {
		return this.db.prepare(`DELETE FROM contacts WHERE peer_id = ?`).run(peerId)
			.changes;
	}

	// Peer Metadata Methods
	savePeerMetadata(
		peerId: string,
		key: string,
		value: MetadataValue,
		ttl?: number,
	): void {
		const now = Date.now();
		this.db
			.prepare(`
      INSERT OR REPLACE INTO peer_metadata
      (peer_id, key, value, updated_at, ttl)
      VALUES (?, ?, ?, ?, ?)
    `)
			.run(peerId, key, JSON.stringify(value), now, ttl ?? 86400);
	}

	getPeerMetadata(peerId: string, key: string): MetadataValue | null {
		const result = this.db
			.prepare(`SELECT value FROM peer_metadata WHERE peer_id = ? AND key = ?`)
			.get(peerId, key) as { value: string } | undefined;
		return result ? JSON.parse(result.value) : null;
	}

	getAllPeerMetadata(peerId: string): { key: string; value: MetadataValue }[] {
		const results = this.db
			.prepare(`SELECT key, value FROM peer_metadata WHERE peer_id = ?`)
			.all(peerId) as { key: string; value: string }[];
		return results.map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
	}

	// Search Methods
	searchContacts(query: string): Contact[] {
		const results = this.db
			.prepare(`
      SELECT * FROM contacts WHERE peer_id IN (
        SELECT rowid FROM search_index WHERE search_index MATCH ?
      )
    `)
			.all(query);
		return results as Contact[];
	}

	// Session Methods
	saveSession(
		session: Omit<Session, "created_at" | "noise_session_info"> & {
			noise_session_info?: string;
		},
	): void {
		const now = Date.now();
		this.db
			.prepare(`
      INSERT OR REPLACE INTO sessions
      (id, peer_id, public_key, private_key, created_at, expires_at, last_used, is_active, noise_session_info)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
			.run(
				session.id,
				session.peer_id,
				session.public_key,
				session.private_key,
				now,
				session.expires_at,
				now,
				session.is_active,
				session.noise_session_info
					? JSON.stringify(session.noise_session_info)
					: null,
			);
	}

	getSession(id: string): Session | null {
		const result = this.db
			.prepare(`SELECT * FROM sessions WHERE id = ?`)
			.get(id);
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
			noise_session_info: row.noise_session_info
				? JSON.parse(row.noise_session_info)
				: undefined,
		};
	}

	getAllActiveSessions(): Session[] {
		const rows = this.db
			.prepare(`SELECT * FROM sessions WHERE is_active = 1`)
			.all() as SessionRow[];
		return rows.map((row) => ({
			id: row.id,
			peer_id: row.peer_id,
			public_key: row.public_key,
			private_key: row.private_key,
			created_at: row.created_at ?? 0,
			expires_at: row.expires_at ?? 0,
			last_used: row.last_used ?? 0,
			is_active: Boolean(row.is_active),
			noise_session_info: row.noise_session_info
				? JSON.parse(row.noise_session_info)
				: undefined,
		}));
	}

	updateSessionLastUsed(id: string): void {
		this.db
			.prepare(`UPDATE sessions SET last_used = ? WHERE id = ?`)
			.run(Date.now(), id);
	}

	invalidateSession(id: string): void {
		this.db.prepare(`UPDATE sessions SET is_active = 0 WHERE id = ?`).run(id);
	}

	deleteExpiredSessions(): number {
		const now = Date.now();
		return this.db.prepare(`DELETE FROM sessions WHERE ? > expires_at`).run(now)
			.changes;
	}

	deleteExpiredPeerMetadata(): number {
		const now = Date.now();
		return this.db
			.prepare(`DELETE FROM peer_metadata WHERE ? > (updated_at + ttl)`)
			.run(now).changes;
	}

	// Cleanup methods
	cleanup(): void {
		this.deleteStaleRoutingEntries();
		this.deleteExpiredMessages();
		this.deleteExpiredPendingMessages();
		this.deleteExpiredReplicatedMessages();
		this.deleteExpiredSessions();
		this.deleteExpiredPeerMetadata();
		this.deleteOldProcessedMessages();
	}
}
