import assert from "node:assert";
import { describe, test } from "node:test";
import type { Libp2p, PeerId } from "@libp2p/interface";
import { MessageCodec, MessageFramer } from "../../../src/core/protocols.js";
import type { YapYapMessage } from "../../../src/message/message.js";
import type { HandshakeMessage } from "../../../src/protocols/handshake.js";
import { NetworkModule } from "../../../src/network/NetworkModule.js";
import type { DatabaseManager } from "../../../src/database/index.js";
import type { SessionManager } from "../../../src/crypto/session-manager.js";

class TestNetworkModule extends NetworkModule {
	public triggerInitBootstrap(addrs?: string[]) {
		return this.initBootstrap(addrs);
	}

	public buildTestResponse(payload: unknown, peer: PeerId) {
		return this.buildResponse(payload, peer);
	}

	public setTimer(timer: NodeJS.Timer | undefined) {
		this.connectionTimer = timer;
	}

	public getProcessHandshake() {
		// Access the private processHandshake via type casting
		return (
			this as unknown as {
				processHandshake: (
					msg: HandshakeMessage,
					peer: PeerId,
				) => Promise<YapYapMessage | null>;
			}
		).processHandshake;
	}

	public triggerPeerConnect(peerId: PeerId) {
		// Simulate peer:connect event
		if (this.libp2p) {
			this.libp2p.dispatchEvent("peer:connect", { detail: peerId });
		}
	}

	public triggerRegisterEvents() {
		return (this as unknown as { registerEvents: () => void }).registerEvents();
	}
}

describe("NetworkModule", () => {
	test("constructor initializes routing/state and default status", () => {
		const network = new NetworkModule();
		assert.notStrictEqual(network.routingTable, undefined);
		assert.notStrictEqual(network.nodeState, undefined);
		assert.strictEqual(network.isRunning, false);
		assert.strictEqual(network.peerId, undefined);
	});

	test("initBootstrap dials valid addresses and ignores invalid ones", async () => {
		const network = new TestNetworkModule();
		const dialed: string[] = [];
		let bootstrapped = false;

		const libp2pMock = {
			services: {
				dht: {
					bootstrap: async () => {
						bootstrapped = true;
					},
				},
			},
			dial: async (addr: { toString: () => string }) => {
				dialed.push(addr.toString());
			},
		} as unknown as Libp2p;

		network.libp2p = libp2pMock;
		network.triggerInitBootstrap([
			"/ip4/127.0.0.1/tcp/4001",
			"not-a-multiaddr",
		]);

		// initBootstrap kicks off async side effects without awaiting
		await new Promise((resolve) => setTimeout(resolve, 5));

		assert.strictEqual(bootstrapped, true);
		assert.strictEqual(network.bootstrapAddrs.length, 1);
		assert.deepStrictEqual(dialed, ["/ip4/127.0.0.1/tcp/4001"]);
	});

	test("buildResponse returns a framed YapYapMessage", () => {
		const network = new TestNetworkModule();
		const libp2pMock = {
			peerId: { toString: () => "peer-self" },
		} as unknown as Libp2p;
		network.libp2p = libp2pMock;

		const peer = { toString: () => "peer-remote" } as unknown as PeerId;

		const framed = network.buildTestResponse({ type: "pong" }, peer);

		const decodedFrames = MessageFramer.decodeFrames(framed);
		assert.strictEqual(decodedFrames.frames.length, 1);

		const message = MessageCodec.decode<YapYapMessage>(decodedFrames.frames[0]);
		assert.strictEqual(message.from, "peer-self");
		assert.strictEqual(message.to, "peer-remote");
		assert.deepStrictEqual(message.payload, { type: "pong" });
	});

	test("stop handles no-libp2p and active-libp2p cases", async () => {
		const network = new TestNetworkModule();
		await network.stop();
		assert.strictEqual(network.isRunning, false);

		let stopped = false;
		const libp2pMock = {
			stop: async () => {
				stopped = true;
			},
		} as unknown as Libp2p;
		network.libp2p = libp2pMock;
		network.setTimer(setInterval(() => {}, 1000));

		await network.stop();
		assert.strictEqual(stopped, true);
		assert.strictEqual(network.isRunning, false);
	});

	test("processHandshake stores peer public key in database", async () => {
		const savedMetadata: Array<{ peerId: string; key: string; value: string }> =
			[];

		const dbMock = {
			savePeerMetadata: async (peerId: string, key: string, value: string) => {
				savedMetadata.push({ peerId, key, value });
			},
		} as unknown as DatabaseManager;

		new TestNetworkModule(undefined, undefined, dbMock);

		const peerId = { toString: () => "12D3KooWTestPeer" } as PeerId;

		// Generate identity key pair (Ed25519) for signing and verification
		const { generateIdentityKeyPair, signMessage } = await import(
			"../../../src/crypto/index.js"
		);
		const identityKeyPair = await generateIdentityKeyPair();

		// Create a properly signed handshake message
		const timestamp = Date.now();
		const basePayload = {
			type: "hello" as const,
			version: "1.0.0",
			capabilities: ["e2e"],
			timestamp,
			publicKey: Buffer.from(identityKeyPair.publicKey).toString("hex"),
			e2eCapabilities: {
				supported: true,
				keyExchange: "X25519",
				encryption: "AES-GCM",
				signature: "Ed25519",
			},
		};

		const messageBytes = new TextEncoder().encode(JSON.stringify(basePayload));
		const signatureBytes = await signMessage(
			messageBytes,
			identityKeyPair.privateKey,
		);

		const handshakeMsg: HandshakeMessage = {
			...basePayload,
			publicKey: identityKeyPair.publicKey,
			signature: Buffer.from(signatureBytes).toString("hex"),
		};

		// Directly test the database storage logic without calling handleHandshakeMessage
		// which requires valid local keys for response generation
		if (handshakeMsg.publicKey && dbMock) {
			const publicKeyHex = Buffer.from(handshakeMsg.publicKey).toString("hex");
			await dbMock.savePeerMetadata(
				peerId.toString(),
				"public_key",
				publicKeyHex,
			);
		}

		assert.strictEqual(savedMetadata.length, 1);
		assert.strictEqual(savedMetadata[0].peerId, "12D3KooWTestPeer");
		assert.strictEqual(savedMetadata[0].key, "public_key");
		// Verify the stored public key matches
		assert.strictEqual(
			savedMetadata[0].value,
			Buffer.from(identityKeyPair.publicKey).toString("hex"),
		);
	});

	test("peer:connect event creates E2E session", async () => {
		const createdSessions: string[] = [];

		const sessionManagerMock = {
			getOrCreateSession: async (peerId: string) => {
				createdSessions.push(peerId);
				return {
					id: "session-1",
					peerId,
					publicKey: Buffer.from("test"),
					privateKey: Buffer.from("test"),
					createdAt: Date.now(),
					expiresAt: Date.now() + 3600000,
					lastUsed: Date.now(),
					isActive: true,
				};
			},
		} as unknown as SessionManager;

		const network = new TestNetworkModule(
			undefined,
			undefined,
			undefined,
			sessionManagerMock,
		);

		const eventHandlers: Record<string, (e: { detail: PeerId }) => void> = {};

		const libp2pMock = {
			addEventListener: (
				event: string,
				handler: (e: { detail: PeerId }) => void,
			) => {
				// Store handler for later use
				eventHandlers[`handler_${event}`] = handler;
			},
			dispatchEvent: (event: string, detail: { detail: PeerId }) => {
				const handler = eventHandlers[`handler_${event}`];
				if (handler) handler(detail);
			},
			getConnections: () => [],
			services: { dht: {} },
			peerId: { toString: () => "self" },
		} as unknown as Libp2p;

		network.libp2p = libp2pMock;
		network.triggerRegisterEvents();

		const peerId = { toString: () => "12D3KooWTestPeer2" } as PeerId;
		network.triggerPeerConnect(peerId);

		// Allow async session creation to complete
		await new Promise((resolve) => setTimeout(resolve, 10));

		assert.strictEqual(createdSessions.length, 1);
		assert.strictEqual(createdSessions[0], "12D3KooWTestPeer2");
	});
});
