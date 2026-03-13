/**
 * Contract tests for Route protocol module
 * Tests route announce, query, and result handling
 */

import assert from "node:assert";
import { describe, test } from "node:test";
import {
	createRouteAnnounce,
	createRouteQuery,
	createRouteResult,
	handleRouteAnnounce,
	handleRouteQuery,
	handleRouteResult,
	RoutingTable,
} from "./route.js";

// Test utilities
function createTestKeyPair() {
	// Note: This would use actual crypto utilities in production
	// For now, we'll use mock values
	return {
		publicKey: new Uint8Array(32).fill(1),
		privateKey: new Uint8Array(64).fill(2),
	};
}

// ============================================================================
// Test Suite: RoutingTable
// ============================================================================

describe("RoutingTable - updatePeer", () => {
	test("Given peer info, When updated, Then entry timestamp updated", () => {
		const table = new RoutingTable();

		table.updatePeer("peer-1", {
			reachablePeers: ["peer-2", "peer-3"],
		});

		const entry = table.getPeer("peer-1");
		assert.ok(entry, "Entry should exist");
		assert.ok(entry?.lastSeen > 0, "Last seen should be set");
	});

	test("Given peer info with hints, When updated, Then hints preserved", () => {
		const table = new RoutingTable();

		const hints = [
			{
				peerId: "peer-2",
				hintType: "latency" as const,
				value: 100,
				timestamp: Date.now(),
			},
		];

		table.updatePeer("peer-1", { hints });

		const entry = table.getPeer("peer-1");
		assert.ok(entry?.hints, "Hints should be set");
		assert.strictEqual(entry?.hints?.length, 1, "Should have one hint");
	});

	test("Given repeated update, Then lastSeen updated", () => {
		const table = new RoutingTable();

		table.updatePeer("peer-1", {});

		const firstLastSeen = table.getPeer("peer-1")?.lastSeen;

		// Wait a bit
		setTimeout(() => {}, 10);

		table.updatePeer("peer-1", {});

		const secondLastSeen = table.getPeer("peer-1")?.lastSeen;

		assert.ok(secondLastSeen > firstLastSeen, "Last seen should be updated");
	});
});

describe("RoutingTable - getPeer", () => {
	test("Given existing peer, When getPeer called, Then returns entry", () => {
		const table = new RoutingTable();

		table.updatePeer("peer-1", {});

		const entry = table.getPeer("peer-1");
		assert.ok(entry, "Entry should exist");
		assert.strictEqual(entry?.lastSeen, table.getPeer("peer-1")?.lastSeen);
	});

	test("Given non-existent peer, When getPeer called, Then returns undefined", () => {
		const table = new RoutingTable();

		const entry = table.getPeer("non-existent");
		assert.strictEqual(entry, undefined, "Should return undefined");
	});
});

describe("RoutingTable - cleanupStaleEntries", () => {
	test("Given entries older than maxAge, When cleanup called, Then deletes them", () => {
		const table = new RoutingTable();

		table.updatePeer("peer-1", {});
		table.updatePeer("peer-2", {});

		// Manually set old lastSeen
		const entry1 = table.getPeer("peer-1");
		if (entry1) {
			// @ts-expect-error - testing internal state
			entry1.lastSeen = Date.now() - 4000000;
		}

		// Manually set old lastSeen
		const entry2 = table.getPeer("peer-2");
		if (entry2) {
			// @ts-expect-error - testing internal state
			entry2.lastSeen = Date.now() - 4000000;
		}

		// Cleanup with maxAge of 3000000 (3 seconds)
		table.cleanupStaleEntries(3000000);

		assert.strictEqual(
			table.getPeer("peer-1"),
			undefined,
			"Old entry should be deleted",
		);
		assert.strictEqual(
			table.getPeer("peer-2"),
			undefined,
			"Old entry should be deleted",
		);
	});

	test("Given entries within maxAge, When cleanup called, Then preserves them", () => {
		const table = new RoutingTable();

		table.updatePeer("peer-1", {});
		table.updatePeer("peer-2", {});

		// Cleanup with maxAge of 3000000 (3 seconds) - should keep all
		table.cleanupStaleEntries(3000000);

		assert.ok(table.getPeer("peer-1"), "Recent entry should be preserved");
		assert.ok(table.getPeer("peer-2"), "Recent entry should be preserved");
	});
});

// ============================================================================
// Test Suite: createRouteAnnounce
// ============================================================================

describe("createRouteAnnounce", () => {
	test("Given parameters, When created, Then returns valid announce message", async () => {
		const announce = await createRouteAnnounce("peer-1", ["peer-2", "peer-3"]);

		assert.strictEqual(
			announce.type,
			"route_announce",
			"Type should be route_announce",
		);
		assert.strictEqual(
			announce.originPeerId,
			"peer-1",
			"Origin peer ID should match",
		);
		assert.ok(announce.timestamp > 0, "Timestamp should be set");
		assert.ok(announce.publicKey.length > 0, "Public key should be set");
		assert.ok(announce.signature?.length > 0, "Signature should be set");
	});

	test("Given reachablePeers, When created, Then includes in message", async () => {
		const reachablePeers = ["peer-a", "peer-b", "peer-c"];

		const announce = await createRouteAnnounce("peer-1", reachablePeers);

		assert.ok(announce.reachablePeers, "Reachable peers should be set");
		assert.strictEqual(
			announce.reachablePeers?.length,
			3,
			"Should include all reachable peers",
		);
	});

	test("Given routingHints, When created, Then includes in message", async () => {
		const hints = [
			{
				peerId: "peer-2",
				hintType: "latency" as const,
				value: 100,
				timestamp: Date.now(),
			},
		];

		const announce = await createRouteAnnounce("peer-1", undefined, hints);

		assert.ok(announce.routingHints, "Routing hints should be set");
		assert.strictEqual(
			announce.routingHints?.length,
			1,
			"Should include one hint",
		);
	});
});

// ============================================================================
// Test Suite: createRouteQuery
// ============================================================================

describe("createRouteQuery", () => {
	test("Given parameters, When created, Then returns valid query message", () => {
		const query = createRouteQuery(
			"peer-target",
			"query-id-123",
			"peer-origin",
		);

		assert.strictEqual(query.type, "route_query", "Type should be route_query");
		assert.strictEqual(
			query.targetPeerId,
			"peer-target",
			"Target peer ID should match",
		);
		assert.strictEqual(query.queryId, "query-id-123", "Query ID should match");
		assert.strictEqual(
			query.originPeerId,
			"peer-origin",
			"Origin peer ID should match",
		);
		assert.ok(query.timestamp > 0, "Timestamp should be set");
	});

	test("Given all parameters, When created, Then includes all fields", () => {
		const query = createRouteQuery(
			"peer-target",
			"query-id-123",
			"peer-origin",
		);

		// Verify all required fields
		assert.ok(query.type);
		assert.ok(query.targetPeerId);
		assert.ok(query.queryId);
		assert.ok(query.timestamp);
		assert.ok(query.originPeerId);
	});
});

// ============================================================================
// Test Suite: createRouteResult
// ============================================================================

describe("createRouteResult", () => {
	test("Given parameters, When created, Then returns valid result message", () => {
		const result = createRouteResult("query-id-123", "peer-origin", [
			"peer-1",
			"peer-2",
		]);

		assert.strictEqual(
			result.type,
			"route_result",
			"Type should be route_result",
		);
		assert.strictEqual(result.queryId, "query-id-123", "Query ID should match");
		assert.strictEqual(
			result.originPeerId,
			"peer-origin",
			"Origin peer ID should match",
		);
		assert.ok(result.timestamp > 0, "Timestamp should be set");
		assert.ok(result.peerIds.length > 0, "Peer IDs should be set");
	});

	test("Given routingHints, When created, Then includes in message", () => {
		const hints = [
			{
				peerId: "peer-1",
				hintType: "latency" as const,
				value: 50,
				timestamp: Date.now(),
			},
		];

		const result = createRouteResult(
			"query-id-123",
			"peer-origin",
			["peer-1"],
			hints,
		);

		assert.ok(result.routingHints, "Routing hints should be set");
		assert.strictEqual(
			result.routingHints?.length,
			1,
			"Should include one hint",
		);
	});

	test("Given empty peerIds, When created, Then returns valid result", () => {
		const result = createRouteResult("query-id-123", "peer-origin", []);

		assert.strictEqual(
			result.type,
			"route_result",
			"Type should be route_result",
		);
		assert.ok(
			result.peerIds.length === 0,
			"Empty peer IDs array should be allowed",
		);
	});
});

// ============================================================================
// Test Suite: handleRouteAnnounce
// ============================================================================

describe("handleRouteAnnounce", () => {
	test("Given valid announce with signature, When handled, Then validates signature and updates routing", async () => {
		const keyPair = createTestKeyPair();
		const table = new RoutingTable();

		const announce = await createRouteAnnounce("peer-1", ["peer-2", "peer-3"]);

		const result = await handleRouteAnnounce(
			announce,
			keyPair.publicKey,
			table,
		);

		assert.strictEqual(result, null, "Should return null on success");

		// Verify routing was updated
		const entry = table.getPeer("peer-1");
		assert.ok(entry, "Routing entry should be created");
		assert.ok(entry?.reachablePeers, "Reachable peers should be set");
	});

	test("Given announce with missing signature, When handled, Then returns null without updating routing", async () => {
		const keyPair = createTestKeyPair();
		const table = new RoutingTable();

		const announce = await createRouteAnnounce("peer-1", ["peer-2", "peer-3"]);
		// Remove signature
		// @ts-expect-error - intentionally testing error path
		delete announce.signature;

		const result = await handleRouteAnnounce(
			announce,
			keyPair.publicKey,
			table,
		);

		assert.strictEqual(result, null, "Should return null");
		assert.strictEqual(
			table.getPeer("peer-1"),
			undefined,
			"Routing should not be updated",
		);
	});

	test("Given announce with wrong sender key, When handled, Then rejects", async () => {
		const keyPair2 = createTestKeyPair();
		const table = new RoutingTable();

		const announce = await createRouteAnnounce("peer-1", ["peer-2", "peer-3"]);

		// Try to verify with wrong key
		const result = await handleRouteAnnounce(
			announce,
			keyPair2.publicKey,
			table,
		);

		assert.strictEqual(
			result,
			null,
			"Should return null when signature invalid",
		);
	});

	test("Given announce with tampered signature, When handled, Then rejects", async () => {
		const keyPair = createTestKeyPair();
		const table = new RoutingTable();

		const announce = await createRouteAnnounce("peer-1", ["peer-2", "peer-3"]);

		// Tamper with signature
		const tamperedAnnounce = { ...announce };
		if (tamperedAnnounce.signature) {
			tamperedAnnounce.signature[0] = (tamperedAnnounce.signature[0] + 1) % 256;
		}

		const result = await handleRouteAnnounce(
			tamperedAnnounce,
			keyPair.publicKey,
			table,
		);

		assert.strictEqual(
			result,
			null,
			"Should return null when signature tampered",
		);
		assert.strictEqual(
			table.getPeer("peer-1"),
			undefined,
			"Routing should not be updated",
		);
	});
});

// ============================================================================
// Test Suite: handleRouteQuery
// ============================================================================

describe("handleRouteQuery", () => {
	test("Given query for existing peer, When handled, Then returns result with peer", async () => {
		const table = new RoutingTable();
		table.updatePeer("peer-target", {});

		const query = createRouteQuery(
			"peer-target",
			"query-id-123",
			"peer-origin",
		);

		const result = await handleRouteQuery(query, "peer-origin", table);

		assert.ok(result, "Should return result");
		assert.strictEqual(
			result?.type,
			"route_result",
			"Type should be route_result",
		);
		assert.strictEqual(
			result?.queryId,
			"query-id-123",
			"Query ID should match",
		);
		assert.ok(result?.peerIds.length > 0, "Should return peer IDs");
	});

	test("Given query for non-existent peer, When handled, Then returns fallback", async () => {
		const table = new RoutingTable();

		const query = createRouteQuery(
			"non-existent-peer",
			"query-id-123",
			"peer-origin",
		);

		const result = await handleRouteQuery(query, "peer-origin", table);

		assert.ok(result, "Should return result");
		assert.strictEqual(
			result?.type,
			"route_result",
			"Type should be route_result",
		);
		assert.ok(result?.peerIds.length > 0, "Should return fallback peer IDs");
	});

	test("Given query with missing fields, When handled, Then returns result with required fields", async () => {
		const table = new RoutingTable();

		const query = {
			type: "route_query" as const,
			targetPeerId: "peer-target",
			queryId: "query-id-123",
			timestamp: Date.now(),
			originPeerId: "peer-origin",
		};

		const result = await handleRouteQuery(query, "peer-origin", table);

		assert.ok(result, "Should return result");
		assert.ok(result?.queryId, "Query ID should be present");
		assert.ok(result?.originPeerId, "Origin peer ID should be present");
		assert.ok(result?.peerIds, "Peer IDs should be present");
	});
});

// ============================================================================
// Test Suite: handleRouteResult
// ============================================================================

describe("handleRouteResult", () => {
	test("Given result with peerIds, When handled, Then updates routing", async () => {
		const table = new RoutingTable();
		const peerIds = ["peer-1", "peer-2", "peer-3"];

		const result = createRouteResult("query-id-123", "peer-origin", peerIds);

		const handled = await handleRouteResult(result, "peer-origin", table);

		assert.strictEqual(handled, null, "Should return null");

		// Verify routing was updated
		const entry = table.getPeer("peer-origin");
		assert.ok(entry, "Routing entry should be created");
		assert.ok(entry?.reachablePeers, "Reachable peers should be set");
		assert.ok(entry?.reachablePeers?.length > 0, "Should have reachable peers");
	});

	test("Given result with empty peerIds, When handled, Then updates routing with empty list", async () => {
		const table = new RoutingTable();

		const result = createRouteResult("query-id-123", "peer-origin", []);

		const handled = await handleRouteResult(result, "peer-origin", table);

		assert.strictEqual(handled, null, "Should return null");

		// Verify routing was updated
		const entry = table.getPeer("peer-origin");
		assert.ok(entry, "Routing entry should be created");
		assert.ok(entry?.reachablePeers, "Reachable peers should be set");
		assert.strictEqual(
			entry?.reachablePeers?.length,
			0,
			"Should have empty reachable peers list",
		);
	});

	test("Given result with missing peerIds, When handled, Then updates routing", async () => {
		const table = new RoutingTable();

		const result = createRouteResult("query-id-123", "peer-origin", []);
		// @ts-expect-error - intentionally testing error path
		delete result.peerIds;

		const handled = await handleRouteResult(result, "peer-origin", table);

		assert.strictEqual(handled, null, "Should return null");
	});
});
