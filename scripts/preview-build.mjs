import {fileURLToPath} from "node:url";
import path from "node:path";
import {build} from "esbuild";

export async function buildPreview() {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const entry = path.join(root, "src", "preview", "preview.ts");
	const outfile = path.join(root, "preview", "preview.js");

	await build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		format: "iife",
		platform: "browser",
		target: "es2020",
		sourcemap: false,
		logLevel: "silent",
	});
}

if (import.meta.url === new URL(process.argv[1], "file://").toString()) {
	await buildPreview();
	console.log("Preview bundle built.");
}
