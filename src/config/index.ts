export type YapYapConfig = {
	dataDir?: string;
	network?: string;
};

/**
 * Default bootstrap peers for P2P discovery.
 * These are well-known peers that help new nodes join the network.
 * Can be overridden via YAPYAP_BOOTSTRAP_ADDRS environment variable.
 */
export const DEFAULT_BOOTSTRAP_ADDRS: string[] = [
	// Public bootstrap nodes (community-run)
	"/ip4/217.177.72.152/tcp/4001/p2p/12D3KooWF9981QXoXUXxpsEQ13NXt6eBvAGVfSfwVTCGz3FhLh6X",
];

/**
 * Parse bootstrap addresses from environment variable or return defaults.
 */
export function getBootstrapAddrs(envValue?: string): string[] {
	if (envValue) {
		const parsed = envValue
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (parsed.length > 0) {
			return parsed;
		}
	}
	return DEFAULT_BOOTSTRAP_ADDRS;
}
