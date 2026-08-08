import type {AniListMedia} from "./types";

const ALWAYS_SEASON_ANIME_FORMATS = new Set(["TV", "TV_SHORT"]);
const CONDITIONAL_SEASON_ANIME_FORMATS = new Set(["ONA", "OVA", "SPECIAL"]);
const EXCLUDED_CHAIN_BRIDGE_FORMATS = new Set(["MUSIC"]);
const SPLIT_COUR_MARKER_REGEX = /\b(?:part|cour)\s*(?:\d+|[ivxlcdm]+)\b/i;

export type CollapsedSeasonMetadata = {
	seasonCount: number;
	seasonNumberById: Map<number, number>;
	seasonEpisodes: Map<number, number>;
};

function getMediaTitles(media: AniListMedia): string[] {
	return [
		media.title?.english ?? undefined,
		media.title?.romaji ?? undefined,
		media.title?.native ?? undefined,
	]
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function isSplitCourEntry(media: AniListMedia | undefined): boolean {
	return media !== undefined
		&& getMediaTitles(media).some((title) => SPLIT_COUR_MARKER_REGEX.test(title));
}

function isNamedStandaloneEntry(media: AniListMedia): boolean {
	const titles = getMediaTitles(media);
	if (titles.some((title) => SPLIT_COUR_MARKER_REGEX.test(title))) {
		return false;
	}
	return titles.some((title) => /:|\uFF1A/.test(title));
}

export function isSeasonCandidate(media: AniListMedia): boolean {
	if (media.type !== "ANIME") {
		return false;
	}
	if (!media.format) {
		return true;
	}
	if (ALWAYS_SEASON_ANIME_FORMATS.has(media.format)) {
		return true;
	}
	if (!CONDITIONAL_SEASON_ANIME_FORMATS.has(media.format)) {
		return false;
	}
	return !isNamedStandaloneEntry(media);
}

export function isChainBridgeCandidate(media: AniListMedia): boolean {
	if (media.type !== "ANIME") {
		return false;
	}
	return !media.format || !EXCLUDED_CHAIN_BRIDGE_FORMATS.has(media.format);
}

export function buildDirectChainFromMedia(media: AniListMedia): AniListMedia[] {
	if (!isSeasonCandidate(media)) {
		return [media];
	}
	const edges = media.relations?.edges ?? [];
	let prequel: AniListMedia | null = null;
	let sequel: AniListMedia | null = null;
	for (const edge of edges) {
		const related = edge.node;
		if (!related || !isSeasonCandidate(related)) {
			continue;
		}
		if (edge.relationType === "PREQUEL") {
			prequel = related;
		} else if (edge.relationType === "SEQUEL") {
			sequel = related;
		}
	}
	return [prequel, media, sequel].filter((entry): entry is AniListMedia => entry !== null);
}

export function sanitizeKnownSeasonIds(values?: number[]): number[] {
	const ids: number[] = [];
	for (const value of values ?? []) {
		if (!Number.isFinite(value)) {
			continue;
		}
		const normalized = Math.floor(value);
		if (normalized > 0 && !ids.includes(normalized)) {
			ids.push(normalized);
		}
	}
	return ids;
}

export function sanitizeKnownSeasonEpisodes(values?: Record<string, number>): Map<number, number> {
	const map = new Map<number, number>();
	for (const [seasonKey, episodeCount] of Object.entries(values ?? {})) {
		const seasonNumber = Number.parseInt(seasonKey, 10);
		if (Number.isFinite(seasonNumber) && seasonNumber > 0
			&& Number.isFinite(episodeCount) && episodeCount > 0) {
			map.set(seasonNumber, Math.floor(episodeCount));
		}
	}
	return map;
}

export function toSeasonEpisodesRecord(map: Map<number, number>): Record<string, number> | undefined {
	if (!map.size) {
		return undefined;
	}
	return Object.fromEntries(
		Array.from(map.entries())
			.sort((a, b) => a[0] - b[0])
			.map(([seasonNumber, episodeCount]) => [String(seasonNumber), episodeCount] as const),
	);
}

export function collapseSeasonMetadata(
	seasonIds: number[],
	seasonById: Map<number, AniListMedia>,
	rawSeasonEpisodes: Map<number, number>,
): CollapsedSeasonMetadata {
	const seasonNumberById = new Map<number, number>();
	const seasonEpisodes = new Map<number, number>();
	let seasonCount = 0;

	for (let rawIndex = 0; rawIndex < seasonIds.length; rawIndex += 1) {
		const seasonId = seasonIds[rawIndex];
		if (!seasonId) {
			continue;
		}
		const media = seasonById.get(seasonId);
		if (!(seasonCount > 0 && isSplitCourEntry(media))) {
			seasonCount += 1;
		}
		const displaySeason = Math.max(1, seasonCount);
		seasonNumberById.set(seasonId, displaySeason);

		const rawEpisodeCount = rawSeasonEpisodes.get(rawIndex + 1);
		const mediaEpisodeCount = typeof media?.episodes === "number" && media.episodes > 0
			? Math.floor(media.episodes)
			: undefined;
		const episodeCount = mediaEpisodeCount ?? rawEpisodeCount;
		if (episodeCount !== undefined && episodeCount > 0) {
			seasonEpisodes.set(displaySeason, (seasonEpisodes.get(displaySeason) ?? 0) + episodeCount);
		}
	}

	return {seasonCount, seasonNumberById, seasonEpisodes};
}
