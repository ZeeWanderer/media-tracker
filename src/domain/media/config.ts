import type {MediaStatus, MediaType} from "../../types";

export const MEDIA_TYPES: MediaType[] = ["novel", "manga", "series", "anime", "movie"];
export const MEDIA_STATUSES: MediaStatus[] = ["planned", "active", "completed", "on-hold", "dropped"];

export const MEDIA_TYPES_SET = new Set<MediaType>(MEDIA_TYPES);
export const MEDIA_STATUSES_SET = new Set<MediaStatus>(MEDIA_STATUSES);

export const TMDB_TYPES = new Set<MediaType>(["series", "anime"]);
export const ANILIST_TYPES = new Set<MediaType>(["anime", "manga"]);
export const IMDB_TYPES = new Set<MediaType>(["series", "anime", "movie"]);
export const NOVEL_PROGRESS_TYPES = new Set<MediaType>(["novel", "manga"]);
export const SEASON_EPISODE_TYPES = new Set<MediaType>(["series", "anime"]);
