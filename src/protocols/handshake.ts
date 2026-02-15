/**
 * Handshake protocol implementation for YapYap node communication
 * Secure Noise XX/IK-style handshake with proper HKDF key derivation
 */

import { hkdfSync, randomUUID } from "node:crypto";
import type { PeerId } from "@libp2p/interface";
import {
	deriveSharedSecret,
	generateEphemeralKeyPair,
	signMessage,
	verifySignature,
} from "../crypto/index.js";
import type { YapYapMessage } from "../message/message.js";
import { handleProtocolError } from "./error-handler.js";

/* ======================================================
   Helpers
====================================================== */

function uint8ArrayToHex(uint8Array: Uint8Array): string {
	return Buffer.from(uint8Array).toString("hex");
}

function hexToUint8Array(hex: string): Uint8Array {
	return Buffer.from(hex, "hex");
}

/* ======================================================
   Types
====================================================== */

export interface NoiseXXMessage {
	type: "initiator" | "responder";
	ephemeralPublicKey: Uint8Array;
	staticPublicKey?: Uint8Array;
	signature?: Uint8Array;
}

export interface HandshakeMessage {
	type: "hello" | "ack";
	version: string;
	capabilities: string[];
	publicKey?: Uint8Array;
	signature?: string;
	timestamp: number;
	e2eCapabilities?: {
		supported: boolean;
		keyExchange: string;
		encryption: string;
		signature: string;
	};
}

export interface HelloMessage extends HandshakeMessage {
	type: "hello";
	publicKey: Uint8Array;
	signature: string;
}

export interface AckMessage extends HandshakeMessage {
	type: "ack";
	publicKey: Uint8Array;
	signature: string;
}

export interface NoiseSessionInfo {
	sessionId: string;
	peerId: string;

	staticPublicKey: Uint8Array;

	ephemeralPrivateKey?: Uint8Array;
	ephemeralPublicKey?: Uint8Array;

	sharedSecret?: Uint8Array;

	sessionKeys?: {
		encryptionKey: Uint8Array;
		decryptionKey: Uint8Array;
	};

	handshakeComplete: boolean;
}

const SUPPORTED_HANDSHAKE_VERSION = "1.0.0";

/* ======================================================
   Handshake Message Generation
====================================================== */

export async function generateHandshakeMessage(
	messageType: "hello" | "ack",
	capabilities: string[],
	privateKey: Uint8Array,
	publicKey: Uint8Array,
): Promise<HandshakeMessage> {
	const timestamp = Date.now();
	const version = SUPPORTED_HANDSHAKE_VERSION;

	const basePayload = {
		type: messageType,
		version,
		capabilities,
		timestamp,
		publicKey: uint8ArrayToHex(publicKey),
		e2eCapabilities: {
			supported: true,
			keyExchange: "X25519",
			encryption: "AES-GCM",
			signature: "Ed25519",
		},
	};

	const messageBytes = new TextEncoder().encode(JSON.stringify(basePayload));
	const signatureBytes = await signMessage(messageBytes, privateKey);

	return {
		...basePayload,
		publicKey,
		signature: uint8ArrayToHex(signatureBytes),
	};
}

/* ======================================================
   Noise XX Message Creation
====================================================== */

export async function generateNoiseXXInitiatorMessage(
	staticPublicKey: Uint8Array,
	signaturePrivateKey?: Uint8Array,
): Promise<{ message: NoiseXXMessage; ephemeralPrivateKey: Uint8Array }> {
	const ephemeralKeyPair = await generateEphemeralKeyPair();

	const message: NoiseXXMessage = {
		type: "initiator",
		ephemeralPublicKey: ephemeralKeyPair.publicKey,
		staticPublicKey,
	};

	if (signaturePrivateKey) {
		const payload = JSON.stringify({
			type: "initiator",
			ephemeralPublicKey: uint8ArrayToHex(ephemeralKeyPair.publicKey),
			staticPublicKey: uint8ArrayToHex(staticPublicKey),
		});

		const signature = await signMessage(
			new TextEncoder().encode(payload),
			signaturePrivateKey,
		);

		message.signature = signature;
	}

	return {
		message,
		ephemeralPrivateKey: ephemeralKeyPair.privateKey,
	};
}

export async function generateNoiseXXResponderMessage(
	staticPublicKey: Uint8Array,
	signaturePrivateKey?: Uint8Array,
): Promise<{ message: NoiseXXMessage; ephemeralPrivateKey: Uint8Array }> {
	const ephemeralKeyPair = await generateEphemeralKeyPair();

	const message: NoiseXXMessage = {
		type: "responder",
		ephemeralPublicKey: ephemeralKeyPair.publicKey,
		staticPublicKey,
	};

	if (signaturePrivateKey) {
		const payload = JSON.stringify({
			type: "responder",
			ephemeralPublicKey: uint8ArrayToHex(ephemeralKeyPair.publicKey),
			staticPublicKey: uint8ArrayToHex(staticPublicKey),
		});

		const signature = await signMessage(
			new TextEncoder().encode(payload),
			signaturePrivateKey,
		);

		message.signature = signature;
	}

	return {
		message,
		ephemeralPrivateKey: ephemeralKeyPair.privateKey,
	};
}

/* ======================================================
   HKDF Key Derivation (SECURE)
====================================================== */

export async function deriveSessionKeys(
	sharedSecret: Uint8Array,
): Promise<{ encryptionKey: Uint8Array; decryptionKey: Uint8Array }> {
	const encryptionKey = hkdfSync(
		"sha256",
		sharedSecret,
		Buffer.from("yapyap-noise-salt"),
		Buffer.from("encryption"),
		32,
	);

	const decryptionKey = hkdfSync(
		"sha256",
		sharedSecret,
		Buffer.from("yapyap-noise-salt"),
		Buffer.from("decryption"),
		32,
	);

	return {
		encryptionKey: new Uint8Array(encryptionKey),
		decryptionKey: new Uint8Array(decryptionKey),
	};
}

/* ======================================================
   Noise XX Handshake Processing
====================================================== */

export async function processNoiseXXHandshake(
	localEphemeralPrivateKey: Uint8Array,
	localPublicKey: Uint8Array,
	remoteMessage: NoiseXXMessage,
	sessionInfo?: NoiseSessionInfo,
): Promise<NoiseSessionInfo> {
	if (!sessionInfo) {
		sessionInfo = {
			sessionId: `noise_${randomUUID()}`,
			peerId: "",
			staticPublicKey: localPublicKey,
			handshakeComplete: false,
		};
	}

	const sharedSecret = await deriveSharedSecret(
		remoteMessage.ephemeralPublicKey,
		localEphemeralPrivateKey,
	);

	sessionInfo.sharedSecret = sharedSecret;
	sessionInfo.ephemeralPublicKey = remoteMessage.ephemeralPublicKey;

	const keys = await deriveSessionKeys(sharedSecret);
	sessionInfo.sessionKeys = keys;

	sessionInfo.handshakeComplete = true;

	return sessionInfo;
}

/* ======================================================
   Handshake Verification
====================================================== */

export async function verifyHandshakeMessage(
	message: HandshakeMessage,
): Promise<boolean> {
	if (!isSupportedHandshakeVersion(message.version)) {
		return false;
	}
	if (!message.signature || !message.publicKey) return false;

	const payload = {
		type: message.type,
		version: message.version,
		capabilities: message.capabilities,
		timestamp: message.timestamp,
		publicKey: uint8ArrayToHex(message.publicKey),
		e2eCapabilities: message.e2eCapabilities,
	};

	const messageBytes = new TextEncoder().encode(JSON.stringify(payload));

	return verifySignature(
		messageBytes,
		hexToUint8Array(message.signature),
		message.publicKey,
	);
}

export function isSupportedHandshakeVersion(version: string): boolean {
	return version === SUPPORTED_HANDSHAKE_VERSION;
}

/* ======================================================
   Handshake Protocol Handling
====================================================== */

export async function handleHandshakeMessage(
	message: HandshakeMessage,
	remotePeerId: PeerId,
	localPrivateKey: Uint8Array,
	localPublicKey: Uint8Array,
): Promise<YapYapMessage | null> {
	return handleProtocolError("handshake", async () => {
		if (!message.type || !message.version || !message.timestamp) {
			throw new Error("Malformed handshake message");
		}

		const valid = await verifyHandshakeMessage(message);
		if (!valid) {
			if (!isSupportedHandshakeVersion(message.version)) {
				throw new Error("Unsupported handshake protocol version");
			}
			throw new Error("Invalid handshake signature");
		}

		if (Math.abs(Date.now() - message.timestamp) > 2 * 60 * 1000) {
			throw new Error("Handshake timestamp outside allowed window");
		}

		if (message.type === "hello") {
			const ack = await generateHandshakeMessage(
				"ack",
				message.capabilities,
				localPrivateKey,
				localPublicKey,
			);

			return {
				id: `handshake_ack_${randomUUID()}`,
				type: "data",
				from: localPublicKey.toString(),
				to: remotePeerId.toString(),
				payload: ack,
				timestamp: Date.now(),
			};
		}

		return null;
	});
}
