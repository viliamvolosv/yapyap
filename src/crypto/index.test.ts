import assert from "node:assert";
import { test } from "node:test";
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
} from "./index.js";

// Test basic function exports and structure
test("crypto module exports all expected functions", () => {
	assert.strictEqual(typeof generateIdentityKeyPair, "function");
	assert.strictEqual(typeof generateEphemeralKeyPair, "function");
	assert.strictEqual(typeof deriveSharedSecret, "function");
	assert.strictEqual(typeof encryptMessage, "function");
	assert.strictEqual(typeof decryptMessage, "function");
	assert.strictEqual(typeof signMessage, "function");
	assert.strictEqual(typeof verifySignature, "function");
	assert.strictEqual(typeof deriveKeyFromPassword, "function");
	assert.strictEqual(typeof encryptE2EMessage, "function");
	assert.strictEqual(typeof decryptE2EMessage, "function");
	assert.strictEqual(typeof deriveMessageKey, "function");
});

test("generateIdentityKeyPair creates valid key pairs", async () => {
	const keyPair = await generateIdentityKeyPair();

	assert.notStrictEqual(keyPair, undefined);
	assert.ok(keyPair.publicKey instanceof Uint8Array);
	assert.ok(keyPair.privateKey instanceof Uint8Array);
	assert.ok(keyPair.publicKey.length > 0);
	assert.ok(keyPair.privateKey.length > 0);
});

test("generateEphemeralKeyPair creates valid key pairs", async () => {
	const keyPair = await generateEphemeralKeyPair();

	assert.notStrictEqual(keyPair, undefined);
	assert.ok(keyPair.publicKey instanceof Uint8Array);
	assert.ok(keyPair.privateKey instanceof Uint8Array);
	assert.ok(keyPair.publicKey.length > 0);
	assert.ok(keyPair.privateKey.length > 0);
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
	assert.ok(sharedSecretA instanceof Uint8Array);
	assert.ok(sharedSecretB instanceof Uint8Array);
	assert.ok(sharedSecretA.length > 0);
	assert.ok(sharedSecretB.length > 0);
	assert.deepStrictEqual(sharedSecretA, sharedSecretB);
});

test("encryptMessage and decryptMessage work together", async () => {
	const plaintext = new TextEncoder().encode("Hello, World!");
	const key = new Uint8Array(32).fill(0x42); // 256-bit key
	const nonce = new Uint8Array(12).fill(0x01); // 96-bit nonce

	const encrypted = await encryptMessage(plaintext, key, nonce);

	assert.notStrictEqual(encrypted, undefined);
	assert.ok(encrypted.ciphertext instanceof Uint8Array);
	assert.ok(encrypted.nonce instanceof Uint8Array);

	const decrypted = await decryptMessage(
		encrypted.ciphertext,
		key,
		encrypted.nonce,
	);

	assert.deepStrictEqual(decrypted, plaintext);
});

test("signMessage and verifySignature work together", async () => {
	const message = new TextEncoder().encode("Hello, World!");
	const keyPair = await generateIdentityKeyPair();

	const signature = await signMessage(message, keyPair.privateKey);

	assert.ok(signature instanceof Uint8Array);

	const isValid = await verifySignature(message, signature, keyPair.publicKey);

	assert.strictEqual(isValid, true);
});

test("deriveKeyFromPassword creates deterministic keys", async () => {
	const password = "my-secret-password";
	const salt = new Uint8Array(16).fill(0x42);

	const key1 = await deriveKeyFromPassword(password, salt);
	const key2 = await deriveKeyFromPassword(password, salt);

	assert.ok(key1 instanceof Uint8Array);
	assert.ok(key2 instanceof Uint8Array);
	assert.deepStrictEqual(key1, key2); // Should be deterministic
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

	assert.notStrictEqual(encrypted, undefined);
	assert.ok(encrypted.ciphertext instanceof Uint8Array);
	assert.ok(encrypted.nonce instanceof Uint8Array);
	assert.ok(encrypted.ephemeralPublicKey instanceof Uint8Array);
	assert.ok(encrypted.signature instanceof Uint8Array);

	const decrypted = await decryptE2EMessage(
		encrypted,
		senderIdentityKeyPair.publicKey,
		recipientEphemeralKeyPair.privateKey,
	);

	assert.strictEqual(decrypted, plaintext);
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

	assert.notStrictEqual(encrypted, undefined);

	const decrypted = await decryptE2EMessage(
		encrypted,
		senderIdentityKeyPair.publicKey,
		recipientEphemeralKeyPair.privateKey,
	);

	assert.strictEqual(decrypted, plaintext);
});

test("deriveMessageKey creates deterministic keys from message and peer identity", () => {
	const message = "Hello, World!";
	const peerIdentity = new Uint8Array([1, 2, 3, 4, 5]);

	const key1 = deriveMessageKey(message, peerIdentity);
	const key2 = deriveMessageKey(message, peerIdentity);

	assert.ok(key1 instanceof Uint8Array);
	assert.ok(key2 instanceof Uint8Array);
	assert.deepStrictEqual(key1, key2); // Should be deterministic
});
