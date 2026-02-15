/**
 * Secure Session Manager for  Node
 * Uses X25519 + HKDF (No TweetNaCl, No WebCrypto)
 */

import crypto from "node:crypto";
import type { DatabaseManager } from "../database/index.js";
import type { NoiseSessionInfo } from "../protocols/handshake.js";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface EncryptionKeyPair {
	publicKey: crypto.KeyObject;
	privateKey: crypto.KeyObject;
}

export interface Session {
	id: string;
	peerId: string;

	publicKey: Buffer;
	privateKey: Buffer;

	createdAt: number;
	expiresAt: number;
	lastUsed: number;

	isActive: boolean;

	noiseSessionInfo?: NoiseSessionInfo;
}

export interface SessionKey {
	sessionId: string;
	encryptionKey: Uint8Array;
	decryptionKey: Uint8Array;
	createdAt: number;
	expiresAt: number;
}

/* -------------------------------------------------------------------------- */
/* Crypto Helpers                                                              */
/* -------------------------------------------------------------------------- */

export function generateKeyPair(): EncryptionKeyPair {
	return crypto.generateKeyPairSync("x25519");
}

export function exportPublicKey(key: crypto.KeyObject): Buffer {
	return key.export({ type: "spki", format: "der" }) as Buffer;
}

export function exportPrivateKey(key: crypto.KeyObject): Buffer {
	return key.export({ type: "pkcs8", format: "der" }) as Buffer;
}

export function importPublicKey(data: Buffer): crypto.KeyObject {
	return crypto.createPublicKey({
		key: data,
		type: "spki",
		format: "der",
	});
}

export function importPrivateKey(data: Buffer): crypto.KeyObject {
	return crypto.createPrivateKey({
		key: data,
		type: "pkcs8",
		format: "der",
	});
}

export function deriveSharedSecret(
	privateKey: crypto.KeyObject,
	peerPublicKey: crypto.KeyObject,
): Buffer {
	return crypto.diffieHellman({
		privateKey,
		publicKey: peerPublicKey,
	});
}

export function deriveSessionKeysHKDF(secret: Buffer): {
	encryptionKey: Buffer;
	decryptionKey: Buffer;
} {
	const material = crypto.hkdfSync(
		"sha256",
		secret,
		Buffer.alloc(0),
		Buffer.from("yapyap-noise-session"),
		64,
	);

	const buf = Buffer.isBuffer(material) ? material : Buffer.from(material);

	return {
		encryptionKey: buf.subarray(0, 32),
		decryptionKey: buf.subarray(32, 64),
	};
}

/* -------------------------------------------------------------------------- */
/* Session Manager                                                             */
/* -------------------------------------------------------------------------- */

interface DatabaseSessionRow {
	id: string;
	peer_id: string;
	public_key: string;
	private_key: string;
	created_at: number;
	expires_at: number;
	last_used: number;
	is_active: boolean;
	noise_session_info?: string | null;
}

export class SessionManager {
	private readonly databaseManager: DatabaseManager;
	private readonly sessions = new Map<string, Session>();
	private readonly DEFAULT_SESSION_LIFETIME = 60 * 60 * 1000; // 1 hour

	constructor(database: DatabaseManager) {
		this.databaseManager = database;
	}

	/* ---------------------------------------------------------------------- */
	/* Init                                                                   */
	/* ---------------------------------------------------------------------- */

	async init(): Promise<void> {
		await this.loadSessionsFromDatabase();
	}

	/* ---------------------------------------------------------------------- */
	/* Session Creation                                                       */
	/* ---------------------------------------------------------------------- */

	async createSession(
		peerId: string,
		noiseInfo?: NoiseSessionInfo,
	): Promise<Session> {
		const id = crypto.randomUUID();
		const now = Date.now();

		const keyPair = generateKeyPair();

		const session: Session = {
			id,
			peerId,
			publicKey: exportPublicKey(keyPair.publicKey),
			privateKey: exportPrivateKey(keyPair.privateKey),
			createdAt: now,
			expiresAt: now + this.DEFAULT_SESSION_LIFETIME,
			lastUsed: now,
			isActive: true,
			...(noiseInfo !== undefined ? { noiseSessionInfo: noiseInfo } : {}),
		};

		this.sessions.set(id, session);
		await this.saveSessionToDatabase(session);

		return session;
	}

	async getOrCreateSession(
		peerId: string,
		noiseInfo?: NoiseSessionInfo,
	): Promise<Session> {
		const existing = this.getActiveSessionsForPeer(peerId)[0];
		if (existing) return existing;

		return this.createSession(peerId, noiseInfo);
	}

	/* ---------------------------------------------------------------------- */
	/* Shared Secret + Keys                                                   */
	/* ---------------------------------------------------------------------- */

	async deriveAndStoreSessionKeys(
		sessionId: string,
		peerPublicKeyBytes: Buffer,
	): Promise<void> {
		const session = this.getSession(sessionId);
		if (!session) return;

		const privateKey = importPrivateKey(session.privateKey);
		const peerPublicKey = importPublicKey(peerPublicKeyBytes);

		const secret = deriveSharedSecret(privateKey, peerPublicKey);
		const keys = deriveSessionKeysHKDF(secret);

		if (!session.noiseSessionInfo) {
			session.noiseSessionInfo = {
				sessionId: session.id,
				peerId: session.peerId,
				staticPublicKey: session.publicKey,
				handshakeComplete: true,
				sessionKeys: keys,
			};
		} else {
			session.noiseSessionInfo.sessionKeys = keys;
			session.noiseSessionInfo.handshakeComplete = true;
		}

		session.lastUsed = Date.now();

		await this.updateSessionInDatabase(session);
	}

	/* ---------------------------------------------------------------------- */
	/* Getters                                                                */
	/* ---------------------------------------------------------------------- */

	getSession(id: string): Session | null {
		const session = this.sessions.get(id);
		if (!session) return null;

		if (this.isExpired(session)) {
			void this.invalidateSession(id);
			return null;
		}

		return session;
	}

	getActiveSessionsForPeer(peerId: string): Session[] {
		return [...this.sessions.values()]
			.filter((s) => s.peerId === peerId && s.isActive && !this.isExpired(s))
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	getSessionKeys(sessionId: string) {
		const s = this.getSession(sessionId);
		return s?.noiseSessionInfo?.sessionKeys ?? null;
	}

	private isExpired(s: Session): boolean {
		return Date.now() > s.expiresAt;
	}

	/* ---------------------------------------------------------------------- */
	/* Maintenance                                                            */
	/* ---------------------------------------------------------------------- */

	async updateSessionUsage(id: string): Promise<void> {
		const s = this.sessions.get(id);
		if (!s) return;

		s.lastUsed = Date.now();
		await this.updateSessionInDatabase(s);
	}

	async invalidateSession(id: string): Promise<void> {
		const s = this.sessions.get(id);
		if (!s) return;

		s.isActive = false;
		s.expiresAt = Date.now();

		this.sessions.delete(id);

		await this.updateSessionInDatabase(s);
	}

	async cleanupExpired(): Promise<number> {
		let count = 0;

		for (const [id, s] of this.sessions.entries()) {
			if (this.isExpired(s)) {
				await this.invalidateSession(id);
				count++;
			}
		}

		await this.databaseManager.deleteExpiredSessions();

		return count;
	}

	/* ---------------------------------------------------------------------- */
	/* Database                                                               */
	/* ---------------------------------------------------------------------- */

	private async loadSessionsFromDatabase(): Promise<void> {
		const rows: DatabaseSessionRow[] =
			await this.databaseManager.getAllActiveSessions();

		for (const row of rows) {
			let noiseInfo: NoiseSessionInfo | undefined;

			if (row.noise_session_info) {
				try {
					noiseInfo = JSON.parse(row.noise_session_info);
				} catch {
					noiseInfo = undefined;
				}
			}

			const session: Session = {
				id: row.id,
				peerId: row.peer_id ?? "",
				publicKey: Buffer.from(row.public_key, "hex"),
				privateKey: Buffer.from(row.private_key, "hex"),
				createdAt: row.created_at,
				expiresAt: row.expires_at,
				lastUsed: row.last_used,
				isActive: row.is_active,
				...(noiseInfo !== undefined ? { noiseSessionInfo: noiseInfo } : {}),
			};

			if (!this.isExpired(session) && session.isActive) {
				this.sessions.set(session.id, session);
			}
		}
	}

	private async saveSessionToDatabase(s: Session): Promise<void> {
		await this.databaseManager.saveSession({
			id: s.id,
			peer_id: s.peerId,
			public_key: s.publicKey.toString("hex"),
			private_key: s.privateKey.toString("hex"),
			expires_at: s.expiresAt,
			last_used: s.lastUsed,
			is_active: s.isActive,
			noise_session_info: s.noiseSessionInfo
				? JSON.stringify(s.noiseSessionInfo)
				: "",
		});
	}

	private async updateSessionInDatabase(s: Session): Promise<void> {
		await this.saveSessionToDatabase(s);
	}

	/* ---------------------------------------------------------------------- */
	/* Stats                                                                  */
	/* ---------------------------------------------------------------------- */

	getStatistics() {
		const active = [...this.sessions.values()].filter(
			(s) => s.isActive && !this.isExpired(s),
		);

		return {
			total: this.sessions.size,
			active: active.length,
			expired: this.sessions.size - active.length,
		};
	}
}
