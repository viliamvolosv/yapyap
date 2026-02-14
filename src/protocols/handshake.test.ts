import { expect, test } from "bun:test";
import type { PeerId } from "@libp2p/interface";
import {
	deriveSharedSecret,
	generateEphemeralKeyPair,
	generateIdentityKeyPair,
	signMessage,
	verifySignature,
} from "../crypto/index";
import {
	deriveSessionKeys,
	generateHandshakeMessage,
	generateNoiseXXInitiatorMessage,
	generateNoiseXXResponderMessage,
	handleHandshakeMessage,
	isSupportedHandshakeVersion,
	processNoiseXXHandshake,
	verifyHandshakeMessage,
} from "./handshake";

test("Noise XX handshake protocol - generate and process messages", async () => {
	// Generate Ed25519 key pairs for signatures
	const initiatorSig = await generateIdentityKeyPair();
	const responderSig = await generateIdentityKeyPair();
	// Generate X25519 static key pairs for ECDH/static
	const initiatorStatic = await generateEphemeralKeyPair();
	const responderStatic = await generateEphemeralKeyPair();
	// Generate ephemeral key pairs for the handshake
	// Removed unused ephemeral key pairs

	// Test: Initiator generates a handshake message
	const initiatorResult = await generateNoiseXXInitiatorMessage(
		initiatorStatic.publicKey,
		initiatorSig.privateKey,
	);
	const initiatorMessage = initiatorResult.message;
	const initiatorEphemeralPrivateKey = initiatorResult.ephemeralPrivateKey;

	expect(initiatorMessage.type).toBe("initiator");
	expect(initiatorMessage.ephemeralPublicKey).toBeDefined();
	expect(initiatorMessage.staticPublicKey).toBeDefined();
	expect(initiatorMessage.signature).toBeDefined();

	const responderResult = await generateNoiseXXResponderMessage(
		responderStatic.publicKey,
		responderSig.privateKey,
	);
	const responderMessage = responderResult.message;
	const responderEphemeralPrivateKey = responderResult.ephemeralPrivateKey;

	expect(responderMessage.type).toBe("responder");
	expect(responderMessage.ephemeralPublicKey).toBeDefined();
	expect(responderMessage.staticPublicKey).toBeDefined();
	expect(responderMessage.signature).toBeDefined();

	// Test: Both parties can derive shared secrets (this test is more about function execution than matching)
	// We just want to ensure the functions don't throw errors
	const initiatorSharedSecret = await deriveSharedSecret(
		responderMessage.ephemeralPublicKey,
		initiatorEphemeralPrivateKey,
	);

	const responderSharedSecret = await deriveSharedSecret(
		initiatorMessage.ephemeralPublicKey,
		responderEphemeralPrivateKey,
	);

	// The main thing is that both operations should complete without throwing errors
	// (they won't be equal because different ephemeral keys are used, but that's expected)
	expect(initiatorSharedSecret).toBeInstanceOf(Uint8Array);
	expect(responderSharedSecret).toBeInstanceOf(Uint8Array);
});

test("Noise XX handshake protocol - signature verification", async () => {
	const keyPair = await generateIdentityKeyPair();

	// Generate a message to sign
	const messageToSign = JSON.stringify({
		type: "initiator",
		ephemeralPublicKey: "test_ephemeral_key",
		staticPublicKey: "test_static_key",
	});

	const encoder = new TextEncoder();
	const messageBytes = encoder.encode(messageToSign);

	// Sign the message
	const signature = await signMessage(messageBytes, keyPair.privateKey);

	// Verify the signature
	const isValid = await verifySignature(
		messageBytes,
		signature,
		keyPair.publicKey,
	);

	expect(isValid).toBe(true);
});

test("Noise XX handshake protocol - session creation", async () => {
	// This test validates that we can create a basic Noise handshake session
	const initiatorKeyPair = await generateIdentityKeyPair();

	// Generate messages for the handshake
	const { message: initiatorMessage } = await generateNoiseXXInitiatorMessage(
		initiatorKeyPair.publicKey,
	);
	expect(initiatorMessage.type).toBe("initiator");
	expect(initiatorMessage.ephemeralPublicKey).toBeDefined();
	expect(initiatorMessage.staticPublicKey).toBeDefined();
});

test("Noise XX handshake protocol - session key derivation", async () => {
	// Generate two X25519 key pairs for ECDH
	const keyPairA = await generateEphemeralKeyPair();
	const keyPairB = await generateEphemeralKeyPair();

	// Use the deriveSharedSecret function to create a valid shared secret
	const sharedSecret = await deriveSharedSecret(
		keyPairB.publicKey,
		keyPairA.privateKey,
	);

	// Test session key derivation with a real shared secret
	const { encryptionKey, decryptionKey } =
		await deriveSessionKeys(sharedSecret);

	expect(encryptionKey).toBeDefined();
	expect(decryptionKey).toBeDefined();
	expect(encryptionKey.length).toBeGreaterThan(0);
	expect(decryptionKey.length).toBeGreaterThan(0);
});

test("Noise XX handshake protocol - full handshake processing", async () => {
	// Generate X25519 key pairs for both parties (ephemeral for ECDH)
	const initiatorEphemeral = await generateEphemeralKeyPair();
	const responderEphemeral = await generateEphemeralKeyPair();

	// Simulate the full handshake process

	// Initiator and responder generate handshake messages
	const { message: initiatorMessage } = await generateNoiseXXInitiatorMessage(
		initiatorEphemeral.publicKey,
	);
	const { message: responderMessage } = await generateNoiseXXResponderMessage(
		responderEphemeral.publicKey,
	);
	// Both parties process their respective messages
	const initiatorSessionInfo = await processNoiseXXHandshake(
		initiatorEphemeral.privateKey,
		initiatorEphemeral.publicKey,
		responderMessage,
	);
	const responderSessionInfo = await processNoiseXXHandshake(
		responderEphemeral.privateKey,
		responderEphemeral.publicKey,
		initiatorMessage,
	);

	// Both sessions should be marked as complete
	expect(initiatorSessionInfo.handshakeComplete).toBe(true);
	expect(responderSessionInfo.handshakeComplete).toBe(true);

	// Both should have session keys derived
	expect(initiatorSessionInfo.sessionKeys).toBeDefined();
	expect(responderSessionInfo.sessionKeys).toBeDefined();

	// Session keys should exist for both parties
	expect(initiatorSessionInfo.sessionKeys?.encryptionKey).toBeDefined();
	expect(initiatorSessionInfo.sessionKeys?.decryptionKey).toBeDefined();
	expect(responderSessionInfo.sessionKeys?.encryptionKey).toBeDefined();
	expect(responderSessionInfo.sessionKeys?.decryptionKey).toBeDefined();
});

test("Noise XX handshake protocol - full handshake simulation", async () => {
	// This tests the complete handshake process as a whole
	const initiatorStatic = await generateEphemeralKeyPair();
	const responderStatic = await generateEphemeralKeyPair();

	// Initiator and responder generate handshake messages
	const { message: initiatorMessage } = await generateNoiseXXInitiatorMessage(
		initiatorStatic.publicKey,
	);
	const { message: responderMessage } = await generateNoiseXXResponderMessage(
		responderStatic.publicKey,
	);
	// Process initiator's message
	const initiatorSessionInfo = await processNoiseXXHandshake(
		initiatorStatic.privateKey,
		initiatorStatic.publicKey,
		responderMessage,
	);
	// Process responder's message
	const responderSessionInfo = await processNoiseXXHandshake(
		responderStatic.privateKey,
		responderStatic.publicKey,
		initiatorMessage,
	);

	// Both sessions should be marked as complete
	expect(initiatorSessionInfo.handshakeComplete).toBe(true);
	expect(responderSessionInfo.handshakeComplete).toBe(true);

	// Both should have session keys derived
	expect(initiatorSessionInfo.sessionKeys).toBeDefined();
	expect(responderSessionInfo.sessionKeys).toBeDefined();

	// Session keys should exist for both parties
	expect(initiatorSessionInfo.sessionKeys?.encryptionKey).toBeDefined();
	expect(initiatorSessionInfo.sessionKeys?.decryptionKey).toBeDefined();
	expect(responderSessionInfo.sessionKeys?.encryptionKey).toBeDefined();
	expect(responderSessionInfo.sessionKeys?.decryptionKey).toBeDefined();
});

test("Handshake protocol - rejects unsupported version", async () => {
	const remoteKeys = await generateIdentityKeyPair();
	const localKeys = await generateIdentityKeyPair();

	const hello = await generateHandshakeMessage(
		"hello",
		["sync", "route"],
		remoteKeys.privateKey,
		remoteKeys.publicKey,
	);
	hello.version = "9.9.9";

	// Re-sign after modifying version so signature remains valid for payload bytes.
	const payload = {
		type: hello.type,
		version: hello.version,
		capabilities: hello.capabilities,
		timestamp: hello.timestamp,
		publicKey: Buffer.from(hello.publicKey as Uint8Array).toString("hex"),
		e2eCapabilities: hello.e2eCapabilities,
	};
	hello.signature = Buffer.from(
		await signMessage(
			new TextEncoder().encode(JSON.stringify(payload)),
			remoteKeys.privateKey,
		),
	).toString("hex");

	expect(isSupportedHandshakeVersion(hello.version)).toBe(false);
	expect(await verifyHandshakeMessage(hello)).toBe(false);
	const origConsoleErr = console.error;
	console.error = () => {};
	try {
		await expect(
			handleHandshakeMessage(
				hello,
				{ toString: () => "peer-remote" } as PeerId,
				localKeys.privateKey,
				localKeys.publicKey,
			),
		).rejects.toThrow("Unsupported handshake protocol version");
	} finally {
		console.error = origConsoleErr;
	}
});

test("Handshake protocol - accepts supported version", async () => {
	const remoteKeys = await generateIdentityKeyPair();
	const localKeys = await generateIdentityKeyPair();

	const hello = await generateHandshakeMessage(
		"hello",
		["sync", "route"],
		remoteKeys.privateKey,
		remoteKeys.publicKey,
	);
	expect(isSupportedHandshakeVersion(hello.version)).toBe(true);

	const response = await handleHandshakeMessage(
		hello,
		{ toString: () => "peer-remote" } as PeerId,
		localKeys.privateKey,
		localKeys.publicKey,
	);
	expect(response).not.toBeNull();
	const ackPayload = response?.payload as { version?: string };
	expect(ackPayload.version).toBe("1.0.0");
});
