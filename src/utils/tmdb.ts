import {App, Notice, requestUrl} from "obsidian";
import {MediaItem} from "../types";
import {MediaTrackerSettings} from "../settings";

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

function extractImdbId(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.startsWith("tt")) {
		return trimmed;
	}
	const match = trimmed.match(/tt\d{7,}/);
	return match ? match[0] : null;
}

async function fetchLatestEpisode(tmdbId: number, apiKey: string) {
	type TvResponse = {
		last_episode_to_air?: {season_number: number; episode_number: number; air_date?: string; name?: string};
	};
	const data = await tmdbRequest<TvResponse>(`/tv/${tmdbId}`, apiKey);
	if (!data.last_episode_to_air) {
		return null;
	}
	return {
		season: data.last_episode_to_air.season_number,
		episode: data.last_episode_to_air.episode_number,
		airDate: data.last_episode_to_air.air_date,
		name: data.last_episode_to_air.name,
	};
}

async function updateSeriesFrontmatter(
	app: App,
	file: import("obsidian").TFile,
	payload: {
		tmdbId?: number;
		lastChecked: number;
		season?: number;
		episode?: number;
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
		if (payload.season !== undefined) {
			frontmatter.tmdbLatestSeason = payload.season;
		}
		if (payload.episode !== undefined) {
			frontmatter.tmdbLatestEpisode = payload.episode;
		}
		if (payload.airDate) {
			frontmatter.tmdbLatestAirDate = payload.airDate;
		}
		if (payload.name) {
			frontmatter.tmdbLatestName = payload.name;
		}
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
	if (!item.links.imdb && !item.tmdbId) {
		new Notice("Series needs an IMDB ID or TMDb ID.");
		return;
	}

	const apiKey = settings.tmdbApiKey;
	try {
		let tmdbId: number | undefined = item.tmdbId;
		if (!tmdbId && item.links.imdb) {
			const imdbId = extractImdbId(item.links.imdb);
			if (!imdbId) {
				new Notice("IMDB ID not found in link.");
				return;
			}
			const found = await findTmdbIdByImdb(imdbId, apiKey);
			tmdbId = found ?? undefined;
		}
		if (!tmdbId) {
			new Notice("TMDb ID not found for this series.");
			return;
		}

		const latest = await fetchLatestEpisode(tmdbId, apiKey);
		await updateSeriesFrontmatter(app, item.file, {
			tmdbId,
			lastChecked: Date.now(),
			season: latest?.season,
			episode: latest?.episode,
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
