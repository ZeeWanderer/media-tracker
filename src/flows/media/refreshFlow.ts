import {App, Notice} from "obsidian";
import {MediaTrackerSettings} from "../../settings";
import {MediaItem} from "../../types";
import {ANILIST_TYPES, TMDB_TYPES} from "../../domain/media/config";
import {refreshAniListLatest} from "./providers/anilistProviderFlow";
import {refreshTmdbSeriesLatest} from "./providers/tmdbProviderFlow";

type RefreshResult = {
	provider: "anilist" | "tmdb" | "none";
	updated: boolean;
};

export async function refreshTrackedMediaLatest(
	app: App,
	settings: MediaTrackerSettings,
	item: MediaItem,
): Promise<RefreshResult> {
	const minDelayMs = settings.tmdbMinIntervalMs;
	if (item.type === "manga") {
		const updated = await refreshAniListLatest(app, item, minDelayMs);
		return {provider: "anilist", updated};
	}
	if (item.type === "anime") {
		const ok = await refreshAniListLatest(app, item, minDelayMs);
		if (!ok && TMDB_TYPES.has(item.type)) {
			const tmdbUpdated = await refreshTmdbSeriesLatest(app, settings, item, minDelayMs);
			return {provider: "tmdb", updated: tmdbUpdated};
		}
		return {provider: "anilist", updated: ok};
	}
	if (TMDB_TYPES.has(item.type)) {
		const tmdbUpdated = await refreshTmdbSeriesLatest(app, settings, item, minDelayMs);
		return {provider: "tmdb", updated: tmdbUpdated};
	}
	new Notice(`${item.title}: no refresh provider for ${item.type}.`);
	return {provider: "none", updated: false};
}

export async function refreshTrackedMedia(
	app: App,
	settings: MediaTrackerSettings,
	items: MediaItem[],
	onProgress?: (current: number, total: number) => void,
): Promise<void> {
	const targets = items.filter((item) => TMDB_TYPES.has(item.type) || ANILIST_TYPES.has(item.type));
	const total = targets.length;
	let index = 0;
	let anilistUpdated = 0;
	let tmdbUpdated = 0;
	for (const item of targets) {
		index += 1;
		onProgress?.(index, total);
		const result = await refreshTrackedMediaLatest(app, settings, item);
		if (result.provider === "anilist" && result.updated) {
			anilistUpdated += 1;
		}
		if (result.provider === "tmdb" && result.updated) {
			tmdbUpdated += 1;
		}
	}
	new Notice(`Updates complete. AniList: ${anilistUpdated}, TMDb: ${tmdbUpdated}.`);
	settings.tmdbLastSync = Date.now();
}
