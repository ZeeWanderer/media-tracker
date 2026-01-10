import {App, TFile} from "obsidian";
import {MediaItem, MediaStatus, MediaType} from "../types";
import {MediaTrackerSettings} from "../settings";
import {collectLinks, getImdbIdFromFrontmatter, getImdbIdFromLinks} from "./links";

const MEDIA_TYPES: MediaType[] = ["novel", "series", "anime", "movie"];
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
	const tmdbLatestSeasonEpisodes = normalizeString(frontmatter.tmdbLatestSeasonEpisodes);
	const tmdbSeasonEpisodes = parseSeasonEpisodes(frontmatter.tmdbSeasonEpisodes);
	const tmdbLatestAirDate = normalizeString(frontmatter.tmdbLatestAirDate);
	const tmdbLatestName = normalizeString(frontmatter.tmdbLatestName);
	const links = collectLinks(frontmatter);
	const imdbId = getImdbIdFromFrontmatter(frontmatter) ?? getImdbIdFromLinks(links);

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
		links,
		imdbId,
		tmdbId: tmdbId ? Number(tmdbId) : undefined,
		tmdbLastChecked: tmdbLastChecked ? Number(tmdbLastChecked) : undefined,
		tmdbLatestSeason: tmdbLatestSeason ? Number(tmdbLatestSeason) : undefined,
		tmdbLatestEpisode: tmdbLatestEpisode ? Number(tmdbLatestEpisode) : undefined,
		tmdbLatestSeasonEpisodes: tmdbLatestSeasonEpisodes ? Number(tmdbLatestSeasonEpisodes) : undefined,
		tmdbSeasonEpisodes,
		tmdbLatestAirDate: tmdbLatestAirDate ?? undefined,
		tmdbLatestName: tmdbLatestName ?? undefined,
	};
}

function parseSeasonEpisodes(value: unknown): Record<string, number> | undefined {
	if (!value) {
		return undefined;
	}
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as Record<string, number>;
			return sanitizeSeasonEpisodes(parsed);
		} catch {
			return undefined;
		}
	}
	if (typeof value === "object") {
		return sanitizeSeasonEpisodes(value as Record<string, number>);
	}
	return undefined;
}

function sanitizeSeasonEpisodes(map: Record<string, number> | null): Record<string, number> | undefined {
	if (!map) {
		return undefined;
	}
	const entries = Object.entries(map)
		.filter(([key, val]) => Number.isFinite(Number(key)) && Number.isFinite(Number(val)));
	if (!entries.length) {
		return undefined;
	}
	return Object.fromEntries(entries.map(([key, val]) => [String(Number(key)), Number(val)]));
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
	anime: "Anime",
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
