import {fetchAniListMedia, toDelayMs} from "./client";
import {
	fetchSeasonChain,
	fetchSeasonTailFromKnown,
} from "./seasonChain";
import {
	buildDirectChainFromMedia,
	collapseSeasonMetadata,
	isSeasonCandidate,
	sanitizeKnownSeasonEpisodes,
	sanitizeKnownSeasonIds,
	toSeasonEpisodesRecord,
} from "./seasonModel";
import type {AniListLatestLookup, AniListLatestLookupRequest, AniListMedia} from "./types";

const MAX_METADATA_HYDRATION_IDS = 32;
const MAX_ANILIST_LOOKUP_CACHE_ENTRIES = 256;
const ANILIST_LOOKUP_MEDIA_CACHE = new Map<number, AniListMedia>();

function getCachedAniListMedia(id: number): AniListMedia | undefined {
	const cached = ANILIST_LOOKUP_MEDIA_CACHE.get(id);
	if (!cached) {
		return undefined;
	}
	// Keep hot entries fresh in insertion-order Map to approximate LRU.
	ANILIST_LOOKUP_MEDIA_CACHE.delete(id);
	ANILIST_LOOKUP_MEDIA_CACHE.set(id, cached);
	return cached;
}

function putCachedAniListMedia(id: number, media: AniListMedia) {
	if (ANILIST_LOOKUP_MEDIA_CACHE.has(id)) {
		ANILIST_LOOKUP_MEDIA_CACHE.delete(id);
	}
	ANILIST_LOOKUP_MEDIA_CACHE.set(id, media);
	while (ANILIST_LOOKUP_MEDIA_CACHE.size > MAX_ANILIST_LOOKUP_CACHE_ENTRIES) {
		let oldest: number | undefined;
		for (const key of ANILIST_LOOKUP_MEDIA_CACHE.keys()) {
			oldest = key;
			break;
		}
		if (oldest === undefined) {
			break;
		}
		ANILIST_LOOKUP_MEDIA_CACHE.delete(oldest);
	}
}

async function fetchAniListMediaCached(id: number, minDelayMs: number): Promise<AniListMedia | null> {
	const cached = getCachedAniListMedia(id);
	if (cached) {
		return cached;
	}
	const media = await fetchAniListMedia(id, minDelayMs);
	if (media) {
		putCachedAniListMedia(id, media);
	}
	return media;
}

export function deriveAniListLatestEpisode(media: AniListMedia): number | undefined {
	const nextEpisode = media.nextAiringEpisode?.episode;
	if (nextEpisode && nextEpisode > 1) {
		return nextEpisode - 1;
	}
	if (typeof media.episodes === "number" && media.episodes > 0) {
		return media.episodes;
	}
	return undefined;
}

async function hydrateMissingSeasonMetadata(
	seasonIds: number[],
	seasonById: Map<number, AniListMedia>,
	minDelayMs: number,
) {
	let fetched = 0;
	for (const seasonId of seasonIds) {
		if (!seasonId || seasonById.has(seasonId)) {
			continue;
		}
		if (fetched >= MAX_METADATA_HYDRATION_IDS) {
			break;
		}
		const media = await fetchAniListMediaCached(seasonId, minDelayMs);
		if (media) {
			seasonById.set(seasonId, media);
		}
		fetched += 1;
	}
}

function findBestSeason(
	seasonIds: number[],
	seasonById: Map<number, AniListMedia>,
): {season?: AniListMedia; index?: number} {
	for (let i = seasonIds.length - 1; i >= 0; i -= 1) {
		const seasonId = seasonIds[i];
		if (!seasonId) {
			continue;
		}
		const season = seasonById.get(seasonId);
		if (!season) {
			continue;
		}
		const latest = deriveAniListLatestEpisode(season);
		const next = season.nextAiringEpisode?.episode;
		if (latest !== undefined || next !== undefined) {
			return {season, index: i};
		}
	}
	return {};
}

export async function lookupAniListLatest(
	request: AniListLatestLookupRequest,
): Promise<AniListLatestLookup | null> {
	const maxDepth = Math.max(1, Math.floor(request.maxDepth ?? 10));
	const minDelayMs = toDelayMs(request.minDelayMs);

	const media = await fetchAniListMediaCached(request.anilistId, minDelayMs);
	if (!media) {
		return null;
	}
	const seasonById = new Map<number, AniListMedia>([[media.id, media]]);

	if (request.mediaType === "manga") {
		return {
			media,
			seasonIds: [request.anilistId],
		};
	}

	if (!isSeasonCandidate(media)) {
		const latestEpisode = deriveAniListLatestEpisode(media);
		const seasonEpisodes = typeof media.episodes === "number" && media.episodes > 0
			? toSeasonEpisodesRecord(new Map([[1, Math.floor(media.episodes)]]))
			: undefined;
		return {
			media,
			seasonIds: [media.id],
			seasonEpisodes,
			latestEpisode,
			nextEpisode: media.nextAiringEpisode?.episode ?? undefined,
			nextAiringAt: media.nextAiringEpisode?.airingAt ?? undefined,
		};
	}

	const knownSeasonIds = sanitizeKnownSeasonIds(request.knownSeasonIds);
	const seasonEpisodes = sanitizeKnownSeasonEpisodes(request.knownSeasonEpisodes);
	const shouldUseTailStrategy = knownSeasonIds.length >= 3;

	let seasonIds: number[] = [];
	let bestSeason: AniListMedia | undefined;
	let bestSeasonIndex: number | undefined;

	if (shouldUseTailStrategy) {
		const tail = await fetchSeasonTailFromKnown(knownSeasonIds, minDelayMs, maxDepth);
		if (tail) {
			seasonIds = tail.seasonIds;
			for (const [seasonId, season] of tail.fetchedById.entries()) {
				seasonById.set(seasonId, season);
				const index = seasonIds.indexOf(seasonId);
				if (index === -1) {
					continue;
				}
				if (typeof season.episodes === "number" && season.episodes > 0) {
					seasonEpisodes.set(index + 1, season.episodes);
				}
			}
			const best = findBestSeason(seasonIds, seasonById);
			bestSeason = best.season;
			bestSeasonIndex = best.index;
		}
	}

	const shouldResolveFullChain = !seasonIds.length
		|| (shouldUseTailStrategy && (bestSeason === undefined || (seasonEpisodes.size <= 1 && seasonIds.length >= 3)));

	if (shouldResolveFullChain) {
		const fetched = await fetchSeasonChain(request.anilistId, minDelayMs, maxDepth);
		const chain = fetched.chain.length ? fetched.chain : buildDirectChainFromMedia(media);
		seasonIds = chain.map((entry) => entry.id);
		seasonById.clear();
		for (const [index, season] of chain.entries()) {
			seasonById.set(season.id, season);
			if (typeof season.episodes === "number" && season.episodes > 0) {
				seasonEpisodes.set(index + 1, season.episodes);
			}
		}
		const best = findBestSeason(seasonIds, seasonById);
		bestSeason = best.season;
		bestSeasonIndex = best.index;
	}

	if (!seasonIds.length) {
		seasonIds = [request.anilistId];
	}
	if (!seasonById.has(request.anilistId)) {
		seasonById.set(request.anilistId, media);
	}
	if (seasonById.size < seasonIds.length) {
		await hydrateMissingSeasonMetadata(seasonIds, seasonById, minDelayMs);
	}

	let latestEpisode = bestSeason ? deriveAniListLatestEpisode(bestSeason) : undefined;
	let nextEpisode = bestSeason?.nextAiringEpisode?.episode ?? undefined;
	let nextAiringAt = bestSeason?.nextAiringEpisode?.airingAt ?? undefined;

	if (bestSeason === undefined) {
		const knownReleasedSeasons = Array.from(seasonEpisodes.entries())
			.filter(([seasonNumber, episodeCount]) => seasonNumber > 0 && episodeCount > 0)
			.sort((a, b) => a[0] - b[0]);
		const latestKnown = knownReleasedSeasons[knownReleasedSeasons.length - 1];
		if (latestKnown) {
			bestSeasonIndex = latestKnown[0] - 1;
			latestEpisode = latestKnown[1];
		}
	}

	if (bestSeason === undefined && latestEpisode === undefined && nextEpisode === undefined) {
		const currentIndex = seasonIds.indexOf(media.id);
		const mediaLatest = deriveAniListLatestEpisode(media);
		const mediaNext = media.nextAiringEpisode?.episode;
		if (currentIndex !== -1 && (mediaLatest !== undefined || mediaNext !== undefined)) {
			bestSeasonIndex = currentIndex;
			latestEpisode = mediaLatest;
			nextEpisode = mediaNext;
			nextAiringAt = media.nextAiringEpisode?.airingAt ?? undefined;
		}
	}
	const collapsed = collapseSeasonMetadata(seasonIds, seasonById, seasonEpisodes);
	const resolvedSeasonNumber = (() => {
		if (bestSeason) {
			const mapped = collapsed.seasonNumberById.get(bestSeason.id);
			if (mapped !== undefined) {
				return mapped;
			}
		}
		if (bestSeasonIndex !== undefined) {
			const seasonId = seasonIds[bestSeasonIndex];
			if (seasonId !== undefined) {
				const mapped = collapsed.seasonNumberById.get(seasonId);
				if (mapped !== undefined) {
					return mapped;
				}
			}
		}
		const mediaSeason = collapsed.seasonNumberById.get(media.id);
		if (mediaSeason !== undefined) {
			return mediaSeason;
		}
		return collapsed.seasonCount || undefined;
	})();

	return {
		media,
		seasonIds,
		seasonTotal: collapsed.seasonCount || undefined,
		seasonNumber: resolvedSeasonNumber,
		seasonEpisodes: toSeasonEpisodesRecord(collapsed.seasonEpisodes),
		latestEpisode,
		nextEpisode,
		nextAiringAt,
	};
}
