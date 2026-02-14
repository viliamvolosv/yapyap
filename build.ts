import type { BunPlugin } from "bun";

/**
 * Build-time constants plugin
 * Injects version, build time, and environment information into the compiled binary
 */
const versionPlugin: BunPlugin = {
	name: "version-injection",
	setup(build) {
		build.onLoad({ filter: /version\.ts/ }, async () => {
			return {
				contents: `export const APP_VERSION = "${process.env.npm_package_version || "0.0.0"}";\nexport const BUILD_TIME = "${new Date().toISOString()}";\nexport const BUILD_ENV = "${process.env.NODE_ENV || "development"}";\n`,
				loader: "ts",
			};
		});
	},
};

/**
 * Main build function with production optimizations
 */
async function build() {
	const isProduction = process.env.NODE_ENV === "production";
	const version = process.env.npm_package_version || "0.0.0";

	console.log(`Building YapYap Messenger v${version}...`);
	console.log(`Environment: ${isProduction ? "production" : "development"}`);

	const result = await Bun.build({
		entrypoints: ["./src/cli/index.ts"],
		compile: {
			outfile: isProduction ? "./dist/yapyap" : "./dist/yapyap-dev",
			// Embed runtime arguments for production
			execArgv: isProduction ? ["--smol"] : [],
			// Enable .env and bunfig.toml loading at runtime (optional)
			autoloadDotenv: true,
			autoloadBunfig: true,
		},
		// Production optimizations
		minify: isProduction,
		sourcemap: isProduction ? "linked" : "inline",
		bytecode: isProduction,
		// Build-time constants
		define: {
			APP_VERSION: JSON.stringify(version),
			BUILD_TIME: JSON.stringify(new Date().toISOString()),
			NODE_ENV: JSON.stringify(process.env.NODE_ENV || "development"),
		},
		// Plugins for build-time transformations
		plugins: [versionPlugin],
	});

	if (result.success) {
		console.log(`✓ Build successful: ${result.outputs[0].path}`);
		console.log(
			`  Size: ${(result.outputs[0].size / 1024 / 1024).toFixed(2)} MB`,
		);

		if (isProduction) {
			console.log("\nProduction build ready!");
			console.log("Run with: ./dist/yapyap [command] [options]");
		} else {
			console.log("\nDevelopment build ready!");
			console.log("Run with: bun run dist/yapyap-dev [command] [options]");
		}
	} else {
		console.error("Build failed!");
		for (const error of result.logs) {
			console.error(error);
		}
		process.exit(1);
	}
}

await build();
