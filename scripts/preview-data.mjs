import {fileURLToPath, pathToFileURL} from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const MEDIA_STATUSES = ["planned", "active", "completed", "on-hold", "dropped"];
const LEGACY_LINK_FIELDS = ["patreon", "kemono", "royalroad", "royalRoad", "imdb", "hdrezka"];

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
	return raw.toLowerCase();
}

function normalizeStatus(value) {
	const raw = normalizeString(value)?.toLowerCase();
	return MEDIA_STATUSES.find((status) => status === raw) ?? "planned";
}

function extractImdbId(value) {
	const match = value.match(/tt\d{7,}/i);
	if (!match) {
		return null;
	}
	return match[0].toLowerCase();
}

function normalizeStoredLink(value) {
	const raw = normalizeString(value);
	if (!raw) {
		return null;
	}
	const imdbId = extractImdbId(raw);
	if (imdbId) {
		return imdbId;
	}
	return raw;
}

function normalizeLinks(values) {
	const links = [];
	for (const value of values) {
		const normalized = normalizeStoredLink(value);
		if (!normalized) {
			continue;
		}
		if (!links.includes(normalized)) {
			links.push(normalized);
		}
	}
	return links;
}

function getImdbIdFromFrontmatter(frontmatter) {
	const raw = typeof frontmatter.imdbId === "string"
		? frontmatter.imdbId
		: typeof frontmatter.imdb === "string"
			? frontmatter.imdb
			: undefined;
	if (!raw) {
		return undefined;
	}
	return extractImdbId(raw) ?? raw;
}

function collectLinks(frontmatter) {
	const links = [];
	const rawLinks = frontmatter.links;
	if (Array.isArray(rawLinks)) {
		for (const entry of rawLinks) {
			if (typeof entry === "string") {
				links.push(entry);
			}
		}
	} else if (rawLinks && typeof rawLinks === "object") {
		for (const value of Object.values(rawLinks)) {
			if (typeof value === "string") {
				links.push(value);
			}
		}
	}
	for (const key of LEGACY_LINK_FIELDS) {
		const value = frontmatter[key];
		if (typeof value === "string") {
			links.push(value);
		}
	}
	const imdbId = getImdbIdFromFrontmatter(frontmatter);
	if (imdbId) {
		links.push(imdbId);
	}
	return normalizeLinks(links);
}

function getTitleSortKey(title) {
	const trimmed = title.trim();
	return trimmed.replace(/^the\s+/i, "");
}

function buildProgress(type, frontmatter) {
	if (type === "novel" || type === "manga") {
		const label = normalizeString(frontmatter.progressLabel);
		if (label) {
			return label;
		}
		const progress = normalizeString(frontmatter.progress ?? frontmatter.chapter);
		const unit = normalizeString(frontmatter.progressUnit) ?? "ch";
		return progress ? `${unit} ${progress}` : undefined;
	}
if (type === "series" || type === "anime") {
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

function buildRepeatProgress(type, frontmatter) {
	return buildProgress(type, {
		progress: frontmatter.repeatProgress,
		progressLabel: frontmatter.repeatProgressLabel,
		progressUnit: frontmatter.repeatProgressUnit,
		season: frontmatter.repeatSeason,
		episode: frontmatter.repeatEpisode,
	});
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
	const links = [];
	let inLinks = false;
	for (const line of lines) {
		if (!line.trim()) {
			continue;
		}
		if (inLinks && !/^\s+/.test(line)) {
			inLinks = false;
		}
		if (inLinks) {
			const listMatch = line.match(/^\s+-\s*(.*)$/);
			if (listMatch) {
				const value = parseValue(listMatch[1]);
				if (value) {
					links.push(value);
				}
				continue;
			}
			const mapMatch = line.match(/^\s+[^:]+:\s*(.*)$/);
			if (mapMatch) {
				const value = parseValue(mapMatch[1]);
				if (value) {
					links.push(value);
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
	if (links.length) {
		frontmatter.links = links;
	}
	return frontmatter;
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
	const anilistId = normalizeString(frontmatter.anilistId ?? frontmatter.anilist);
	const anilistLatestEpisode = normalizeString(frontmatter.anilistLatestEpisode);
	const anilistNextEpisode = normalizeString(frontmatter.anilistNextEpisode);
	const anilistNextAiringAt = normalizeString(frontmatter.anilistNextAiringAt);
	const anilistChapters = normalizeString(frontmatter.anilistChapters);
	const anilistVolumes = normalizeString(frontmatter.anilistVolumes);
	const anilistSeason = normalizeString(frontmatter.anilistSeason);
	const anilistSeasonTotal = normalizeString(frontmatter.anilistSeasonTotal);
	const anilistSeasonEpisodes = normalizeString(frontmatter.anilistSeasonEpisodes);
	const imdbId = getImdbIdFromFrontmatter(frontmatter);

	return {
		title,
		type,
		status,
		author,
		progress: buildProgress(type, frontmatter),
		progressRaw: normalizeString(frontmatter.progress),
		progressLabel: normalizeString(frontmatter.progressLabel),
		progressUnit: normalizeString(frontmatter.progressUnit),
		season: season ? Number(season) : undefined,
		episode: episode ? Number(episode) : undefined,
		repeatProgress: buildRepeatProgress(type, frontmatter),
		repeatProgressRaw: normalizeString(frontmatter.repeatProgress),
		repeatProgressLabel: normalizeString(frontmatter.repeatProgressLabel),
		repeatProgressUnit: normalizeString(frontmatter.repeatProgressUnit),
		repeatSeason: normalizeString(frontmatter.repeatSeason) !== undefined
			? Number(frontmatter.repeatSeason)
			: undefined,
		repeatEpisode: normalizeString(frontmatter.repeatEpisode) !== undefined
			? Number(frontmatter.repeatEpisode)
			: undefined,
		year: year ? Number(year) : undefined,
		links: collectLinks(frontmatter),
		imdbId,
		tmdbId: tmdbId ? Number(tmdbId) : undefined,
		tmdbLastChecked: tmdbLastChecked ? Number(tmdbLastChecked) : undefined,
		tmdbLatestSeason: tmdbLatestSeason ? Number(tmdbLatestSeason) : undefined,
		tmdbLatestEpisode: tmdbLatestEpisode ? Number(tmdbLatestEpisode) : undefined,
		tmdbLatestAirDate: tmdbLatestAirDate ?? undefined,
		tmdbLatestName: tmdbLatestName ?? undefined,
		anilistId: anilistId ? Number(anilistId) : undefined,
		anilistLatestEpisode: anilistLatestEpisode ? Number(anilistLatestEpisode) : undefined,
		anilistNextEpisode: anilistNextEpisode ? Number(anilistNextEpisode) : undefined,
		anilistNextAiringAt: anilistNextAiringAt ? Number(anilistNextAiringAt) : undefined,
		anilistChapters: anilistChapters ? Number(anilistChapters) : undefined,
		anilistVolumes: anilistVolumes ? Number(anilistVolumes) : undefined,
		anilistSeason: anilistSeason ? Number(anilistSeason) : undefined,
		anilistSeasonTotal: anilistSeasonTotal ? Number(anilistSeasonTotal) : undefined,
		anilistSeasonEpisodes: anilistSeasonEpisodes ? JSON.parse(anilistSeasonEpisodes) : undefined,
	};
}

function buildAnnouncedSeasonPreviewItem() {
	return {
		title: "Dept Q (Announced season)",
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
	return {dataPath, count: limited.length, mediaDir};
}

if (import.meta.url === pathToFileURL(process.argv[1]).toString()) {
	const {count, mediaDir} = await generatePreviewData();
	console.log(`Preview data generated from ${mediaDir} (${count} items).`);
}
