import {App, Notice, requestUrl} from "obsidian";
import {MediaItem} from "../types";
import {MediaTrackerSettings} from "../settings";
import {extractAnilistId} from "./links";
import {updateFrontmatter} from "./frontmatter";

const ANILIST_URL = "https://graphql.anilist.co";
const ALLOWED_ANIME_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);

type AniListRelationType = "PREQUEL" | "SEQUEL" | "SIDE_STORY" | "SPIN_OFF" | "OTHER" | "SUMMARY" | "ALTERNATIVE" | "PARENT" | "CHARACTER" | "COMPILATION" | "CONTAINS";

type AniListMedia = {
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

async function fetchAniListMedia(id: number): Promise<AniListMedia | null> {
	const query = `
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
	try {
		const response = await requestUrl({
			url: ANILIST_URL,
			method: "POST",
			contentType: "application/json",
			body: JSON.stringify({query, variables: {id}}),
		});
		const data = response.json as {data?: {Media?: AniListMedia}};
		return data?.data?.Media ?? null;
	} catch {
		return null;
	}
}

function deriveLatestEpisode(media: AniListMedia): number | undefined {
	const nextEpisode = media.nextAiringEpisode?.episode;
	if (nextEpisode && nextEpisode > 1) {
		return nextEpisode - 1;
	}
	if (typeof media.episodes === "number" && media.episodes > 0) {
		return media.episodes;
	}
	return undefined;
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

function buildAnimeChain(startId: number, nodes: Map<number, AniListMedia>) {
	const prequelMap = new Map<number, number>();
	const sequelMap = new Map<number, number>();
	for (const media of nodes.values()) {
		const edges = media.relations?.edges ?? [];
		for (const edge of edges) {
			const related = edge.node;
			if (!related || !isSeasonCandidate(related)) {
				continue;
			}
			if (edge.relationType === "PREQUEL") {
				prequelMap.set(media.id, related.id);
			} else if (edge.relationType === "SEQUEL") {
				sequelMap.set(media.id, related.id);
			}
		}
	}

	const chain: AniListMedia[] = [];
	let current = startId;
	const seen = new Set<number>();
	while (prequelMap.has(current) && !seen.has(current)) {
		seen.add(current);
		current = prequelMap.get(current) ?? current;
	}
	while (current && !seen.has(current)) {
		seen.add(current);
		const node = nodes.get(current);
		if (node && isSeasonCandidate(node)) {
			chain.push(node);
		}
		const next = sequelMap.get(current);
		if (!next || seen.has(next)) {
			break;
		}
		current = next;
	}
	return chain;
}

async function fetchAniListChain(startId: number, minDelayMs: number, maxDepth = 10) {
	const nodes = new Map<number, AniListMedia>();
	const queue: number[] = [startId];
	const visited = new Set<number>();
	while (queue.length && nodes.size < maxDepth) {
		const id = queue.shift();
		if (!id || visited.has(id)) {
			continue;
		}
		visited.add(id);
		const media = await fetchAniListMedia(id);
		if (media) {
			nodes.set(id, media);
			const edges = media.relations?.edges ?? [];
			for (const edge of edges) {
				const related = edge.node;
				if (!related || !isSeasonCandidate(related)) {
					continue;
				}
				if (edge.relationType === "PREQUEL" || edge.relationType === "SEQUEL") {
					nodes.set(related.id, related);
					if (!visited.has(related.id)) {
						queue.push(related.id);
					}
				}
			}
		}
		if (minDelayMs > 0 && queue.length) {
			await new Promise((resolve) => window.setTimeout(resolve, minDelayMs));
		}
	}
	return nodes;
}

export async function refreshAniListLatest(
	app: App,
	settings: MediaTrackerSettings,
	item: MediaItem,
	minDelayMs: number,
): Promise<boolean> {
	const linkId = item.anilistId ? String(item.anilistId) : undefined;
	const parsed = linkId ? extractAnilistId(linkId) : undefined;
	const fallbackId = item.anilistIds?.[0];
	const anilistId = parsed ?? item.anilistId ?? fallbackId;
	if (!anilistId) {
		new Notice("AniList ID not found.");
		return false;
	}
	const nodes = await fetchAniListChain(anilistId, minDelayMs, 10);
	const media = nodes.get(anilistId);
	if (!media) {
		new Notice(`${item.title}: AniList request failed.`);
		return false;
	}
	const latestEpisode = deriveLatestEpisode(media);
	const nextEpisode = media.nextAiringEpisode?.episode ?? undefined;
	const hasEpisodeData = latestEpisode !== undefined || nextEpisode !== undefined;
	if (item.type === "anime" && !hasEpisodeData) {
		await updateFrontmatter(app, item.file, (frontmatter) => {
			frontmatter.anilistId = anilistId;
			frontmatter.anilistLastChecked = Date.now();
			if ("anilistLatestEpisode" in frontmatter) {
				delete frontmatter.anilistLatestEpisode;
			}
			if ("anilistNextEpisode" in frontmatter) {
				delete frontmatter.anilistNextEpisode;
			}
			if ("anilistNextAiringAt" in frontmatter) {
				delete frontmatter.anilistNextAiringAt;
			}
		});
		new Notice(`${item.title}: AniList has no episode data.`);
		return false;
	}
	const chain = item.type === "anime" ? buildAnimeChain(anilistId, nodes) : [];
	const orderedIds = chain.map((entry) => entry.id);
	const storedIds = orderedIds.length ? orderedIds : [anilistId];
	const lastSeason = chain.length ? chain[chain.length - 1] : media;
	const lastLatestEpisode = lastSeason ? deriveLatestEpisode(lastSeason) : undefined;
	const lastNextEpisode = lastSeason?.nextAiringEpisode?.episode ?? undefined;
	const lastNextAiringAt = lastSeason?.nextAiringEpisode?.airingAt ?? undefined;
	const seasonNumber = chain.length ? chain.length : item.type === "anime" ? 1 : undefined;
	const seasonTotal = chain.length ? chain.length : item.type === "anime" ? 1 : undefined;
	await updateFrontmatter(app, item.file, (frontmatter) => {
		frontmatter.anilistId = anilistId;
		frontmatter.anilistIds = storedIds;
		frontmatter.anilistLastChecked = Date.now();
		if (lastLatestEpisode !== undefined) {
			frontmatter.anilistLatestEpisode = lastLatestEpisode;
		} else if ("anilistLatestEpisode" in frontmatter) {
			delete frontmatter.anilistLatestEpisode;
		}
		if (lastNextEpisode !== undefined) {
			frontmatter.anilistNextEpisode = lastNextEpisode;
		} else if ("anilistNextEpisode" in frontmatter) {
			delete frontmatter.anilistNextEpisode;
		}
		if (lastNextAiringAt !== undefined) {
			frontmatter.anilistNextAiringAt = lastNextAiringAt;
		} else if ("anilistNextAiringAt" in frontmatter) {
			delete frontmatter.anilistNextAiringAt;
		}
		if (typeof media.chapters === "number") {
			frontmatter.anilistChapters = media.chapters;
		} else if ("anilistChapters" in frontmatter) {
			delete frontmatter.anilistChapters;
		}
		if (typeof media.volumes === "number") {
			frontmatter.anilistVolumes = media.volumes;
		} else if ("anilistVolumes" in frontmatter) {
			delete frontmatter.anilistVolumes;
		}
		if (seasonNumber !== undefined) {
			frontmatter.anilistSeason = seasonNumber;
			frontmatter.anilistSeasonTotal = seasonTotal;
		} else {
			if ("anilistSeason" in frontmatter) {
				delete frontmatter.anilistSeason;
			}
			if ("anilistSeasonTotal" in frontmatter) {
				delete frontmatter.anilistSeasonTotal;
			}
		}
	});
	if (item.type === "manga") {
		if (typeof media.chapters === "number") {
			new Notice(`${item.title}: AniList chapters ${media.chapters}.`);
		}
		if (typeof media.volumes === "number") {
			new Notice(`${item.title}: AniList volumes ${media.volumes}.`);
		}
	} else if (item.type === "anime") {
		const label = seasonNumber ? `S${seasonNumber}E${lastLatestEpisode ?? "?"}` : `E${lastLatestEpisode ?? "?"}`;
		new Notice(`${item.title}: AniList latest ${label}.`);
	}
	if (minDelayMs > 0) {
		await new Promise((resolve) => window.setTimeout(resolve, minDelayMs));
	}
	return true;
}
