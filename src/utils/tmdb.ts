import {App, Notice, requestUrl} from "obsidian";
import {MediaItem} from "../types";
import {MediaTrackerSettings} from "../settings";
import {extractImdbId, getImdbIdFromLinks} from "./links";

const TMDB_BASE = "https://api.themoviedb.org/3";

function delay(ms: number) {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function tmdbRequest<T>(path: string, apiKey: string) {
	const url = `${TMDB_BASE}${path}${path.includes("?") ? "&" : "?"}api_key=${apiKey}`;
	try {
		const response = await requestUrl({url});
		return response.json as T;
	} catch (error) {
		throw new Error(`TMDb request failed for ${path}`);
	}
}

async function findTmdbIdByImdb(imdbId: string, apiKey: string): Promise<number | null> {
	type FindResponse = {tv_results?: Array<{id: number}>};
	const data = await tmdbRequest<FindResponse>(`/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`, apiKey);
	return data.tv_results?.[0]?.id ?? null;
}

async function fetchLatestEpisode(tmdbId: number, apiKey: string) {
	type TvResponse = {
		last_episode_to_air?: {season_number: number; episode_number: number; air_date?: string; name?: string};
		seasons?: Array<{season_number: number; episode_count?: number}>;
	};
	const data = await tmdbRequest<TvResponse>(`/tv/${tmdbId}`, apiKey);
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

function buildSeasonEpisodes(seasons?: Array<{season_number: number; episode_count?: number}>): Record<string, number> | undefined {
	if (!seasons?.length) {
		return undefined;
	}
	const entries = seasons
		.filter((season) => Number.isFinite(season.season_number) && Number.isFinite(season.episode_count))
		.map((season) => [String(season.season_number), Number(season.episode_count)]);
	if (!entries.length) {
		return undefined;
	}
	return Object.fromEntries(entries);
}

async function updateSeriesFrontmatter(
	app: App,
	file: import("obsidian").TFile,
	payload: {
		tmdbId?: number;
		lastChecked: number;
		season?: number;
		episode?: number;
		seasonEpisodeCount?: number;
		seasonEpisodes?: Record<string, number>;
		airDate?: string;
		name?: string;
	},
) {
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter) {
			return;
		}
		if (payload.tmdbId) {
			frontmatter.tmdbId = payload.tmdbId;
		}
		frontmatter.tmdbLastChecked = payload.lastChecked;
		const cleanedSeasonEpisodes = payload.seasonEpisodes
			? sanitizeSeasonEpisodes(payload.seasonEpisodes)
			: undefined;
		const encodedSeasonEpisodes = cleanedSeasonEpisodes
			? JSON.stringify(cleanedSeasonEpisodes)
			: undefined;
		const hasExistingSeasonEpisodes = Object.keys(coerceSeasonEpisodes(frontmatter.tmdbSeasonEpisodes)).length > 0;
		if (cleanedSeasonEpisodes) {
			frontmatter.tmdbSeasonEpisodes = encodedSeasonEpisodes;
			delete frontmatter.tmdbLatestSeasonEpisodes;
			delete frontmatter.tmdbLatestSeason;
			delete frontmatter.tmdbLatestEpisode;
		} else if (!hasExistingSeasonEpisodes && payload.season !== undefined) {
			frontmatter.tmdbLatestSeason = payload.season;
		}
		if (!cleanedSeasonEpisodes && !hasExistingSeasonEpisodes && payload.episode !== undefined) {
			frontmatter.tmdbLatestEpisode = payload.episode;
		} else if (payload.seasonEpisodeCount !== undefined) {
			if (!hasExistingSeasonEpisodes) {
				frontmatter.tmdbLatestSeasonEpisodes = payload.seasonEpisodeCount;
			}
			if (payload.season !== undefined) {
				const current = coerceSeasonEpisodes(frontmatter.tmdbSeasonEpisodes);
				current[String(payload.season)] = payload.seasonEpisodeCount;
				frontmatter.tmdbSeasonEpisodes = JSON.stringify(current);
			}
		} else if (frontmatter.tmdbSeasonEpisodes && Object.keys(coerceSeasonEpisodes(frontmatter.tmdbSeasonEpisodes)).length === 0) {
			delete frontmatter.tmdbSeasonEpisodes;
		}
		if (payload.airDate) {
			frontmatter.tmdbLatestAirDate = payload.airDate;
		}
		if (payload.name) {
			frontmatter.tmdbLatestName = payload.name;
		}
	});
}

function coerceSeasonEpisodes(value: unknown): Record<string, number> {
	if (!value) {
		return {};
	}
	if (typeof value === "object") {
		return {...(value as Record<string, number>)};
	}
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as Record<string, number>;
			return {...parsed};
		} catch {
			return {};
		}
	}
	return {};
}

function sanitizeSeasonEpisodes(map: Record<string, number>): Record<string, number> | undefined {
	const entries = Object.entries(map)
		.filter(([key, val]) => Number.isFinite(Number(key)) && Number.isFinite(Number(val)));
	if (!entries.length) {
		return undefined;
	}
	return Object.fromEntries(entries.map(([key, val]) => [String(Number(key)), Number(val)]));
}

async function storeSeriesTmdbId(app: App, file: import("obsidian").TFile, tmdbId: number) {
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter) {
			return;
		}
		frontmatter.tmdbId = tmdbId;
	});
}

async function storeSeriesImdbId(app: App, file: import("obsidian").TFile, imdbId: string) {
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter) {
			return;
		}
		frontmatter.imdbId = imdbId;
	});
}

export async function refreshSeriesLatest(
	app: App,
	settings: MediaTrackerSettings,
	item: MediaItem,
	minDelayMs: number,
) {
	if (!settings.tmdbApiKey) {
		new Notice("Set a TMDb API key in settings.");
		return;
	}

	const linkImdbId = getImdbIdFromLinks(item.links ?? []);
	const imdbId = item.imdbId ?? linkImdbId;
	if (!imdbId && !item.tmdbId) {
		new Notice("Series needs an IMDB ID or TMDb ID.");
		return;
	}

	const apiKey = settings.tmdbApiKey;
	try {
		let tmdbId: number | undefined = item.tmdbId;
		if (!tmdbId && imdbId) {
			const normalized = extractImdbId(imdbId);
			if (!normalized) {
				new Notice("IMDB ID not found in link.");
				return;
			}
			const found = await findTmdbIdByImdb(normalized, apiKey);
			tmdbId = found ?? undefined;
			if (tmdbId) {
				await storeSeriesTmdbId(app, item.file, tmdbId);
			}
			if (!item.imdbId) {
				await storeSeriesImdbId(app, item.file, normalized);
			}
		}
		if (!tmdbId) {
			new Notice("TMDb ID not found for this series.");
			return;
		}

		const latest = await fetchLatestEpisode(tmdbId, apiKey);
		const seasonEpisodeCount = latest?.season && latest.seasonEpisodes
			? latest.seasonEpisodes[String(latest.season)]
			: undefined;
		await updateSeriesFrontmatter(app, item.file, {
			tmdbId,
			lastChecked: Date.now(),
			season: latest?.season,
			episode: latest?.episode,
			seasonEpisodeCount,
			seasonEpisodes: latest?.seasonEpisodes,
			airDate: latest?.airDate,
			name: latest?.name,
		});
		if (latest?.season && latest?.episode) {
			new Notice(`${item.title}: latest S${latest.season}E${latest.episode}`);
		} else {
			new Notice(`${item.title}: TMDb did not return a latest episode.`);
		}
		if (minDelayMs > 0) {
			await delay(minDelayMs);
		}
	} catch (error) {
		new Notice(`${item.title}: TMDb request failed. Check your API key and network.`);
	}
}

export async function refreshAllSeries(
	app: App,
	settings: MediaTrackerSettings,
	items: MediaItem[],
	onProgress?: (current: number, total: number) => void,
) {
	const series = items.filter((item) => item.type === "series");
	const total = series.length;
	let index = 0;
	for (const item of series) {
		index += 1;
		onProgress?.(index, total);
		await refreshSeriesLatest(app, settings, item, settings.tmdbMinIntervalMs);
	}
}
