import {fetchAniListMedia} from "./client";
import {isChainBridgeCandidate, isSeasonCandidate} from "./seasonModel";
import type {AniListMedia} from "./types";

export type SeasonChainResult = {
	chain: AniListMedia[];
};

export type SeasonTailResult = {
	seasonIds: number[];
	fetchedById: Map<number, AniListMedia>;
};

type FetchMedia = (id: number) => Promise<AniListMedia | null>;

function getRelationNode(media: AniListMedia, relation: "PREQUEL" | "SEQUEL"): AniListMedia | null {
	const edges = media.relations?.edges ?? [];
	for (const edge of edges) {
		if (edge.relationType !== relation) {
			continue;
		}
		const related = edge.node;
		if (related && isChainBridgeCandidate(related)) {
			return related;
		}
	}
	return null;
}


async function fetchAdjacentSeason(
	media: AniListMedia,
	relation: "PREQUEL" | "SEQUEL",
	fetchMedia: FetchMedia,
	maxDepth: number,
	visited: Set<number>,
): Promise<AniListMedia | null> {
	let current = media;
	let steps = 0;
	while (steps < maxDepth) {
		const related = getRelationNode(current, relation);
		if (!related || visited.has(related.id)) {
			return null;
		}
		visited.add(related.id);
		const fullRelated = await fetchMedia(related.id) ?? related;
		steps += 1;
		if (isSeasonCandidate(fullRelated)) {
			return fullRelated;
		}
		current = fullRelated;
	}
	return null;
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
	if (!isSeasonCandidate(start)) {
		return {chain: [start]};
	}

	const backwards: AniListMedia[] = [start];
	let current = start;
	const visited = new Set<number>([start.id]);
	while (backwards.length < maxDepth) {
		const media = await fetchAdjacentSeason(current, "PREQUEL", fetchCached, maxDepth, visited);
		if (!media) {
			break;
		}
		backwards.push(media);
		current = media;
	}

	const chain = backwards.reverse();
	current = start;
	while (chain.length < maxDepth) {
		const media = await fetchAdjacentSeason(current, "SEQUEL", fetchCached, maxDepth, visited);
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
		const detectedPrequel = await fetchAdjacentSeason(
			anchor,
			"PREQUEL",
			(id) => fetchAniListMedia(id, minDelayMs),
			maxDepth,
			new Set<number>([anchor.id]),
		);
		// If known IDs are out of order or stale, abort tail strategy and let full-chain resolution recover.
		if (previousKnownId && detectedPrequel?.id !== previousKnownId) {
			return null;
		}
	}
	fetchedById.set(anchor.id, anchor);

	let current = anchor;
	let steps = 0;
	const visited = new Set<number>(seasonIds);
	while (steps < maxDepth) {
		const sequel = await fetchAdjacentSeason(
			current,
			"SEQUEL",
			(id) => fetchAniListMedia(id, minDelayMs),
			maxDepth,
			visited,
		);
		if (!sequel || seasonIds.includes(sequel.id)) {
			break;
		}
		seasonIds.push(sequel.id);
		fetchedById.set(sequel.id, sequel);
		current = sequel;
		steps += 1;
	}

	return {seasonIds, fetchedById};
}
