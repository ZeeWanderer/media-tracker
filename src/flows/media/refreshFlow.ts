import {App} from "obsidian";
import {MediaTrackerSettings} from "../../core/pluginSettingsModel";
import {MediaItem, UpdateLogAttempt, UpdateLogEntry, UpdateLogRun, UpdateProvider} from "../../types";
import {ANILIST_TYPES, TMDB_TYPES} from "../../domain/media/config";
import {getImdbIdFromLinks} from "../../domain/media/links";
import {AniListRefreshResult, refreshAniListLatest} from "./providers/anilistProviderFlow";
import {refreshTmdbSeriesLatest, TmdbRefreshResult} from "./providers/tmdbProviderFlow";

type RefreshItemResult = {
	provider: UpdateProvider;
	status: UpdateLogEntry["status"];
	message: string;
	providersChecked: RefreshQueue[];
	attempts: UpdateLogAttempt[];
};

type RefreshQueue = "anilist" | "tmdb";
type QueuedRefreshTarget = {
	item: MediaItem;
	queue: RefreshQueue;
};

const RUN_UPDATE_INTERVAL_MS = 250;

function toEntry(item: MediaItem, result: RefreshItemResult): UpdateLogEntry {
	return {
		title: item.title,
		filePath: item.file.path,
		type: item.type,
		provider: result.provider,
		status: result.status,
		message: result.message,
		attempts: result.attempts.length ? [...result.attempts] : undefined,
	};
}

function toAttempt(result: AniListRefreshResult | TmdbRefreshResult): UpdateLogAttempt {
	return {
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
		providersChecked: [result.provider],
		attempts: [toAttempt(result)],
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
	const message = `Unexpected refresh error: ${detail}`;
	return {
		provider: queue,
		status: "failed",
		message,
		providersChecked: [queue],
		attempts: [
			{
				provider: queue,
				status: "failed",
				message,
			},
		],
	};
}

function normalizeCheckedAt(value: number | undefined): number | undefined {
	if (!Number.isFinite(value) || value === undefined || value <= 0) {
		return undefined;
	}
	return Math.floor(value);
}

function getTargetCheckedAt(target: QueuedRefreshTarget): number | undefined {
	if (target.queue === "anilist") {
		return normalizeCheckedAt(target.item.anilistLastChecked);
	}
	return normalizeCheckedAt(target.item.tmdbLastChecked);
}

function compareTargetsByRefreshPriority(a: QueuedRefreshTarget, b: QueuedRefreshTarget): number {
	const aCheckedAt = getTargetCheckedAt(a);
	const bCheckedAt = getTargetCheckedAt(b);
	const aMissing = aCheckedAt === undefined;
	const bMissing = bCheckedAt === undefined;
	if (aMissing && !bMissing) {
		return -1;
	}
	if (!aMissing && bMissing) {
		return 1;
	}
	if (aCheckedAt !== undefined && bCheckedAt !== undefined && aCheckedAt !== bCheckedAt) {
		// Older checks run first so partial runs update the stalest entries first.
		return aCheckedAt - bCheckedAt;
	}
	return a.item.title.localeCompare(b.item.title);
}

export async function refreshTrackedMediaLatest(
	app: App,
	settings: Readonly<MediaTrackerSettings>,
	item: MediaItem,
): Promise<RefreshItemResult> {
	const tmdbMinDelayMs = settings.tmdbMinIntervalMs;
	const anilistMinDelayMs = 0;
	if (item.type === "manga") {
		const result = mapProviderResult(await refreshAniListLatest(app, item, anilistMinDelayMs));
		return {
			...result,
			providersChecked: ["anilist"],
		};
	}
	if (item.type === "anime") {
		const aniListResult = await refreshAniListLatest(app, item, anilistMinDelayMs);
		const hasTmdbIdentity = Boolean(item.tmdbId || item.imdbId || getImdbIdFromLinks(item.links ?? []));
		if (aniListResult.status === "failed" && TMDB_TYPES.has(item.type) && hasTmdbIdentity) {
			const fallback = mapProviderResult(await refreshTmdbSeriesLatest(app, settings, item, tmdbMinDelayMs));
			return {
				...fallback,
				providersChecked: ["anilist", "tmdb"],
				attempts: [toAttempt(aniListResult), ...fallback.attempts],
			};
		}
		const result = mapProviderResult(aniListResult);
		return {
			...result,
			providersChecked: ["anilist"],
		};
	}
	if (TMDB_TYPES.has(item.type)) {
		const result = mapProviderResult(await refreshTmdbSeriesLatest(app, settings, item, tmdbMinDelayMs));
		return {
			...result,
			providersChecked: ["tmdb"],
		};
	}
	return {
		provider: "none",
		status: "skipped",
		message: `No refresh provider for ${item.type}.`,
		providersChecked: [],
		attempts: [],
	};
}

export function formatRefreshRunSummary(run: UpdateLogRun): string {
	return `Update complete. ${run.total} checked · ${run.updated} updated · ${run.unchanged} unchanged · ${run.failed} failed · ${run.skipped} skipped.`;
}

export async function refreshTrackedMedia(
	app: App,
	settings: Readonly<MediaTrackerSettings>,
	items: MediaItem[],
	onProgress?: (current: number, total: number) => void,
	onRunUpdate?: (run: UpdateLogRun) => void,
): Promise<UpdateLogRun> {
	const startedAt = Date.now();
	const targets = items
		.map((item) => ({item, queue: getRefreshQueue(item)}))
		.filter((target): target is {item: MediaItem; queue: RefreshQueue} => target.queue !== null);
	targets.sort(compareTargetsByRefreshPriority);
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
	let anilistTotal = anilistTargets.length;
	let tmdbTotal = tmdbTargets.length;
	let anilistCompleted = 0;
	let tmdbCompleted = 0;
	let lastRunUpdateAt = 0;
	const buildProviderProgress = () => ({
		anilist: {
			total: anilistTotal,
			completed: anilistCompleted,
		},
		tmdb: {
			total: tmdbTotal,
			completed: tmdbCompleted,
		},
	});
	const buildSnapshot = (copyEntries = false): UpdateLogRun => {
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
			entries: copyEntries ? [...entries] : entries,
		};
	};

	const emitRunUpdate = (force = false) => {
		if (!onRunUpdate) {
			return;
		}
		const now = Date.now();
		if (!force && now - lastRunUpdateAt < RUN_UPDATE_INTERVAL_MS) {
			return;
		}
		lastRunUpdateAt = now;
		onRunUpdate(buildSnapshot(false));
	};

	onProgress?.(0, total);
	emitRunUpdate(true);

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
		for (const provider of result.providersChecked) {
			if (provider === "anilist") {
				anilistCompleted += 1;
				if (queue !== "anilist") {
					anilistTotal += 1;
				}
				continue;
			}
			if (provider === "tmdb") {
				tmdbCompleted += 1;
				if (queue !== "tmdb") {
					tmdbTotal += 1;
				}
			}
		}
		completed += 1;
		onProgress?.(completed, total);
		emitRunUpdate();
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

	emitRunUpdate(true);
	if (completed !== total) {
		onProgress?.(total, total);
		emitRunUpdate(true);
	}

	const finishedAt = Date.now();
	return {
		...buildSnapshot(true),
		finishedAt,
		durationMs: Math.max(0, finishedAt - startedAt),
	};
}
