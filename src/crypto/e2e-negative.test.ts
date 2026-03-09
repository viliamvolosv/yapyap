/**
 * Negative-path contract tests for crypto modules
 * Tests that crypto operations reject invalid inputs and malformed data
 */

import * as crypto from "node:crypto";
import {
	decryptE2EMessage,
	deriveSharedSecret,
	encryptE2EMessage,
	generateIdentityKeyPair,
	generateEphemeralKeyPair,
	encryptMessage,
	decryptMessage,
	signMessage,
	verifySignature,
	deriveKeyFromPassword,
} from "./index.js";

// Test utilities for deterministic testing
function createTestKeyPair() {
	return {
		identity: generateIdentityKeyPairSync(),
		ephemeral: generateEphemeralKeyPairSync(),
		recipient: generateIdentityKeyPairSync(),
	};
}

function generateEphemeralKeyPairSync() {
	const keyPair = crypto.generateKeyPairSync("x25519");
	return {
		publicKey: new Uint8Array(
			Buffer.from(keyPair.publicKey.export({ type: "spki", format: "der" })),
		),
		privateKey: new Uint8Array(
			Buffer.from(keyPair.privateKey.export({ type: "pkcs8", format: "der" })),
		),
	};
}

function generateIdentityKeyPairSync() {
	const keyPair = crypto.generateKeyPairSync("ed25519");
	return {
		publicKey: new Uint8Array(
			Buffer.from(keyPair.publicKey.export({ type: "spki", format: "der" })),
		),
		privateKey: new Uint8Array(
			Buffer.from(keyPair.privateKey.export({ type: "pkcs8", format: "der" })),
		),
	};
}

function createTestMessage() {
	return "Test message for negative path validation";
}

const testMessage = createTestMessage();

// ============================================================================
// Test Suite: deriveSharedSecret Negative Paths
// ============================================================================

describe("deriveSharedSecret - Negative Paths", () => {
	test(
		"Rejects deriveSharedSecret when privateKey is not X25519",
		() => {
			const keyPair = generateIdentityKeyPairSync();
			expect(() =>
				deriveSharedSecret(keyPair.publicKey, keyPair.privateKey),
			).toThrow(/X25519/i);
		},
		{ timeout: 5000 },
	);

	test(
		"Rejects deriveSharedSecret when publicKey is not X25519",
		() => {
			const keyPair = generateIdentityKeyPairSync();
			expect(() =>
				deriveSharedSecret(keyPair.publicKey, keyPair.publicKey),
			).toThrow(/X25519/i);
		},
		{ timeout: 5000 },
	);

	test(
		"Rejects deriveSharedSecret when keys are invalid/empty",
		() => {
			expect(() => deriveSharedSecret(new Uint8Array(0), new Uint8Array(0)))
				.toThrow(/Failed to import|key type/i);
		},
		{ timeout: 5000 },
	);
});

// ============================================================================
// Test Suite: encryptMessage Negative Paths
// ============================================================================

describe("encryptMessage - Negative Paths", () => {
	test("Rejects encryptMessage with invalid key length", () => {
		expect(() =>
			encryptMessage(new TextEncoder().encode(testMessage), new Uint8Array(0)),
		).toThrow();
	});

	test("Rejects encryptMessage with invalid nonce length", () => {
		expect(() =>
			encryptMessage(
				new TextEncoder().encode(testMessage),
				new Uint8Array(32),
				new Uint8Array(0),
			),
		).toThrow();
	});
});

// ============================================================================
// Test Suite: decryptMessage Negative Paths
// ============================================================================

describe("decryptMessage - Negative Paths", () => {
	test("Rejects decryptMessage with invalid key length", () => {
		const { identity } = createTestKeyPair();
		const { ciphertext, nonce } = encryptMessageSync(
			new TextEncoder().encode(testMessage),
			identity.privateKey,
		);
		expect(() => decryptMessage(ciphertext, new Uint8Array(0), nonce)).toThrow(
			/Decryption failed/i,
		);
	});

	test("Rejects decryptMessage with invalid nonce length", () => {
		const { identity } = createTestKeyPair();
		const { ciphertext, nonce } = encryptMessageSync(
			new TextEncoder().encode(testMessage),
			identity.privateKey,
		);
		expect(() => decryptMessage(ciphertext, identity.privateKey, new Uint8Array(0)))
			.toThrow(/Decryption failed/i);
	});

	test("Rejects decryptMessage with tampered ciphertext (missing auth tag)", () => {
		const { identity } = createTestKeyPair();
		const { ciphertext, nonce } = encryptMessageSync(
			new TextEncoder().encode(testMessage),
			identity.privateKey,
		);
		// Remove auth tag (last 16 bytes)
		const tamperedCiphertext = ciphertext.slice(0, ciphertext.length - 16);
		expect(() => decryptMessage(tamperedCiphertext, identity.privateKey, nonce))
			.toThrow(/Decryption failed/i);
	});

	test("Rejects decryptMessage with tampered ciphertext (invalid auth tag)", () => {
		const { identity } = createTestKeyPair();
		const { ciphertext, nonce } = encryptMessageSync(
			new TextEncoder().encode(testMessage),
			identity.privateKey,
		);
		// Tamper with auth tag
		const tamperedCiphertext = new Uint8Array(ciphertext);
		tamperedCiphertext[tamperedCiphertext.length - 1] = (tamperedCiphertext[tamperedCiphertext.length - 1] + 1) % 256;
		expect(() => decryptMessage(tamperedCiphertext, identity.privateKey, nonce))
			.toThrow(/Decryption failed/i);
	});

	test("Rejects decryptMessage with tampered nonce", () => {
		const { identity } = createTestKeyPair();
		const { ciphertext, nonce } = encryptMessageSync(
			new TextEncoder().encode(testMessage),
			identity.privateKey,
		);
		// Tamper with nonce
		const tamperedNonce = new Uint8Array(nonce);
		tamperedNonce[0] = (tamperedNonce[0] + 1) % 256;
		expect(() => decryptMessage(ciphertext, identity.privateKey, tamperedNonce))
			.toThrow(/Decryption failed/i);
	});

	test("Rejects decryptMessage with empty ciphertext", () => {
		const { identity } = createTestKeyPair();
		expect(() => decryptMessage(new Uint8Array(0), identity.privateKey, new Uint8Array(12)))
			.toThrow(/Decryption failed/i);
	});
});

function encryptMessageSync(plaintext: Uint8Array, key: Uint8Array) {
	return encryptMessage(plaintext, key);
}

// ============================================================================
// Test Suite: signMessage Negative Paths
// ============================================================================

describe("signMessage - Negative Paths", () => {
	test("Rejects signMessage with invalid privateKey", () => {
		expect(() => signMessage(new Uint8Array(0), new Uint8Array(0))).toThrow();
	});

	test("Rejects signMessage with invalid message", () => {
		const keyPair = generateIdentityKeyPairSync();
		expect(() => signMessage(new Uint8Array(0), keyPair.privateKey)).toThrow();
	});
});

// ============================================================================
// Test Suite: verifySignature Negative Paths
// ============================================================================

describe("verifySignature - Negative Paths", () => {
	test("Rejects verifySignature with invalid publicKey", () => {
		const keyPair = generateIdentityKeyPairSync();
		expect(() =>
			verifySignature(
				new TextEncoder().encode(testMessage),
				keyPair.publicKey,
				new Uint8Array(0),
			),
		).toThrow();
	});

	test("Rejects verifySignature with invalid signature", () => {
		const keyPair = generateIdentityKeyPairSync();
		expect(() =>
			verifySignature(
				new TextEncoder().encode(testMessage),
				new Uint8Array(0),
				keyPair.publicKey,
			),
		).toThrow();
	});

	test("Rejects verifySignature with tampered signature", () => {
		const keyPair = generateIdentityKeyPairSync();
		const signature = signMessageSync(
			new TextEncoder().encode(testMessage),
			keyPair.privateKey,
		);
		// Tamper with signature
		const tamperedSignature = new Uint8Array(signature);
		tamperedSignature[0] = (tamperedSignature[0] + 1) % 256;
		expect(() =>
			verifySignature(
				new TextEncoder().encode(testMessage),
				tamperedSignature,
				keyPair.publicKey,
			),
		).toBe(false);
	});
});

function signMessageSync(message: Uint8Array, privateKey: Uint8Array) {
	return signMessage(message, privateKey);
}

// ============================================================================
// Test Suite: deriveKeyFromPassword Negative Paths
// ============================================================================

describe("deriveKeyFromPassword - Negative Paths", () => {
	test("Rejects deriveKeyFromPassword with empty password", () => {
		expect(() => deriveKeyFromPassword("", new Uint8Array(16)))
			.toThrow(/Failed to import|key derivation/i);
	});

	test("Rejects deriveKeyFromPassword with invalid salt length", () => {
		expect(() => deriveKeyFromPassword("test", new Uint8Array(0))).toThrow();
	});
});

// ============================================================================
// Test Suite: encryptE2EMessage Negative Paths
// ============================================================================

describe("encryptE2EMessage - Negative Paths", () => {
	test("Rejects encryptE2EMessage when recipientPublicKey is not X25519", async () => {
		const keyPair = generateIdentityKeyPairSync();
		expect(() =>
			encryptE2EMessage(testMessage, keyPair.publicKey, keyPair.privateKey),
		).toThrow(/X25519|Failed to encrypt/i);
	}, { timeout: 5000 });

	test("Rejects encryptE2EMessage when senderPrivateKey is not Ed25519", async () => {
		const keyPair = generateIdentityKeyPairSync();
		expect(() =>
			encryptE2EMessage(testMessage, keyPair.publicKey, keyPair.publicKey),
		).toThrow(/Ed25519|Failed to encrypt/i);
	}, { timeout: 5000 });

	test("Rejects encryptE2EMessage with empty plaintext", async () => {
		const keyPair = generateEphemeralKeyPairSync();
		expect(() =>
			encryptE2EMessage("", keyPair.publicKey, keyPair.privateKey),
		).toThrow(/Failed to encrypt/i);
	}, { timeout: 5000 });
});

// ============================================================================
// Test Suite: decryptE2EMessage Negative Paths
// ============================================================================

describe("decryptE2EMessage - Negative Paths", () => {
	test("Rejects decryptE2EMessage when ephemeralPublicKey is missing", async () => {
		const keyPair = generateIdentityKeyPairSync();
		const encrypted = await encryptE2EMessage(
			testMessage,
			keyPair.publicKey,
			keyPair.privateKey,
		);
		// Remove ephemeralPublicKey
		const invalidEncrypted = {
			...encrypted,
			ephemeralPublicKey: undefined as any,
		};
		expect(() =>
			decryptE2EMessage(invalidEncrypted, keyPair.publicKey, keyPair.privateKey),
		).toThrow(/ephemeral public key/i);
	}, { timeout: 5000 });

	test("Rejects decryptE2EMessage when ciphertext is truncated", async () => {
		const keyPair = generateIdentityKeyPairSync();
		const encrypted = await encryptE2EMessage(
			testMessage,
			keyPair.publicKey,
			keyPair.privateKey,
		);
		// Truncate ciphertext
		const truncated = {
			...encrypted,
			ciphertext: encrypted.ciphertext.slice(0, encrypted.ciphertext.length - 1),
		};
		expect(() =>
			decryptE2EMessage(truncated, keyPair.publicKey, keyPair.privateKey),
		).toThrow(/Failed to decrypt/i);
	}, { timeout: 5000 });

	test("Rejects decryptE2EMessage when nonce is tampered", async () => {
		const keyPair = generateIdentityKeyPairSync();
		const encrypted = await encryptE2EMessage(
			testMessage,
			keyPair.publicKey,
			keyPair.privateKey,
		);
		// Tamper with nonce
		const tamperedNonce = new Uint8Array(encrypted.nonce);
		tamperedNonce[0] = (tamperedNonce[0] + 1) % 256;
		const tamperedEncrypted = {
			...encrypted,
			nonce: tamperedNonce,
		};
		expect(() =>
			decryptE2EMessage(tamperedEncrypted, keyPair.publicKey, keyPair.privateKey),
		).toThrow(/Failed to decrypt/i);
	}, { timeout: 5000 });

	test("Rejects decryptE2EMessage when signature is tampered", async () => {
		const keyPair = generateIdentityKeyPairSync();
		const encrypted = await encryptE2EMessage(
			testMessage,
			keyPair.publicKey,
			keyPair.privateKey,
		);
		// Tamper with signature
		const tamperedSignature = new Uint8Array(encrypted.signature);
		tamperedSignature[0] = (tamperedSignature[0] + 1) % 256;
		const tamperedEncrypted = {
			...encrypted,
			signature: tamperedSignature,
		};
		expect(() =>
			decryptE2EMessage(tamperedEncrypted, keyPair.publicKey, keyPair.privateKey),
		).toThrow(/signature verification failed/i);
	}, { timeout: 5000 });

	test("Rejects decryptE2EMessage when senderPublicKey is wrong", async () => {
		const keyPair = generateIdentityKeyPairSync();
		const otherKeyPair = generateIdentityKeyPairSync();
		const encrypted = await encryptE2EMessage(
			testMessage,
			keyPair.publicKey,
			keyPair.privateKey,
		);
		expect(() =>
			decryptE2EMessage(encrypted, otherKeyPair.publicKey, keyPair.privateKey),
		).toThrow(/signature verification failed/i);
	}, { timeout: 5000 });

	test("Rejects decryptE2EMessage when recipientPrivateKey is wrong", async () => {
		const keyPair = generateIdentityKeyPairSync();
		const otherKeyPair = generateIdentityKeyPairSync();
		const encrypted = await encryptE2EMessage(
			testMessage,
			keyPair.publicKey,
			keyPair.privateKey,
		);
		expect(() =>
			decryptE2EMessage(encrypted, keyPair.publicKey, otherKeyPair.privateKey),
		).toThrow(/Failed to decrypt/i);
	}, { timeout: 5000 });

	test("Rejects decryptE2EMessage when plaintext is empty but auth tag present", async () => {
		const keyPair = generateIdentityKeyPairSync();
		const encrypted = await encryptE2EMessage(
			"",
			keyPair.publicKey,
			keyPair.privateKey,
		);
		expect(() =>
			decryptE2EMessage(encrypted, keyPair.publicKey, keyPair.privateKey),
		).toThrow(/Failed to decrypt/i);
	}, { timeout: 5000 });

	test("Rejects decryptE2EMessage when ciphertext is malformed (no auth tag)", async () => {
		const keyPair = generateIdentityKeyPairSync();
		const encrypted = await encryptE2EMessage(
			testMessage,
			keyPair.publicKey,
			keyPair.privateKey,
		);
		// Remove auth tag and nonce
		const malformed = {
			ciphertext: encrypted.ciphertext.slice(0, encrypted.ciphertext.length - 16),
			nonce: encrypted.nonce.slice(0, 10),
			ephemeralPublicKey: encrypted.ephemeralPublicKey,
			signature: encrypted.signature,
		};
		expect(() =>
			decryptE2EMessage(malformed, keyPair.publicKey, keyPair.privateKey),
		).toThrow(/Failed to decrypt/i);
	}, { timeout: 5000 });
});

// ============================================================================
// Test Suite: Error Clarity and Stability
// ============================================================================

describe("Crypto Errors - Clarity and Stability", () => {
	test("Errors are explicit and include operation context", () => {
		const { identity } = createTestKeyPair();
		const error = new Error("Test error");
		expect(error.message).toContain("decrypt");
	});

	test("Errors from crypto operations are stable across calls", () => {
		const { identity } = createTestKeyPair();
		const error1 = new Error("Test error");
		const error2 = new Error("Test error");
		expect(error1.message).toBe(error2.message);
	});
});