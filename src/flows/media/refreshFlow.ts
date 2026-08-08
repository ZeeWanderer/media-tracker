import {App, type TFile} from "obsidian";
import {MediaTrackerSettings} from "../../core/pluginSettingsModel";
import {refreshAniListLatest} from "./providers/anilistProviderFlow";
import {refreshTmdbSeriesLatest} from "./providers/tmdbProviderFlow";
import {
	executeRefreshProviderPlan,
	getRefreshProviderPlan,
	type RefreshProviderResult,
	type RefreshQueue,
} from "./providerSelection";
import type {MediaItem} from "../../domain/media/models";
import type {UpdateLogAttempt, UpdateLogEntry, UpdateLogRun, UpdateProvider} from "../../core/updateTypes";
import type {PluginLogger} from "../../infra/logging/pluginLogger";

type RefreshLogger = Pick<PluginLogger, "debug" | "warn">;
type VaultMediaItem = MediaItem<TFile>;

export type RefreshItemResult = {
	provider: UpdateProvider;
	status: UpdateLogEntry["status"];
	message: string;
	providersChecked: RefreshQueue[];
	attempts: UpdateLogAttempt[];
};

export type RefreshItemExecutor = (item: VaultMediaItem) => Promise<RefreshItemResult>;

type QueuedRefreshTarget = {
	item: VaultMediaItem;
	queue: RefreshQueue;
};

const RUN_UPDATE_INTERVAL_MS = 250;

function getItemDebugMeta(item: VaultMediaItem): Record<string, unknown> {
	return {
		title: item.title,
		filePath: item.file.path,
		type: item.type,
		anilistId: item.anilistId ?? null,
		anilistIds: item.anilistIds ?? [],
		tmdbId: item.tmdbId ?? null,
		imdbId: item.imdbId ?? null,
		status: item.status,
		progress: item.progress ?? null,
		season: item.season ?? null,
		episode: item.episode ?? null,
	};
}

function toEntry(item: VaultMediaItem, result: RefreshItemResult): UpdateLogEntry {
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

function toAttempt(result: RefreshProviderResult): UpdateLogAttempt {
	return {
		provider: result.provider,
		status: result.status,
		message: result.message,
	};
}

function getRefreshQueue(item: VaultMediaItem): RefreshQueue | null {
	return getRefreshProviderPlan(item).primary;
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
	item: VaultMediaItem,
	logger?: RefreshLogger,
): Promise<RefreshItemResult> {
	const tmdbMinDelayMs = settings.tmdbMinIntervalMs;
	const anilistMinDelayMs = 0;
	const plan = getRefreshProviderPlan(item);
	if (!plan.primary) {
		logger?.debug("refresh", "item_provider_skipped", "No provider mapped for item type.", getItemDebugMeta(item));
		return {
			provider: "none",
			status: "skipped",
			message: `No refresh provider for ${item.type}.`,
			providersChecked: [],
			attempts: [],
		};
	}
	logger?.debug("refresh", "item_provider_selected", `Using ${plan.primary} refresh for ${item.type} item.`, {
		...getItemDebugMeta(item),
		queue: plan.primary,
	});
	const execution = await executeRefreshProviderPlan(plan, {
		anilist: () => refreshAniListLatest(app, item, anilistMinDelayMs, logger),
		tmdb: () => refreshTmdbSeriesLatest(app, settings, item, tmdbMinDelayMs, logger),
	});
	if (!execution) {
		throw new Error("Refresh provider execution unexpectedly had no primary provider.");
	}
	if (execution.providersChecked.length > 1) {
		logger?.debug("refresh", "item_provider_fallback", "Fell back to TMDB after AniList failure.", {
			...getItemDebugMeta(item),
			anilistMessage: execution.attempts[0]?.message ?? "",
		});
	}
	return {
		provider: execution.result.provider,
		status: execution.result.status,
		message: execution.result.message,
		providersChecked: execution.providersChecked,
		attempts: execution.attempts.map((attempt) => toAttempt(attempt)),
	};
}

export function formatRefreshRunSummary(run: UpdateLogRun): string {
	return `Update complete. ${run.total} checked · ${run.updated} updated · ${run.unchanged} unchanged · ${run.failed} failed · ${run.skipped} skipped.`;
}

export async function executeTrackedMediaRefresh(
	items: VaultMediaItem[],
	refreshItem: RefreshItemExecutor,
	onProgress?: (current: number, total: number) => void,
	onRunUpdate?: (run: UpdateLogRun) => void,
	logger?: RefreshLogger,
): Promise<UpdateLogRun> {
	const startedAt = Date.now();
	const targets = items
		.map((item) => ({item, queue: getRefreshQueue(item)}))
		.filter((target): target is {item: VaultMediaItem; queue: RefreshQueue} => target.queue !== null);
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
	logger?.debug("refresh", "queue_prepared", "Prepared refresh queue ordering.", {
		totalItems: items.length,
		refreshTargets: total,
		anilistTargets: anilistTargets.length,
		tmdbTargets: tmdbTargets.length,
	});
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

	const commitItemResult = (queue: RefreshQueue, item: VaultMediaItem, result: RefreshItemResult) => {
		entries.push(toEntry(item, result));
		logger?.debug("refresh", "item_result", "Processed refresh result for item.", {
			...getItemDebugMeta(item),
			queue,
			provider: result.provider,
			status: result.status,
			message: result.message,
			providersChecked: result.providersChecked,
			attempts: result.attempts,
		});
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

	const runQueue = async (queue: RefreshQueue, queueItems: VaultMediaItem[]) => {
		for (const item of queueItems) {
			try {
				const result = await refreshItem(item);
				commitItemResult(queue, item, result);
			} catch (error) {
				logger?.warn("refresh", "item_unexpected_failure", "Unexpected error while refreshing item.", {
					...getItemDebugMeta(item),
					queue,
					error: error instanceof Error ? error.message : String(error),
				});
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

export async function refreshTrackedMedia(
	app: App,
	settings: Readonly<MediaTrackerSettings>,
	items: VaultMediaItem[],
	onProgress?: (current: number, total: number) => void,
	onRunUpdate?: (run: UpdateLogRun) => void,
	logger?: RefreshLogger,
): Promise<UpdateLogRun> {
	return executeTrackedMediaRefresh(
		items,
		(item) => refreshTrackedMediaLatest(app, settings, item, logger),
		onProgress,
		onRunUpdate,
		logger,
	);
}
