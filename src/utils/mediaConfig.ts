import {MediaType, NewMediaFieldConfig} from "../types";

const NOVEL_FIELDS: NewMediaFieldConfig[] = [
	{
		key: "author",
		label: "Author",
		placeholder: "Author",
	},
	{
		key: "progress",
		label: "Progress",
		description: "Chapter, volume, or other progress note.",
		placeholder: "1",
	},
];

const SERIES_FIELDS: NewMediaFieldConfig[] = [
	{
		key: "season",
		label: "Season",
		placeholder: "2",
		inputType: "number",
	},
	{
		key: "episode",
		label: "Episode",
		placeholder: "5",
		inputType: "number",
	},
];

const MOVIE_FIELDS: NewMediaFieldConfig[] = [
	{
		key: "year",
		label: "Year",
		placeholder: "2024",
		inputType: "number",
	},
];

export const MEDIA_TYPE_CONFIGS: Array<{type: MediaType; label: string; fields: NewMediaFieldConfig[]}> = [
	{type: "novel", label: "Novel", fields: NOVEL_FIELDS},
	{type: "manga", label: "Manga", fields: NOVEL_FIELDS},
	{type: "series", label: "Series", fields: SERIES_FIELDS},
	{type: "anime", label: "Anime", fields: SERIES_FIELDS},
	{type: "movie", label: "Movie", fields: MOVIE_FIELDS},
];

export const MEDIA_TYPES: MediaType[] = MEDIA_TYPE_CONFIGS.map((config) => config.type);

export const MEDIA_TYPE_LABELS = Object.fromEntries(
	MEDIA_TYPE_CONFIGS.map((config) => [config.type, config.label]),
) as Record<MediaType, string>;

export const MEDIA_TYPE_FIELDS = Object.fromEntries(
	MEDIA_TYPE_CONFIGS.map((config) => [config.type, config.fields]),
) as Record<MediaType, NewMediaFieldConfig[]>;

export const TMDB_TYPES = new Set<MediaType>(["series", "anime"]);
export const IMDB_TYPES = new Set<MediaType>(["series", "anime", "movie"]);
export const NOVEL_PROGRESS_TYPES = new Set<MediaType>(["novel", "manga"]);
export const SEASON_EPISODE_TYPES = new Set<MediaType>(["series", "anime"]);
