import {TFile} from "obsidian";

export type MediaType = "novel" | "manga" | "series" | "anime" | "movie";
export type MediaStatus = "planned" | "active" | "completed" | "on-hold" | "dropped";
export type UpdateNotificationMode = "quiet" | "summary" | "verbose";
export type UpdateProvider = "anilist" | "tmdb" | "none";
export type UpdateEntryStatus = "updated" | "unchanged" | "failed" | "skipped";

export interface MediaItem {
	file: TFile;
	title: string;
	type: MediaType;
	status: MediaStatus;
	author?: string;
	progress?: string;
	progressRaw?: string;
	progressLabel?: string;
	season?: number;
	episode?: number;
	year?: number;
	links: string[];
	imdbId?: string;
	tmdbId?: number;
	tmdbLastChecked?: number;
	tmdbLatestSeason?: number;
	tmdbLatestEpisode?: number;
	tmdbLatestSeasonEpisodes?: number;
	tmdbSeasonEpisodes?: Record<string, number>;
	tmdbLatestAirDate?: string;
	tmdbLatestName?: string;
	anilistId?: number;
	anilistIds?: number[];
	anilistLastChecked?: number;
	anilistLatestEpisode?: number;
	anilistNextEpisode?: number;
	anilistNextAiringAt?: number;
	anilistChapters?: number;
	anilistVolumes?: number;
	anilistSeason?: number;
	anilistSeasonTotal?: number;
	anilistSeasonEpisodes?: Record<string, number>;
}

export interface NewMediaDraft {
	title: string;
	type: MediaType;
	status: MediaStatus;
	author?: string;
	progress?: string;
	season?: string;
	episode?: string;
	year?: string;
	imdbId?: string;
	anilistId?: string;
	links: string[];
}

export interface UpdateLogEntry {
	title: string;
	filePath: string;
	type: MediaType;
	provider: UpdateProvider;
	status: UpdateEntryStatus;
	message: string;
}

export interface UpdateLogRun {
	startedAt: number;
	finishedAt: number;
	durationMs: number;
	total: number;
	updated: number;
	unchanged: number;
	failed: number;
	skipped: number;
	entries: UpdateLogEntry[];
}

export type NewMediaFieldConfig = {
	key: keyof NewMediaDraft;
	label: string;
	placeholder?: string;
	description?: string;
	inputType?: "text" | "number";
};
