import {MEDIA_TYPES} from "./config";
import {buildProgressDisplay, buildRepeatProgressDisplay} from "./progress";
import type {MediaRecord} from "./models";
import type {LatestMediaSnapshot} from "./schema";

export type MediaRecordSource = {
	basename: string;
	parentName?: string;
	parentPath?: string;
	baseFolder: string;
};

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TYPE_FILE_BASENAME_REGEX = new RegExp(
	`^(?:${MEDIA_TYPES.map((type) => escapeRegex(type)).join("|")})(?:-\\d+)?$`,
	"i",
);

function resolveFallbackTitle(source: MediaRecordSource): string {
	const baseFolder = source.baseFolder.replace(/\/+$/, "");
	const isNestedMediaFile = source.parentPath !== undefined
		&& source.parentName !== undefined
		&& source.parentPath !== baseFolder
		&& source.parentPath.startsWith(`${baseFolder}/`)
		&& TYPE_FILE_BASENAME_REGEX.test(source.basename.trim());
	return isNestedMediaFile ? source.parentName ?? source.basename : source.basename;
}

export function mapMediaSnapshotToRecord(
	snapshot: LatestMediaSnapshot,
	source: MediaRecordSource,
): MediaRecord | null {
	const type = snapshot.type;
	if (!type) {
		return null;
	}

	return {
		title: snapshot.title ?? resolveFallbackTitle(source),
		alternateTitles: [...(snapshot.alternateTitles ?? [])],
		type,
		status: snapshot.status,
		author: snapshot.author,
		progress: buildProgressDisplay(type, snapshot),
		progressRaw: snapshot.progress,
		progressLabel: snapshot.progressLabel,
		progressUnit: snapshot.progressUnit,
		season: snapshot.season,
		episode: snapshot.episode,
		repeatProgress: buildRepeatProgressDisplay(type, snapshot),
		repeatProgressRaw: snapshot.repeatProgress,
		repeatProgressLabel: snapshot.repeatProgressLabel,
		repeatProgressUnit: snapshot.repeatProgressUnit,
		repeatSeason: snapshot.repeatSeason,
		repeatEpisode: snapshot.repeatEpisode,
		year: snapshot.year,
		links: [...snapshot.links],
		imdbId: snapshot.imdbId,
		tmdbId: snapshot.tmdbId,
		tmdbLastChecked: snapshot.tmdbLastChecked,
		tmdbLatestSeason: snapshot.tmdbLatestSeason,
		tmdbLatestEpisode: snapshot.tmdbLatestEpisode,
		tmdbLatestSeasonEpisodes: snapshot.tmdbLatestSeasonEpisodes,
		tmdbSeasonEpisodes: snapshot.tmdbSeasonEpisodes ? {...snapshot.tmdbSeasonEpisodes} : undefined,
		tmdbLatestAirDate: snapshot.tmdbLatestAirDate,
		tmdbLatestName: snapshot.tmdbLatestName,
		anilistId: snapshot.anilistId,
		anilistIds: snapshot.anilistIds ? [...snapshot.anilistIds] : undefined,
		anilistLastChecked: snapshot.anilistLastChecked,
		anilistLatestEpisode: snapshot.anilistLatestEpisode,
		anilistNextEpisode: snapshot.anilistNextEpisode,
		anilistNextAiringAt: snapshot.anilistNextAiringAt,
		anilistChapters: snapshot.anilistChapters,
		anilistVolumes: snapshot.anilistVolumes,
		anilistSeason: snapshot.anilistSeason,
		anilistSeasonTotal: snapshot.anilistSeasonTotal,
		anilistSeasonEpisodes: snapshot.anilistSeasonEpisodes ? {...snapshot.anilistSeasonEpisodes} : undefined,
	};
}

export function getTitleSortKey(title: string): string {
	return title.trim().replace(/^the\s+/i, "");
}
