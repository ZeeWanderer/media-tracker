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
	links: {
		patreon?: string | null;
		kemono?: string | null;
		royalroad?: string | null;
		imdb?: string | null;
		hdrezka?: string | null;
	};
	extraLinks?: Array<{label: string; url: string}>;
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
	patreon?: string;
	kemono?: string;
	royalroad?: string;
	imdb?: string;
}
