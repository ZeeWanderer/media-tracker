import {fetchAniListMedia, toDelayMs} from "./client";
import {
	buildDirectChainFromMedia,
	fetchSeasonChain,
	fetchSeasonTailFromKnown,
	sanitizeKnownSeasonEpisodes,
	sanitizeKnownSeasonIds,
	toSeasonEpisodesRecord,
} from "./seasonChain";
import type {AniListLatestLookup, AniListLatestLookupRequest, AniListMedia} from "./types";

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

	const media = await fetchAniListMedia(request.anilistId, minDelayMs);
	if (!media) {
		return null;
	}

	if (request.mediaType === "manga") {
		return {
			media,
			seasonIds: [request.anilistId],
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
				const index = seasonIds.indexOf(seasonId);
				if (index === -1) {
					continue;
				}
				if (typeof season.episodes === "number" && season.episodes > 0) {
					seasonEpisodes.set(index + 1, season.episodes);
				}
			}
			const best = findBestSeason(seasonIds, tail.fetchedById);
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
		for (const [index, season] of chain.entries()) {
			if (typeof season.episodes === "number" && season.episodes > 0) {
				seasonEpisodes.set(index + 1, season.episodes);
			}
		}
		const best = findBestSeason(
			seasonIds,
			new Map<number, AniListMedia>(chain.map((season) => [season.id, season])),
		);
		bestSeason = best.season;
		bestSeasonIndex = best.index;
	}

	if (!seasonIds.length) {
		seasonIds = [request.anilistId];
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

	return {
		media,
		seasonIds,
		seasonTotal: seasonIds.length || undefined,
		seasonNumber: bestSeasonIndex !== undefined ? bestSeasonIndex + 1 : seasonIds.length || undefined,
		seasonEpisodes: toSeasonEpisodesRecord(seasonEpisodes),
		latestEpisode,
		nextEpisode,
		nextAiringAt,
	};
}

