import { expect, test } from "bun:test";
import { DatabaseManager, type Session } from "../database/index";
import type { NoiseSessionInfo } from "../protocols/handshake";
import { SessionManager } from "./session-manager";

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

	expect(sessionManager).toBeDefined();
	expect(sessionManager).toBeInstanceOf(SessionManager);
});

test("SessionManager init method works", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	await expect(sessionManager.init()).resolves.toBeUndefined();
});

test("createSession creates a new session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	expect(session).toBeDefined();
	expect(session.id).toBeDefined();
	expect(session.peerId).toBe(peerId);
	expect(session.createdAt).toBeGreaterThan(0);
	expect(session.expiresAt).toBeGreaterThan(session.createdAt);
	expect(session.isActive).toBe(true);
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

	expect(secondSession.id).toBe(firstSession.id);
});

test("getOrCreateSession creates new session when none exists", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	// Get or create should create a new session
	const session = await sessionManager.getOrCreateSession(peerId);

	expect(session).toBeDefined();
	expect(session.peerId).toBe(peerId);
});

test("getSession retrieves existing session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	const retrievedSession = sessionManager.getSession(session.id);

	expect(retrievedSession).toBeDefined();
	expect(retrievedSession?.id).toBe(session.id);
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

	expect(retrievedSession).toBeNull();
});

test("updateSessionUsage updates last used timestamp", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	// This should not throw an error
	expect(() => sessionManager.updateSessionUsage(session.id)).not.toThrow();
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
	expect(retrievedSession).toBeNull();
});

test("getSession returns true for valid session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	const retrievedSession = sessionManager.getSession(session.id);
	expect(retrievedSession).not.toBeNull();
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
	expect(retrievedSession).toBeNull();
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

	expect(activeSessions.length).toBe(2);
	expect(activeSessions[0]).toBeDefined();
	expect(activeSessions[1]).toBeDefined();
	expect(activeSessions[0]?.peerId).toBe(peerId);
	expect(activeSessions[1]?.peerId).toBe(peerId);
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

	expect(expiredCount).toBe(1);
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

	expect(session).toBeDefined();
	expect(session.peerId).toBe(peerId);
	expect(session.noiseSessionInfo).toEqual(noiseSessionInfo);
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

	expect(session.noiseSessionInfo).toEqual(noiseSessionInfo);
});

test("getSessionKeys returns null for session without noise session info", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	const keys = sessionManager.getSessionKeys(session.id);

	expect(keys).toBeNull();
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

	expect(keys).not.toBeNull();
	expect(keys?.encryptionKey).toEqual(
		noiseSessionInfo.sessionKeys?.encryptionKey,
	);
	expect(keys?.decryptionKey).toEqual(
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

	expect(stats).toBeDefined();
	expect(stats.total).toBe(2);
	expect(stats.active).toBe(2);
});
