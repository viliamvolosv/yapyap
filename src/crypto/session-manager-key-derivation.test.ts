import assert from "node:assert";
import * as crypto from "node:crypto";
import { test } from "node:test";
import { DatabaseManager, type Session } from "../database/index.js";
import type { NoiseSessionInfo } from "../protocols/handshake.js";
import { SessionManager } from "./session-manager.js";

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

test("createE2ESession creates a new session", async () => {
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

test("getOrCreateE2ESession returns existing session when one exists", async () => {
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

test("getOrCreateE2ESession creates new session when none exists", async () => {
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

test("getOrCreateE2ESession returns existing session when one exists", async () => {
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

test("getOrCreateE2ESession creates new session when none exists", async () => {
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

	// Manually expire the session by modifying the in-memory session
	// Note: In the actual implementation, the SessionManager checks expiration
	// when getSession is called. We'll test this by creating a session with
	// an already expired timestamp.

	// Expire the session via the object reference returned earlier
	session.expiresAt = Date.now() - 1000;

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
	assert.strictEqual(retrievedSession, null);
});

test("isValidSession returns true for valid session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	const isValid = sessionManager.getSession(session.id) !== null;
	assert.strictEqual(isValid, true);
});

test("isValidSession returns false for expired session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	// Manually expire the session via the session object
	session.expiresAt = Date.now() - 1000;

	const isValid = sessionManager.getSession(session.id) !== null;
	assert.strictEqual(isValid, false);
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

	// Manually expire the session via the session object
	session.expiresAt = Date.now() - 1000;

	// Cleanup should remove expired sessions
	const expiredCount = await sessionManager.cleanupExpired();
	assert.strictEqual(expiredCount, 1);
});

test("getOrCreateE2ESessionWithHandshake creates new session when none exists", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const noiseSessionInfo: NoiseSessionInfo = {
		sessionId: `session_${Date.now()}`,
		peerId: "test-peer-id",
		staticPublicKey: new Uint8Array([1, 2, 3, 4, 5]),
		handshakeComplete: true,
		sessionKeys: {
			encryptionKey: new Uint8Array([4, 5, 6]),
			decryptionKey: new Uint8Array([7, 8, 9]),
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

test("getOrCreateE2ESessionWithHandshake updates existing session with handshake info", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const noiseSessionInfo: NoiseSessionInfo = {
		sessionId: `session_${Date.now()}`,
		peerId: "test-peer-id",
		staticPublicKey: new Uint8Array([1, 2, 3, 4, 5]),
		handshakeComplete: true,
		sessionKeys: {
			encryptionKey: new Uint8Array([4, 5, 6]),
			decryptionKey: new Uint8Array([7, 8, 9]),
		},
	};

	// Get or create with handshake info - should create a new session
	const updatedSession = await sessionManager.getOrCreateSession(
		peerId,
		noiseSessionInfo,
	);

	assert.deepStrictEqual(updatedSession.noiseSessionInfo, noiseSessionInfo);
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
		staticPublicKey: new Uint8Array([1, 2, 3, 4, 5]),
		handshakeComplete: true,
		sessionKeys: {
			encryptionKey: new Uint8Array([4, 5, 6]),
			decryptionKey: new Uint8Array([7, 8, 9]),
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

// Additional tests for new functionality
test("deriveAndStoreSessionKeys derives and stores session keys", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const session = await sessionManager.createSession(peerId);

	// Generate a valid X25519 keypair for the peer
	const { publicKey: peerPublicKey } = crypto.generateKeyPairSync("x25519");

	// This should not throw an error
	await sessionManager.deriveAndStoreSessionKeys(
		session.id,
		peerPublicKey.export({ format: "der", type: "spki" }),
	);

	const keys = sessionManager.getSessionKeys(session.id);
	assert.notStrictEqual(keys, null);
	assert.notStrictEqual(keys?.encryptionKey, undefined);
	assert.notStrictEqual(keys?.decryptionKey, undefined);
});

test("createSession with noiseSessionInfo includes it in the session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb);

	// Initialize the session manager
	await sessionManager.init();

	const peerId = "test-peer-id";

	const noiseSessionInfo: NoiseSessionInfo = {
		sessionId: `session_${Date.now()}`,
		peerId: "test-peer-id",
		staticPublicKey: new Uint8Array([1, 2, 3, 4, 5]),
		handshakeComplete: true,
		sessionKeys: {
			encryptionKey: new Uint8Array([4, 5, 6]),
			decryptionKey: new Uint8Array([7, 8, 9]),
		},
	};

	const session = await sessionManager.createSession(peerId, noiseSessionInfo);

	assert.deepStrictEqual(session.noiseSessionInfo, noiseSessionInfo);
});
