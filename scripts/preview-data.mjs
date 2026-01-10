import {fileURLToPath, pathToFileURL} from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const MEDIA_TYPES = ["novel", "series", "movie"];
const MEDIA_STATUSES = ["planned", "active", "completed", "on-hold", "dropped"];

function normalizeString(value) {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length ? trimmed : undefined;
	}
	if (typeof value === "number") {
		return `${value}`;
	}
	return undefined;
}

function normalizeType(value) {
	const raw = normalizeString(value);
	if (!raw) {
		return null;
	}
	const lowered = raw.toLowerCase();
	return MEDIA_TYPES.find((type) => type === lowered) ?? null;
}

function normalizeStatus(value) {
	const raw = normalizeString(value)?.toLowerCase();
	return MEDIA_STATUSES.find((status) => status === raw) ?? "planned";
}

function normalizeLink(value) {
	const raw = normalizeString(value);
	if (!raw) {
		return null;
	}
	if (raw.startsWith("http://") || raw.startsWith("https://")) {
		return raw;
	}
	if (raw.startsWith("tt")) {
		return `https://www.imdb.com/title/${raw}/`;
	}
	return raw;
}

function getTitleSortKey(title) {
	const trimmed = title.trim();
	return trimmed.replace(/^the\s+/i, "");
}

function buildProgress(type, frontmatter) {
	if (type === "novel") {
		const label = normalizeString(frontmatter.progressLabel);
		if (label) {
			return label;
		}
		const progress = normalizeString(frontmatter.progress ?? frontmatter.chapter);
		const unit = normalizeString(frontmatter.progressUnit) ?? "ch";
		return progress ? `${unit} ${progress}` : undefined;
	}
	if (type === "series") {
		const season = normalizeString(frontmatter.season);
		const episode = normalizeString(frontmatter.episode);
		if (season || episode) {
			return `S${season ?? "?"}E${episode ?? "?"}`;
		}
		return undefined;
	}
	if (type === "movie") {
		const year = normalizeString(frontmatter.year);
		return year ? `Year ${year}` : undefined;
	}
	return undefined;
}

function parseValue(raw) {
	const trimmed = raw.trim();
	if (!trimmed) {
		return "";
	}
	if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
		return trimmed.slice(1, -1);
	}
	if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseFrontmatter(content) {
	const match = content.match(/^---\s*([\s\S]*?)\s*---/);
	if (!match) {
		return {};
	}
	const lines = match[1].split(/\r?\n/);
	const frontmatter = {};
	const links = {};
	let inLinks = false;
	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}
		if (inLinks && !/^\s+/.test(line)) {
			inLinks = false;
		}
		if (inLinks) {
			const matchLine = line.match(/^\s+([^:]+):\s*(.*)$/);
			if (matchLine) {
				const key = matchLine[1].trim();
				const value = parseValue(matchLine[2]);
				if (value) {
					links[key] = value;
				}
			}
			continue;
		}

		const matchLine = line.match(/^([^:]+):\s*(.*)$/);
		if (!matchLine) {
			continue;
		}
		const key = matchLine[1].trim();
		const value = parseValue(matchLine[2]);
		if (key === "links") {
			inLinks = true;
			continue;
		}
		frontmatter[key] = value;
	}
	if (Object.keys(links).length) {
		frontmatter.links = links;
	}
	return frontmatter;
}

function extractExtraLinks(frontmatter) {
	const raw = frontmatter.links;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return [];
	}
	return Object.entries(raw)
		.map(([label, value]) => {
			const url = normalizeLink(value);
			return url ? {label, url} : null;
		})
		.filter((entry) => entry !== null);
}

function parseMediaItem(filePath, frontmatter) {
	const type = normalizeType(frontmatter.type ?? frontmatter.media);
	if (!type) {
		return null;
	}
	const title = normalizeString(frontmatter.title) ?? path.basename(filePath, path.extname(filePath));
	const status = normalizeStatus(frontmatter.status);
	const author = normalizeString(frontmatter.author);
	const season = normalizeString(frontmatter.season);
	const episode = normalizeString(frontmatter.episode);
	const year = normalizeString(frontmatter.year);
	const tmdbId = normalizeString(frontmatter.tmdbId);
	const tmdbLastChecked = normalizeString(frontmatter.tmdbLastChecked);
	const tmdbLatestSeason = normalizeString(frontmatter.tmdbLatestSeason);
	const tmdbLatestEpisode = normalizeString(frontmatter.tmdbLatestEpisode);
	const tmdbLatestAirDate = normalizeString(frontmatter.tmdbLatestAirDate);
	const tmdbLatestName = normalizeString(frontmatter.tmdbLatestName);

	return {
		title,
		type,
		status,
		author,
		progress: buildProgress(type, frontmatter),
		season: season ? Number(season) : undefined,
		episode: episode ? Number(episode) : undefined,
		year: year ? Number(year) : undefined,
		links: {
			patreon: normalizeLink(frontmatter.patreon),
			kemono: normalizeLink(frontmatter.kemono),
			royalroad: normalizeLink(frontmatter.royalroad ?? frontmatter.royalRoad),
			imdb: normalizeLink(frontmatter.imdb ?? frontmatter.imdbId),
			hdrezka: normalizeLink(frontmatter.hdrezka),
		},
		extraLinks: extractExtraLinks(frontmatter),
		tmdbId: tmdbId ? Number(tmdbId) : undefined,
		tmdbLastChecked: tmdbLastChecked ? Number(tmdbLastChecked) : undefined,
		tmdbLatestSeason: tmdbLatestSeason ? Number(tmdbLatestSeason) : undefined,
		tmdbLatestEpisode: tmdbLatestEpisode ? Number(tmdbLatestEpisode) : undefined,
		tmdbLatestAirDate: tmdbLatestAirDate ?? undefined,
		tmdbLatestName: tmdbLatestName ?? undefined,
	};
}

async function loadMediaItems(mediaDir) {
	let entries;
	try {
		entries = await fs.readdir(mediaDir, {withFileTypes: true});
	} catch (error) {
		return [];
	}
	const items = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) {
			continue;
		}
		const filePath = path.join(mediaDir, entry.name);
		const content = await fs.readFile(filePath, "utf8");
		const frontmatter = parseFrontmatter(content);
		const item = parseMediaItem(filePath, frontmatter);
		if (item) {
			items.push(item);
		}
	}
	items.sort((a, b) => getTitleSortKey(a.title).localeCompare(getTitleSortKey(b.title)));
	return items;
}

export async function generatePreviewData() {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const defaultVault = path.resolve(root, "..", "MediaTracker");
	const vaultPath = process.env.MEDIA_TRACKER_VAULT ?? defaultVault;
	const mediaFolder = process.env.MEDIA_TRACKER_MEDIA_FOLDER ?? "Media";
	const mediaDir = path.join(vaultPath, mediaFolder);
	const maxItems = Number.parseInt(process.env.MEDIA_TRACKER_PREVIEW_LIMIT ?? "48", 10);
	const items = await loadMediaItems(mediaDir);
	const limited = Number.isFinite(maxItems) && maxItems > 0 ? items.slice(0, maxItems) : items;
	const dataPath = path.join(root, "preview", "data.js");
	const payload = {items: limited};
	const content = `window.MEDIA_TRACKER_PREVIEW_DATA = ${JSON.stringify(payload, null, 2)};`;
	await fs.writeFile(dataPath, content, "utf8");
	return {dataPath, count: limited.length, mediaDir};
}

if (import.meta.url === pathToFileURL(process.argv[1]).toString()) {
	const {count, mediaDir} = await generatePreviewData();
	console.log(`Preview data generated from ${mediaDir} (${count} items).`);
}
