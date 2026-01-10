import {TFile} from "obsidian";

export type MediaType = "novel" | "series" | "movie";
export type MediaStatus = "planned" | "active" | "completed" | "on-hold" | "dropped";

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
	links: string[];
}
