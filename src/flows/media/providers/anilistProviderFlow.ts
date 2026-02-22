import {App} from "obsidian";
import {lookupAniListLatest} from "../../../infra/api/anilist/lookup";
import {updateMediaSnapshot} from "../../../domain/media";
import {extractAnilistId} from "../../../domain/media/links";
import type {MediaItem} from "../../../domain/media/models";
import {providerDelay, sameNumberArray, sameNumberRecord} from "./providerFlowUtils";

export type AniListRefreshResult = {
	provider: "anilist";
	status: "updated" | "unchanged" | "failed" | "skipped";
	message: string;
};

function mergeNumberRecord(
	base: Record<string, number> | undefined,
	incoming: Record<string, number> | undefined,
): Record<string, number> | undefined {
	const merged = new Map<number, number>();
	for (const source of [base, incoming]) {
		if (!source) {
			continue;
		}
		for (const [key, value] of Object.entries(source)) {
			const numericKey = Number.parseInt(key, 10);
			if (!Number.isFinite(numericKey) || numericKey <= 0) {
				continue;
			}
			if (!Number.isFinite(value) || value <= 0) {
				continue;
			}
			merged.set(numericKey, Math.floor(value));
		}
	}
	if (!merged.size) {
		return undefined;
	}
	return Object.fromEntries(
		Array.from(merged.entries())
			.sort((a, b) => a[0] - b[0])
			.map(([key, value]) => [String(key), value] as const),
	);
}

export async function refreshAniListLatest(
	app: App,
	item: MediaItem,
	minDelayMs: number,
): Promise<AniListRefreshResult> {
	const linkId = item.anilistId ? String(item.anilistId) : undefined;
	const parsed = linkId ? extractAnilistId(linkId) : undefined;
	const fallbackId = item.anilistIds?.[0];
	const anilistId = parsed ?? item.anilistId ?? fallbackId;
	if (!anilistId) {
		return {
			provider: "anilist",
			status: "skipped",
			message: "AniList ID not found.",
		};
	}

	const result = await lookupAniListLatest({
		anilistId,
		mediaType: item.type === "manga" ? "manga" : "anime",
		knownSeasonIds: item.anilistIds,
		knownSeasonEpisodes: item.anilistSeasonEpisodes,
		minDelayMs,
		maxDepth: 10,
	});
	if (!result) {
		return {
			provider: "anilist",
			status: "failed",
			message: "AniList request failed.",
		};
	}

	const hasEpisodeData = result.latestEpisode !== undefined || result.nextEpisode !== undefined;
	const storedIds = result.seasonIds.length ? result.seasonIds : [anilistId];
	const seasonIdsChanged = !sameNumberArray(item.anilistIds, storedIds);

	if (item.type === "anime" && !hasEpisodeData) {
		const changed = seasonIdsChanged
			|| item.anilistLatestEpisode !== undefined
			|| item.anilistNextEpisode !== undefined
			|| item.anilistNextAiringAt !== undefined;
		await updateMediaSnapshot(app, item.file, (snapshot) => {
			snapshot.anilistId = anilistId;
			snapshot.anilistIds = storedIds;
			snapshot.anilistLastChecked = Date.now();
			snapshot.anilistLatestEpisode = undefined;
			snapshot.anilistNextEpisode = undefined;
			snapshot.anilistNextAiringAt = undefined;
		});
		await providerDelay(minDelayMs);
		return {
			provider: "anilist",
			status: changed ? "updated" : "unchanged",
			message: "AniList has no episode data.",
		};
	}

	const nextLatestEpisode = result.latestEpisode;
	const nextEpisode = result.nextEpisode;
	const nextAiringAt = result.nextAiringAt;
	const nextChapters = typeof result.media.chapters === "number" ? result.media.chapters : undefined;
	const nextVolumes = typeof result.media.volumes === "number" ? result.media.volumes : undefined;
	const nextSeason = result.seasonNumber;
	const nextSeasonTotal = result.seasonTotal;
	const nextSeasonEpisodes = item.type === "anime"
		? mergeNumberRecord(item.anilistSeasonEpisodes, result.seasonEpisodes)
		: result.seasonEpisodes;

	const changed = item.type === "manga"
		? nextChapters !== item.anilistChapters || nextVolumes !== item.anilistVolumes
		: nextLatestEpisode !== item.anilistLatestEpisode
			|| nextEpisode !== item.anilistNextEpisode
			|| nextAiringAt !== item.anilistNextAiringAt
			|| nextSeason !== item.anilistSeason
			|| nextSeasonTotal !== item.anilistSeasonTotal
			|| !sameNumberRecord(nextSeasonEpisodes, item.anilistSeasonEpisodes)
			|| seasonIdsChanged;

	await updateMediaSnapshot(app, item.file, (snapshot) => {
		snapshot.anilistId = anilistId;
		snapshot.anilistIds = storedIds;
		snapshot.anilistLastChecked = Date.now();
		snapshot.anilistLatestEpisode = nextLatestEpisode;
		snapshot.anilistNextEpisode = nextEpisode;
		snapshot.anilistNextAiringAt = nextAiringAt;
		snapshot.anilistChapters = nextChapters;
		snapshot.anilistVolumes = nextVolumes;
		snapshot.anilistSeason = nextSeason;
		snapshot.anilistSeasonTotal = nextSeasonTotal;
		snapshot.anilistSeasonEpisodes = nextSeasonEpisodes;
	});

	await providerDelay(minDelayMs);
	if (item.type === "manga") {
		if (nextChapters !== undefined || nextVolumes !== undefined) {
			return {
				provider: "anilist",
				status: changed ? "updated" : "unchanged",
				message: `AniList chapters ${nextChapters ?? "?"}, volumes ${nextVolumes ?? "?"}.`,
			};
		}
		return {
			provider: "anilist",
			status: changed ? "updated" : "unchanged",
			message: "AniList metadata refreshed.",
		};
	}
	const label = nextSeason
		? `S${nextSeason}E${nextLatestEpisode ?? "?"}`
		: `E${nextLatestEpisode ?? "?"}`;
	return {
		provider: "anilist",
		status: changed ? "updated" : "unchanged",
		message: `AniList latest ${label}.`,
	};
}
