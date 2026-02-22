export const MEDIA_TYPES = ["novel", "manga", "series", "anime", "movie"] as const;
export type MediaType = typeof MEDIA_TYPES[number];

export const MEDIA_STATUSES = ["planned", "active", "completed", "on-hold", "dropped"] as const;
export type MediaStatus = typeof MEDIA_STATUSES[number];

export const TMDB_TYPES = new Set<MediaType>(["series", "anime"]);
export const ANILIST_TYPES = new Set<MediaType>(["anime", "manga"]);
export const IMDB_TYPES = new Set<MediaType>(["series", "anime", "movie"]);
export const NOVEL_PROGRESS_TYPES = new Set<MediaType>(["novel", "manga"]);
export const SEASON_EPISODE_TYPES = new Set<MediaType>(["series", "anime"]);
