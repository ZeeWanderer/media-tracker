import {fetchAniListMedia} from "./client";
import type {AniListMedia} from "./types";

const ALLOWED_ANIME_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

export type SeasonChainResult = {
	chain: AniListMedia[];
};

export type SeasonTailResult = {
	seasonIds: number[];
	fetchedById: Map<number, AniListMedia>;
};

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

export function sanitizeKnownSeasonIds(values?: number[]): number[] {
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

export function sanitizeKnownSeasonEpisodes(values?: Record<string, number>): Map<number, number> {
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

export function toSeasonEpisodesRecord(map: Map<number, number>): Record<string, number> | undefined {
	if (!map.size) {
		return undefined;
	}
	const entries = Array.from(map.entries())
		.sort((a, b) => a[0] - b[0])
		.map(([seasonNumber, episodeCount]) => [String(seasonNumber), episodeCount] as const);
	return Object.fromEntries(entries);
}

export function isSeasonCandidate(media: AniListMedia): boolean {
	if (media.type !== "ANIME") {
		return false;
	}
	if (!media.format) {
		return true;
	}
	return ALLOWED_ANIME_FORMATS.has(media.format);
}

export function buildDirectChainFromMedia(media: AniListMedia): AniListMedia[] {
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

export async function fetchSeasonChain(
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

export async function fetchSeasonTailFromKnown(
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

