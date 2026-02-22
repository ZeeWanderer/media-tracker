import {requestUrl} from "obsidian";

const TMDB_BASE = "https://api.themoviedb.org/3";

export type TmdbLatestEpisode = {
	season?: number;
	episode?: number;
	airDate?: string;
	name?: string;
	seasonEpisodes?: Record<string, number>;
};

type TmdbFindResponse = {tv_results?: Array<{id: number}>};
type TmdbTvResponse = {
	last_episode_to_air?: {
		season_number: number;
		episode_number: number;
		air_date?: string;
		name?: string;
	};
	seasons?: Array<{season_number: number; episode_count?: number}>;
};

async function tmdbRequest<T>(path: string, apiKey: string): Promise<T> {
	const url = `${TMDB_BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${apiKey}`;
	try {
		const response = await requestUrl({url});
		return response.json as T;
	} catch {
		throw new Error(`TMDb request failed for ${path}`);
	}
}

export async function findTmdbTvIdByImdb(imdbId: string, apiKey: string): Promise<number | null> {
	const data = await tmdbRequest<TmdbFindResponse>(
		`/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`,
		apiKey,
	);
	return data.tv_results?.[0]?.id ?? null;
}

function buildSeasonEpisodes(seasons?: Array<{season_number: number; episode_count?: number}>): Record<string, number> | undefined {
	if (!seasons?.length) {
		return undefined;
	}
	const seasonEpisodes: Record<string, number> = {};
	for (const season of seasons) {
		if (!Number.isFinite(season.season_number) || !Number.isFinite(season.episode_count)) {
			continue;
		}
		seasonEpisodes[String(season.season_number)] = Number(season.episode_count);
	}
	if (Object.keys(seasonEpisodes).length === 0) {
		return undefined;
	}
	return seasonEpisodes;
}

export async function fetchTmdbLatestEpisode(tmdbId: number, apiKey: string): Promise<TmdbLatestEpisode> {
	const data = await tmdbRequest<TmdbTvResponse>(`/tv/${tmdbId}`, apiKey);
	if (!data.last_episode_to_air) {
		return {
			season: undefined,
			episode: undefined,
			airDate: undefined,
			name: undefined,
			seasonEpisodes: buildSeasonEpisodes(data.seasons),
		};
	}
	return {
		season: data.last_episode_to_air.season_number,
		episode: data.last_episode_to_air.episode_number,
		airDate: data.last_episode_to_air.air_date,
		name: data.last_episode_to_air.name,
		seasonEpisodes: buildSeasonEpisodes(data.seasons),
	};
}
