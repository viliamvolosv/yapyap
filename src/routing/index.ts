// RoutingModule: DHT, routing table, peer discovery
import type { PeerId, PeerInfo } from "@libp2p/interface";
import { xor } from "uint8arrays/xor";

export interface RoutingMetrics {
	lookups: number;
	successfulLookups: number;
	failedLookups: number;
	routingTableUpdates: number;
	successRate: number;
}

const MAX_REPUTATION = 100;
const MIN_REPUTATION = -100;

// Kademlia bucket structure for peer organization
interface Bucket {
	id: number; // The bucket ID (0-255)
	peers: Map<string, { lastSeen: number; isAvailable: boolean }>; // Peer IDs in this bucket
}

export class RoutingModule {
	constructor(private readonly selfId: string) {
		// Initialize 256 buckets for Kademlia
		for (let i = 0; i < 256; i++) {
			this.buckets[i] = { id: i, peers: new Map() };
		}
	}
	// Track per-peer load (number of active messages/streams)
	private readonly peerLoad: Map<string, number> = new Map();
	/**
	 * Increment load for a peer (call when sending message/stream)
	 */
	incrementPeerLoad(peerId: string) {
		this.peerLoad.set(peerId, (this.peerLoad.get(peerId) || 0) + 1);
	}

	/**
	 * Decrement load for a peer (call when message/stream completes)
	 */
	decrementPeerLoad(peerId: string) {
		const prev = this.peerLoad.get(peerId) || 0;
		this.peerLoad.set(peerId, Math.max(0, prev - 1));
	}

	/**
	 * Get current load for a peer
	 */
	getPeerLoad(peerId: string): number {
		return this.peerLoad.get(peerId) || 0;
	}
	// Reputation scores: peerId -> score (higher is better)
	private readonly reputation: Map<string, number> = new Map();
	private readonly routingTable = new Map<
		string,
		{ lastSeen: number; isAvailable: boolean }
	>();
	private readonly buckets: Bucket[] = [];
	private readonly discoveredPeers = new Map<string, PeerId>();
	private readonly connectedPeers = new Set<string>();
	private readonly inboundPeers = new Set<string>();
	private routingMetrics: RoutingMetrics = {
		lookups: 0,
		successfulLookups: 0,
		failedLookups: 0,
		routingTableUpdates: 0,
		successRate: 0,
	};

	public getMetrics(): RoutingMetrics {
		return this.routingMetrics;
	}

	onPeerDiscovery(peerInfo: PeerInfo) {
		this.discoveredPeers.set(peerInfo.id.toString(), peerInfo.id);
		// Initialize reputation if not present
		if (!this.reputation.has(peerInfo.id.toString())) {
			this.reputation.set(peerInfo.id.toString(), 0);
		}
	}

	recordLookup(success: boolean) {
		this.routingMetrics.lookups++;

		if (success) this.routingMetrics.successfulLookups++;
		else this.routingMetrics.failedLookups++;
	}

	onPeerConnect(peerId: PeerId) {
		this.connectedPeers.add(peerId.toString());
		// Bump reputation for successful connection
		this.bumpReputation(peerId.toString(), 1);
	}

	onPeerDisconnect(peerId: PeerId) {
		this.connectedPeers.delete(peerId.toString());
		// Lower reputation for disconnect
		this.bumpReputation(peerId.toString(), -1);
	}
	/**
	 * Bump reputation for a peer
	 */
	bumpReputation(peerId: string, delta: number) {
		const prev = this.reputation.get(peerId) || 0;
		this.reputation.set(
			peerId,
			Math.max(MIN_REPUTATION, Math.min(MAX_REPUTATION, prev + delta)),
		);
	}

	/**
	 * Set reputation for a peer
	 */
	setReputation(peerId: string, score: number) {
		this.reputation.set(peerId, score);
	}

	/**
	 * Get reputation for a peer
	 */
	getReputation(peerId: string): number {
		return this.reputation.get(peerId) || 0;
	}

	onInboundConnection(peerId: PeerId) {
		this.inboundPeers.add(peerId.toString());
	}

	onInboundDisconnect(peerId: PeerId) {
		this.inboundPeers.delete(peerId.toString());
	}

	/**
	 * Add a peer to the routing table, placing it in the correct bucket
	 */
	addPeerToRoutingTable(peerId: string, isAvailable: boolean = true) {
		try {
			// Update or create the peer entry
			const now = Date.now();
			this.routingTable.set(peerId, {
				lastSeen: now,
				isAvailable,
			});

			// Determine which bucket this peer belongs to based on XOR distance from self
			const bucketId = this.getBucketIdForPeer(peerId);
			if (bucketId >= 0 && bucketId < 256) {
				const bucket = this.buckets[bucketId];
				if (bucket) {
					// Add peer to bucket
					if (!bucket.peers.has(peerId)) {
						bucket.peers.set(peerId, {
							lastSeen: now,
							isAvailable,
						});
					}

					// Keep bucket size within limits (Kademlia standard is typically 20 peers per bucket)
					if (bucket.peers.size > 20) {
						this.evictFromBucket(bucket);
					}
				}
			}

			this.routingMetrics.routingTableUpdates++;
		} catch (error) {
			console.error("Error adding peer to routing table:", error);
			throw error;
		}
	}

	/**
	 * Remove a peer from the routing table
	 */
	removePeerFromRoutingTable(peerId: string) {
		// Remove from main routing table
		this.routingTable.delete(peerId);

		// Remove from all buckets
		for (const bucket of this.buckets) {
			if (bucket.peers.has(peerId)) {
				bucket.peers.delete(peerId);
			}
		}
	}

	/**
	 * Update peer entry in routing table with new timestamp
	 */
	updateRoutingTableEntry(peerId: string, isAvailable: boolean = true) {
		const now = Date.now();
		if (this.routingTable.has(peerId)) {
			this.routingTable.set(peerId, {
				lastSeen: now,
				isAvailable,
			});

			// Also update in bucket
			const bucketId = this.getBucketIdForPeer(peerId);
			if (bucketId >= 0 && bucketId < 256) {
				const bucket = this.buckets[bucketId];
				if (bucket?.peers.has(peerId)) {
					bucket.peers.set(peerId, {
						lastSeen: now,
						isAvailable,
					});
				}
			}
		} else {
			// If peer not in table, add it
			this.addPeerToRoutingTable(peerId, isAvailable);
		}
	}

	/**
	 * Get bucket ID for a given peer (based on XOR distance from self)
	 * This implements true Kademlia XOR distance calculations
	 */
	protected getBucketIdForPeer(peerId: string): number {
		// Defensive: ensure peerId and selfId are defined and valid hex strings
		if (
			!peerId ||
			typeof peerId !== "string" ||
			!/^[0-9a-fA-F]+$/.test(peerId)
		) {
			console.error(
				"Invalid or undefined peerId for getBucketIdForPeer:",
				peerId,
			);
			return 255;
		}
		if (
			!this.selfId ||
			typeof this.selfId !== "string" ||
			!/^[0-9a-fA-F]+$/.test(this.selfId)
		) {
			console.error(
				"Invalid or undefined selfId for getBucketIdForPeer:",
				this.selfId,
			);
			return 255;
		}
		try {
			const peerBytes = Buffer.from(peerId, "hex");
			const selfBytes = Buffer.from(this.selfId, "hex");
			const dist = xor(selfBytes, peerBytes);
			for (let i = 0; i < dist.length; i++) {
				const byte = dist[i];
				if (byte !== undefined && byte !== 0) {
					return i * 8 + Math.clz32(byte) - 24;
				}
			}
			return 255;
		} catch (err) {
			console.error(
				"Error in getBucketIdForPeer (Buffer/xor):",
				err,
				peerId,
				this.selfId,
			);
			return 255;
		}
	}

	/**
	 * Evict a peer from a bucket to maintain size limits
	 */
	private async evictFromBucket(bucket: Bucket) {
		if (bucket.peers.size <= 20) return; // Already within limit

		// Evict oldest peer in the bucket
		let oldestPeerId: string | null = null;
		let oldestTimestamp = Infinity;

		for (const [peerId, entry] of Array.from(bucket.peers.entries())) {
			if (entry.lastSeen < oldestTimestamp) {
				oldestTimestamp = entry.lastSeen;
				oldestPeerId = peerId;
			}
		}

		if (oldestPeerId) {
			// Before eviction, check if peer is still alive
			if (await this.ping(oldestPeerId)) {
				// Peer is still alive, keep it
				return;
			}

			bucket.peers.delete(oldestPeerId);

			// Also remove from main routing table
			this.routingTable.delete(oldestPeerId);
		}
	}

	async ping(_peerId: string): Promise<boolean> {
		return true;
	}

	getRoutingTableInfo() {
		return {
			totalEntries: this.routingTable.size,
			entries: Array.from(this.routingTable.entries()).map(
				([peerId, entry]) => ({
					peerId,
					lastSeen: new Date(entry.lastSeen).toISOString(),
					isAvailable: entry.isAvailable,
				}),
			),
			connectedPeers: this.connectedPeers.size,
			discoveredPeers: this.discoveredPeers.size,
			inboundPeers: this.inboundPeers.size,
			bucketInfo: this.buckets.map((bucket) => ({
				id: bucket.id,
				peerCount: bucket.peers.size,
			})),
		};
	}

	getRoutingMetrics(): RoutingMetrics {
		return {
			...this.routingMetrics,
			successRate:
				this.routingMetrics.lookups > 0
					? (this.routingMetrics.successfulLookups /
							this.routingMetrics.lookups) *
						100
					: 0,
		};
	}

	/**
	 * Remove stale entries from the routing table (older than thresholdMs)
	 */
	cleanupStaleEntries(thresholdMs: number = 5 * 60 * 1000) {
		const now = Date.now();
		let removed = 0;
		for (const [peerId, entry] of Array.from(this.routingTable.entries())) {
			if (now - entry.lastSeen > thresholdMs) {
				this.removePeerFromRoutingTable(peerId);
				removed++;
			}
		}
		if (removed > 0) {
			this.routingMetrics.routingTableUpdates++;
		}
		return removed;
	}

	/**
	 * Optimize routing table by removing stale entries and maintaining bucket sizes
	 */
	optimizeBuckets() {
		// Remove stale entries from all buckets
		const now = Date.now();
		let totalRemoved = 0;

		for (const bucket of this.buckets) {
			// Create list of peers to remove
			const peersToRemove: string[] = [];

			for (const [peerId, entry] of Array.from(bucket.peers.entries())) {
				if (now - entry.lastSeen > 5 * 60 * 1000) {
					// 5 minutes threshold
					peersToRemove.push(peerId);
				}
			}

			// Remove stale peers from bucket
			for (const peerId of peersToRemove) {
				bucket.peers.delete(peerId);
				this.routingTable.delete(peerId);
				totalRemoved++;
			}
		}

		if (totalRemoved > 0) {
			this.routingMetrics.routingTableUpdates++;
		}
	}

	/**
	 * Find closest peers to a target using XOR distance (Kademlia-like)
	 */
	findClosestPeers(targetPeerId: string, count: number = 8): string[] {
		return this.getAllPeers()
			.map((p) => ({
				id: p,
				dist: this.xorDistance(p, targetPeerId),
			}))
			.sort((a, b) => this.compare(a.dist, b.dist))
			.slice(0, count)
			.map((x) => x.id);
	}

	getAllPeers(): string[] {
		return this.buckets
			.flatMap((b) => Array.from(b.peers.entries()))
			.map(([peerId]) => peerId);
	}

	xorDistance(peerId: string, targetId: string): Uint8Array {
		const peerBytes = Buffer.from(peerId, "hex");
		const targetBytes = Buffer.from(targetId, "hex");
		return xor(peerBytes, targetBytes);
	}

	compare(a: Uint8Array, b: Uint8Array): number {
		const minLen = Math.min(a.length, b.length);
		for (let i = 0; i < minLen; i++) {
			const byteA = a[i];
			const byteB = b[i];
			if (byteA !== undefined && byteB !== undefined && byteA !== byteB) {
				return byteA - byteB;
			}
		}
		return a.length - b.length;
	}

	/**
	 * Select optimal peers based on reputation, recency, availability, and load (least-loaded preferred)
	 */
	selectOptimalPeers(limit: number = 5): string[] {
		try {
			return Array.from(this.routingTable.entries())
				.filter(([, entry]) => entry.isAvailable)
				.sort((a, b) => {
					// Sort by reputation DESC, then by lastSeen DESC, then by load ASC
					const repA = this.getReputation(a[0]);
					const repB = this.getReputation(b[0]);
					if (repA !== repB) return repB - repA;
					if (b[1].lastSeen !== a[1].lastSeen)
						return b[1].lastSeen - a[1].lastSeen;
					// Prefer least-loaded peer
					return this.getPeerLoad(a[0]) - this.getPeerLoad(b[0]);
				})
				.slice(0, limit)
				.map(([peerId]) => peerId);
		} catch (error) {
			console.error("Error selecting optimal peers:", error);
			// Return empty array on error to prevent crashes
			return [];
		}
	}
	/**
	 * Penalize a peer for misbehavior (e.g., failed delivery, invalid message)
	 */
	penalizePeer(peerId: string, penalty: number = 5) {
		this.bumpReputation(peerId, -penalty);
	}

	/**
	 * Find peers with a given capability
	 */
	findPeersWithCapability(_cap: string): string[] {
		// In a real implementation, this would check peer capabilities
		// For now, return all available peers
		return Array.from(this.routingTable.entries())
			.filter(([_, entry]) => entry.isAvailable)
			.map(([peerId]) => peerId);
	}
}
