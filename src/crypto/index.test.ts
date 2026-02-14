import { expect, test } from "bun:test";
import {
	decryptE2EMessage,
	decryptMessage,
	deriveKeyFromPassword,
	deriveMessageKey,
	deriveSharedSecret,
	encryptE2EMessage,
	encryptMessage,
	generateEphemeralKeyPair,
	generateIdentityKeyPair,
	signMessage,
	verifySignature,
} from "./index";

// Test basic function exports and structure
test("crypto module exports all expected functions", () => {
	expect(typeof generateIdentityKeyPair).toBe("function");
	expect(typeof generateEphemeralKeyPair).toBe("function");
	expect(typeof deriveSharedSecret).toBe("function");
	expect(typeof encryptMessage).toBe("function");
	expect(typeof decryptMessage).toBe("function");
	expect(typeof signMessage).toBe("function");
	expect(typeof verifySignature).toBe("function");
	expect(typeof deriveKeyFromPassword).toBe("function");
	expect(typeof encryptE2EMessage).toBe("function");
	expect(typeof decryptE2EMessage).toBe("function");
	expect(typeof deriveMessageKey).toBe("function");
});

test("generateIdentityKeyPair creates valid key pairs", async () => {
	const keyPair = await generateIdentityKeyPair();

	expect(keyPair).toBeDefined();
	expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
	expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
	expect(keyPair.publicKey.length).toBeGreaterThan(0);
	expect(keyPair.privateKey.length).toBeGreaterThan(0);
});

test("generateEphemeralKeyPair creates valid key pairs", async () => {
	const keyPair = await generateEphemeralKeyPair();

	expect(keyPair).toBeDefined();
	expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
	expect(keyPair.privateKey).toBeInstanceOf(Uint8Array);
	expect(keyPair.publicKey.length).toBeGreaterThan(0);
	expect(keyPair.privateKey.length).toBeGreaterThan(0);
});

test("deriveSharedSecret creates shared secrets", async () => {
	const keyPairA = await generateEphemeralKeyPair();
	const keyPairB = await generateEphemeralKeyPair();
	const sharedSecretA = await deriveSharedSecret(
		keyPairB.publicKey,
		keyPairA.privateKey,
	);
	const sharedSecretB = await deriveSharedSecret(
		keyPairA.publicKey,
		keyPairB.privateKey,
	);
	expect(sharedSecretA).toBeInstanceOf(Uint8Array);
	expect(sharedSecretB).toBeInstanceOf(Uint8Array);
	expect(sharedSecretA.length).toBeGreaterThan(0);
	expect(sharedSecretB.length).toBeGreaterThan(0);
	expect(sharedSecretA).toEqual(sharedSecretB);
});

test("encryptMessage and decryptMessage work together", async () => {
	const plaintext = new TextEncoder().encode("Hello, World!");
	const key = new Uint8Array(32).fill(0x42); // 256-bit key
	const nonce = new Uint8Array(12).fill(0x01); // 96-bit nonce

	const encrypted = await encryptMessage(plaintext, key, nonce);

	expect(encrypted).toBeDefined();
	expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
	expect(encrypted.nonce).toBeInstanceOf(Uint8Array);

	const decrypted = await decryptMessage(
		encrypted.ciphertext,
		key,
		encrypted.nonce,
	);

	expect(decrypted).toEqual(plaintext);
});

test("signMessage and verifySignature work together", async () => {
	const message = new TextEncoder().encode("Hello, World!");
	const keyPair = await generateIdentityKeyPair();

	const signature = await signMessage(message, keyPair.privateKey);

	expect(signature).toBeInstanceOf(Uint8Array);

	const isValid = await verifySignature(message, signature, keyPair.publicKey);

	expect(isValid).toBe(true);
});

test("deriveKeyFromPassword creates deterministic keys", async () => {
	const password = "my-secret-password";
	const salt = new Uint8Array(16).fill(0x42);

	const key1 = await deriveKeyFromPassword(password, salt);
	const key2 = await deriveKeyFromPassword(password, salt);

	expect(key1).toBeInstanceOf(Uint8Array);
	expect(key2).toBeInstanceOf(Uint8Array);
	expect(key1).toEqual(key2); // Should be deterministic
});

test("encryptE2EMessage and decryptE2EMessage work together", async () => {
	const plaintext = "Hello, End-to-End Encryption!";
	// Recipient X25519 key for ECDH and sender Ed25519 key for signing
	const recipientEphemeralKeyPair = await generateEphemeralKeyPair();
	const senderIdentityKeyPair = await generateIdentityKeyPair();

	const encrypted = await encryptE2EMessage(
		plaintext,
		recipientEphemeralKeyPair.publicKey,
		senderIdentityKeyPair.privateKey,
	);

	expect(encrypted).toBeDefined();
	expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
	expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
	expect(encrypted.ephemeralPublicKey).toBeInstanceOf(Uint8Array);
	expect(encrypted.signature).toBeInstanceOf(Uint8Array);

	const decrypted = await decryptE2EMessage(
		encrypted,
		senderIdentityKeyPair.publicKey,
		recipientEphemeralKeyPair.privateKey,
	);

	expect(decrypted).toBe(plaintext);
});

test("encryptE2EMessage handles edge cases", async () => {
	const plaintext = "";
	// Recipient X25519 key for ECDH and sender Ed25519 key for signing
	const recipientEphemeralKeyPair = await generateEphemeralKeyPair();
	const senderIdentityKeyPair = await generateIdentityKeyPair();

	const encrypted = await encryptE2EMessage(
		plaintext,
		recipientEphemeralKeyPair.publicKey,
		senderIdentityKeyPair.privateKey,
	);

	expect(encrypted).toBeDefined();

	const decrypted = await decryptE2EMessage(
		encrypted,
		senderIdentityKeyPair.publicKey,
		recipientEphemeralKeyPair.privateKey,
	);

	expect(decrypted).toBe(plaintext);
});

test("deriveMessageKey creates deterministic keys from message and peer identity", () => {
	const message = "Hello, World!";
	const peerIdentity = new Uint8Array([1, 2, 3, 4, 5]);

	const key1 = deriveMessageKey(message, peerIdentity);
	const key2 = deriveMessageKey(message, peerIdentity);

	expect(key1).toBeInstanceOf(Uint8Array);
	expect(key2).toBeInstanceOf(Uint8Array);
	expect(key1).toEqual(key2); // Should be deterministic
});
