/**
 * API test utilities for YapYap project
 */

import { ApiModule } from "../../src/api/index";
import type { YapYapNode } from "../../src/core/node";

/**
 * Create a test API module instance for testing
 */
export function createTestApiModule(node: YapYapNode): ApiModule {
	return new ApiModule(node);
}

/**
 * Mock response for API endpoints
 */
export interface MockApiResponse {
	status: number;
	body?: unknown;
	headers?: Record<string, string>;
}

/**
 * Test utility to simulate API request handling
 */
export async function simulateApiRequest(
	apiModule: ApiModule,
	method: string,
	path: string,
	_body?: unknown,
): Promise<MockApiResponse> {
	// This is a simplified simulation - in real tests we'd need to mock the HTTP server
	try {
		const request = new Request(`http://localhost${path}`, { method });
		const response = await apiModule.handleRequest(request);
		const body = await response.json();

		return {
			status: response.status,
			body,
		};
	} catch (_error) {
		return { status: 500, body: { error: "Internal server error" } };
	}
}
