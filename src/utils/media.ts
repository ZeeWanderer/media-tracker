import {App, TFile} from "obsidian";
import {MediaItem, MediaStatus, MediaType} from "../types";
import {MediaTrackerSettings} from "../settings";

const MEDIA_TYPES: MediaType[] = ["novel", "series", "movie"];
const MEDIA_STATUSES: MediaStatus[] = ["planned", "active", "completed", "on-hold", "dropped"];

function normalizeString(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length ? trimmed : undefined;
	}
	if (typeof value === "number") {
		return `${value}`;
	}
	return undefined;
}

function normalizeType(value: unknown): MediaType | null {
	const raw = normalizeString(value);
	if (!raw) {
		return null;
	}
	const lowered = raw.toLowerCase();
	return MEDIA_TYPES.find((type) => type === lowered) ?? null;
}

function normalizeStatus(value: unknown): MediaStatus {
	const raw = normalizeString(value)?.toLowerCase();
	return MEDIA_STATUSES.find((status) => status === raw) ?? "planned";
}

function normalizeLink(value: unknown): string | null {
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

function extractExtraLinks(frontmatter: Record<string, unknown>): Array<{label: string; url: string}> {
	const raw = frontmatter.links;
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return [];
	}
	return Object.entries(raw as Record<string, unknown>)
		.map(([label, value]) => {
			const url = normalizeLink(value);
			return url ? {label, url} : null;
		})
		.filter((entry): entry is {label: string; url: string} => entry !== null);
}

function buildProgress(type: MediaType, frontmatter: Record<string, unknown>): string | undefined {
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

function parseMediaItem(file: TFile, app: App): MediaItem | null {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter ?? {};
	const type = normalizeType(frontmatter.type ?? frontmatter.media);
	if (!type) {
		return null;
	}

	const title = normalizeString(frontmatter.title) ?? file.basename;
	const status = normalizeStatus(frontmatter.status);
	const author = normalizeString(frontmatter.author);
	const progressRaw = normalizeString(frontmatter.progress ?? frontmatter.chapter);
	const progressLabel = normalizeString(frontmatter.progressLabel);
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
		file,
		title,
		type,
		status,
		author,
		progress: buildProgress(type, frontmatter),
		progressRaw,
		progressLabel,
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

export function getMediaItems(app: App, settings: MediaTrackerSettings): MediaItem[] {
	const baseFolder = normalizeString(settings.mediaFolder) ?? "Media";
	const files = app.vault.getFiles().filter((file) => file.path.startsWith(`${baseFolder}/`));
	const items = files
		.map((file) => parseMediaItem(file, app))
		.filter((item): item is MediaItem => item !== null);

	items.sort((a, b) => getTitleSortKey(a.title).localeCompare(getTitleSortKey(b.title)));
	return items;
}

export const MEDIA_TYPE_LABELS: Record<MediaType, string> = {
	novel: "Novel",
	series: "Series",
	movie: "Movie",
};

export const MEDIA_STATUS_LABELS: Record<MediaStatus, string> = {
	planned: "Planned",
	active: "Active",
	completed: "Completed",
	"on-hold": "On hold",
	dropped: "Dropped",
};

export function getTitleSortKey(title: string): string {
	const trimmed = title.trim();
	return trimmed.replace(/^the\s+/i, "");
}
