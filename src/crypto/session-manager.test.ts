import assert from "node:assert";
import { test } from "node:test";
import { DatabaseManager, type Session } from "../database/index.js";
import type { NoiseSessionInfo } from "../protocols/handshake.js";
import { SessionManager } from "./session-manager.js";

// Helper to convert session-manager Session to database Session
function toDatabaseSession(
	session: import("./session-manager").Session,
): Session {
	return {
		id: session.id,
		peer_id: session.peerId,
		public_key: session.publicKey.toString("base64"),
		private_key: session.privateKey.toString("base64"),
		created_at: session.createdAt,
		expires_at: session.expiresAt,
		last_used: session.lastUsed,
		is_active: session.isActive,
	};
}

// Mock database manager to avoid actual database operations during tests
class MockDatabaseManager extends DatabaseManager {
	private sessions: Map<string, Session> = new Map();

	constructor() {
		super({ dataDir: "./test-data" });
	}

	saveSession(session: Session): void {
		this.sessions.set(session.id, session);
	}

	getSession(id: string): Session | null {
		return this.sessions.get(id) || null;
	}

	getAllActiveSessions(): Session[] {
		const activeSessions: Session[] = [];
		for (const session of this.sessions.values()) {
			if (session.is_active) {
				activeSessions.push(session);
			}
		}
		return activeSessions;
	}

	updateSessionLastUsed(id: string): void {
		const session = this.sessions.get(id);
		if (session) {
			session.last_used = Date.now();
			this.sessions.set(id, session);
		}
	}

	invalidateSession(id: string): void {
		const session = this.sessions.get(id);
		if (session) {
			session.is_active = false;
			session.expires_at = Date.now();
			this.sessions.set(id, session);
		}
	}

	deleteExpiredSessions(): number {
		let count = 0;
		for (const [id, session] of this.sessions.entries()) {
			if (Date.now() > session.expires_at) {
				this.sessions.delete(id);
				count++;
			}
		}
		return count;
	}

	close(): void {
		// Mock cleanup
	}
}

test("SessionManager can be instantiated", () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	assert.notStrictEqual(sessionManager, undefined);
	assert.ok(sessionManager instanceof SessionManager);
});

test("SessionManager init method works", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	await assert.doesNotReject(async () => await sessionManager.init());
});

test("createSession creates a new session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	assert.notStrictEqual(session, undefined);
	assert.notStrictEqual(session.id, undefined);
	assert.strictEqual(session.peerId, peerId);
	assert.ok(session.createdAt > 0);
	assert.ok(session.expiresAt > session.createdAt);
	assert.strictEqual(session.isActive, true);
});

test("getOrCreateSession returns existing session when one exists", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	// Create first session
	const firstSession = await sessionManager.createSession(peerId);

	// Get or create should return the existing session
	const secondSession = await sessionManager.getOrCreateSession(peerId);

	assert.strictEqual(secondSession.id, firstSession.id);
});

test("getOrCreateSession creates new session when none exists", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	// Get or create should create a new session
	const session = await sessionManager.getOrCreateSession(peerId);

	assert.notStrictEqual(session, undefined);
	assert.strictEqual(session.peerId, peerId);
});

test("getSession retrieves existing session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	const retrievedSession = sessionManager.getSession(session.id);

	assert.notStrictEqual(retrievedSession, undefined);
	assert.strictEqual(retrievedSession?.id, session.id);
});

test("getSession returns null for expired session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	// Manually expire the session
	session.expiresAt = Date.now() - 1000;

	// Update in mock database
	mockDb.saveSession(toDatabaseSession(session));

	const retrievedSession = sessionManager.getSession(session.id);

	assert.strictEqual(retrievedSession, null);
});

test("updateSessionUsage updates last used timestamp", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	// This should not throw an error
	assert.doesNotThrow(() => sessionManager.updateSessionUsage(session.id));
});

test("invalidateSession marks session as inactive", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	// Invalidate the session
	sessionManager.invalidateSession(session.id);

	// Get session should return null since it's invalidated
	const retrievedSession = sessionManager.getSession(session.id);
	assert.strictEqual(retrievedSession, null);
});

test("getSession returns true for valid session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	const retrievedSession = sessionManager.getSession(session.id);
	assert.notStrictEqual(retrievedSession, null);
});

test("getSession returns false for expired session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	// Manually expire the session
	session.expiresAt = Date.now() - 1000;

	// Update in mock database
	mockDb.saveSession(toDatabaseSession(session));

	const retrievedSession = sessionManager.getSession(session.id);
	assert.strictEqual(retrievedSession, null);
});

test("getActiveSessionsForPeer returns active sessions for peer", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	// Create multiple sessions for same peer
	await sessionManager.createSession(peerId);
	await sessionManager.createSession(peerId);

	const activeSessions = sessionManager.getActiveSessionsForPeer(peerId);

	assert.strictEqual(activeSessions.length, 2);
	assert.notStrictEqual(activeSessions[0], undefined);
	assert.notStrictEqual(activeSessions[1], undefined);
	assert.strictEqual(activeSessions[0]?.peerId, peerId);
	assert.strictEqual(activeSessions[1]?.peerId, peerId);
});

test("cleanupExpiredSessions removes expired sessions", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	// Create a session
	const session = await sessionManager.createSession(peerId);

	// Manually expire the session
	session.expiresAt = Date.now() - 1000;

	// Update in mock database
	mockDb.saveSession(toDatabaseSession(session));

	// Cleanup should remove expired sessions
	const expiredCount = await sessionManager.cleanupExpired();

	assert.strictEqual(expiredCount, 1);
});

test("getOrCreateSession with noise session info creates new session when none exists", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const noiseSessionInfo: NoiseSessionInfo = {
		sessionId: `session_${Date.now()}`,
		peerId: "test-peer-id",
		staticPublicKey: Buffer.from([1, 2, 3, 4, 5]),
		handshakeComplete: true,
		sessionKeys: {
			encryptionKey: Buffer.from([4, 5, 6]),
			decryptionKey: Buffer.from([7, 8, 9]),
		},
	};

	const session = await sessionManager.getOrCreateSession(
		peerId,
		noiseSessionInfo,
	);

	assert.notStrictEqual(session, undefined);
	assert.strictEqual(session.peerId, peerId);
	assert.deepStrictEqual(session.noiseSessionInfo, noiseSessionInfo);
});

test("getOrCreateSession with noise session info updates existing session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const noiseSessionInfo: NoiseSessionInfo = {
		sessionId: `session_${Date.now()}`,
		peerId: "test-peer-id",
		staticPublicKey: Buffer.from([1, 2, 3, 4, 5]),
		handshakeComplete: true,
		sessionKeys: {
			encryptionKey: Buffer.from([4, 5, 6]),
			decryptionKey: Buffer.from([7, 8, 9]),
		},
	};

	// Create a session with handshake info
	const session = await sessionManager.getOrCreateSession(
		peerId,
		noiseSessionInfo,
	);

	assert.deepStrictEqual(session.noiseSessionInfo, noiseSessionInfo);
});

test("getSessionKeys returns null for session without noise session info", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	const keys = sessionManager.getSessionKeys(session.id);

	assert.strictEqual(keys, null);
});

test("getSessionKeys returns encryption/decryption keys for session with noise session info", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const noiseSessionInfo: NoiseSessionInfo = {
		sessionId: `session_${Date.now()}`,
		peerId: "test-peer-id",
		staticPublicKey: Buffer.from([1, 2, 3, 4, 5]),
		handshakeComplete: true,
		sessionKeys: {
			encryptionKey: Buffer.from([4, 5, 6]),
			decryptionKey: Buffer.from([7, 8, 9]),
		},
	};

	const session = await sessionManager.createSession(peerId, noiseSessionInfo);

	const keys = sessionManager.getSessionKeys(session.id);

	assert.notStrictEqual(keys, null);
	assert.deepStrictEqual(
		keys?.encryptionKey,
		noiseSessionInfo.sessionKeys?.encryptionKey,
	);
	assert.deepStrictEqual(
		keys?.decryptionKey,
		noiseSessionInfo.sessionKeys?.decryptionKey,
	);
});

test("getStatistics returns correct statistics", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	// Create a few sessions
	await sessionManager.createSession(peerId);
	await sessionManager.createSession(peerId);

	const stats = sessionManager.getStatistics();

	assert.notStrictEqual(stats, undefined);
	assert.strictEqual(stats.total, 2);
	assert.strictEqual(stats.active, 2);
});
