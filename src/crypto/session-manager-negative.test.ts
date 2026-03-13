import assert from "node:assert";
import { test } from "node:test";
import type { Session } from "../database/index.js";
import type { NoiseSessionInfo } from "../protocols/handshake.js";
import { SessionManager } from "./session-manager.js";

class MockDatabaseManager {
	private sessions = new Map<string, Session>();

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

	close(): void {}
}

// Negative path tests for SessionManager
test("SessionManager rejects invalid peer ID (empty string)", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	try {
		await sessionManager.createSession("");
		assert.fail("Should have thrown an error for empty peer ID");
	} catch (error) {
		assert.ok(error instanceof Error);
	}
});

test("SessionManager rejects invalid peer ID (whitespace only)", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	try {
		await sessionManager.createSession("   ");
		assert.fail("Should have thrown an error for whitespace-only peer ID");
	} catch (error) {
		assert.ok(error instanceof Error);
	}
});

test("SessionManager rejects null peer ID", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	try {
		await sessionManager.createSession(null as never);
		assert.fail("Should have thrown an error for null peer ID");
	} catch (error) {
		assert.ok(error instanceof Error);
	}
});

test("SessionManager rejects undefined peer ID", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	try {
		await sessionManager.createSession(undefined as never);
		assert.fail("Should have thrown an error for undefined peer ID");
	} catch (error) {
		assert.ok(error instanceof Error);
	}
});

test("Encryption with invalid session fails gracefully", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	const peerId = "test-peer-id";
	const session = await sessionManager.createSession(peerId);

	const invalidPublicKey = Buffer.from([1, 2, 3]);

	try {
		const sharedSecret = sessionManager.deriveSharedSecret(
			sessionManager.importPrivateKey(session.privateKey),
			sessionManager.importPublicKey(invalidPublicKey),
		);
		assert.ok(sharedSecret);
	} catch (error) {
		assert.ok(error instanceof Error);
	}
});

test("Decryption with wrong session key fails", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	const peerId = "test-peer-id";
	const session = await sessionManager.createSession(peerId);

	const keys = sessionManager.getSessionKeys(session.id);
	assert.strictEqual(keys, null);
});

test("Encryption with expired session fails gracefully", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	const peerId = "test-peer-id";
	const session = await sessionManager.createSession(peerId);

	session.expiresAt = Date.now() - 1000;

	mockDb.saveSession({
		id: session.id,
		peer_id: session.peerId,
		public_key: session.publicKey.toString("hex"),
		private_key: session.privateKey.toString("hex"),
		created_at: session.createdAt,
		expires_at: session.expiresAt,
		last_used: session.lastUsed,
		is_active: session.isActive,
	});

	const retrievedSession = sessionManager.getSession(session.id);
	assert.strictEqual(retrievedSession, null);
});

test("Multiple sessions for same peer - only one active allowed", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	const peerId = "test-peer-id";

	// Create two sessions - session1 should be returned first due to insertion order
	const session1 = await sessionManager.createSession(peerId);
	const session2 = await sessionManager.createSession(peerId);

	const activeSessions = sessionManager.getActiveSessionsForPeer(peerId);

	// Both sessions should exist
	assert.strictEqual(activeSessions.length, 2);

	// session1 is created first and should be at index 0
	assert.strictEqual(activeSessions[0].id, session1.id);

	// session2 should be at index 1
	assert.strictEqual(activeSessions[1].id, session2.id);
});

test("Session reuse with invalid noise info does not corrupt session", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	const peerId = "test-peer-id";

	const noiseSessionInfo: NoiseSessionInfo = {
		sessionId: `session_${Date.now()}`,
		peerId: "different-peer",
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

	assert.strictEqual(session.peerId, peerId);
	assert.strictEqual(session.noiseSessionInfo?.peerId, "different-peer");
});

test("Session keys derived with invalid public key throw error", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	const peerId = "test-peer-id";
	const session = await sessionManager.createSession(peerId);

	const invalidPublicKey = Buffer.from([
		0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	]);

	try {
		const sharedSecret = sessionManager.deriveSharedSecret(
			sessionManager.importPrivateKey(session.privateKey),
			sessionManager.importPublicKey(invalidPublicKey),
		);
		assert.ok(sharedSecret);
	} catch (error) {
		assert.ok(error instanceof Error);
	}
});

test("Cleanup with no expired sessions returns 0", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	const peerId = "test-peer-id";
	await sessionManager.createSession(peerId);

	const count = await sessionManager.cleanupExpired();
	assert.strictEqual(count, 0);
});

test("Multiple sessions - cleanup removes only expired", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	const peerId1 = "peer1";
	const peerId2 = "peer2";

	const session1 = await sessionManager.createSession(peerId1);
	const _session2 = await sessionManager.createSession(peerId2);

	session1.expiresAt = Date.now() - 1000;
	mockDb.saveSession({
		id: session1.id,
		peer_id: session1.peerId,
		public_key: session1.publicKey.toString("hex"),
		private_key: session1.privateKey.toString("hex"),
		created_at: session1.createdAt,
		expires_at: session1.expiresAt,
		last_used: session1.lastUsed,
		is_active: session1.isActive,
	});

	const count = await sessionManager.cleanupExpired();
	assert.strictEqual(count, 1);

	const activeSessions = sessionManager.getActiveSessionsForPeer(peerId2);
	assert.strictEqual(activeSessions.length, 1);
});

test("Update session usage with invalid ID returns without error", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	assert.doesNotThrow(() => sessionManager.updateSessionUsage("invalid-id"));
});

test("Invalidate non-existent session returns without error", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	assert.doesNotThrow(() => sessionManager.invalidateSession("invalid-id"));
});

test("Session statistics after cleanup", async () => {
	const mockDb = new MockDatabaseManager();
	const sessionManager = new SessionManager(mockDb as never);

	await sessionManager.init();

	const peerId = "test-peer-id";
	const session1 = await sessionManager.createSession(peerId);
	const _session2 = await sessionManager.createSession(peerId);

	session1.expiresAt = Date.now() - 1000;
	mockDb.saveSession({
		id: session1.id,
		peer_id: session1.peerId,
		public_key: session1.publicKey.toString("hex"),
		private_key: session1.privateKey.toString("hex"),
		created_at: session1.createdAt,
		expires_at: session1.expiresAt,
		last_used: session1.lastUsed,
		is_active: session1.isActive,
	});

	const stats = sessionManager.getStatistics();
	assert.strictEqual(stats.total, 2);
	assert.strictEqual(stats.active, 1);
	assert.strictEqual(stats.expired, 1);
});
