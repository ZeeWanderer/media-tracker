import assert from "node:assert/strict";
import {cp, mkdtemp, readFile, readdir, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {
	decodeMediaSnapshot,
	normalizeMediaFrontmatter,
} from "../src/domain/media/frontmatter.ts";
import {mapMediaSnapshotToRecord} from "../src/domain/media/readModel.ts";

const requireFromProject = createRequire(path.resolve("package.json"));
const yamlPackage = "yaml";
const {parse, stringify} = requireFromProject(yamlPackage);

async function collectMarkdownFiles(root) {
	const files = [];
	for (const entry of await readdir(root, {withFileTypes: true})) {
		const entryPath = path.join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectMarkdownFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(entryPath);
		}
	}
	return files;
}

function readFrontmatter(markdown) {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	assert.ok(match, "Fixture must contain YAML frontmatter.");
	return {
		frontmatter: parse(match[1]) ?? {},
		body: markdown.slice(match[0].length),
	};
}

function mapFixture(frontmatter, filePath, vaultRoot) {
	const relativePath = path.relative(vaultRoot, filePath).split(path.sep).join("/");
	const parentPath = path.posix.dirname(relativePath);
	const {snapshot} = decodeMediaSnapshot(frontmatter);
	return mapMediaSnapshotToRecord(snapshot, {
		basename: path.posix.basename(relativePath, ".md"),
		parentName: path.posix.basename(parentPath),
		parentPath,
		baseFolder: "Media",
	});
}

test("reads and migrates a copied fixture vault without touching source fixtures", async (t) => {
	const fixtureRoot = path.resolve("tests/fixtures/vault");
	const copiedVault = await mkdtemp(path.join(tmpdir(), "media-tracker-vault-"));
	t.after(() => rm(copiedVault, {recursive: true, force: true}));
	await cp(fixtureRoot, copiedVault, {recursive: true});

	const mediaRoot = path.join(copiedVault, "Media");
	const files = await collectMarkdownFiles(mediaRoot);
	assert.equal(files.length, 4);

	const byFolder = new Map();
	for (const file of files) {
		const markdown = await readFile(file, "utf8");
		const parsed = readFrontmatter(markdown);
		byFolder.set(path.basename(path.dirname(file)), {file, markdown, ...parsed});
	}

	const legacy = byFolder.get("Legacy Show");
	const legacyDecoded = decodeMediaSnapshot(legacy.frontmatter);
	assert.equal(legacyDecoded.fromVersion, 3);
	assert.deepEqual(legacyDecoded.appliedVersions, [4, 5]);
	assert.equal(legacyDecoded.snapshot.anilistId, 123);
	assert.equal(mapFixture(legacy.frontmatter, legacy.file, copiedVault).title, "Legacy Show");
	assert.equal(mapFixture(legacy.frontmatter, legacy.file, copiedVault).progress, "S2E7");

	const legacyNormalization = normalizeMediaFrontmatter(legacy.frontmatter);
	assert.equal(legacyNormalization.changed, true);
	await writeFile(
		legacy.file,
		`---\n${stringify(legacy.frontmatter)}---\n${legacy.body}`,
		"utf8",
	);
	const migratedLegacy = readFrontmatter(await readFile(legacy.file, "utf8")).frontmatter;
	assert.equal(decodeMediaSnapshot(migratedLegacy).fromVersion, 5);
	assert.equal(mapFixture(migratedLegacy, legacy.file, copiedVault).title, "Legacy Show");

	const malformed = byFolder.get("Malformed Entry");
	const malformedDecoded = decodeMediaSnapshot(malformed.frontmatter);
	assert.equal(malformedDecoded.snapshot.type, undefined);
	assert.equal(malformedDecoded.snapshot.status, "planned");
	assert.ok(malformedDecoded.issues.some((issue) => issue.field === "type" && issue.level === "error"));
	assert.equal(mapFixture(malformed.frontmatter, malformed.file, copiedVault), null);

	const current = byFolder.get("Current Manga");
	const currentRecord = mapFixture(current.frontmatter, current.file, copiedVault);
	assert.equal(currentRecord.title, "Current Manga");
	assert.deepEqual(currentRecord.alternateTitles, ["Current Manga Alias"]);
	assert.equal(normalizeMediaFrontmatter(current.frontmatter).changed, false);

	const future = byFolder.get("Future Note");
	const futureBefore = structuredClone(future.frontmatter);
	const futureNormalization = normalizeMediaFrontmatter(future.frontmatter);
	assert.equal(futureNormalization.unsupportedSourceVersion, 99);
	assert.equal(futureNormalization.changed, false);
	assert.deepEqual(future.frontmatter, futureBefore);

	assert.equal((await collectMarkdownFiles(copiedVault)).length, 5);
	assert.equal(await readFile(path.join(fixtureRoot, "Media/Legacy Show/anime.md"), "utf8"), legacy.markdown);
});
