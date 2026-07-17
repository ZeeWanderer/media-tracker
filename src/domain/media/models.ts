import {TFile} from "obsidian";
import type {MediaStatus, MediaType} from "./config";

export interface MediaItem {
	file: TFile;
	title: string;
	alternateTitles: string[];
	type: MediaType;
	status: MediaStatus;
	author?: string;
	progress?: string;
	progressRaw?: string;
	progressLabel?: string;
	progressUnit?: string;
	season?: number;
	episode?: number;
	repeatProgress?: string;
	repeatProgressRaw?: string;
	repeatProgressLabel?: string;
	repeatProgressUnit?: string;
	repeatSeason?: number;
	repeatEpisode?: number;
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
