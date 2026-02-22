import {MediaTrackerSettings} from "./pluginSettingsModel";
import {UpdateLogRun} from "../types";
import {PluginLogger} from "../infra/logging/pluginLogger";

type UpdateRunStateDeps = {
	settings: MediaTrackerSettings;
	saveSettingsData: () => Promise<void>;
	refreshUpdateLogViews: () => void;
	loadPendingRunCheckpoint: () => Promise<UpdateLogRun | null>;
	savePendingRunCheckpoint: (run: UpdateLogRun | null) => Promise<void>;
	logger?: PluginLogger;
};

const MAX_RUNS = 25;
const MAX_ENTRIES_PER_RUN = 1500;

export function isValidUpdateLogRun(run: unknown): run is UpdateLogRun {
	if (!run || typeof run !== "object") {
		return false;
	}
	const value = run as Partial<UpdateLogRun>;
	return Number.isFinite(value.startedAt)
		&& Number.isFinite(value.finishedAt)
		&& Number.isFinite(value.durationMs)
		&& Number.isFinite(value.total)
		&& Number.isFinite(value.updated)
		&& Number.isFinite(value.unchanged)
		&& Number.isFinite(value.failed)
		&& Number.isFinite(value.skipped)
		&& Array.isArray(value.entries);
}

export class UpdateRunState {
	private activeRun: UpdateLogRun | null = null;
	private pendingPersistTimer: number | null = null;

	constructor(private readonly deps: UpdateRunStateDeps) {}

	getActiveUpdateRun(): UpdateLogRun | null {
		return this.activeRun;
	}

	setActiveUpdateRun(run: UpdateLogRun | null) {
		const hadPendingRun = this.activeRun !== null;
		this.activeRun = run ? {
			...run,
			state: "in-progress",
		} : null;
		if (this.activeRun) {
			if (!hadPendingRun) {
				this.flushPendingUpdateRunPersist();
			} else {
				this.schedulePendingUpdateRunPersist();
			}
		} else {
			this.flushPendingUpdateRunPersist();
		}
		this.deps.refreshUpdateLogViews();
	}

	async recordCompletedUpdateRun(run: UpdateLogRun) {
		if (Number.isFinite(run.finishedAt) && run.finishedAt > 0) {
			this.deps.settings.tmdbLastSync = Math.floor(run.finishedAt);
		}
		this.appendUpdateRun(run);
		await this.deps.saveSettingsData();
		this.deps.refreshUpdateLogViews();
	}

	async restorePendingUpdateRunIfAny() {
		let pendingRun: UpdateLogRun | null = null;
		try {
			pendingRun = await this.deps.loadPendingRunCheckpoint();
		} catch {
			pendingRun = null;
		}
		if (!isValidUpdateLogRun(pendingRun)) {
			try {
				await this.deps.savePendingRunCheckpoint(null);
			} catch {
				// Ignore checkpoint cleanup failures.
			}
			return;
		}
		const now = Date.now();
		const startedAt = Number.isFinite(pendingRun.startedAt) && pendingRun.startedAt > 0
			? pendingRun.startedAt
			: now;
		this.appendUpdateRun({
			...this.cloneUpdateRun(pendingRun),
			startedAt,
			finishedAt: now,
			durationMs: Math.max(0, now - startedAt),
			state: "interrupted",
		});
		try {
			await this.deps.savePendingRunCheckpoint(null);
		} catch {
			// Ignore checkpoint cleanup failures.
		}
		await this.deps.saveSettingsData();
		this.deps.logger?.warn("refresh", "interrupted_run_recovered", "Recovered interrupted update run from previous session.", {
			total: pendingRun.total,
			processed: this.getProcessedCount(pendingRun),
		});
	}

	flushPendingUpdateRunPersist() {
		if (this.pendingPersistTimer !== null) {
			window.clearTimeout(this.pendingPersistTimer);
			this.pendingPersistTimer = null;
		}
		void this.persistPendingUpdateRun();
	}

	private schedulePendingUpdateRunPersist() {
		if (this.pendingPersistTimer !== null) {
			return;
		}
		this.pendingPersistTimer = window.setTimeout(() => {
			this.pendingPersistTimer = null;
			void this.persistPendingUpdateRun();
		}, 1500);
	}

	private async persistPendingUpdateRun() {
		try {
			await this.deps.savePendingRunCheckpoint(this.toPendingRunCheckpoint(this.activeRun));
		} catch (error) {
			this.deps.logger?.warn("refresh", "pending_run_persist_failed", "Failed to persist pending update run.", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	private appendUpdateRun(run: UpdateLogRun) {
		const trimmedRun = this.cloneUpdateRun({
			...run,
			state: run.state ?? "completed",
			entries: run.entries.slice(0, MAX_ENTRIES_PER_RUN),
		});
		const currentRuns = this.deps.settings.updateLogRuns ?? [];
		this.deps.settings.updateLogRuns = [trimmedRun, ...currentRuns].slice(0, MAX_RUNS);
	}

	private cloneUpdateRun(run: UpdateLogRun): UpdateLogRun {
		return {
			...run,
			providerProgress: run.providerProgress
				? {
					anilist: {...run.providerProgress.anilist},
					tmdb: {...run.providerProgress.tmdb},
				}
				: undefined,
			entries: run.entries.map((entry) => ({
				...entry,
				attempts: entry.attempts ? entry.attempts.map((attempt) => ({...attempt})) : undefined,
			})),
		};
	}

	private toPendingRunCheckpoint(run: UpdateLogRun | null): UpdateLogRun | null {
		if (!run) {
			return null;
		}
		return {
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			durationMs: run.durationMs,
			total: run.total,
			updated: run.updated,
			unchanged: run.unchanged,
			failed: run.failed,
			skipped: run.skipped,
			providerProgress: run.providerProgress
				? {
					anilist: {...run.providerProgress.anilist},
					tmdb: {...run.providerProgress.tmdb},
				}
				: undefined,
			state: "in-progress",
			entries: [],
		};
	}

	private getProcessedCount(run: UpdateLogRun): number {
		return Math.max(0, run.updated + run.unchanged + run.failed + run.skipped);
	}
}
