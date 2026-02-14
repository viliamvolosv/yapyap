/**
 * Common error handling utilities for YapYap protocol modules
 */

/**
 * Standardized error handler function that wraps protocol message handlers
 * @param operationName - Name of the operation being performed
 * @param handler - The actual handler function to execute
 * @returns The result of the handler or null if an error occurs
 */
export async function handleProtocolError<T>(
	operationName: string,
	handler: () => Promise<T | null>,
): Promise<T | null> {
	try {
		return await handler();
	} catch (error) {
		console.error(`Error handling ${operationName} message:`, error);
		// Also log the stack trace for better debugging
		if (error instanceof Error && error.stack) {
			console.error(`Stack trace for ${operationName}:`, error.stack);
		}
		// Also add more context to help with debugging
		if (error instanceof Error) {
			const enhancedError = new Error(`[${operationName}] ${error.message}`);
			if (error.stack !== undefined) {
				enhancedError.stack = error.stack;
			}
			throw enhancedError;
		}
		throw error;
	}
}

/**
 * Standardized error handler for synchronous functions
 */
export function handleProtocolErrorSync<T>(
	operationName: string,
	handler: () => T | null,
): T | null {
	try {
		return handler();
	} catch (error) {
		console.error(`Error handling ${operationName} message:`, error);
		return null;
	}
}
