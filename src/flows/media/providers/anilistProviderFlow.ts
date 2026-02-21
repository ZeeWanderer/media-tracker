import {App, TFile} from "obsidian";
import {MediaItem} from "../../../types";
import {lookupAniListLatest} from "../../../infra/api/anilistApi";
import {processMediaFrontmatter} from "../../../domain/media";
import {extractAnilistId} from "../../../domain/media/links";

export type AniListRefreshResult = {
	provider: "anilist";
	status: "updated" | "unchanged" | "failed" | "skipped";
	message: string;
};

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

function sameNumberArray(a: number[] | undefined, b: number[] | undefined): boolean {
	const left = a ?? [];
	const right = b ?? [];
	if (left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => value === right[index]);
}

function sameNumberRecord(a: Record<string, number> | undefined, b: Record<string, number> | undefined): boolean {
	const leftEntries = Object.entries(a ?? {}).sort((x, y) => Number(x[0]) - Number(y[0]));
	const rightEntries = Object.entries(b ?? {}).sort((x, y) => Number(x[0]) - Number(y[0]));
	if (leftEntries.length !== rightEntries.length) {
		return false;
	}
	return leftEntries.every(([leftKey, leftVal], index) => {
		const [rightKey, rightVal] = rightEntries[index] ?? [];
		return leftKey === rightKey && leftVal === rightVal;
	});
}

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
		await updateMediaFrontmatter(app, item.file, (frontmatter) => {
			frontmatter.anilistId = anilistId;
			frontmatter.anilistIds = storedIds;
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
		await delay(minDelayMs);
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

	await updateMediaFrontmatter(app, item.file, (frontmatter) => {
		frontmatter.anilistId = anilistId;
		frontmatter.anilistIds = storedIds;
		frontmatter.anilistLastChecked = Date.now();

		if (nextLatestEpisode !== undefined) {
			frontmatter.anilistLatestEpisode = nextLatestEpisode;
		} else if ("anilistLatestEpisode" in frontmatter) {
			delete frontmatter.anilistLatestEpisode;
		}

		if (nextEpisode !== undefined) {
			frontmatter.anilistNextEpisode = nextEpisode;
		} else if ("anilistNextEpisode" in frontmatter) {
			delete frontmatter.anilistNextEpisode;
		}

		if (nextAiringAt !== undefined) {
			frontmatter.anilistNextAiringAt = nextAiringAt;
		} else if ("anilistNextAiringAt" in frontmatter) {
			delete frontmatter.anilistNextAiringAt;
		}

		if (nextChapters !== undefined) {
			frontmatter.anilistChapters = nextChapters;
		} else if ("anilistChapters" in frontmatter) {
			delete frontmatter.anilistChapters;
		}

		if (nextVolumes !== undefined) {
			frontmatter.anilistVolumes = nextVolumes;
		} else if ("anilistVolumes" in frontmatter) {
			delete frontmatter.anilistVolumes;
		}

		if (nextSeason !== undefined) {
			frontmatter.anilistSeason = nextSeason;
		} else if ("anilistSeason" in frontmatter) {
			delete frontmatter.anilistSeason;
		}

		if (nextSeasonTotal !== undefined) {
			frontmatter.anilistSeasonTotal = nextSeasonTotal;
		} else if ("anilistSeasonTotal" in frontmatter) {
			delete frontmatter.anilistSeasonTotal;
		}

		if (nextSeasonEpisodes) {
			frontmatter.anilistSeasonEpisodes = JSON.stringify(nextSeasonEpisodes);
		} else if ("anilistSeasonEpisodes" in frontmatter) {
			delete frontmatter.anilistSeasonEpisodes;
		}
	});

	await delay(minDelayMs);
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
