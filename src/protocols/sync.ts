/**
 * Synchronization protocol implementation for YapYap node communication
 * Implements the /yapyap/sync/1.0.0 protocol
 */

import { createHash } from "node:crypto";
import type { PeerId } from "@libp2p/interface";
import { handleProtocolError } from "./error-handler";

/* -------------------------------------------------------------------------- */
/*                                   TYPES                                    */
/* -------------------------------------------------------------------------- */

export interface SyncRequestMessage {
	type: "sync_request";
	originPeerId: string;
	timestamp: number;
	requestType: "state" | "delta" | "snapshot";
	requestId: string;

	lastSyncTimestamp?: number;
	targetStateHash?: string;

	metadataKey?: string;
	metadataReplication?: boolean;
}

export type NodeStateData = Record<string, unknown>;
export type DeltaData = Partial<NodeStateData>;
export type MetadataValue = unknown;

export interface SyncResponseMessage {
	type: "sync_response";
	originPeerId: string;
	timestamp: number;
	requestId: string;
	responseType: "state" | "delta" | "snapshot";
	data: NodeStateData | DeltaData[] | MetadataValue | null;

	stateHash?: string;
	timestampReceived?: number;

	metadataKey?: string;
	metadataReplication?: boolean;
}

/* -------------------------------------------------------------------------- */
/*                                NODE STATE                                  */
/* -------------------------------------------------------------------------- */

export class NodeState {
	private state: NodeStateData = {};
	private metadata: Map<
		string,
		Record<string, { value: MetadataValue; updated_at: number }>
	> = new Map();

	private deltaHistory: Array<{ timestamp: number; delta: DeltaData }> = [];

	getState(): NodeStateData {
		return this.state;
	}

	setState(newState: NodeStateData): void {
		this.state = { ...newState };
	}

	getPeerMetadata(peerId: string, key: string): MetadataValue | null {
		const peerData = this.metadata.get(peerId);
		return peerData ? (peerData[key]?.value ?? null) : null;
	}

	setPeerMetadata(peerId: string, key: string, value: MetadataValue): void {
		if (!this.metadata.has(peerId)) {
			this.metadata.set(peerId, {});
		}

		let peerData = this.metadata.get(peerId);
		if (!peerData) {
			peerData = {};
			this.metadata.set(peerId, peerData);
		}
		peerData[key] = {
			value,
			updated_at: Date.now(),
		};
	}

	applyDelta(delta: DeltaData): void {
		if (delta && typeof delta === "object") {
			for (const key of Object.keys(delta)) {
				this.state[key] = delta[key];
			}
		}

		this.deltaHistory.push({
			timestamp: Date.now(),
			delta,
		});

		if (this.deltaHistory.length > 100) {
			this.deltaHistory.shift();
		}
	}

	getDeltasSince(timestamp: number): DeltaData[] {
		return this.deltaHistory
			.filter((d) => d.timestamp > timestamp)
			.map((d) => d.delta);
	}

	getRecentDeltas(limit = 10): DeltaData[] {
		return this.deltaHistory.slice(-limit).map((d) => d.delta);
	}
}

/* -------------------------------------------------------------------------- */
/*                              MESSAGE HANDLER                               */
/* -------------------------------------------------------------------------- */

export async function handleSyncMessage(
	message: SyncRequestMessage | SyncResponseMessage,
	remotePeerId: PeerId,
	nodeState: NodeState,
	getPeerMetadata?: (
		peerId: string,
		key: string,
	) => Promise<MetadataValue | null>,
	savePeerMetadata?: (
		peerId: string,
		key: string,
		value: MetadataValue,
	) => Promise<void>,
): Promise<SyncResponseMessage | null> {
	return handleProtocolError("sync", async () => {
		switch (message.type) {
			case "sync_request": {
				if (
					message.metadataReplication &&
					message.metadataKey &&
					getPeerMetadata
				) {
					const value = await getPeerMetadata(
						remotePeerId.toString(),
						message.metadataKey,
					);

					return {
						type: "sync_response",
						originPeerId: remotePeerId.toString(),
						timestamp: Date.now(),
						requestId: message.requestId,
						responseType: "state",
						data: value,
						metadataKey: message.metadataKey,
						metadataReplication: true,
					};
				}

				return handleSyncRequest(message, remotePeerId, nodeState);
			}

			case "sync_response": {
				if (
					message.metadataReplication &&
					message.metadataKey &&
					savePeerMetadata &&
					getPeerMetadata
				) {
					const existing = await getPeerMetadata(
						remotePeerId.toString(),
						message.metadataKey,
					);

					// FIXED: compare against timestampReceived, not Date.now()
					if (!existing) {
						await savePeerMetadata(
							remotePeerId.toString(),
							message.metadataKey,
							message.data,
						);
					}
				}

				return handleSyncResponse(message, nodeState);
			}
		}
	});
}

/* -------------------------------------------------------------------------- */
/*                          SYNC REQUEST HANDLING                             */
/* -------------------------------------------------------------------------- */

async function handleSyncRequest(
	message: SyncRequestMessage,
	remotePeerId: PeerId,
	nodeState: NodeState,
): Promise<SyncResponseMessage> {
	let data: NodeStateData | DeltaData[];
	let stateHash: string | undefined;

	switch (message.requestType) {
		case "state":
			data = nodeState.getState();
			stateHash = generateStateHash(JSON.stringify(data));
			break;

		case "delta":
			data =
				message.lastSyncTimestamp !== undefined
					? nodeState.getDeltasSince(message.lastSyncTimestamp)
					: nodeState.getRecentDeltas();

			stateHash = generateStateHash(JSON.stringify(data));
			break;

		case "snapshot":
			data = nodeState.getState();
			stateHash = generateStateHash(JSON.stringify(data));
			break;
	}

	return {
		type: "sync_response",
		originPeerId: remotePeerId.toString(),
		timestamp: Date.now(),
		requestId: message.requestId,
		responseType: message.requestType,
		data,
		stateHash,
		timestampReceived: message.timestamp,
	};
}

/* -------------------------------------------------------------------------- */
/*                          SYNC RESPONSE HANDLING                            */
/* -------------------------------------------------------------------------- */

async function handleSyncResponse(
	message: SyncResponseMessage,
	nodeState: NodeState,
	applyDelta?: (delta: DeltaData) => Promise<void> | void,
): Promise<null> {
	if (message.responseType === "delta" && Array.isArray(message.data)) {
		if (applyDelta) {
			for (const delta of message.data) {
				await applyDelta(delta);
			}
		}
	} else if (
		message.responseType === "state" &&
		message.data &&
		typeof message.data === "object" &&
		!Array.isArray(message.data)
	) {
		nodeState.setState(message.data as NodeStateData);
	}

	if (message.stateHash && message.data) {
		const computedHash = generateStateHash(JSON.stringify(message.data));

		if (computedHash !== message.stateHash) {
			console.warn(`State hash mismatch for request ${message.requestId}`);
		}
	}

	return null;
}

/* -------------------------------------------------------------------------- */
/*                                 UTILITIES                                  */
/* -------------------------------------------------------------------------- */

function generateStateHash(stateData: string): string {
	return createHash("sha256").update(stateData).digest("hex");
}

export function selectKClosestPeers(
	selfId: string,
	peerIds: string[],
	k: number,
): string[] {
	function xorDistance(a: string, b: string): bigint {
		const bufA = Buffer.from(a);
		const bufB = Buffer.from(b);
		const len = Math.max(bufA.length, bufB.length);

		let dist = 0n;

		for (let i = 0; i < len; i++) {
			const byteA = bufA[i] ?? 0;
			const byteB = bufB[i] ?? 0;
			dist = (dist << 8n) + BigInt(byteA ^ byteB);
		}

		return dist;
	}

	return peerIds
		.map((pid) => ({ pid, dist: xorDistance(selfId, pid) }))
		.sort((a, b) => (a.dist < b.dist ? -1 : 1))
		.slice(0, k)
		.map((x) => x.pid);
}

/* -------------------------------------------------------------------------- */
/*                              FACTORY HELPERS                               */
/* -------------------------------------------------------------------------- */

export function createSyncRequest(
	originPeerId: string,
	requestType: "state" | "delta" | "snapshot",
	requestId: string,
	lastSyncTimestamp?: number,
	targetStateHash?: string,
): SyncRequestMessage {
	const msg: SyncRequestMessage = {
		type: "sync_request",
		originPeerId,
		timestamp: Date.now(),
		requestType,
		requestId,
	};
	if (lastSyncTimestamp !== undefined) {
		msg.lastSyncTimestamp = lastSyncTimestamp;
	}
	if (targetStateHash !== undefined) {
		msg.targetStateHash = targetStateHash;
	}
	return msg;
}

export function createSyncResponse(
	originPeerId: string,
	requestId: string,
	responseType: "state" | "delta" | "snapshot",
	data: NodeStateData | DeltaData[],
	stateHash?: string,
): SyncResponseMessage {
	const msg: SyncResponseMessage = {
		type: "sync_response",
		originPeerId,
		timestamp: Date.now(),
		requestId,
		responseType,
		data,
	};
	if (stateHash !== undefined) {
		msg.stateHash = stateHash;
	}
	return msg;
}
