import {fileURLToPath, pathToFileURL} from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import {createJiti} from "jiti";
import {parse as parseYaml} from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, {fsCache: false});
const {decodeMediaSnapshot} = await jiti.import(path.join(root, "src/domain/media/frontmatter.ts"));
const {getTitleSortKey, mapMediaSnapshotToRecord} = await jiti.import(path.join(root, "src/domain/media/readModel.ts"));

function parseFrontmatter(content) {
	const match = content.match(/^---\s*([\s\S]*?)\s*---/);
	if (!match?.[1]) {
		return {};
	}
	try {
		const parsed = parseYaml(match[1]);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function parseMediaRecord(filePath, mediaDir, frontmatter) {
	const {snapshot} = decodeMediaSnapshot(frontmatter);
	const parentPath = path.dirname(filePath);
	return mapMediaSnapshotToRecord(snapshot, {
		basename: path.basename(filePath, path.extname(filePath)),
		parentName: path.basename(parentPath),
		parentPath,
		baseFolder: mediaDir,
	});
}

function buildAnnouncedSeasonPreviewItem() {
	return {
		title: "Dept Q (Announced season)",
		alternateTitles: [],
		type: "series",
		status: "active",
		season: 1,
		episode: 9,
		progress: "S1E9",
		links: [],
		tmdbLatestSeason: 1,
		tmdbLatestEpisode: 9,
		tmdbLatestAirDate: "2025-02-14",
		tmdbLatestName: "Episode 9",
		tmdbSeasonEpisodes: {
			"1": 9,
			"2": 0,
		},
	};
}

function buildRepeatingPreviewItem() {
	return {
		title: "PSYCHO-PASS",
		alternateTitles: [],
		type: "anime",
		status: "active",
		season: 3,
		episode: 8,
		progress: "S3E8",
		repeatSeason: 1,
		repeatEpisode: 6,
		repeatProgress: "S1E6",
		links: [],
		anilistId: 13601,
		anilistLastChecked: 1,
		anilistLatestEpisode: 8,
		anilistSeason: 3,
		anilistSeasonTotal: 3,
		anilistSeasonEpisodes: {
			"1": 22,
			"2": 11,
			"3": 8,
		},
	};
}

async function collectMarkdownFiles(directory) {
	let entries;
	try {
		entries = await fs.readdir(directory, {withFileTypes: true});
	} catch {
		return [];
	}
	const files = [];
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectMarkdownFiles(entryPath));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(entryPath);
		}
	}
	return files;
}

async function loadMediaItems(mediaDir) {
	const startedAt = performance.now();
	const items = [];
	const files = await collectMarkdownFiles(mediaDir);
	let readAndParseMs = 0;
	let mapMs = 0;
	for (const filePath of files) {
		const readStartedAt = performance.now();
		const content = await fs.readFile(filePath, "utf8");
		const frontmatter = parseFrontmatter(content);
		readAndParseMs += performance.now() - readStartedAt;
		const mapStartedAt = performance.now();
		const item = parseMediaRecord(filePath, mediaDir, frontmatter);
		mapMs += performance.now() - mapStartedAt;
		if (item) {
			items.push(item);
		}
	}
	items.sort((a, b) => getTitleSortKey(a.title).localeCompare(getTitleSortKey(b.title)));
	return {
		items,
		sourceCount: files.length,
		durationMs: performance.now() - startedAt,
		readAndParseMs,
		mapMs,
	};
}

export async function generatePreviewData() {
	const defaultVault = path.resolve(root, "..", "MediaTracker");
	const vaultPath = process.env.MEDIA_TRACKER_VAULT ?? defaultVault;
	const mediaFolder = process.env.MEDIA_TRACKER_MEDIA_FOLDER ?? "Media";
	const mediaDir = path.join(vaultPath, mediaFolder);
	const maxItems = Number.parseInt(process.env.MEDIA_TRACKER_PREVIEW_LIMIT ?? "48", 10);
	const {items, sourceCount, durationMs, readAndParseMs, mapMs} = await loadMediaItems(mediaDir);
	const limited = Number.isFinite(maxItems) && maxItems > 0 ? items.slice(0, maxItems) : items;
	const previewItems = [...limited];
	const repeatingItem = buildRepeatingPreviewItem();
	if (!previewItems.some((item) => item.title === repeatingItem.title)) {
		if (Number.isFinite(maxItems) && maxItems > 0 && previewItems.length >= maxItems) {
			previewItems.pop();
		}
		previewItems.unshift(repeatingItem);
	}
	const announcedItem = buildAnnouncedSeasonPreviewItem();
	if (!previewItems.some((item) => item.title === announcedItem.title)) {
		if (Number.isFinite(maxItems) && maxItems > 0 && previewItems.length >= maxItems) {
			previewItems.pop();
		}
		previewItems.unshift(announcedItem);
	}
	const dataPath = path.join(root, "preview", "data.js");
	const payload = {items: previewItems};
	const content = `window.MEDIA_TRACKER_PREVIEW_DATA = ${JSON.stringify(payload, null, 2)};`;
	await fs.writeFile(dataPath, content, "utf8");
	return {dataPath, count: limited.length, sourceCount, durationMs, readAndParseMs, mapMs, mediaDir};
}

if (import.meta.url === pathToFileURL(process.argv[1]).toString()) {
	const {count, sourceCount, durationMs, readAndParseMs, mapMs, mediaDir} = await generatePreviewData();
	console.log(
		`Preview data generated from ${mediaDir} (${count} of ${sourceCount} files; `
		+ `scan ${durationMs.toFixed(1)} ms, read/YAML ${readAndParseMs.toFixed(1)} ms, map ${mapMs.toFixed(1)} ms).`,
	);
}
