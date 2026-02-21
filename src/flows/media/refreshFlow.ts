import {App} from "obsidian";
import {MediaTrackerSettings} from "../../settings";
import {MediaItem, UpdateLogEntry, UpdateLogRun, UpdateProvider} from "../../types";
import {ANILIST_TYPES, TMDB_TYPES} from "../../domain/media/config";
import {getImdbIdFromLinks} from "../../domain/media/links";
import {AniListRefreshResult, refreshAniListLatest} from "./providers/anilistProviderFlow";
import {refreshTmdbSeriesLatest, TmdbRefreshResult} from "./providers/tmdbProviderFlow";

type RefreshItemResult = {
	provider: UpdateProvider;
	status: UpdateLogEntry["status"];
	message: string;
};

type RefreshQueue = "anilist" | "tmdb";

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

function getRefreshQueue(item: MediaItem): RefreshQueue | null {
	if (ANILIST_TYPES.has(item.type)) {
		return "anilist";
	}
	if (TMDB_TYPES.has(item.type)) {
		return "tmdb";
	}
	return null;
}

function toUnexpectedFailure(queue: RefreshQueue, error: unknown): RefreshItemResult {
	const detail = error instanceof Error ? error.message : String(error);
	return {
		provider: queue,
		status: "failed",
		message: `Unexpected refresh error: ${detail}`,
	};
}

export async function refreshTrackedMediaLatest(
	app: App,
	settings: MediaTrackerSettings,
	item: MediaItem,
): Promise<RefreshItemResult> {
	const tmdbMinDelayMs = settings.tmdbMinIntervalMs;
	const anilistMinDelayMs = 0;
	if (item.type === "manga") {
		return mapProviderResult(await refreshAniListLatest(app, item, anilistMinDelayMs));
	}
	if (item.type === "anime") {
		const aniListResult = await refreshAniListLatest(app, item, anilistMinDelayMs);
		const hasTmdbIdentity = Boolean(item.tmdbId || item.imdbId || getImdbIdFromLinks(item.links ?? []));
		if (aniListResult.status === "failed" && TMDB_TYPES.has(item.type) && hasTmdbIdentity) {
			return mapProviderResult(await refreshTmdbSeriesLatest(app, settings, item, tmdbMinDelayMs));
		}
		return mapProviderResult(aniListResult);
	}
	if (TMDB_TYPES.has(item.type)) {
		return mapProviderResult(await refreshTmdbSeriesLatest(app, settings, item, tmdbMinDelayMs));
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
	onRunUpdate?: (run: UpdateLogRun) => void,
): Promise<UpdateLogRun> {
	const startedAt = Date.now();
	const targets = items
		.map((item) => ({item, queue: getRefreshQueue(item)}))
		.filter((target): target is {item: MediaItem; queue: RefreshQueue} => target.queue !== null);
	const total = targets.length;
	const entries: UpdateLogEntry[] = [];
	let updated = 0;
	let unchanged = 0;
	let failed = 0;
	let skipped = 0;
	let completed = 0;
	const anilistTargets = targets
		.filter((target) => target.queue === "anilist")
		.map((target) => target.item);
	const tmdbTargets = targets
		.filter((target) => target.queue === "tmdb")
		.map((target) => target.item);
	let anilistCompleted = 0;
	let tmdbCompleted = 0;
	const buildProviderProgress = () => ({
		anilist: {
			total: anilistTargets.length,
			completed: anilistCompleted,
		},
		tmdb: {
			total: tmdbTargets.length,
			completed: tmdbCompleted,
		},
	});
	const buildSnapshot = (): UpdateLogRun => {
		const now = Date.now();
		return {
			startedAt,
			finishedAt: now,
			durationMs: Math.max(0, now - startedAt),
			total,
			updated,
			unchanged,
			failed,
			skipped,
			providerProgress: buildProviderProgress(),
			entries: [...entries],
		};
	};
	onProgress?.(0, total);
	onRunUpdate?.(buildSnapshot());

	const commitItemResult = (queue: RefreshQueue, item: MediaItem, result: RefreshItemResult) => {
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
		if (queue === "anilist") {
			anilistCompleted += 1;
		} else {
			tmdbCompleted += 1;
		}
		completed += 1;
		onProgress?.(completed, total);
		onRunUpdate?.(buildSnapshot());
	};

	const runQueue = async (queue: RefreshQueue, queueItems: MediaItem[]) => {
		for (const item of queueItems) {
			try {
				const result = await refreshTrackedMediaLatest(app, settings, item);
				commitItemResult(queue, item, result);
			} catch (error) {
				commitItemResult(queue, item, toUnexpectedFailure(queue, error));
			}
		}
	};

	await Promise.all([
		runQueue("anilist", anilistTargets),
		runQueue("tmdb", tmdbTargets),
	]);

	if (completed !== total) {
		onProgress?.(total, total);
		onRunUpdate?.(buildSnapshot());
	}

	settings.tmdbLastSync = Date.now();
	const finishedAt = Date.now();
	return {
		...buildSnapshot(),
		finishedAt,
		durationMs: Math.max(0, finishedAt - startedAt),
	};
}
