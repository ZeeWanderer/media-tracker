export type AniListRelationType =
	| "PREQUEL"
	| "SEQUEL"
	| "SIDE_STORY"
	| "SPIN_OFF"
	| "OTHER"
	| "SUMMARY"
	| "ALTERNATIVE"
	| "PARENT"
	| "CHARACTER"
	| "COMPILATION"
	| "CONTAINS";

export type AniListMediaTitle = {
	romaji?: string | null;
	english?: string | null;
	native?: string | null;
};

export type AniListMedia = {
	id: number;
	type: "ANIME" | "MANGA";
	title?: AniListMediaTitle | null;
	format?: string | null;
	episodes?: number | null;
	chapters?: number | null;
	volumes?: number | null;
	nextAiringEpisode?: {episode: number; airingAt: number} | null;
	relations?: {
		edges?: Array<{
			relationType?: AniListRelationType;
			node?: AniListMedia | null;
		}>;
	} | null;
};

export type AniListLatestLookupRequest = {
	anilistId: number;
	mediaType: "anime" | "manga";
	knownSeasonIds?: number[];
	knownSeasonEpisodes?: Record<string, number>;
	minDelayMs: number;
	maxDepth?: number;
};

export type AniListLatestLookup = {
	media: AniListMedia;
	seasonIds: number[];
	seasonTotal?: number;
	seasonNumber?: number;
	seasonEpisodes?: Record<string, number>;
	latestEpisode?: number;
	nextEpisode?: number;
	nextAiringAt?: number;
};
