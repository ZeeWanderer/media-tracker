import {MediaItem} from "../../types";
import {ANILIST_TYPES, NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES, TMDB_TYPES} from "./config";
import {incrementProgressNumericString, parseChapterProgressValue, parseMangaProgress, type MangaProgress} from "./progress";

export type TrackerComputationItem = Pick<
	MediaItem,
	| "type"
	| "progress"
	| "progressRaw"
	| "progressLabel"
	| "season"
	| "episode"
	| "tmdbLatestSeason"
	| "tmdbLatestEpisode"
	| "tmdbLatestSeasonEpisodes"
	| "tmdbSeasonEpisodes"
	| "tmdbLatestAirDate"
	| "tmdbLatestName"
	| "anilistId"
	| "anilistLastChecked"
	| "anilistLatestEpisode"
	| "anilistNextEpisode"
	| "anilistNextAiringAt"
	| "anilistChapters"
	| "anilistVolumes"
	| "anilistSeason"
	| "anilistSeasonTotal"
	| "anilistSeasonEpisodes"
>;

export type TrackerBadgeDescriptor = {
	text: string;
	isNew: boolean;
	title?: string;
};

function getAniListLatestFromNext(nextEpisode?: number): number | undefined {
	if (!nextEpisode || nextEpisode <= 1) {
		return undefined;
	}
	return nextEpisode - 1;
}

function getCurrentMangaProgress(item: TrackerComputationItem): MangaProgress | undefined {
	const candidates = [item.progressRaw, item.progressLabel, item.progress];
	for (const candidate of candidates) {
		if (!candidate) {
			continue;
		}
		const parsed = parseMangaProgress(candidate);
		if (!parsed) {
			continue;
		}
		return parsed;
	}
	return undefined;
}

function isMangaProgressBehindLatest(
	latestChapters: number,
	latestVolumes: number | undefined,
	currentProgress: MangaProgress | undefined,
): boolean {
	if (!currentProgress) {
		return false;
	}
	if (currentProgress.kind === "chapter") {
		return latestChapters > currentProgress.chapter;
	}
	// Prefer through-chapter numbering semantics for x.y progress.
	if (latestChapters > currentProgress.chapter) {
		return true;
	}
	if (latestChapters < currentProgress.chapter) {
		return false;
	}
	// On equal chapter numbers, use volume as a tie-breaker when available.
	if (latestVolumes === undefined) {
		return false;
	}
	return latestVolumes > currentProgress.volume;
}

function getAnnouncedSeason(
	seasonEpisodes: Record<string, number> | undefined,
	latestSeason: number,
): number | undefined {
	if (!seasonEpisodes) {
		return undefined;
	}
	const announced = Object.entries(seasonEpisodes)
		.map(([key, value]) => ({season: Number(key), episodes: Number(value)}))
		.filter((entry) => Number.isFinite(entry.season) && Number.isFinite(entry.episodes))
		.filter((entry) => entry.episodes === 0 && entry.season > latestSeason)
		.map((entry) => entry.season);
	if (!announced.length) {
		return undefined;
	}
	return Math.max(...announced);
}

function getLatestSeasonEpisode(item: TrackerComputationItem): {season: number; episode: number} | undefined {
	if (item.tmdbLatestSeason !== undefined && item.tmdbLatestEpisode !== undefined) {
		return {season: item.tmdbLatestSeason, episode: item.tmdbLatestEpisode};
	}
	const map = item.tmdbSeasonEpisodes;
	if (!map) {
		return undefined;
	}
	const seasons = Object.entries(map)
		.map(([key, value]) => ({season: Number(key), episodes: Number(value)}))
		.filter((entry) => Number.isFinite(entry.season) && Number.isFinite(entry.episodes) && entry.episodes > 0)
		.map((entry) => entry.season);
	if (!seasons.length) {
		return undefined;
	}
	const latestSeason = Math.max(...seasons);
	const latestEpisode = map[String(latestSeason)];
	if (latestEpisode === undefined || latestEpisode <= 0) {
		return undefined;
	}
	return {season: latestSeason, episode: latestEpisode};
}

function buildAniListBadge(item: TrackerComputationItem): TrackerBadgeDescriptor | undefined {
	if (item.type === "manga") {
		const chapters = item.anilistChapters;
		const volumes = item.anilistVolumes;
		if (chapters === undefined && volumes === undefined) {
			return undefined;
		}
		const currentProgress = getCurrentMangaProgress(item);
		const isNew = chapters !== undefined
			? isMangaProgressBehindLatest(chapters, volumes, currentProgress)
			: false;
		if (chapters !== undefined && volumes !== undefined) {
			return {text: `${isNew ? "New" : "Latest"} Vol ${volumes} · Ch ${chapters}`, isNew};
		}
		if (chapters !== undefined) {
			return {text: `${isNew ? "New" : "Latest"} Ch ${chapters}`, isNew};
		}
		return {text: `Latest Vol ${volumes}`, isNew: false};
	}

	if (item.type !== "anime") {
		return undefined;
	}

	const latest = item.anilistLatestEpisode ?? getAniListLatestFromNext(item.anilistNextEpisode);
	if (!latest) {
		const next = item.anilistNextEpisode;
		if (!next) {
			return undefined;
		}
		const label = item.anilistSeason
			? `S${item.anilistSeason}E${next} Ann.`
			: `E${next} Ann.`;
		return {text: label, isNew: false};
	}

	let isNew = false;
	if (item.anilistSeason && item.season !== undefined) {
		if (item.season < item.anilistSeason) {
			isNew = true;
		} else if (item.season === item.anilistSeason && item.episode !== undefined && latest > item.episode) {
			isNew = true;
		}
	} else if (item.episode !== undefined && latest > item.episode) {
		isNew = true;
	}

	const latestLabel = item.anilistSeason
		? `S${item.anilistSeason}E${latest}`
		: `E${latest}`;
	const title = item.anilistNextAiringAt
		? `Next airs ${new Date(item.anilistNextAiringAt * 1000).toLocaleString()}`
		: undefined;
	return {
		text: `${isNew ? "New" : "Latest"} ${latestLabel}`,
		isNew,
		title,
	};
}

export function buildLatestBadges(item: TrackerComputationItem): TrackerBadgeDescriptor[] {
	if (ANILIST_TYPES.has(item.type)) {
		if (item.type === "anime" && item.anilistId && item.anilistLastChecked === undefined) {
			return [];
		}
		const aniListBadge = buildAniListBadge(item);
		if (aniListBadge) {
			return [aniListBadge];
		}
	}

	if (!TMDB_TYPES.has(item.type)) {
		return [];
	}

	const latest = getLatestSeasonEpisode(item);
	if (!latest) {
		const announcedSeason = getAnnouncedSeason(item.tmdbSeasonEpisodes, 0);
		return announcedSeason !== undefined
			? [{text: `S${announcedSeason} Ann.`, isNew: false}]
			: [];
	}

	let isNew = false;
	if (item.season !== undefined && item.episode !== undefined) {
		if (latest.season > item.season) {
			isNew = true;
		} else if (latest.season === item.season && latest.episode > item.episode) {
			isNew = true;
		}
	}
	const titleParts = [];
	if (item.tmdbLatestName) {
		titleParts.push(item.tmdbLatestName);
	}
	if (item.tmdbLatestAirDate) {
		titleParts.push(item.tmdbLatestAirDate);
	}
	const badges: TrackerBadgeDescriptor[] = [{
		text: `${isNew ? "New" : "Latest"} S${latest.season}E${latest.episode}`,
		isNew,
		title: titleParts.length ? titleParts.join(" • ") : undefined,
	}];
	const announcedSeason = getAnnouncedSeason(item.tmdbSeasonEpisodes, latest.season);
	if (announcedSeason !== undefined) {
		badges.push({text: `S${announcedSeason} Ann.`, isNew: false});
	}
	return badges;
}

export function getNextProgressValue(item: TrackerComputationItem): string | null {
	if (SEASON_EPISODE_TYPES.has(item.type) && item.season !== undefined && item.episode !== undefined) {
		const seasonKey = String(item.season);
		const isLatestSeason = item.tmdbLatestSeason !== undefined
			&& item.tmdbLatestEpisode !== undefined
			&& item.season === item.tmdbLatestSeason;
		const anilistSeasonEpisodes = item.type === "anime" ? item.anilistSeasonEpisodes : undefined;
		const anilistSeasonCount = anilistSeasonEpisodes?.[seasonKey];
		const anilistLatestEpisode = item.type === "anime" ? item.anilistLatestEpisode : undefined;
		const knownCurrentSeasonEpisodeCount = anilistSeasonCount ?? (isLatestSeason
			? item.tmdbLatestEpisode
			: item.tmdbSeasonEpisodes?.[seasonKey]);
		const fallbackSeasonEpisodeCount = anilistLatestEpisode ?? item.tmdbLatestSeasonEpisodes;
		const seasonEpisodeCount = knownCurrentSeasonEpisodeCount ?? (item.season > 0 ? fallbackSeasonEpisodeCount : undefined);

		// Do not auto-advance "season 0" unless we actually know that season's episode count.
		if (item.season <= 0 && seasonEpisodeCount === undefined) {
			return null;
		}
		// A known count of 0 means announced season with no released episodes yet.
		if (seasonEpisodeCount === 0) {
			return null;
		}

		if (seasonEpisodeCount !== undefined && item.episode >= seasonEpisodeCount) {
			if (item.type === "anime" && anilistSeasonCount) {
				if (item.anilistSeasonTotal && item.season < item.anilistSeasonTotal) {
					return `S${item.season + 1}E1`;
				}
				return null;
			}
			if (anilistLatestEpisode) {
				return null;
			}
			return isLatestSeason ? null : `S${item.season + 1}E1`;
		}
		return `S${item.season}E${item.episode + 1}`;
	}

	if (!NOVEL_PROGRESS_TYPES.has(item.type)) {
		return null;
	}

	const raw = item.progressRaw?.trim();
	const rawChapter = raw ? parseChapterProgressValue(raw) : null;
	if (rawChapter) {
		return incrementProgressNumericString(rawChapter);
	}
	const label = item.progressLabel?.trim() ?? item.progress?.trim();
	const labelChapter = label ? parseChapterProgressValue(label) : null;
	if (!labelChapter) {
		return null;
	}
	return incrementProgressNumericString(labelChapter);
}
