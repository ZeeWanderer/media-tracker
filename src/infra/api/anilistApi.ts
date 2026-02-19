import {httpRequestJson} from "../network/httpClient";

const ANILIST_URL = "https://graphql.anilist.co";
const ALLOWED_ANIME_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

type AniListRelationType =
	| "PREQUEL"
	| "SEQUEL"
	| "SIDE_STORY"
	| "SPIN_OFF"
	| "OTHER"
	| "SUMMARY"
	| "ALTERNATIVE"
	| "PARENT"
	| "CHARACTER"
	| "COMPILATION"
	| "CONTAINS";

export type AniListMedia = {
	id: number;
	type: "ANIME" | "MANGA";
	format?: string | null;
	episodes?: number | null;
	chapters?: number | null;
	volumes?: number | null;
	nextAiringEpisode?: {episode: number; airingAt: number} | null;
	relations?: {
		edges?: Array<{
			relationType?: AniListRelationType;
			node?: AniListMedia | null;
		}>;
	} | null;
};

type AniListResponse = {
	data?: {Media?: AniListMedia};
	errors?: unknown;
};

export type AniListLatestLookupRequest = {
	anilistId: number;
	mediaType: "anime" | "manga";
	knownSeasonIds?: number[];
	knownSeasonEpisodes?: Record<string, number>;
	minDelayMs: number;
	maxDepth?: number;
};

export type AniListLatestLookup = {
	media: AniListMedia;
	seasonIds: number[];
	seasonTotal?: number;
	seasonNumber?: number;
	seasonEpisodes?: Record<string, number>;
	latestEpisode?: number;
	nextEpisode?: number;
	nextAiringAt?: number;
};

const MEDIA_QUERY = `
	query ($id: Int) {
		Media(id: $id) {
			id
			type
			format
			episodes
			chapters
			volumes
			nextAiringEpisode {
				episode
				airingAt
			}
			relations {
				edges {
					relationType
					node {
						id
						type
						format
						episodes
						chapters
						volumes
						nextAiringEpisode {
							episode
							airingAt
						}
					}
				}
			}
		}
	}
`;

function wait(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sanitizeKnownSeasonIds(values?: number[]): number[] {
	const ids: number[] = [];
	for (const value of values ?? []) {
		if (!Number.isFinite(value)) {
			continue;
		}
		const normalized = Math.floor(value);
		if (normalized <= 0 || ids.includes(normalized)) {
			continue;
		}
		ids.push(normalized);
	}
	return ids;
}

function sanitizeKnownSeasonEpisodes(
	values?: Record<string, number>,
): Map<number, number> {
	const map = new Map<number, number>();
	if (!values) {
		return map;
	}
	for (const [seasonKey, episodeCount] of Object.entries(values)) {
		const seasonNumber = Number.parseInt(seasonKey, 10);
		if (!Number.isFinite(seasonNumber) || seasonNumber <= 0) {
			continue;
		}
		if (!Number.isFinite(episodeCount) || episodeCount <= 0) {
			continue;
		}
		map.set(seasonNumber, Math.floor(episodeCount));
	}
	return map;
}

function toSeasonEpisodesRecord(map: Map<number, number>): Record<string, number> | undefined {
	if (!map.size) {
		return undefined;
	}
	const entries = Array.from(map.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([seasonNumber, episodeCount]) => [String(seasonNumber), episodeCount] as const);
	return Object.fromEntries(entries);
}

function isSeasonCandidate(media: AniListMedia): boolean {
	if (media.type !== "ANIME") {
		return false;
	}
	if (!media.format) {
		return true;
	}
	return ALLOWED_ANIME_FORMATS.has(media.format);
}

function getRelationId(media: AniListMedia, relation: "PREQUEL" | "SEQUEL"): number | null {
	const edges = media.relations?.edges ?? [];
	for (const edge of edges) {
		if (edge.relationType !== relation) {
			continue;
		}
		const related = edge.node;
		if (related && isSeasonCandidate(related)) {
			return related.id;
		}
	}
	return null;
}

function buildDirectChainFromMedia(media: AniListMedia): AniListMedia[] {
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
	const chain: AniListMedia[] = [];
	if (prequel) {
		chain.push(prequel);
	}
	chain.push(media);
	if (sequel) {
		chain.push(sequel);
	}
	return chain;
}

export async function fetchAniListMedia(id: number): Promise<AniListMedia | null> {
	try {
		const response = await httpRequestJson<AniListResponse>({
			url: ANILIST_URL,
			method: "POST",
			contentType: "application/json",
			body: JSON.stringify({query: MEDIA_QUERY, variables: {id}}),
		});
		if (response.errors) {
			return null;
		}
		return response.data?.Media ?? null;
	} catch {
		return null;
	}
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

type SeasonChainResult = {
	chain: AniListMedia[];
};

async function fetchSeasonChain(
	startId: number,
	minDelayMs: number,
	maxDepth: number,
): Promise<SeasonChainResult> {
	const cache = new Map<number, AniListMedia>();
	const fetchCached = async (id: number): Promise<AniListMedia | null> => {
		const hit = cache.get(id);
		if (hit) {
			return hit;
		}
		const media = await fetchAniListMedia(id);
		if (media) {
			cache.set(id, media);
		}
		return media;
	};

	const start = await fetchCached(startId);
	if (!start) {
		return {chain: []};
	}

	const backwards: AniListMedia[] = [start];
	let current = start;
	while (backwards.length < maxDepth) {
		const prequelId = getRelationId(current, "PREQUEL");
		if (!prequelId) {
			break;
		}
		const media = await fetchCached(prequelId);
		if (!media) {
			break;
		}
		backwards.push(media);
		current = media;
		await wait(minDelayMs);
	}

	const chain = backwards.reverse();
	current = start;
	while (chain.length < maxDepth) {
		const sequelId = getRelationId(current, "SEQUEL");
		if (!sequelId) {
			break;
		}
		const media = await fetchCached(sequelId);
		if (!media) {
			break;
		}
		chain.push(media);
		current = media;
		await wait(minDelayMs);
	}

	return {chain};
}

type SeasonTailResult = {
	seasonIds: number[];
	fetchedById: Map<number, AniListMedia>;
};

async function fetchSeasonTailFromKnown(
	knownSeasonIds: number[],
	minDelayMs: number,
	maxDepth: number,
): Promise<SeasonTailResult | null> {
	if (!knownSeasonIds.length) {
		return null;
	}

	const seasonIds = [...knownSeasonIds];
	const fetchedById = new Map<number, AniListMedia>();
	const anchorId = seasonIds[seasonIds.length - 1];
	if (!anchorId) {
		return null;
	}

	const anchor = await fetchAniListMedia(anchorId);
	if (!anchor || !isSeasonCandidate(anchor)) {
		return null;
	}
	if (seasonIds.length > 1) {
		const previousKnownId = seasonIds[seasonIds.length - 2];
		const detectedPrequelId = getRelationId(anchor, "PREQUEL");
		if (previousKnownId && detectedPrequelId && detectedPrequelId !== previousKnownId) {
			return null;
		}
	}
	fetchedById.set(anchor.id, anchor);

	let current = anchor;
	let steps = 0;
	while (steps < maxDepth) {
		const sequelId = getRelationId(current, "SEQUEL");
		if (!sequelId || seasonIds.includes(sequelId)) {
			break;
		}
		const sequel = await fetchAniListMedia(sequelId);
		if (!sequel || !isSeasonCandidate(sequel)) {
			break;
		}
		seasonIds.push(sequel.id);
		fetchedById.set(sequel.id, sequel);
		current = sequel;
		steps += 1;
		await wait(minDelayMs);
	}

	return {seasonIds, fetchedById};
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
	const minDelayMs = Math.max(0, Math.floor(request.minDelayMs));

	const media = await fetchAniListMedia(request.anilistId);
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

	if (!seasonIds.length) {
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

	if (bestSeason === undefined) {
		const currentIndex = seasonIds.indexOf(media.id);
		const latest = deriveAniListLatestEpisode(media);
		const next = media.nextAiringEpisode?.episode;
		if (currentIndex !== -1 && (latest !== undefined || next !== undefined)) {
			bestSeason = media;
			bestSeasonIndex = currentIndex;
		}
	}

	return {
		media,
		seasonIds,
		seasonTotal: seasonIds.length || undefined,
		seasonNumber: bestSeasonIndex !== undefined ? bestSeasonIndex + 1 : seasonIds.length || undefined,
		seasonEpisodes: toSeasonEpisodesRecord(seasonEpisodes),
		latestEpisode: bestSeason ? deriveAniListLatestEpisode(bestSeason) : undefined,
		nextEpisode: bestSeason?.nextAiringEpisode?.episode ?? undefined,
		nextAiringAt: bestSeason?.nextAiringEpisode?.airingAt ?? undefined,
	};
}
