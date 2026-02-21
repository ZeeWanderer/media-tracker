import {httpRequest} from "../network/httpClient";

const ANILIST_URL = "https://graphql.anilist.co";
const ALLOWED_ANIME_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);
// AniList official docs currently note a temporary degraded limit of 30 requests/minute.
const ANILIST_FALLBACK_RATE_PER_MINUTE = 30;
const ANILIST_FALLBACK_MIN_DELAY_MS = Math.ceil(60_000 / ANILIST_FALLBACK_RATE_PER_MINUTE);
const ANILIST_MAX_RETRIES = 5;
const ANILIST_MAX_BACKOFF_MS = 30_000;
const ANILIST_RETRY_JITTER_MS = 250;
let anilistNextAllowedRequestAt = 0;
let anilistComputedMinDelayMs = ANILIST_FALLBACK_MIN_DELAY_MS;

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

function toDelayMs(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.floor(value);
}

function getAniListBaseDelayMs(requestedMinDelayMs: number): number {
	return Math.max(anilistComputedMinDelayMs, requestedMinDelayMs);
}

async function waitForAniListRateWindow(): Promise<void> {
	const now = Date.now();
	if (anilistNextAllowedRequestAt > now) {
		await wait(anilistNextAllowedRequestAt - now);
	}
}

function getHeaderValue(headers: Record<string, string> | undefined, key: string): string | undefined {
	if (!headers) {
		return undefined;
	}
	const direct = headers[key] ?? headers[key.toLowerCase()];
	if (direct !== undefined) {
		return direct;
	}
	const match = Object.entries(headers)
		.find(([headerKey]) => headerKey.toLowerCase() === key.toLowerCase());
	return match?.[1];
}

function parseRetryAfterDelayMs(headers: Record<string, string> | undefined): number | undefined {
	const raw = getHeaderValue(headers, "Retry-After");
	if (!raw) {
		return undefined;
	}
	const seconds = Number.parseFloat(raw);
	if (Number.isFinite(seconds) && seconds > 0) {
		return Math.floor(seconds * 1000);
	}
	const parsedDateMs = Date.parse(raw);
	if (!Number.isFinite(parsedDateMs)) {
		return undefined;
	}
	const delta = parsedDateMs - Date.now();
	return delta > 0 ? delta : undefined;
}

function parseRateLimitResetDelayMs(headers: Record<string, string> | undefined): number | undefined {
	const raw = getHeaderValue(headers, "X-RateLimit-Reset");
	if (!raw) {
		return undefined;
	}
	const resetSeconds = Number.parseInt(raw, 10);
	if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) {
		return undefined;
	}
	const delta = resetSeconds * 1000 - Date.now();
	return delta > 0 ? delta : undefined;
}

function parseRateLimitLimit(headers: Record<string, string> | undefined): number | undefined {
	const raw = getHeaderValue(headers, "X-RateLimit-Limit");
	if (!raw) {
		return undefined;
	}
	const limit = Number.parseInt(raw, 10);
	if (!Number.isFinite(limit) || limit <= 0) {
		return undefined;
	}
	return limit;
}

function parseRateLimitRemaining(headers: Record<string, string> | undefined): number | undefined {
	const raw = getHeaderValue(headers, "X-RateLimit-Remaining");
	if (!raw) {
		return undefined;
	}
	const remaining = Number.parseInt(raw, 10);
	if (!Number.isFinite(remaining) || remaining < 0) {
		return undefined;
	}
	return remaining;
}

function scheduleNextAniListRequest(
	requestedMinDelayMs: number,
	headers?: Record<string, string>,
	minimumDelayMs?: number,
) {
	const reportedLimitPerMinute = parseRateLimitLimit(headers);
	if (reportedLimitPerMinute !== undefined) {
		anilistComputedMinDelayMs = Math.max(1, Math.ceil(60_000 / reportedLimitPerMinute));
	}

	const resetDelayMs = parseRateLimitResetDelayMs(headers);
	const remaining = parseRateLimitRemaining(headers);
	const dynamicWindowDelayMs = resetDelayMs !== undefined && remaining !== undefined
		? remaining <= 0
			? resetDelayMs + 100
			: Math.ceil(resetDelayMs / remaining)
		: undefined;

	let delayMs = getAniListBaseDelayMs(requestedMinDelayMs);
	if (dynamicWindowDelayMs !== undefined) {
		// Prefer live window budgeting when the server exposes remaining quota and reset timestamp.
		delayMs = Math.max(requestedMinDelayMs, dynamicWindowDelayMs);
	}
	if (minimumDelayMs !== undefined) {
		delayMs = Math.max(delayMs, minimumDelayMs);
	}
	anilistNextAllowedRequestAt = Date.now() + Math.max(0, delayMs);
}

function computeAniListRetryDelayMs(
	attempt: number,
	baseDelayMs: number,
	headers?: Record<string, string>,
): number {
	const retryAfterMs = parseRetryAfterDelayMs(headers);
	if (retryAfterMs !== undefined) {
		return Math.max(baseDelayMs, retryAfterMs + 100);
	}
	const resetDelayMs = parseRateLimitResetDelayMs(headers);
	if (resetDelayMs !== undefined) {
		return Math.max(baseDelayMs, resetDelayMs + 100);
	}
	const exponentialBackoffMs = Math.min(ANILIST_MAX_BACKOFF_MS, baseDelayMs * (2 ** attempt));
	const jitterMs = Math.floor(Math.random() * ANILIST_RETRY_JITTER_MS);
	return exponentialBackoffMs + jitterMs;
}

function hasTooManyRequestsError(errors: unknown): boolean {
	if (!errors) {
		return false;
	}
	const text = typeof errors === "string" ? errors : JSON.stringify(errors);
	return text.toLowerCase().includes("too many requests");
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

export async function fetchAniListMedia(
	id: number,
	minDelayMs = 0,
): Promise<AniListMedia | null> {
	const requestedMinDelayMs = toDelayMs(minDelayMs);
	const body = JSON.stringify({query: MEDIA_QUERY, variables: {id}});
	for (let attempt = 0; attempt <= ANILIST_MAX_RETRIES; attempt += 1) {
		await waitForAniListRateWindow();
		const baseDelayMs = getAniListBaseDelayMs(requestedMinDelayMs);
		try {
			const response = await httpRequest({
				url: ANILIST_URL,
				method: "POST",
				contentType: "application/json",
				body,
				throw: false,
			});
			const parsed = response.json as AniListResponse;
			const rateLimited = response.status === 429 || hasTooManyRequestsError(parsed.errors);
			if (response.status >= 200 && response.status < 300 && !rateLimited) {
				scheduleNextAniListRequest(requestedMinDelayMs, response.headers);
				if (parsed.errors) {
					return null;
				}
				return parsed.data?.Media ?? null;
			}

			const shouldRetry = rateLimited || response.status >= 500;
			if (!shouldRetry || attempt >= ANILIST_MAX_RETRIES) {
				scheduleNextAniListRequest(requestedMinDelayMs, response.headers);
				return null;
			}
			scheduleNextAniListRequest(
				requestedMinDelayMs,
				response.headers,
				computeAniListRetryDelayMs(attempt, baseDelayMs, response.headers),
			);
		} catch {
			if (attempt >= ANILIST_MAX_RETRIES) {
				scheduleNextAniListRequest(requestedMinDelayMs, undefined, baseDelayMs);
				return null;
			}
			scheduleNextAniListRequest(
				requestedMinDelayMs,
				undefined,
				computeAniListRetryDelayMs(attempt, baseDelayMs),
			);
		}
	}
	return null;
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
		const media = await fetchAniListMedia(id, minDelayMs);
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

	const anchor = await fetchAniListMedia(anchorId, minDelayMs);
	if (!anchor || !isSeasonCandidate(anchor)) {
		return null;
	}
	if (seasonIds.length > 1) {
		const previousKnownId = seasonIds[seasonIds.length - 2];
		const detectedPrequelId = getRelationId(anchor, "PREQUEL");
		// If known IDs are out of order or stale, abort tail strategy and let full-chain resolution recover.
		if (previousKnownId && detectedPrequelId !== previousKnownId) {
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
		const sequel = await fetchAniListMedia(sequelId, minDelayMs);
		if (!sequel || !isSeasonCandidate(sequel)) {
			break;
		}
		seasonIds.push(sequel.id);
		fetchedById.set(sequel.id, sequel);
		current = sequel;
		steps += 1;
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
