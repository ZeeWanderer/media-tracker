import {spawnSync} from "node:child_process";
import {mkdtemp, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";

async function collectTestFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, {withFileTypes: true})) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectTestFiles(entryPath));
		} else if (entry.name.endsWith(".test.mjs")) {
			files.push(entryPath);
		}
	}
	return files;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(root, "tests");
const obsidianMockPath = path.join(testRoot, "support", "obsidianMock.mjs");
const testFiles = await collectTestFiles(testRoot);
if (!testFiles.length) {
	throw new Error("No test files found.");
}

const outputDirectory = await mkdtemp(path.join(tmpdir(), "media-tracker-tests-"));
try {
	await build({
		entryPoints: testFiles,
		outbase: testRoot,
		outdir: outputDirectory,
		entryNames: "[dir]/[name]",
		outExtension: {".js": ".mjs"},
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node20",
		sourcemap: "inline",
		logLevel: "silent",
		plugins: [
			{
				name: "obsidian-test-mock",
				setup(buildContext) {
					buildContext.onResolve({filter: /^obsidian$/}, () => ({path: obsidianMockPath}));
				},
			},
		],
	});

	const bundledTests = testFiles.map((file) => path.join(outputDirectory, path.relative(testRoot, file)));
	let failed = false;
	for (const bundledTest of bundledTests) {
		const result = spawnSync(process.execPath, [bundledTest], {stdio: "inherit", cwd: root});
		if (result.error) {
			throw result.error;
		}
		if (result.status !== 0) {
			failed = true;
		}
	}
	process.exitCode = failed ? 1 : 0;
} finally {
	await rm(outputDirectory, {recursive: true, force: true});
}
