import { describe, expect, test } from "bun:test";
import type { Libp2p, PeerId } from "@libp2p/interface";
import { MessageCodec, MessageFramer } from "../../../src/core/protocols";
import type { YapYapMessage } from "../../../src/message/message";
import { NetworkModule } from "../../../src/network/NetworkModule";

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
		expect(network.routingTable).toBeDefined();
		expect(network.nodeState).toBeDefined();
		expect(network.isRunning).toBe(false);
		expect(network.peerId).toBeUndefined();
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

		expect(bootstrapped).toBe(true);
		expect(network.bootstrapAddrs).toHaveLength(1);
		expect(dialed).toEqual(["/ip4/127.0.0.1/tcp/4001"]);
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
		expect(decodedFrames.frames).toHaveLength(1);

		const message = MessageCodec.decode<YapYapMessage>(decodedFrames.frames[0]);
		expect(message.from).toBe("peer-self");
		expect(message.to).toBe("peer-remote");
		expect(message.payload).toEqual({ type: "pong" });
	});

	test("stop handles no-libp2p and active-libp2p cases", async () => {
		const network = new TestNetworkModule();
		await network.stop();
		expect(network.isRunning).toBe(false);

		let stopped = false;
		const libp2pMock = {
			stop: async () => {
				stopped = true;
			},
		} as unknown as Libp2p;
		network.libp2p = libp2pMock;
		network.setTimer(setInterval(() => {}, 1000));

		await network.stop();
		expect(stopped).toBe(true);
		expect(network.isRunning).toBe(false);
	});
});
