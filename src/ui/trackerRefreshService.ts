import {App, Notice} from "obsidian";
import {formatRefreshRunSummary, refreshTrackedMedia} from "../flows/media";
import {executeLibraryRefresh} from "../core/libraryRefreshOrchestrator";
import type {MediaTrackerSettings} from "../core/pluginSettingsModel";
import type {PluginLogger} from "../infra/logging/pluginLogger";
import type {MediaItem} from "../domain/media/models";
import type {UpdateLogRun} from "../core/updateTypes";

type TrackerRefreshServiceDeps = {
	app: App;
	getSettings: () => MediaTrackerSettings;
	logger: PluginLogger;
	setActiveUpdateRun: (run: UpdateLogRun | null) => void;
	recordCompletedUpdateRun: (run: UpdateLogRun) => Promise<void>;
	openUpdateLog: () => Promise<void>;
	onStateChange: () => void;
};

export class TrackerRefreshService {
	private refreshing = false;
	private progressCurrent = 0;
	private progressTotal = 0;

	constructor(private readonly deps: TrackerRefreshServiceDeps) {}

	get isRefreshing(): boolean {
		return this.refreshing;
	}

	get current(): number {
		return this.progressCurrent;
	}

	get total(): number {
		return this.progressTotal;
	}

	private setProgress(current: number, total: number) {
		this.progressCurrent = Math.max(0, Math.floor(current));
		this.progressTotal = Math.max(0, Math.floor(total));
		this.deps.onStateChange();
	}

	private clearProgress() {
		this.progressCurrent = 0;
		this.progressTotal = 0;
	}

	async run(items: MediaItem[]): Promise<void> {
		if (this.refreshing) {
			return;
		}
		this.refreshing = true;
		this.clearProgress();
		this.deps.onStateChange();
		this.deps.logger.info("refresh", "bulk_start", "Starting bulk media refresh.", {count: items.length});
		await executeLibraryRefresh(
			{
				getSettings: () => this.deps.getSettings(),
				runRefresh: (targets, onProgress, onRunUpdate) => refreshTrackedMedia(
					this.deps.app,
					this.deps.getSettings(),
					targets,
					onProgress,
					onRunUpdate,
				),
				setActiveUpdateRun: (run) => this.deps.setActiveUpdateRun(run),
				recordCompletedUpdateRun: (run) => this.deps.recordCompletedUpdateRun(run),
				openUpdateLog: () => this.deps.openUpdateLog(),
			},
			{
				items,
				onProgress: (current, total) => this.setProgress(current, total),
				onCompleted: (run) => {
					this.notifyRefreshResult(run);
					this.deps.logger.info("refresh", "bulk_complete", "Bulk media refresh completed.", {
						total: run.total,
						updated: run.updated,
						unchanged: run.unchanged,
						failed: run.failed,
						skipped: run.skipped,
						durationMs: run.durationMs,
					});
				},
				onFailed: (error) => {
					this.deps.logger.error("refresh", "bulk_failed", "Bulk media refresh failed.", {
						error: error instanceof Error ? error.message : String(error),
					});
					new Notice("Failed to refresh media updates.");
				},
				onFinally: () => {
					this.refreshing = false;
					this.clearProgress();
					this.deps.onStateChange();
				},
			},
		);
	}

	private notifyRefreshResult(run: UpdateLogRun) {
		const mode = this.deps.getSettings().updateNotificationMode;
		if (mode === "quiet") {
			if (run.failed > 0) {
				new Notice(`Update complete with ${run.failed} failure${run.failed === 1 ? "" : "s"}. Open update log for details.`);
			}
			return;
		}

		const summary = formatRefreshRunSummary(run);
		if (mode === "summary") {
			new Notice(summary);
			return;
		}

		const failed = run.entries.filter((entry) => entry.status === "failed").slice(0, 3);
		if (!failed.length) {
			new Notice(summary);
			return;
		}
		const details = failed.map((entry) => `${entry.title}: ${entry.message}`).join(" | ");
		const suffix = run.failed > failed.length ? " | More failures in update log." : "";
		new Notice(`${summary} ${details}${suffix}`, 10000);
	}
}
