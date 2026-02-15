import * as esbuild from "esbuild";

/**
 * Build-time constants plugin
 * Injects version, build time, and environment information into the build
 */
const versionPlugin: esbuild.Plugin = {
	name: "version-injection",
	setup(build) {
		build.onLoad({ filter: /version\.ts$/ }, async () => {
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

	try {
		const _result = await esbuild.build({
			entryPoints: ["./src/cli/index.ts"],
			bundle: true,
			platform: "node",
			target: "node22",
			format: "esm",
			outfile: isProduction ? "./dist/yapyap.js" : "./dist/yapyap-dev.js",
			minify: isProduction,
			sourcemap: isProduction ? "linked" : "inline",
			define: {
				"process.env.APP_VERSION": JSON.stringify(version),
				"process.env.BUILD_TIME": JSON.stringify(new Date().toISOString()),
				"process.env.NODE_ENV": JSON.stringify(
					process.env.NODE_ENV || "development",
				),
			},
			plugins: [versionPlugin],
			banner: {
				js: "#!/usr/bin/env node",
			},
		});

		console.log("✓ Build successful!");
		console.log(
			`  Output: ${isProduction ? "./dist/yapyap.js" : "./dist/yapyap-dev.js"}`,
		);

		if (isProduction) {
			console.log("\nProduction build ready!");
			console.log("Run with: node ./dist/yapyap.js [command] [options]");
		} else {
			console.log("\nDevelopment build ready!");
			console.log("Run with: node ./dist/yapyap-dev.js [command] [options]");
		}
	} catch (error) {
		console.error("Build failed!", error);
		process.exit(1);
	}
}

build();
