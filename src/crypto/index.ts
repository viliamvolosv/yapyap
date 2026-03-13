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
export function generateIdentityKeyPair(): EncryptionKeyPair {
	// Use Node's crypto for Ed25519 key generation
	const keyPair = crypto.generateKeyPairSync("ed25519");

	const publicKey = keyPair.publicKey.export({
		type: "spki",
		format: "der",
	});
	const privateKey = keyPair.privateKey.export({
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
export function generateEphemeralKeyPair(): EncryptionKeyPair {
	// Use Node's crypto for X25519 key generation
	const keyPair = crypto.generateKeyPairSync("x25519");

	const publicKey = keyPair.publicKey.export({
		type: "spki",
		format: "der",
	});
	const privateKey = keyPair.privateKey.export({
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
export function deriveSharedSecret(
	publicKey: Uint8Array,
	privateKey: Uint8Array,
): Uint8Array {
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
	const secret = crypto.diffieHellman({
		privateKey: importedPrivateKey,
		publicKey: importedPublicKey,
	});
	return new Uint8Array(secret);
}

const X25519_PUBLIC_KEY_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
const X25519_PRIVATE_KEY_PREFIX = Buffer.from(
	"302e020100300506032b656e04220420",
	"hex",
);
const P25519 = (1n << 255n) - 19n;

function ensureX25519PublicKeyDer(
	key: Uint8Array,
	context: string,
): Uint8Array {
	let keyObject: crypto.KeyObject;

	try {
		keyObject = crypto.createPublicKey({
			key: Buffer.from(key),
			format: "der",
			type: "spki",
		});
	} catch (error) {
		throw new Error(
			`Failed to parse ${context} public key as SPKI: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	if (keyObject.asymmetricKeyType === "x25519") {
		return key;
	}

	if (keyObject.asymmetricKeyType === "ed25519") {
		const jwk = keyObject.export({ format: "jwk" }) as crypto.JsonWebKey;
		if (!jwk.x) {
			throw new Error(`Missing Ed25519 public key material for ${context}`);
		}

		const edRaw = Buffer.from(jwk.x, "base64url");
		const montgomeryRaw = convertEd25519PublicToX25519(edRaw);
		return Buffer.concat([
			X25519_PUBLIC_KEY_PREFIX,
			Buffer.from(montgomeryRaw),
		]);
	}

	throw new Error(
		`Unsupported public key type "${keyObject.asymmetricKeyType}" for ${context}; expected X25519 or Ed25519`,
	);
}

function ensureX25519PrivateKeyDer(
	key: Uint8Array,
	context: string,
): Uint8Array {
	let keyObject: crypto.KeyObject;

	try {
		keyObject = crypto.createPrivateKey({
			key: Buffer.from(key),
			format: "der",
			type: "pkcs8",
		});
	} catch (error) {
		throw new Error(
			`Failed to parse ${context} private key as PKCS8: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}

	if (keyObject.asymmetricKeyType === "x25519") {
		return key;
	}

	if (keyObject.asymmetricKeyType === "ed25519") {
		const jwk = keyObject.export({ format: "jwk" }) as crypto.JsonWebKey;
		if (!jwk.d) {
			throw new Error(`Missing Ed25519 private key material for ${context}`);
		}

		const edRaw = Buffer.from(jwk.d, "base64url");
		const montgomeryRaw = convertEd25519PrivateToX25519(edRaw);
		return Buffer.concat([
			X25519_PRIVATE_KEY_PREFIX,
			Buffer.from(montgomeryRaw),
		]);
	}

	throw new Error(
		`Unsupported private key type "${keyObject.asymmetricKeyType}" for ${context}; expected X25519 or Ed25519`,
	);
}

function convertEd25519PublicToX25519(raw: Uint8Array): Uint8Array {
	if (raw.length !== 32) {
		throw new Error("Ed25519 public key must be 32 bytes");
	}

	const y = decodeEdwardsY(raw);
	const numerator = (1n + y) % P25519;
	const denominator = (1n - y + P25519) % P25519;
	if (denominator === 0n) {
		throw new Error("Cannot convert Ed25519 key with y=1 to X25519");
	}

	const montgomery = (numerator * modInverse(denominator, P25519)) % P25519;
	return toLittleEndian(montgomery);
}

function convertEd25519PrivateToX25519(raw: Uint8Array): Uint8Array {
	if (raw.length !== 32) {
		throw new Error("Ed25519 private key must be 32 bytes");
	}

	const hash = crypto.createHash("sha512").update(raw).digest();
	const scalar = new Uint8Array(hash.slice(0, 32));
	scalar[0] &= 248;
	scalar[31] &= 127;
	scalar[31] |= 64;
	return scalar;
}

function decodeEdwardsY(raw: Uint8Array): bigint {
	let y = 0n;
	for (let i = 0; i < 32; i++) {
		let byte = BigInt(raw[i]);
		if (i === 31) {
			byte &= 0x7fn;
		}
		y |= byte << BigInt(i * 8);
	}
	return y;
}

function modInverse(value: bigint, modulus: bigint): bigint {
	let a = ((value % modulus) + modulus) % modulus;
	let b = modulus;
	let x = 0n;
	let lastX = 1n;

	while (b !== 0n) {
		const quotient = a / b;
		[a, b] = [b, a - quotient * b];
		[lastX, x] = [x, lastX - quotient * x];
	}

	if (a !== 1n) {
		throw new Error("Value is not invertible modulo the field prime");
	}

	return ((lastX % modulus) + modulus) % modulus;
}

function toLittleEndian(value: bigint): Uint8Array {
	let remaining = value;
	const bytes = new Uint8Array(32);
	for (let i = 0; i < 32; i++) {
		bytes[i] = Number(remaining & 0xffn);
		remaining >>= 8n;
	}
	return bytes;
}

function deriveSymmetricKey(key: Uint8Array): Buffer {
	if (!key || key.length < 32) {
		throw new Error("Symmetric key must be at least 32 bytes");
	}

	if (key.length === 32) {
		return Buffer.from(key);
	}

	const hash = crypto.createHash("sha256");
	hash.update(key);
	return hash.digest().slice(0, 32);
}

function normalizeEncryptNonce(nonce?: Uint8Array): Buffer {
	if (!nonce) {
		return crypto.randomBytes(12);
	}

	if (nonce.length !== 12) {
		throw new Error("Invalid nonce length: must be 12 bytes (96 bits)");
	}

	return Buffer.from(nonce);
}

function normalizeDecryptNonce(nonce: Uint8Array): Buffer {
	if (nonce.length !== 12) {
		throw new Error("Invalid nonce length: must be 12 bytes (96 bits)");
	}

	return Buffer.from(nonce);
}

/**
 * Encrypt a message using AES-GCM
 */
export function encryptMessage(
	plaintext: Uint8Array,
	key: Uint8Array,
	nonce?: Uint8Array,
): EncryptedMessage {
	const derivedKey = deriveSymmetricKey(key);
	const nonceBuffer = normalizeEncryptNonce(nonce);

	// Use Node's crypto for AES-GCM encryption
	const cipher = crypto.createCipheriv("aes-256-gcm", derivedKey, nonceBuffer);
	const ciphertext = Buffer.concat([
		cipher.update(Buffer.from(plaintext)),
		cipher.final(),
	]);
	const authTag = cipher.getAuthTag();
	// Append authTag to ciphertext
	const fullCiphertext = Buffer.concat([ciphertext, authTag]);
	return {
		ciphertext: new Uint8Array(fullCiphertext),
		nonce: new Uint8Array(nonceBuffer),
	};
}

/**
 * Decrypt a message using AES-GCM
 */
export function decryptMessage(
	ciphertext: Uint8Array,
	key: Uint8Array,
	nonce: Uint8Array,
): Uint8Array {
	const derivedKey = deriveSymmetricKey(key);
	const nonceBuffer = normalizeDecryptNonce(nonce);

	// Use Node's crypto for AES-GCM decryption
	const decipher = crypto.createDecipheriv("aes-256-gcm", derivedKey, nonceBuffer);
	// If ciphertext includes authTag, extract and set it
	// Assume last 16 bytes are authTag (standard for AES-GCM)
	const tagLength = 16;
	if (ciphertext.length < tagLength) {
		throw new Error(
			"Decryption failed: ciphertext must include encrypted data plus auth tag",
		);
	}

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
}

/**
 * Sign a message using Ed25519
 */
export function signMessage(
	message: Uint8Array,
	privateKey: Uint8Array,
): Uint8Array {
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
export function verifySignature(
	message: Uint8Array,
	signature: Uint8Array,
	publicKey: Uint8Array,
): boolean {
	if (!signature || signature.length === 0) {
		throw new Error("verifySignature: signature must not be empty");
	}
	// Use Node's crypto for Ed25519 signature verification
	const importedPublicKey = crypto.createPublicKey({
		key: Buffer.from(publicKey),
		format: "der",
		type: "spki",
	});
	try {
		const result = crypto.verify(
			null,
			Buffer.from(message),
			importedPublicKey,
			Buffer.from(signature),
		);
		return result;
	} catch (error) {
		throw new Error(
			`verifySignature failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Generate a key from a password using PBKDF2
 */
export function deriveKeyFromPassword(
	password: string,
	salt: Uint8Array,
	iterations: number = 100000,
): Uint8Array {
	if (!password || password.length === 0) {
		throw new Error("Key derivation failed: password must not be empty");
	}
	if (!salt || salt.length === 0) {
		throw new Error("Key derivation failed: salt must contain at least one byte");
	}
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
export function encryptE2EMessage(
	plaintext: string,
	recipientPublicKey: Uint8Array,
	senderPrivateKey: Uint8Array,
): EncryptedMessage {
	try {
		// Generate ephemeral key pair for this message
		const ephemeralKeyPair = generateEphemeralKeyPair();

		const recipientKey = ensureX25519PublicKeyDer(
			recipientPublicKey,
			"encryptE2EMessage recipient",
		);
		const ephemeralPrivateKeyDer = ensureX25519PrivateKeyDer(
			ephemeralKeyPair.privateKey,
			"encryptE2EMessage ephemeral private",
		);

		// Derive shared secret using ECDH
		const sharedSecret = deriveSharedSecret(
			recipientKey,
			ephemeralPrivateKeyDer,
		);

		// Create plaintext bytes
		const encoder = new TextEncoder();
		const plaintextBytes = encoder.encode(plaintext);

		// Derive AES-GCM key from shared secret only (to match decryption)
		const hash = crypto.createHash("sha256");
		hash.update(sharedSecret);
		const messageKey = hash.digest().slice(0, 32);

		const encryptedResult = encryptMessage(plaintextBytes, messageKey);

		// Sign the message with sender's private key for authenticity
		const signature = signMessage(plaintextBytes, senderPrivateKey);

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
export function decryptE2EMessage(
	encryptedMessage: EncryptedMessage,
	senderPublicKey: Uint8Array | undefined | null,
	recipientPrivateKey: Uint8Array,
): string {
	try {
		if (!encryptedMessage.ephemeralPublicKey) {
			throw new Error("Missing ephemeral public key in encrypted message");
		}

		const ephemeralPublicKey = ensureX25519PublicKeyDer(
			encryptedMessage.ephemeralPublicKey,
			"decryptE2EMessage ephemeral public",
		);
		const recipientPrivateKeyDer = ensureX25519PrivateKeyDer(
			recipientPrivateKey,
			"decryptE2EMessage recipient private",
		);

		// Derive shared secret using ECDH with ephemeral public key from message
		const sharedSecret = deriveSharedSecret(
			ephemeralPublicKey,
			recipientPrivateKeyDer,
		);

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
			plaintextBytes = decryptMessage(
				encryptedMessage.ciphertext,
				messageKey,
				encryptedMessage.nonce,
			);
		}

		// Verify signature if present and we have a sender key
		if (senderPublicKey && encryptedMessage.signature) {
			const isValid = verifySignature(
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
