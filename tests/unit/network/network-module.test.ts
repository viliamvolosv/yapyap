import assert from "node:assert";
import { describe, test } from "node:test";
import type { Libp2p, PeerId } from "@libp2p/interface";
import { MessageCodec, MessageFramer } from "../../../src/core/protocols.js";
import type { YapYapMessage } from "../../../src/message/message.js";
import { NetworkModule } from "../../../src/network/NetworkModule.js";

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
});
