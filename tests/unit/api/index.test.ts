import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiModule } from "../../../src/api/index";
import type { YapYapNode } from "../../../src/core/node";
import type { YapYapMessage } from "../../../src/message/message";

const VALID_PEER_ID = "12D3KooWE5fP2xCV6W9iM8vfA2HRM6k9K9jS5rvnV5wM6x9KfGqA";
const SELF_PEER_ID = "12D3KooWSELFpeer12345678901234567890123456789012345";

type QueueEntry = {
	id: number;
	target_peer_id: string;
	status: "pending" | "processing" | "delivered" | "failed";
	attempts: number;
	queued_at: number;
	next_retry_at?: number;
	message_data: string;
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
	private queueEntries: QueueEntry[] = [];

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

	getRecentMessageQueueEntries() {
		return this.queueEntries;
	}

	setQueueEntries(entries: QueueEntry[]) {
		this.queueEntries = entries;
	}
}

class MockNode {
	public db = new MockDatabase();
	public failSend = false;
	public sentMessages: YapYapMessage[] = [];

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
		expect(res.status).toBe(200);
		expect(body.status).toBe("ok");
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
		expect(res.status).toBe(200);
		expect(body.message).toBe("Message sent successfully");
		expect(body.queued).toBe(false);
		expect(node.sentMessages).toHaveLength(1);
		expect(node.sentMessages[0].to).toBe(VALID_PEER_ID);
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
		expect(res.status).toBe(400);
		expect(body.error).toBe("Invalid target peerId");
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
		expect(res.status).toBe(202);
		expect(body.message).toBe("Message queued for retry");
		expect(body.queued).toBe(true);
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
		expect(createRes.status).toBe(200);

		const listRes = await api.handleTestRequest(
			new Request("http://localhost/api/database/contacts", { method: "GET" }),
		);
		const listBody = (await json(listRes)) as {
			contacts: Array<{ peer_id: string }>;
		};
		expect(listBody.contacts).toHaveLength(1);
		expect(listBody.contacts[0].peer_id).toBe(VALID_PEER_ID);

		const detailsRes = await api.handleTestRequest(
			new Request(`http://localhost/api/database/contacts/${VALID_PEER_ID}`, {
				method: "GET",
			}),
		);
		expect(detailsRes.status).toBe(200);

		const deleteRes = await api.handleTestRequest(
			new Request(`http://localhost/api/database/contacts/${VALID_PEER_ID}`, {
				method: "DELETE",
			}),
		);
		expect(deleteRes.status).toBe(200);
	});

	test("GET /api/messages/inbox and /api/messages/outbox filter by self peer id", async () => {
		node.db.setQueueEntries([
			{
				id: 1,
				target_peer_id: VALID_PEER_ID,
				status: "pending",
				attempts: 0,
				queued_at: Date.now(),
				message_data: JSON.stringify({
					id: "m1",
					type: "data",
					from: SELF_PEER_ID,
					to: VALID_PEER_ID,
					payload: { text: "out" },
					timestamp: Date.now(),
				}),
			},
			{
				id: 2,
				target_peer_id: SELF_PEER_ID,
				status: "delivered",
				attempts: 1,
				queued_at: Date.now(),
				message_data: JSON.stringify({
					id: "m2",
					type: "data",
					from: VALID_PEER_ID,
					to: SELF_PEER_ID,
					payload: { text: "in" },
					timestamp: Date.now(),
				}),
			},
		]);

		const inboxRes = await api.handleTestRequest(
			new Request("http://localhost/api/messages/inbox", { method: "GET" }),
		);
		const inboxBody = (await json(inboxRes)) as {
			inbox: Array<{ message: { id: string } }>;
		};
		expect(inboxRes.status).toBe(200);
		expect(inboxBody.inbox).toHaveLength(1);
		expect(inboxBody.inbox[0].message.id).toBe("m2");

		const outboxRes = await api.handleTestRequest(
			new Request("http://localhost/api/messages/outbox", { method: "GET" }),
		);
		const outboxBody = (await json(outboxRes)) as {
			outbox: Array<{ message: { id: string } }>;
		};
		expect(outboxRes.status).toBe(200);
		expect(outboxBody.outbox).toHaveLength(1);
		expect(outboxBody.outbox[0].message.id).toBe("m1");
	});

	test("POST /api/node/stop is forbidden outside development", async () => {
		const res = await api.handleTestRequest(
			new Request("http://localhost/api/node/stop", { method: "POST" }),
		);
		expect(res.status).toBe(403);
	});
});
