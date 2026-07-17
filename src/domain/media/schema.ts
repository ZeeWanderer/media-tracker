import {
	MEDIA_STATUSES,
	MEDIA_TYPES,
	type MediaStatus,
	type MediaType,
} from "./config";

export const CURRENT_MEDIA_SCHEMA_VERSION = 5;
export const MEDIA_SCHEMA_VERSION_KEY = "mediaTrackerVersion";

export const MEDIA_TYPE_VALUES: MediaType[] = [...MEDIA_TYPES];
export const MEDIA_STATUS_VALUES: MediaStatus[] = [...MEDIA_STATUSES];

export type MediaSchemaVersion = typeof CURRENT_MEDIA_SCHEMA_VERSION;

export interface MediaSnapshotV4 {
	version: 4;
	type?: MediaType;
	status: MediaStatus;
	title?: string;
	alternateTitles?: string[];
	author?: string;
	progress?: string;
	progressLabel?: string;
	progressUnit?: string;
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

export interface MediaSnapshotV5 extends Omit<MediaSnapshotV4, "version"> {
	version: MediaSchemaVersion;
	repeatProgress?: string;
	repeatProgressLabel?: string;
	repeatProgressUnit?: string;
	repeatSeason?: number;
	repeatEpisode?: number;
}

export type LatestMediaSnapshot = MediaSnapshotV5;

export type MediaFrontmatterFieldKind =
	| "string"
	| "number"
	| "string-array"
	| "number-array"
	| "number-record";

export type MediaFrontmatterFieldSchema = {
	kind: MediaFrontmatterFieldKind;
	required?: boolean;
	enumValues?: readonly string[];
	defaultValue?: string | number | string[] | number[] | Record<string, number>;
	description?: string;
};

export type MediaFrontmatterSchema = {
	version: MediaSchemaVersion;
	versionKey: string;
	fields: Record<string, MediaFrontmatterFieldSchema>;
};

export const MEDIA_FRONTMATTER_SCHEMA: MediaFrontmatterSchema = {
	version: CURRENT_MEDIA_SCHEMA_VERSION,
	versionKey: MEDIA_SCHEMA_VERSION_KEY,
	fields: {
		type: {
			kind: "string",
			required: true,
			enumValues: MEDIA_TYPE_VALUES,
			description: "Media kind.",
		},
		status: {
			kind: "string",
			enumValues: MEDIA_STATUS_VALUES,
			defaultValue: "planned",
			description: "Tracking status.",
		},
		title: {kind: "string"},
		alternateTitles: {kind: "string-array"},
		author: {kind: "string"},
		progress: {kind: "string"},
		progressLabel: {kind: "string"},
		progressUnit: {kind: "string"},
		season: {kind: "number"},
		episode: {kind: "number"},
		repeatProgress: {kind: "string"},
		repeatProgressLabel: {kind: "string"},
		repeatProgressUnit: {kind: "string"},
		repeatSeason: {kind: "number"},
		repeatEpisode: {kind: "number"},
		year: {kind: "number"},
		imdbId: {kind: "string"},
		anilistId: {kind: "number"},
		anilistIds: {kind: "number-array"},
		links: {kind: "string-array"},
		tmdbId: {kind: "number"},
		tmdbLastChecked: {kind: "number"},
		tmdbLatestSeason: {kind: "number"},
		tmdbLatestEpisode: {kind: "number"},
		tmdbLatestSeasonEpisodes: {kind: "number"},
		tmdbSeasonEpisodes: {kind: "number-record"},
		tmdbLatestAirDate: {kind: "string"},
		tmdbLatestName: {kind: "string"},
		anilistLastChecked: {kind: "number"},
		anilistLatestEpisode: {kind: "number"},
		anilistNextEpisode: {kind: "number"},
		anilistNextAiringAt: {kind: "number"},
		anilistChapters: {kind: "number"},
		anilistVolumes: {kind: "number"},
		anilistSeason: {kind: "number"},
		anilistSeasonTotal: {kind: "number"},
		anilistSeasonEpisodes: {kind: "number-record"},
	},
};
