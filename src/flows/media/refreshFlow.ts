import {App} from "obsidian";
import {MediaTrackerSettings} from "../../settings";
import {MediaItem, UpdateLogEntry, UpdateLogRun, UpdateProvider} from "../../types";
import {ANILIST_TYPES, TMDB_TYPES} from "../../domain/media/config";
import {AniListRefreshResult, refreshAniListLatest} from "./providers/anilistProviderFlow";
import {refreshTmdbSeriesLatest, TmdbRefreshResult} from "./providers/tmdbProviderFlow";

type RefreshItemResult = {
	provider: UpdateProvider;
	status: UpdateLogEntry["status"];
	message: string;
};

function toEntry(item: MediaItem, result: RefreshItemResult): UpdateLogEntry {
	return {
		title: item.title,
		filePath: item.file.path,
		type: item.type,
		provider: result.provider,
		status: result.status,
		message: result.message,
	};
}

function mapProviderResult(result: AniListRefreshResult | TmdbRefreshResult): RefreshItemResult {
	return {
		provider: result.provider,
		status: result.status,
		message: result.message,
	};
}

export async function refreshTrackedMediaLatest(
	app: App,
	settings: MediaTrackerSettings,
	item: MediaItem,
): Promise<RefreshItemResult> {
	const minDelayMs = settings.tmdbMinIntervalMs;
	if (item.type === "manga") {
		return mapProviderResult(await refreshAniListLatest(app, item, minDelayMs));
	}
	if (item.type === "anime") {
		const aniListResult = await refreshAniListLatest(app, item, minDelayMs);
		if (aniListResult.status === "failed" && TMDB_TYPES.has(item.type)) {
			return mapProviderResult(await refreshTmdbSeriesLatest(app, settings, item, minDelayMs));
		}
		return mapProviderResult(aniListResult);
	}
	if (TMDB_TYPES.has(item.type)) {
		return mapProviderResult(await refreshTmdbSeriesLatest(app, settings, item, minDelayMs));
	}
	return {
		provider: "none",
		status: "skipped",
		message: `No refresh provider for ${item.type}.`,
	};
}

export function formatRefreshRunSummary(run: UpdateLogRun): string {
	return `Update complete. ${run.total} checked · ${run.updated} updated · ${run.unchanged} unchanged · ${run.failed} failed · ${run.skipped} skipped.`;
}

export async function refreshTrackedMedia(
	app: App,
	settings: MediaTrackerSettings,
	items: MediaItem[],
	onProgress?: (current: number, total: number) => void,
): Promise<UpdateLogRun> {
	const startedAt = Date.now();
	const targets = items.filter((item) => TMDB_TYPES.has(item.type) || ANILIST_TYPES.has(item.type));
	const total = targets.length;
	const entries: UpdateLogEntry[] = [];
	let updated = 0;
	let unchanged = 0;
	let failed = 0;
	let skipped = 0;

	for (const [index, item] of targets.entries()) {
		onProgress?.(index + 1, total);
		const result = await refreshTrackedMediaLatest(app, settings, item);
		entries.push(toEntry(item, result));
		switch (result.status) {
			case "updated":
				updated += 1;
				break;
			case "unchanged":
				unchanged += 1;
				break;
			case "failed":
				failed += 1;
				break;
			case "skipped":
			default:
				skipped += 1;
				break;
		}
	}

	settings.tmdbLastSync = Date.now();
	const finishedAt = Date.now();
	return {
		startedAt,
		finishedAt,
		durationMs: Math.max(0, finishedAt - startedAt),
		total,
		updated,
		unchanged,
		failed,
		skipped,
		entries,
	};
}
