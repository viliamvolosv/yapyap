/**
 * Common error handling utilities for YapYap protocol modules
 */

let lastProtocolError: Error | null = null;

export function getLastProtocolError(): Error | null {
	return lastProtocolError;
}

export function clearLastProtocolError(): void {
	lastProtocolError = null;
}

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
	lastProtocolError = null;
	try {
		return await handler();
	} catch (error) {
		console.error(`Error handling ${operationName} message:`, error);
		if (error instanceof Error && error.stack) {
			console.error(`Stack trace for ${operationName}:`, error.stack);
		}

		if (error instanceof Error) {
			const enhancedError = new Error(`[${operationName}] ${error.message}`);
			if (error.stack !== undefined) {
				enhancedError.stack = error.stack;
			}
			lastProtocolError = enhancedError;
		} else {
			lastProtocolError = null;
		}

		return null;
	}
}

/**
 * Standardized error handler for synchronous functions
 */
export function handleProtocolErrorSync<T>(
	operationName: string,
	handler: () => T | null,
): T | null {
	lastProtocolError = null;
	try {
		return handler();
	} catch (error) {
		console.error(`Error handling ${operationName} message:`, error);

		if (error instanceof Error) {
			const enhancedError = new Error(`[${operationName}] ${error.message}`);
			if (error.stack !== undefined) {
				enhancedError.stack = error.stack;
			}
			lastProtocolError = enhancedError;
		} else {
			lastProtocolError = null;
		}

		return null;
	}
}
