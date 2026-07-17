import {fetchAniListMedia} from "./client";
import type {AniListMedia} from "./types";

const ALWAYS_SEASON_ANIME_FORMATS = new Set(["TV", "TV_SHORT"]);
const CONDITIONAL_SEASON_ANIME_FORMATS = new Set(["ONA", "OVA", "SPECIAL"]);
const EXCLUDED_CHAIN_BRIDGE_FORMATS = new Set(["MUSIC"]);
const SPLIT_COUR_MARKER_REGEX = /\b(?:part|cour)\s*(?:\d+|[ivxlcdm]+)\b/i;

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
	if (ALWAYS_SEASON_ANIME_FORMATS.has(media.format)) {
		return true;
	}
	if (!CONDITIONAL_SEASON_ANIME_FORMATS.has(media.format)) {
		return false;
	}
	return !isNamedStandaloneEntry(media);
}

function isChainBridgeCandidate(media: AniListMedia): boolean {
	if (media.type !== "ANIME") {
		return false;
	}
	if (!media.format) {
		return true;
	}
	return !EXCLUDED_CHAIN_BRIDGE_FORMATS.has(media.format);
}

function getMediaTitles(media: AniListMedia): string[] {
	const titles = [
		media.title?.english ?? undefined,
		media.title?.romaji ?? undefined,
		media.title?.native ?? undefined,
	];
	return titles
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function isNamedStandaloneEntry(media: AniListMedia): boolean {
	const titles = getMediaTitles(media);
	if (titles.some((title) => SPLIT_COUR_MARKER_REGEX.test(title))) {
		return false;
	}
	return titles.some((title) => /[:：]/.test(title));
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
