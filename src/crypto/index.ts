/**
 * Cryptographic utilities for YapYap node
 * Implements end-to-end encryption and key management
 */

import * as crypto from "node:crypto";

export interface EncryptionKeyPair {
	publicKey: Uint8Array;
	privateKey: Uint8Array;
}

export interface EncryptedMessage {
	ciphertext: Uint8Array;
	nonce: Uint8Array;
	ephemeralPublicKey?: Uint8Array;
	signature?: Uint8Array;
}

export interface DecryptedMessage {
	plaintext: Uint8Array;
	signature?: Uint8Array;
}

/**
 * Generate a key pair using Ed25519 for identity
 */
export async function generateIdentityKeyPair(): Promise<EncryptionKeyPair> {
	// Use Node's crypto for Ed25519 key generation
	const keyPair = crypto.generateKeyPairSync("ed25519");

	const publicKey = await keyPair.publicKey.export({
		type: "spki",
		format: "der",
	});
	const privateKey = await keyPair.privateKey.export({
		type: "pkcs8",
		format: "der",
	});

	return {
		publicKey: new Uint8Array(publicKey),
		privateKey: new Uint8Array(privateKey),
	};
}

/**
 * Generate an ephemeral key pair using X25519 for ECDH
 */
export async function generateEphemeralKeyPair(): Promise<EncryptionKeyPair> {
	// Use Node's crypto for X25519 key generation
	const keyPair = crypto.generateKeyPairSync("x25519");

	const publicKey = await keyPair.publicKey.export({
		type: "spki",
		format: "der",
	});
	const privateKey = await keyPair.privateKey.export({
		type: "pkcs8",
		format: "der",
	});

	return {
		publicKey: new Uint8Array(publicKey),
		privateKey: new Uint8Array(privateKey),
	};
}

/**
 * Derive a shared secret using ECDH with X25519
 */
export async function deriveSharedSecret(
	publicKey: Uint8Array,
	privateKey: Uint8Array,
): Promise<Uint8Array> {
	// Use Node's crypto for X25519 Diffie-Hellman
	let importedPublicKey: crypto.KeyObject;
	let importedPrivateKey: crypto.KeyObject;
	try {
		importedPublicKey = crypto.createPublicKey({
			key: Buffer.from(publicKey),
			type: "spki",
			format: "der",
		});
		importedPrivateKey = crypto.createPrivateKey({
			key: Buffer.from(privateKey),
			type: "pkcs8",
			format: "der",
		});
	} catch (e) {
		throw new Error(
			"Failed to import X25519 keys for ECDH. Ensure you are passing X25519 keys in DER format. " +
				(e instanceof Error ? e.message : e),
		);
	}

	// Check key types
	if (
		importedPrivateKey.asymmetricKeyType !== "x25519" ||
		importedPublicKey.asymmetricKeyType !== "x25519"
	) {
		throw new Error(
			`deriveSharedSecret: Both keys must be X25519. Got privateKey type: ${importedPrivateKey.asymmetricKeyType}, publicKey type: ${importedPublicKey.asymmetricKeyType}`,
		);
	}

	// Use Node's crypto.diffieHellman for X25519
	return crypto.diffieHellman({
		privateKey: importedPrivateKey,
		publicKey: importedPublicKey,
	});
}

/**
 * Encrypt a message using AES-GCM
 */
export async function encryptMessage(
	plaintext: Uint8Array,
	key: Uint8Array,
	nonce?: Uint8Array,
): Promise<EncryptedMessage> {
	if (!nonce) {
		nonce = crypto.randomBytes(12); // 96-bit nonce for AES-GCM
	}

	// Use Node's crypto for AES-GCM encryption
	const cipher = crypto.createCipheriv(
		"aes-256-gcm",
		Buffer.from(key),
		Buffer.from(nonce),
	);
	const ciphertext = Buffer.concat([
		cipher.update(Buffer.from(plaintext)),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	// Append authTag to ciphertext
	const fullCiphertext = Buffer.concat([ciphertext, authTag]);
	return {
		ciphertext: new Uint8Array(fullCiphertext),
		nonce: nonce,
	};
}

/**
 * Decrypt a message using AES-GCM
 */
export async function decryptMessage(
	ciphertext: Uint8Array,
	key: Uint8Array,
	nonce: Uint8Array,
): Promise<Uint8Array> {
	// Use Node's crypto for AES-GCM decryption
	const decipher = crypto.createDecipheriv(
		"aes-256-gcm",
		Buffer.from(key),
		Buffer.from(nonce),
	);
	// If ciphertext includes authTag, extract and set it
	// Assume last 16 bytes are authTag (standard for AES-GCM)
	const tagLength = 16;
	if (ciphertext.length > tagLength) {
		const authTag = Buffer.from(
			ciphertext.slice(ciphertext.length - tagLength),
		);
		const encrypted = Buffer.from(
			ciphertext.slice(0, ciphertext.length - tagLength),
		);
		decipher.setAuthTag(authTag);
		try {
			const plaintext = Buffer.concat([
				decipher.update(encrypted),
				decipher.final(),
			]);
			return new Uint8Array(plaintext);
		} catch (error) {
			throw new Error(
				`Decryption failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	} else {
		// No authTag, fallback
		try {
			const plaintext = Buffer.concat([
				decipher.update(Buffer.from(ciphertext)),
				decipher.final(),
			]);
			return new Uint8Array(plaintext);
		} catch (error) {
			throw new Error(
				`Decryption failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

/**
 * Sign a message using Ed25519
 */
export async function signMessage(
	message: Uint8Array,
	privateKey: Uint8Array,
): Promise<Uint8Array> {
	// Use Node's crypto for Ed25519 signing
	const importedPrivateKey = crypto.createPrivateKey({
		key: Buffer.from(privateKey),
		format: "der",
		type: "pkcs8",
	});
	const signature = crypto.sign(null, Buffer.from(message), importedPrivateKey);
	return new Uint8Array(signature);
}

/**
 * Verify a signature using Ed25519
 */
export async function verifySignature(
	message: Uint8Array,
	signature: Uint8Array,
	publicKey: Uint8Array,
): Promise<boolean> {
	// Use Node's crypto for Ed25519 signature verification
	const importedPublicKey = crypto.createPublicKey({
		key: Buffer.from(publicKey),
		format: "der",
		type: "spki",
	});
	return crypto.verify(
		null,
		Buffer.from(message),
		importedPublicKey,
		Buffer.from(signature),
	);
}

/**
 * Generate a key from a password using PBKDF2
 */
export async function deriveKeyFromPassword(
	password: string,
	salt: Uint8Array,
	iterations: number = 100000,
): Promise<Uint8Array> {
	// Use Node's crypto for PBKDF2 key derivation
	const keyMaterial = crypto.pbkdf2Sync(
		password,
		salt,
		iterations,
		32,
		"sha256",
	);

	return new Uint8Array(keyMaterial);
}

/**
 * Generate a unique session identifier
 */
export function generateSessionId(): string {
	return `session_${Date.now()}_${crypto.randomBytes(16).toString("hex")}`;
}

/**
 * Create a deterministic key from a message and peer identity
 */
export function deriveMessageKey(
	message: string | Uint8Array,
	peerIdentity: Uint8Array,
): Uint8Array {
	const encoder = new TextEncoder();
	const messageBytes =
		typeof message === "string" ? encoder.encode(message) : message;
	const data = new Uint8Array([...messageBytes, ...peerIdentity]);

	// Use SHA-256 to create a deterministic key from the message and identity
	const hash = crypto.createHash("sha256");
	hash.update(data);
	return hash.digest();
}

/**
 * Encrypt a message using E2EE with X25519 + AES-GCM + Ed25519 signature
 */
export async function encryptE2EMessage(
	plaintext: string,
	recipientPublicKey: Uint8Array,
	senderPrivateKey: Uint8Array,
): Promise<EncryptedMessage> {
	try {
		// Generate ephemeral key pair for this message
		const ephemeralKeyPair = await generateEphemeralKeyPair();

		// Derive shared secret using ECDH
		const sharedSecret = await deriveSharedSecret(
			recipientPublicKey,
			ephemeralKeyPair.privateKey,
		);

		// Create plaintext bytes
		const encoder = new TextEncoder();
		const plaintextBytes = encoder.encode(plaintext);

		// Derive AES-GCM key from shared secret only (to match decryption)
		const hash = crypto.createHash("sha256");
		hash.update(sharedSecret);
		const messageKey = hash.digest().slice(0, 32);

		// Special case: handle empty plaintext
		let encryptedResult: { ciphertext: Uint8Array; nonce: Uint8Array };
		if (plaintextBytes.length === 0) {
			encryptedResult = {
				ciphertext: new Uint8Array(0),
				nonce: crypto.randomBytes(12),
			};
		} else {
			encryptedResult = await encryptMessage(plaintextBytes, messageKey);
		}

		// Sign the message with sender's private key for authenticity
		const signature = await signMessage(plaintextBytes, senderPrivateKey);

		return {
			ciphertext: encryptedResult.ciphertext,
			nonce: encryptedResult.nonce,
			ephemeralPublicKey: ephemeralKeyPair.publicKey,
			signature: signature,
		};
	} catch (error) {
		console.error("E2E encryption failed:", error);
		throw new Error(
			`Failed to encrypt E2E message: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Decrypt a message using E2EE with X25519 + AES-GCM + Ed25519 signature verification
 */
export async function decryptE2EMessage(
	encryptedMessage: EncryptedMessage,
	senderPublicKey: Uint8Array,
	recipientPrivateKey: Uint8Array,
): Promise<string> {
	try {
		if (!encryptedMessage.ephemeralPublicKey) {
			throw new Error("Missing ephemeral public key in encrypted message");
		}

		// Derive shared secret using ECDH with ephemeral public key from message
		const sharedSecret = await deriveSharedSecret(
			encryptedMessage.ephemeralPublicKey,
			recipientPrivateKey,
		);

		// FIXED: We need to decrypt first to get the plaintext, then derive the key
		// However, we need the key to decrypt. This is a chicken-and-egg problem.
		// The issue is that deriveMessageKey uses the plaintext, but we need the key to get the plaintext.

		// Solution: We need a different approach. Let's derive the key from the ciphertext metadata
		// For now, we'll use a simpler approach: derive key from shared secret only

		// Create a key from shared secret (simplified approach)
		const hash = crypto.createHash("sha256");
		hash.update(sharedSecret);
		const messageKey = hash.digest().slice(0, 32);

		// Special case: handle empty ciphertext
		let plaintextBytes: Uint8Array;
		if (
			!encryptedMessage.ciphertext ||
			encryptedMessage.ciphertext.length === 0
		) {
			plaintextBytes = new Uint8Array(0);
		} else {
			plaintextBytes = await decryptMessage(
				encryptedMessage.ciphertext,
				messageKey,
				encryptedMessage.nonce,
			);
		}

		// Verify signature if present
		if (encryptedMessage.signature) {
			const isValid = await verifySignature(
				plaintextBytes,
				encryptedMessage.signature,
				senderPublicKey,
			);

			if (!isValid) {
				throw new Error("Message signature verification failed");
			}
		}

		return new TextDecoder().decode(plaintextBytes);
	} catch (error) {
		console.error("E2E decryption failed:", error);
		throw new Error(
			`Failed to decrypt E2E message: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}
