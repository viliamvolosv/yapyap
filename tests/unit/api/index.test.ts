import assert from "node:assert";
import { afterEach, beforeEach, describe, test } from "node:test";
import { ApiModule } from "../../../src/api/index.js";
import type { YapYapNode } from "../../../src/core/node.js";
import {
	encryptE2EMessage,
	generateEphemeralKeyPair,
	generateIdentityKeyPair,
} from "../../../src/crypto/index.js";
import type {
	EncryptedPayload,
	YapYapMessage,
} from "../../../src/message/message.js";

// Generate valid key pairs for tests
const testIdentityKeyPair = await generateIdentityKeyPair();
const testRecipientKeyPair = await generateEphemeralKeyPair();

const VALID_PEER_ID = "12D3KooWE5fP2xCV6W9iM8vfA2HRM6k9K9jS5rvnV5wM6x9KfGqA";
const SELF_PEER_ID = "12D3KooWSELFpeer12345678901234567890123456789012345";

type PendingEntry = {
	message_id: string;
	target_peer_id: string;
	status: "pending" | "processing" | "delivered" | "failed";
	attempts: number;
	created_at: number;
	next_retry_at?: number;
	message_data: string;
};

type ProcessedEntry = {
	message_id: string;
	from_peer_id: string;
	to_peer_id: string;
	message_data: string;
	processed_at: number;
};

class MockDatabase {
	private contacts = new Map<
		string,
		{
			peer_id: string;
			alias: string;
			last_seen: number;
			metadata: string;
			is_trusted: boolean;
		}
	>();
	private queueEntries: PendingEntry[] = [];
	private processedEntries: ProcessedEntry[] = [];

	getAllContacts() {
		return Array.from(this.contacts.values());
	}

	getContact(peerId: string) {
		return this.contacts.get(peerId) ?? null;
	}

	saveContactLww(contact: {
		peer_id: string;
		alias: string;
		last_seen: number;
		metadata: string;
		is_trusted: boolean;
	}) {
		this.contacts.set(contact.peer_id, contact);
	}

	deleteContact(peerId: string) {
		this.contacts.delete(peerId);
	}

	getRecentPendingMessages() {
		return this.queueEntries;
	}

	getRecentProcessedMessages() {
		return this.processedEntries;
	}

	setQueueEntries(entries: PendingEntry[]) {
		this.queueEntries = entries;
	}

	setProcessedEntries(entries: ProcessedEntry[]) {
		this.processedEntries = entries;
	}
}

class MockNode {
	public db = new MockDatabase();
	public failSend = false;
	public sentMessages: YapYapMessage[] = [];
	public bootstrapAddrs: string[] = [];
	public bootstrapDialSuccessPeerIds: string[] = [];
	public bootstrapDialSuccessAddrs: string[] = [];

	getPeerId() {
		return SELF_PEER_ID;
	}

	getLibp2p() {
		return {
			getConnections: () => [
				{
					remotePeer: { toString: () => VALID_PEER_ID },
					direction: "inbound",
				},
			],
		};
	}

	getDatabase() {
		return this.db;
	}

	async getPeerPublicKey(peerId: string): Promise<string | null> {
		if (peerId === VALID_PEER_ID) {
			return Buffer.from(testRecipientKeyPair.publicKey).toString("hex");
		}
		return null;
	}

	getNodeKeyPair() {
		return {
			privateKey: Buffer.from(testIdentityKeyPair.privateKey),
			publicKey: Buffer.from(testIdentityKeyPair.publicKey),
		};
	}

	getBootstrapAddrs(): string[] {
		return this.bootstrapAddrs;
	}

	getBootstrapDialSuccessPeerIds(): string[] {
		return this.bootstrapDialSuccessPeerIds;
	}

	getBootstrapDialSuccessAddrs(): string[] {
		return this.bootstrapDialSuccessAddrs;
	}

	getEncryptionPublicKeyHex(): string {
		return Buffer.from(testRecipientKeyPair.publicKey).toString("hex");
	}

	async encryptMessage(
		payload: unknown,
		recipient: Uint8Array,
	): Promise<EncryptedPayload> {
		const encrypted = await encryptE2EMessage(
			JSON.stringify(payload),
			recipient,
			Buffer.from(testIdentityKeyPair.privateKey),
		);
		return {
			encrypted: true,
			ciphertext: Buffer.isBuffer(encrypted.ciphertext)
				? encrypted.ciphertext.toString("hex")
				: encrypted.ciphertext,
			mac: encrypted.mac,
		};
	}

	messageRouter = {
		send: async (message: YapYapMessage) => {
			if (this.failSend) {
				throw new Error("Connection is not multiplexed");
			}
			this.sentMessages.push(message);
		},
	};
}

class TestApiModule extends ApiModule {
	public async handleTestRequest(request: Request): Promise<Response> {
		return this.handleRequest(request);
	}
}

describe("ApiModule", () => {
	let api: TestApiModule;
	let node: MockNode;
	let previousNodeEnv: string | undefined;

	beforeEach(() => {
		node = new MockNode();
		api = new TestApiModule(node as unknown as YapYapNode);
		previousNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "test";
	});

	afterEach(() => {
		process.env.NODE_ENV = previousNodeEnv;
	});

	async function json(res: Response) {
		return (await res.json()) as Record<string, unknown>;
	}

	test("GET /health returns ok", async () => {
		const res = await api.handleTestRequest(
			new Request("http://localhost/health", { method: "GET" }),
		);
		const body = await json(res);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(body.success, true);
		assert.strictEqual((body.data as { status: string }).status, "ok");
	});

	test("POST /api/messages/send accepts `to` and sends message", async () => {
		const res = await api.handleTestRequest(
			new Request("http://localhost/api/messages/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ to: VALID_PEER_ID, payload: { text: "hi" } }),
			}),
		);

		const body = await json(res);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(body.success, true);
		assert.strictEqual(
			(body.data as { message: string; queued: boolean }).message,
			"Message sent successfully",
		);
		assert.strictEqual(
			(body.data as { message: string; queued: boolean }).queued,
			false,
		);
		assert.strictEqual(node.sentMessages.length, 1);
		assert.strictEqual(node.sentMessages[0].to, VALID_PEER_ID);
	});

	test("POST /api/messages/send rejects invalid peer id", async () => {
		const res = await api.handleTestRequest(
			new Request("http://localhost/api/messages/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ targetId: "invalid-peer-id", payload: {} }),
			}),
		);
		const body = await json(res);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(body.success, false);
		assert.strictEqual(
			(body.error as { message: unknown }).message,
			"Invalid target peerId",
		);
	});

	test("POST /api/messages/send returns 202 when transport send fails", async () => {
		node.failSend = true;
		const res = await api.handleTestRequest(
			new Request("http://localhost/api/messages/send", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ targetId: VALID_PEER_ID, payload: { n: 1 } }),
			}),
		);

		const body = await json(res);
		assert.strictEqual(res.status, 202);
		assert.strictEqual(body.success, true);
		assert.strictEqual(
			(body.data as { message: string; queued: boolean }).message,
			"Message queued for retry",
		);
		assert.strictEqual(
			(body.data as { message: string; queued: boolean }).queued,
			true,
		);
	});

	test("contacts CRUD endpoints persist and return data", async () => {
		const createRes = await api.handleTestRequest(
			new Request("http://localhost/api/database/contacts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					peerId: VALID_PEER_ID,
					alias: "node-2",
					isTrusted: true,
					metadata: { source: "test" },
				}),
			}),
		);
		assert.strictEqual(createRes.status, 200);
		const created = await json(createRes);
		assert.strictEqual(created.success, true);

		const listRes = await api.handleTestRequest(
			new Request("http://localhost/api/database/contacts", { method: "GET" }),
		);
		const listBody = await json(listRes);
		assert.strictEqual(listBody.success, true);
		const contacts = (
			listBody.data as {
				contacts: Array<{ peer_id: string }>;
			}
		).contacts;
		assert.strictEqual(contacts.length, 1);
		assert.strictEqual(contacts[0].peer_id, VALID_PEER_ID);

		const detailsRes = await api.handleTestRequest(
			new Request(`http://localhost/api/database/contacts/${VALID_PEER_ID}`, {
				method: "GET",
			}),
		);
		assert.strictEqual(detailsRes.status, 200);
		const detailsBody = await json(detailsRes);
		assert.strictEqual(detailsBody.success, true);

		const deleteRes = await api.handleTestRequest(
			new Request(`http://localhost/api/database/contacts/${VALID_PEER_ID}`, {
				method: "DELETE",
			}),
		);
		assert.strictEqual(deleteRes.status, 200);
		const deleteBody = await json(deleteRes);
		assert.strictEqual(deleteBody.success, true);
	});

	test("contacts endpoint rejects invalid publicKey", async () => {
		const res = await api.handleTestRequest(
			new Request("http://localhost/api/database/contacts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					peerId: VALID_PEER_ID,
					publicKey: "null",
				}),
			}),
		);
		const body = await json(res);
		assert.strictEqual(res.status, 400);
		assert.strictEqual(body.success, false);
	});

	test("GET /api/messages/inbox and /api/messages/outbox filter by self peer id", async () => {
		// Set up outbox (pending messages for sending)
		node.db.setQueueEntries([
			{
				message_id: "m1",
				target_peer_id: VALID_PEER_ID,
				status: "pending",
				attempts: 0,
				created_at: Date.now(),
				message_data: JSON.stringify({
					id: "m1",
					type: "data",
					from: SELF_PEER_ID,
					to: VALID_PEER_ID,
					payload: { text: "out" },
					timestamp: Date.now(),
				}),
			},
		]);

		// Set up inbox (processed received messages)
		node.db.setProcessedEntries([
			{
				message_id: "m2",
				from_peer_id: VALID_PEER_ID,
				to_peer_id: SELF_PEER_ID,
				message_data: JSON.stringify({
					id: "m2",
					type: "data",
					from: VALID_PEER_ID,
					to: SELF_PEER_ID,
					payload: { text: "in" },
					timestamp: Date.now(),
				}),
				processed_at: Date.now(),
			},
		]);

		const inboxRes = await api.handleTestRequest(
			new Request("http://localhost/api/messages/inbox", { method: "GET" }),
		);
		const inboxBody = await json(inboxRes);
		assert.strictEqual(inboxBody.success, true);
		assert.strictEqual(inboxRes.status, 200);
		const inbox = (
			inboxBody.data as {
				inbox: Array<{ message: { id: string } }>;
			}
		).inbox;
		assert.strictEqual(inbox.length, 1);
		assert.strictEqual(inbox[0].message.id, "m2");

		const outboxRes = await api.handleTestRequest(
			new Request("http://localhost/api/messages/outbox", { method: "GET" }),
		);
		const outboxBody = await json(outboxRes);
		assert.strictEqual(outboxBody.success, true);
		assert.strictEqual(outboxRes.status, 200);
		const outbox = (
			outboxBody.data as {
				outbox: Array<{ message: { id: string } }>;
			}
		).outbox;
		assert.strictEqual(outbox.length, 1);
		assert.strictEqual(outbox[0].message.id, "m1");
	});

	test("POST /api/node/stop is forbidden outside development", async () => {
		const res = await api.handleTestRequest(
			new Request("http://localhost/api/node/stop", { method: "POST" }),
		);
		assert.strictEqual(res.status, 403);
	});

	test("bootstrap status correctly counts connected peers", async () => {
		// Mock a node with bootstrap addresses
		const bootstrapPeerId = "12D3KooWBootstrapPeer";
		const _bootstrapAddr = `/ip4/127.0.0.1/tcp/4001/p2p/${bootstrapPeerId}`;

		const res = await api.handleTestRequest(
			new Request("http://localhost/api/node/info", { method: "GET" }),
		);
		const body = await json(res);

		// May return 200 or 500 if libp2p not initialized
		if (res.status === 200) {
			assert.strictEqual(body.success, true);
			assert.ok(
				(body.data as { bootstrap?: { connected: number } }).bootstrap,
				"Should have bootstrap status",
			);

			const bootstrapData = (
				body.data as {
					bootstrap?: {
						configured: string[];
						connected: number;
						total: number;
						healthy: boolean;
					};
				}
			).bootstrap;

			assert.ok(Array.isArray(bootstrapData.configured));
			assert.strictEqual(typeof bootstrapData.connected, "number");
			assert.strictEqual(typeof bootstrapData.total, "number");
			assert.strictEqual(typeof bootstrapData.healthy, "boolean");
		} else {
			// If libp2p not initialized, that's expected for this test
			assert.ok(res.status >= 400);
		}
	});

	test("bootstrap health uses successful dialed addresses without /p2p peer ids", async () => {
		const bootstrapAddr = "/dns4/bootstrap.example.org/tcp/4001";
		node.bootstrapAddrs = [bootstrapAddr];
		node.bootstrapDialSuccessAddrs = [bootstrapAddr];
		node.bootstrapDialSuccessPeerIds = [];

		const res = await api.handleTestRequest(
			new Request("http://localhost/api/node/info", { method: "GET" }),
		);
		const body = await json(res);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(body.success, true);

		const bootstrap = (
			body.data as {
				bootstrap: {
					connected: number;
					total: number;
					healthy: boolean;
				};
			}
		).bootstrap;

		assert.strictEqual(bootstrap.total, 1);
		assert.strictEqual(bootstrap.connected, 1);
		assert.strictEqual(bootstrap.healthy, true);
	});

	test("GET /api/node/info includes E2E publicKey", async () => {
		const res = await api.handleTestRequest(
			new Request("http://localhost/api/node/info", { method: "GET" }),
		);
		const body = await json(res);
		assert.strictEqual(res.status, 200);
		assert.strictEqual(body.success, true);
		assert.strictEqual(
			typeof (body.data as { publicKey?: unknown }).publicKey,
			"string",
		);
		assert.ok(
			((body.data as { publicKey: string }).publicKey ?? "").length > 0,
			"publicKey should be non-empty",
		);
	});

	test("dialPeer uses cached multiaddrs from routing_cache", async () => {
		// Add peer with multiaddrs
		const peerId = "12D3KooWTestPeer";
		const _multiaddrs = ["/ip4/192.168.1.50/tcp/4001/p2p/12D3KooWTestPeer"];

		const res = await api.handleTestRequest(
			new Request(`http://localhost/api/peers/${peerId}/dial`, {
				method: "POST",
			}),
		);

		// Should not error even if libp2p not initialized
		assert.ok(res.status === 200 || res.status >= 400);
	});
});
