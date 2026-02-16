// Centralized schema definition for YapYap database

export const yapyapSchema = {
	node_keys: `
    CREATE TABLE IF NOT EXISTS node_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_key TEXT UNIQUE NOT NULL,
      private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,
	routing_cache: `
    CREATE TABLE IF NOT EXISTS routing_cache (
      peer_id TEXT PRIMARY KEY,
      multiaddrs TEXT NOT NULL,
      last_seen INTEGER NOT NULL,
      is_available BOOLEAN NOT NULL DEFAULT 1,
      ttl INTEGER NOT NULL
    )
  `,
	pending_messages: `
    CREATE TABLE IF NOT EXISTS pending_messages (
      message_id TEXT PRIMARY KEY,
      target_peer_id TEXT NOT NULL,
      message_data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deadline_at INTEGER NOT NULL,
      last_error TEXT
    )
  `,
	replicated_messages: `
    CREATE TABLE IF NOT EXISTS replicated_messages (
      message_id TEXT PRIMARY KEY,
      original_target_peer_id TEXT NOT NULL,
      source_peer_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deadline_at INTEGER NOT NULL
    )
  `,
	message_replicas: `
    CREATE TABLE IF NOT EXISTS message_replicas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      replica_peer_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'assigned',
      assigned_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      ack_expected INTEGER NOT NULL DEFAULT 0,
      ack_received_at INTEGER,
      last_error TEXT,
      UNIQUE(message_id, replica_peer_id),
      FOREIGN KEY(message_id) REFERENCES replicated_messages(message_id) ON DELETE CASCADE
    )
  `,
	processed_messages: `
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      from_peer_id TEXT NOT NULL,
      to_peer_id TEXT,
      message_data TEXT,
      sequence_number INTEGER,
      processed_at INTEGER NOT NULL
    )
  `,
	peer_sequences: `
    CREATE TABLE IF NOT EXISTS peer_sequences (
      peer_id TEXT PRIMARY KEY,
      last_sequence INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,
	peer_vector_clocks: `
    CREATE TABLE IF NOT EXISTS peer_vector_clocks (
      peer_id TEXT PRIMARY KEY,
      counter INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `,
	contacts: `
    CREATE TABLE IF NOT EXISTS contacts (
      peer_id TEXT PRIMARY KEY,
      alias TEXT,
      last_seen INTEGER NOT NULL,
      metadata TEXT,
      is_trusted BOOLEAN NOT NULL DEFAULT 0
    )
  `,
	peer_metadata: `
    CREATE TABLE IF NOT EXISTS peer_metadata (
      peer_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      ttl INTEGER NOT NULL DEFAULT 86400,
      PRIMARY KEY (peer_id, key)
    )
  `,
	sessions: `
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      peer_id TEXT NOT NULL,
      public_key TEXT NOT NULL,
      private_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_used INTEGER NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT 1,
      noise_session_info TEXT
    )
  `,
	search_index: `
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      peer_id,
      alias,
      metadata,
      content='contacts'
    )
  `,
	indexes: [
		"CREATE INDEX IF NOT EXISTS idx_routing_cache_last_seen ON routing_cache(last_seen);",
		"CREATE INDEX IF NOT EXISTS idx_pending_messages_status_retry ON pending_messages(status, next_retry_at);",
		"CREATE INDEX IF NOT EXISTS idx_pending_messages_target_peer_id ON pending_messages(target_peer_id);",
		"CREATE INDEX IF NOT EXISTS idx_pending_messages_deadline_at ON pending_messages(deadline_at);",
		"CREATE INDEX IF NOT EXISTS idx_replicated_messages_status_deadline ON replicated_messages(status, deadline_at);",
		"CREATE INDEX IF NOT EXISTS idx_replicated_messages_target_peer ON replicated_messages(original_target_peer_id);",
		"CREATE INDEX IF NOT EXISTS idx_message_replicas_message_id ON message_replicas(message_id);",
		"CREATE INDEX IF NOT EXISTS idx_message_replicas_replica_peer_id ON message_replicas(replica_peer_id);",
		"CREATE INDEX IF NOT EXISTS idx_message_replicas_ack_expected ON message_replicas(ack_expected, status);",
		"CREATE INDEX IF NOT EXISTS idx_processed_messages_processed_at ON processed_messages(processed_at);",
		"CREATE INDEX IF NOT EXISTS idx_processed_messages_from_peer_id ON processed_messages(from_peer_id);",
		"CREATE INDEX IF NOT EXISTS idx_contacts_last_seen ON contacts(last_seen);",
		"CREATE INDEX IF NOT EXISTS idx_sessions_peer_id ON sessions(peer_id);",
		"CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);",
		"CREATE INDEX IF NOT EXISTS idx_peer_sequences_updated_at ON peer_sequences(updated_at);",
		"CREATE INDEX IF NOT EXISTS idx_peer_vector_clocks_updated_at ON peer_vector_clocks(updated_at);",
	],
};
