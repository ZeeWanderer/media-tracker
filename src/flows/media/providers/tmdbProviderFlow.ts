import {App, TFile} from "obsidian";
import {MediaTrackerSettings} from "../../../settings";
import {MediaItem} from "../../../types";
import {fetchTmdbLatestEpisode, findTmdbTvIdByImdb} from "../../../infra/api/tmdbApi";
import {updateMediaSnapshot} from "../../../domain/media";
import {extractImdbId, getImdbIdFromLinks} from "../../../domain/media/links";

export type TmdbRefreshResult = {
	provider: "tmdb";
	status: "updated" | "unchanged" | "failed";
	message: string;
};

function delay(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sanitizeSeasonEpisodes(map: Record<string, number>): Record<string, number> | undefined {
	const entries = Object.entries(map)
		.filter(([key, val]) => Number.isFinite(Number(key)) && Number.isFinite(Number(val)));
	if (!entries.length) {
		return undefined;
	}
	return Object.fromEntries(entries.map(([key, val]) => [String(Number(key)), Number(val)]));
}

function sameNumberRecord(a: Record<string, number> | undefined, b: Record<string, number> | undefined): boolean {
	const leftEntries = Object.entries(a ?? {}).sort((x, y) => Number(x[0]) - Number(y[0]));
	const rightEntries = Object.entries(b ?? {}).sort((x, y) => Number(x[0]) - Number(y[0]));
	if (leftEntries.length !== rightEntries.length) {
		return false;
	}
	return leftEntries.every(([leftKey, leftVal], index) => {
		const [rightKey, rightVal] = rightEntries[index] ?? [];
		return leftKey === rightKey && leftVal === rightVal;
	});
}

async function updateSeriesFrontmatter(
	app: App,
	file: TFile,
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
	await updateMediaSnapshot(app, file, (snapshot) => {
		if (payload.tmdbId !== undefined) {
			snapshot.tmdbId = payload.tmdbId;
		}
		snapshot.tmdbLastChecked = payload.lastChecked;
		let nextSeasonEpisodes = payload.seasonEpisodes
			? sanitizeSeasonEpisodes(payload.seasonEpisodes)
			: sanitizeSeasonEpisodes(snapshot.tmdbSeasonEpisodes ?? {});
		if (!payload.seasonEpisodes
			&& payload.seasonEpisodeCount !== undefined
			&& payload.season !== undefined) {
			const current = {...(nextSeasonEpisodes ?? {})};
			current[String(payload.season)] = payload.seasonEpisodeCount;
			nextSeasonEpisodes = sanitizeSeasonEpisodes(current);
		}
		snapshot.tmdbSeasonEpisodes = nextSeasonEpisodes;
		if (payload.season !== undefined) {
			snapshot.tmdbLatestSeason = payload.season;
		}
		if (payload.episode !== undefined) {
			snapshot.tmdbLatestEpisode = payload.episode;
		}
		if (payload.seasonEpisodeCount !== undefined) {
			snapshot.tmdbLatestSeasonEpisodes = payload.seasonEpisodeCount;
		}
		if (payload.airDate) {
			snapshot.tmdbLatestAirDate = payload.airDate;
		}
		if (payload.name) {
			snapshot.tmdbLatestName = payload.name;
		}
	});
}

async function storeSeriesTmdbId(app: App, file: TFile, tmdbId: number) {
	await updateMediaSnapshot(app, file, (snapshot) => {
		snapshot.tmdbId = tmdbId;
	});
}

async function storeSeriesImdbId(app: App, file: TFile, imdbId: string) {
	await updateMediaSnapshot(app, file, (snapshot) => {
		snapshot.imdbId = imdbId;
	});
}

export async function refreshTmdbSeriesLatest(
	app: App,
	settings: MediaTrackerSettings,
	item: MediaItem,
	minDelayMs: number,
): Promise<TmdbRefreshResult> {
	if (!settings.tmdbApiKey) {
		return {
			provider: "tmdb",
			status: "failed",
			message: "Set a TMDb API key in settings.",
		};
	}

	const linkImdbId = getImdbIdFromLinks(item.links ?? []);
	const imdbId = item.imdbId ?? linkImdbId;
	if (!imdbId && !item.tmdbId) {
		return {
			provider: "tmdb",
			status: "failed",
			message: "Series needs an IMDB ID or TMDb ID.",
		};
	}

	const apiKey = settings.tmdbApiKey;
	try {
		let tmdbId: number | undefined = item.tmdbId;
		if (!tmdbId && imdbId) {
			const normalized = extractImdbId(imdbId);
			if (!normalized) {
				return {
					provider: "tmdb",
					status: "failed",
					message: "IMDB ID not found in link.",
				};
			}
			const found = await findTmdbTvIdByImdb(normalized, apiKey);
			tmdbId = found ?? undefined;
			if (tmdbId) {
				await storeSeriesTmdbId(app, item.file, tmdbId);
			}
			if (!item.imdbId) {
				await storeSeriesImdbId(app, item.file, normalized);
			}
		}
		if (!tmdbId) {
			return {
				provider: "tmdb",
				status: "failed",
				message: "TMDb ID not found for this series.",
			};
		}

		const latest = await fetchTmdbLatestEpisode(tmdbId, apiKey);
		const seasonEpisodeCount = latest?.episode ?? undefined;
		const nextSeason = latest?.season;
		const nextEpisode = latest?.episode;
		const nextSeasonEpisodes = latest?.seasonEpisodes;
		const nextAirDate = latest?.airDate;
		const nextName = latest?.name;
		const changed = nextSeason !== item.tmdbLatestSeason
			|| nextEpisode !== item.tmdbLatestEpisode
			|| !sameNumberRecord(nextSeasonEpisodes, item.tmdbSeasonEpisodes)
			|| nextAirDate !== item.tmdbLatestAirDate
			|| nextName !== item.tmdbLatestName;

		await updateSeriesFrontmatter(app, item.file, {
			tmdbId,
			lastChecked: Date.now(),
			season: nextSeason,
			episode: nextEpisode,
			seasonEpisodeCount,
			seasonEpisodes: nextSeasonEpisodes,
			airDate: nextAirDate,
			name: nextName,
		});

		await delay(minDelayMs);
		if (nextSeason && nextEpisode) {
			return {
				provider: "tmdb",
				status: changed ? "updated" : "unchanged",
				message: `TMDb latest S${nextSeason}E${nextEpisode}.`,
			};
		}
		return {
			provider: "tmdb",
			status: changed ? "updated" : "unchanged",
			message: "TMDb did not return a latest episode.",
		};
	} catch {
		return {
			provider: "tmdb",
			status: "failed",
			message: "TMDb request failed. Check API key and network.",
		};
	}
}
