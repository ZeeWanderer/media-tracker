import {App, Notice} from "obsidian";
import {MediaItem} from "../types";
import {MediaTrackerSettings} from "../settings";
import {refreshAniListLatest} from "./anilist";
import {refreshSeriesLatest} from "./tmdb";
import {ANILIST_TYPES, TMDB_TYPES} from "./mediaConfig";

type RefreshResult = {
	provider: "anilist" | "tmdb" | "none";
	updated: boolean;
};

export async function refreshMediaLatest(
	app: App,
	settings: MediaTrackerSettings,
	item: MediaItem,
	minDelayMs: number,
): Promise<RefreshResult> {
	if (item.type === "manga") {
		const updated = await refreshAniListLatest(app, settings, item, minDelayMs);
		return {provider: "anilist", updated};
	}
	if (item.type === "anime") {
		const ok = await refreshAniListLatest(app, settings, item, minDelayMs);
		if (!ok && TMDB_TYPES.has(item.type)) {
			await refreshSeriesLatest(app, settings, item, minDelayMs);
			return {provider: "tmdb", updated: true};
		}
		return {provider: "anilist", updated: ok};
	}
	if (TMDB_TYPES.has(item.type)) {
		await refreshSeriesLatest(app, settings, item, minDelayMs);
		return {provider: "tmdb", updated: true};
	}
	new Notice(`${item.title}: no refresh provider for ${item.type}.`);
	return {provider: "none", updated: false};
}

export async function refreshAllMedia(
	app: App,
	settings: MediaTrackerSettings,
	items: MediaItem[],
	onProgress?: (current: number, total: number) => void,
) {
	const targets = items.filter((item) => TMDB_TYPES.has(item.type) || ANILIST_TYPES.has(item.type));
	const total = targets.length;
	let index = 0;
	let anilistUpdated = 0;
	let tmdbUpdated = 0;
	for (const item of targets) {
		index += 1;
		onProgress?.(index, total);
		const result = await refreshMediaLatest(app, settings, item, settings.tmdbMinIntervalMs);
		if (result.provider === "anilist" && result.updated) {
			anilistUpdated += 1;
		}
		if (result.provider === "tmdb" && result.updated) {
			tmdbUpdated += 1;
		}
	}
	new Notice(`Updates complete. AniList: ${anilistUpdated}, TMDb: ${tmdbUpdated}.`);
}
