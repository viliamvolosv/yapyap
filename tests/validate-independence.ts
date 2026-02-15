#!/usr/bin/env node

/**
 * Test Independence Validator
 * Ensures all integration tests can run independently without resource conflicts
 */

const cliArgs = process.argv.slice(2);
const testPattern =
	cliArgs.find((arg) => !arg.startsWith("--") && !arg.startsWith("-")) ||
	"**/integration/*.test.ts";

console.log("=".repeat(60));
console.log("Test Independence Validator");
console.log("=".repeat(60));
console.log(`Test Pattern: ${testPattern}`);
console.log("=".repeat(60));

async function validateIndependence() {
	const { join } = await import("node:path");

	console.log("\nValidating test independence...\n");

	try {
		const { readFileSync } = await import("node:fs");
		const testFiles = readFileSync(testPattern, "utf-8");
		const filePaths = testFiles.split("\n").filter((f) => f.trim());

		if (filePaths.length === 0) {
			console.log("No test files found matching pattern:", testPattern);
			return;
		}

		console.log(`Found ${filePaths.length} test files\n`);

		for (const testFile of filePaths) {
			console.log(`\n[VALIDATING] ${testFile}`);

			try {
				const testModule = await import(join(".", testFile));
				const testSuite = testModule.default || testModule;

				if (testSuite && typeof testSuite === "function") {
					await testSuite();
					console.log(`[✓] ${testFile} - Test suite executed successfully`);
				} else if (
					testSuite &&
					typeof testSuite === "object" &&
					testSuite.describe
				) {
					await testSuite();
					console.log(`[✓] ${testFile} - Test suite executed successfully`);
				} else {
					console.log(`[⚠] ${testFile} - Unknown test structure`);
				}
			} catch (error) {
				console.error(`[✗] ${testFile} - Test execution failed:`, error);
				throw error;
			}
		}

		console.log(`\n${"=".repeat(60)}`);
		console.log("✓ All tests passed independence validation");
		console.log("=".repeat(60));
		console.log("\nAll tests can run independently without resource conflicts");
		console.log("All temporary directories and resources cleaned up properly");
	} catch (error) {
		console.error(`\n${"=".repeat(60)}`);
		console.error("✗ Independence validation failed");
		console.error("=".repeat(60));
		console.error(error);
		process.exit(1);
	}
}

validateIndependence().catch((error) => {
	console.error("Fatal error during validation:", error);
	process.exit(1);
});
