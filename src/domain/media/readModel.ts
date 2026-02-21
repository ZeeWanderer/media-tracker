import {App, TFile} from "obsidian";
import {MediaItem, MediaStatus, MediaType} from "../../types";
import {MediaTrackerSettings} from "../../settings";
import {MEDIA_STATUSES, MEDIA_TYPES, NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES} from "./config";
import {collectLinks, getAnilistIdFromFrontmatter, getAnilistIdFromLinks, getImdbIdFromFrontmatter, getImdbIdFromLinks} from "./links";

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TYPE_FILE_BASENAME_REGEX = new RegExp(
	`^(?:${MEDIA_TYPES.map((type) => escapeRegex(type)).join("|")})(?:-\\d+)?$`,
	"i",
);

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
	if (NOVEL_PROGRESS_TYPES.has(type)) {
		const label = normalizeString(frontmatter.progressLabel);
		if (label) {
			return label;
		}
		const progress = normalizeString(frontmatter.progress ?? frontmatter.chapter);
		if (!progress) {
			return undefined;
		}
		// Keep explicit textual progress untouched; only prepend unit for pure numeric values.
		if (!/^\d+(?:\.\d+)?$/.test(progress)) {
			return progress;
		}
		const unit = normalizeString(frontmatter.progressUnit) ?? "ch";
		return `${unit} ${progress}`;
	}
	if (SEASON_EPISODE_TYPES.has(type)) {
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

function isTypeFileBasename(value: string): boolean {
	return TYPE_FILE_BASENAME_REGEX.test(value.trim());
}

function resolveFallbackTitle(file: TFile, baseFolder: string): string {
	const parent = file.parent;
	if (parent
		&& parent.path.startsWith(`${baseFolder}/`)
		&& parent.path !== baseFolder
		&& isTypeFileBasename(file.basename)) {
		return parent.name;
	}
	return file.basename;
}

function parseMediaItem(file: TFile, app: App, baseFolder: string): MediaItem | null {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter ?? {};
	const type = normalizeType(frontmatter.type ?? frontmatter.media);
	if (!type) {
		return null;
	}

	const title = normalizeString(frontmatter.title) ?? resolveFallbackTitle(file, baseFolder);
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
	const anilistId = getAnilistIdFromFrontmatter(frontmatter);
	const anilistIds = Array.isArray(frontmatter.anilistIds)
		? frontmatter.anilistIds
			.map((entry) => (typeof entry === "number" ? entry : Number(entry)))
			.filter((entry) => Number.isFinite(entry))
		: undefined;
	const anilistLastChecked = normalizeString(frontmatter.anilistLastChecked);
	const anilistLatestEpisode = normalizeString(frontmatter.anilistLatestEpisode);
	const anilistNextEpisode = normalizeString(frontmatter.anilistNextEpisode);
	const anilistNextAiringAt = normalizeString(frontmatter.anilistNextAiringAt);
	const anilistChapters = normalizeString(frontmatter.anilistChapters);
	const anilistVolumes = normalizeString(frontmatter.anilistVolumes);
	const anilistSeason = normalizeString(frontmatter.anilistSeason);
	const anilistSeasonTotal = normalizeString(frontmatter.anilistSeasonTotal);
	const anilistSeasonEpisodes = parseSeasonEpisodes(frontmatter.anilistSeasonEpisodes);
	const links = collectLinks(frontmatter);
	const imdbId = getImdbIdFromFrontmatter(frontmatter) ?? getImdbIdFromLinks(links);
	const fallbackAnilistId = getAnilistIdFromLinks(links);

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
		anilistId: anilistId ?? fallbackAnilistId,
		anilistIds,
		tmdbId: tmdbId ? Number(tmdbId) : undefined,
		tmdbLastChecked: tmdbLastChecked ? Number(tmdbLastChecked) : undefined,
		tmdbLatestSeason: tmdbLatestSeason ? Number(tmdbLatestSeason) : undefined,
		tmdbLatestEpisode: tmdbLatestEpisode ? Number(tmdbLatestEpisode) : undefined,
		tmdbLatestSeasonEpisodes: tmdbLatestSeasonEpisodes ? Number(tmdbLatestSeasonEpisodes) : undefined,
		tmdbSeasonEpisodes,
		tmdbLatestAirDate: tmdbLatestAirDate ?? undefined,
		tmdbLatestName: tmdbLatestName ?? undefined,
		anilistLastChecked: anilistLastChecked ? Number(anilistLastChecked) : undefined,
		anilistLatestEpisode: anilistLatestEpisode ? Number(anilistLatestEpisode) : undefined,
		anilistNextEpisode: anilistNextEpisode ? Number(anilistNextEpisode) : undefined,
		anilistNextAiringAt: anilistNextAiringAt ? Number(anilistNextAiringAt) : undefined,
		anilistChapters: anilistChapters ? Number(anilistChapters) : undefined,
		anilistVolumes: anilistVolumes ? Number(anilistVolumes) : undefined,
		anilistSeason: anilistSeason ? Number(anilistSeason) : undefined,
		anilistSeasonTotal: anilistSeasonTotal ? Number(anilistSeasonTotal) : undefined,
		anilistSeasonEpisodes,
	};
}

export function getTitleSortKey(title: string): string {
	const trimmed = title.trim();
	return trimmed.replace(/^the\s+/i, "");
}

export function listMediaItems(app: App, settings: MediaTrackerSettings): MediaItem[] {
	const baseFolder = normalizeString(settings.mediaFolder) ?? "Media";
	const files = app.vault.getFiles().filter((file) => file.path.startsWith(`${baseFolder}/`));
	const items = files
		.map((file) => parseMediaItem(file, app, baseFolder))
		.filter((item): item is MediaItem => item !== null);

	items.sort((a, b) => getTitleSortKey(a.title).localeCompare(getTitleSortKey(b.title)));
	return items;
}
