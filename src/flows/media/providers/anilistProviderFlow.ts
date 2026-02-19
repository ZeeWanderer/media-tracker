import {App, Notice, TFile} from "obsidian";
import {MediaItem} from "../../../types";
import {lookupAniListLatest} from "../../../infra/api/anilistApi";
import {processMediaFrontmatter} from "../../../domain/media";
import {extractAnilistId} from "../../../domain/media/links";

function delay(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function updateMediaFrontmatter(
	app: App,
	file: TFile,
	updater: (frontmatter: Record<string, unknown>) => void,
): Promise<void> {
	await processMediaFrontmatter(app, file, updater);
}

export async function refreshAniListLatest(
	app: App,
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

	const result = await lookupAniListLatest({
		anilistId,
		mediaType: item.type === "manga" ? "manga" : "anime",
		knownSeasonIds: item.anilistIds,
		knownSeasonEpisodes: item.anilistSeasonEpisodes,
		minDelayMs,
		maxDepth: 10,
	});
	if (!result) {
		new Notice(`${item.title}: AniList request failed.`);
		return false;
	}

	const hasEpisodeData = result.latestEpisode !== undefined || result.nextEpisode !== undefined;
	if (item.type === "anime" && !hasEpisodeData) {
		await updateMediaFrontmatter(app, item.file, (frontmatter) => {
			frontmatter.anilistId = anilistId;
			if (result.seasonIds.length) {
				frontmatter.anilistIds = result.seasonIds;
			}
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

	const storedIds = result.seasonIds.length ? result.seasonIds : [anilistId];
	await updateMediaFrontmatter(app, item.file, (frontmatter) => {
		frontmatter.anilistId = anilistId;
		frontmatter.anilistIds = storedIds;
		frontmatter.anilistLastChecked = Date.now();

		if (result.latestEpisode !== undefined) {
			frontmatter.anilistLatestEpisode = result.latestEpisode;
		} else if ("anilistLatestEpisode" in frontmatter) {
			delete frontmatter.anilistLatestEpisode;
		}

		if (result.nextEpisode !== undefined) {
			frontmatter.anilistNextEpisode = result.nextEpisode;
		} else if ("anilistNextEpisode" in frontmatter) {
			delete frontmatter.anilistNextEpisode;
		}

		if (result.nextAiringAt !== undefined) {
			frontmatter.anilistNextAiringAt = result.nextAiringAt;
		} else if ("anilistNextAiringAt" in frontmatter) {
			delete frontmatter.anilistNextAiringAt;
		}

		if (typeof result.media.chapters === "number") {
			frontmatter.anilistChapters = result.media.chapters;
		} else if ("anilistChapters" in frontmatter) {
			delete frontmatter.anilistChapters;
		}

		if (typeof result.media.volumes === "number") {
			frontmatter.anilistVolumes = result.media.volumes;
		} else if ("anilistVolumes" in frontmatter) {
			delete frontmatter.anilistVolumes;
		}

		if (result.seasonNumber !== undefined) {
			frontmatter.anilistSeason = result.seasonNumber;
			if (result.seasonTotal !== undefined) {
				frontmatter.anilistSeasonTotal = result.seasonTotal;
			} else if ("anilistSeasonTotal" in frontmatter) {
				delete frontmatter.anilistSeasonTotal;
			}
			if (result.seasonEpisodes) {
				frontmatter.anilistSeasonEpisodes = JSON.stringify(result.seasonEpisodes);
			} else if ("anilistSeasonEpisodes" in frontmatter) {
				delete frontmatter.anilistSeasonEpisodes;
			}
		} else {
			if ("anilistSeason" in frontmatter) {
				delete frontmatter.anilistSeason;
			}
			if ("anilistSeasonTotal" in frontmatter) {
				delete frontmatter.anilistSeasonTotal;
			}
			if ("anilistSeasonEpisodes" in frontmatter) {
				delete frontmatter.anilistSeasonEpisodes;
			}
		}
	});

	if (item.type === "manga") {
		if (typeof result.media.chapters === "number") {
			new Notice(`${item.title}: AniList chapters ${result.media.chapters}.`);
		}
		if (typeof result.media.volumes === "number") {
			new Notice(`${item.title}: AniList volumes ${result.media.volumes}.`);
		}
	} else if (item.type === "anime") {
		if (result.latestEpisode === undefined
			&& result.seasonTotal
			&& result.seasonNumber
			&& result.seasonTotal > result.seasonNumber) {
			new Notice(`${item.title}: AniList next season announced (S${result.seasonNumber + 1}).`);
		} else {
			const label = result.seasonNumber
				? `S${result.seasonNumber}E${result.latestEpisode ?? "?"}`
				: `E${result.latestEpisode ?? "?"}`;
			new Notice(`${item.title}: AniList latest ${label}.`);
		}
	}

	await delay(minDelayMs);
	return true;
}
