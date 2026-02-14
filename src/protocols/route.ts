/**
 * Routing protocol implementation for YapYap node communication
 * Implements the /yapyap/route/1.0.0 protocol
 */

import type { PeerId } from "@libp2p/interface";
import { handleProtocolError } from "./error-handler";

/* -------------------------------------------------------------------------- */
/*                                   TYPES                                    */
/* -------------------------------------------------------------------------- */

export interface RouteAnnounceMessage {
	type: "route_announce";
	originPeerId: string;
	timestamp: number;
	reachablePeers?: string[];
	routingHints?: RoutingHint[];
	publicKey: Uint8Array;
	signature: Uint8Array;
}

export interface RouteQueryMessage {
	type: "route_query";
	targetPeerId: string;
	queryId: string;
	timestamp: number;
	originPeerId: string;
}

export interface RouteResultMessage {
	type: "route_result";
	queryId: string;
	originPeerId: string;
	timestamp: number;
	peerIds: string[];
	routingHints?: RoutingHint[];
}

export interface RoutingHint {
	peerId: string;
	hintType: "reachability" | "latency" | "bandwidth" | "capacity";
	value: number;
	timestamp: number;
}

/* -------------------------------------------------------------------------- */
/*                              ROUTING TABLE                                 */
/* -------------------------------------------------------------------------- */

interface RoutingEntry {
	lastSeen: number;
	reachablePeers?: string[];
	hints?: RoutingHint[];
}

export class RoutingTable {
	private table = new Map<string, RoutingEntry>();

	updatePeer(
		peerId: string,
		info: {
			reachablePeers?: string[];
			hints?: RoutingHint[];
		},
	): void {
		this.table.set(peerId, {
			lastSeen: Date.now(),
			...(info.reachablePeers !== undefined
				? { reachablePeers: info.reachablePeers }
				: {}),
			...(info.hints !== undefined ? { hints: info.hints } : {}),
		});
	}

	getPeer(peerId: string): RoutingEntry | undefined {
		return this.table.get(peerId);
	}

	getAllPeers(): string[] {
		return [...this.table.keys()];
	}

	cleanupStaleEntries(maxAge = 300_000): void {
		const now = Date.now();

		for (const [peerId, info] of this.table.entries()) {
			if (now - info.lastSeen > maxAge) {
				this.table.delete(peerId);
			}
		}
	}
}

/* -------------------------------------------------------------------------- */
/*                              MESSAGE HANDLER                               */
/* -------------------------------------------------------------------------- */

export async function handleRouteMessage(
	message: RouteAnnounceMessage | RouteQueryMessage | RouteResultMessage,
	remotePeerId: PeerId,
	routingTable: RoutingTable,
	broadcastFn?: (
		msg: RouteAnnounceMessage,
		excludePeerId: string,
	) => Promise<void>,
): Promise<RouteResultMessage | null> {
	return handleProtocolError("route", async () => {
		switch (message.type) {
			case "route_announce":
				return handleRouteAnnounce(
					message,
					remotePeerId,
					routingTable,
					broadcastFn,
				);

			case "route_query":
				return handleRouteQuery(message, remotePeerId, routingTable);

			case "route_result":
				return handleRouteResult(message, remotePeerId, routingTable);
		}
	});
}

/* -------------------------------------------------------------------------- */
/*                          ROUTE ANNOUNCE HANDLER                            */
/* -------------------------------------------------------------------------- */

async function handleRouteAnnounce(
	message: RouteAnnounceMessage,
	remotePeerId: PeerId,
	routingTable: RoutingTable,
	broadcastFn?: (
		msg: RouteAnnounceMessage,
		excludePeerId: string,
	) => Promise<void>,
): Promise<null> {
	const peerId = message.originPeerId;

	console.log(`Received route announcement from peer ${peerId}`);

	/* ---------------------------- Verify Signature --------------------------- */

	try {
		const { verifySignature } = await import("../crypto/index");

		const announceData = JSON.stringify({
			type: message.type,
			originPeerId: message.originPeerId,
			timestamp: message.timestamp,
			reachablePeers: message.reachablePeers,
			routingHints: message.routingHints,
			publicKey: Array.from(message.publicKey),
		});

		const isValid = await verifySignature(
			new TextEncoder().encode(announceData),
			message.signature,
			message.publicKey,
		);

		if (!isValid) {
			console.warn(`Invalid signature in route announcement from ${peerId}`);
			return null;
		}
	} catch (err) {
		console.error("Signature verification failed:", err);
		return null;
	}

	/* ----------------------------- Update Routing ----------------------------- */

	routingTable.updatePeer(peerId, {
		...(message.reachablePeers !== undefined
			? { reachablePeers: message.reachablePeers }
			: {}),
		...(message.routingHints !== undefined
			? { hints: message.routingHints }
			: {}),
	});

	/* ------------------------------ Broadcast -------------------------------- */

	if (broadcastFn) {
		try {
			await broadcastFn(message, remotePeerId.toString());
		} catch (err) {
			console.warn("Failed to forward route announcement:", err);
		}
	}

	/* -------------------------- Reputation Update ---------------------------- */

	try {
		const { RoutingModule } = await import("../routing/index");
		const routingModule = new RoutingModule(remotePeerId.toString());
		routingModule.bumpReputation?.(peerId, 1);
	} catch {
		// Optional dependency
	}

	return null;
}

/* -------------------------------------------------------------------------- */
/*                            ROUTE QUERY HANDLER                             */
/* -------------------------------------------------------------------------- */

async function handleRouteQuery(
	message: RouteQueryMessage,
	remotePeerId: PeerId,
	routingTable: RoutingTable,
): Promise<RouteResultMessage> {
	const { targetPeerId, queryId } = message;

	console.log(
		`Route query for ${targetPeerId} from ${remotePeerId.toString()}`,
	);

	const targetInfo = routingTable.getPeer(targetPeerId);

	let peerIds: string[] = [];
	let routingHints: RoutingHint[] | undefined;

	if (targetInfo) {
		peerIds = [targetPeerId];
		routingHints = targetInfo.hints;
	} else {
		// Fallback behavior (placeholder for DHT lookup)
		peerIds = [remotePeerId.toString()];
	}

	return {
		type: "route_result",
		queryId,
		originPeerId: remotePeerId.toString(),
		timestamp: Date.now(),
		peerIds,
		...(routingHints !== undefined ? { routingHints } : {}),
	};
}

/* -------------------------------------------------------------------------- */
/*                           ROUTE RESULT HANDLER                             */
/* -------------------------------------------------------------------------- */

async function handleRouteResult(
	message: RouteResultMessage,
	remotePeerId: PeerId,
	routingTable: RoutingTable,
): Promise<null> {
	console.log(
		`Received route result for query ${message.queryId} from ${message.originPeerId}`,
	);

	if (message.peerIds.length > 0) {
		routingTable.updatePeer(message.originPeerId, {
			reachablePeers: message.peerIds,
			...(message.routingHints !== undefined
				? { hints: message.routingHints }
				: {}),
		});

		try {
			const { RoutingModule } = await import("../routing/index");
			const routingModule = new RoutingModule(remotePeerId.toString());
			routingModule.bumpReputation?.(message.originPeerId, 1);
		} catch {
			// Optional dependency
		}
	}

	return null;
}

/* -------------------------------------------------------------------------- */
/*                               FACTORY HELPERS                              */
/* -------------------------------------------------------------------------- */

export async function createRouteAnnounce(
	originPeerId: string,
	reachablePeers?: string[],
	routingHints?: RoutingHint[],
): Promise<RouteAnnounceMessage> {
	const { generateIdentityKeyPair, signMessage } = await import(
		"../crypto/index"
	);

	const keyPair = await generateIdentityKeyPair();

	const basePayload = {
		type: "route_announce" as const,
		originPeerId,
		timestamp: Date.now(),
		...(reachablePeers !== undefined ? { reachablePeers } : {}),
		...(routingHints !== undefined ? { routingHints } : {}),
		publicKey: Array.from(keyPair.publicKey),
	};

	const signature = await signMessage(
		new TextEncoder().encode(JSON.stringify(basePayload)),
		keyPair.privateKey,
	);

	return {
		...basePayload,
		publicKey: keyPair.publicKey,
		signature,
	};
}

export function createRouteQuery(
	targetPeerId: string,
	queryId: string,
	originPeerId: string,
): RouteQueryMessage {
	return {
		type: "route_query",
		targetPeerId,
		queryId,
		timestamp: Date.now(),
		originPeerId,
	};
}

export function createRouteResult(
	queryId: string,
	originPeerId: string,
	peerIds: string[],
	routingHints?: RoutingHint[],
): RouteResultMessage {
	return {
		type: "route_result",
		queryId,
		originPeerId,
		timestamp: Date.now(),
		peerIds,
		...(routingHints !== undefined ? { routingHints } : {}),
	};
}
