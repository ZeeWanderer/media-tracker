import {Notice, type TFile} from "obsidian";
import {formatRefreshRunSummary} from "../flows/media";
import type {LibraryRefreshCoordinator} from "../core/libraryRefreshOrchestrator";
import type {MediaTrackerSettings} from "../core/pluginSettingsModel";
import type {PluginLogger} from "../infra/logging/pluginLogger";
import type {MediaItem} from "../domain/media/models";
import type {UpdateLogRun} from "../core/updateTypes";

type TrackerRefreshServiceDeps = {
	refreshCoordinator: LibraryRefreshCoordinator;
	getSettings: () => MediaTrackerSettings;
	logger: PluginLogger;
	onStateChange: () => void;
};

export class TrackerRefreshService {
	private unsubscribe: (() => void) | null = null;

	constructor(private readonly deps: TrackerRefreshServiceDeps) {}

	get isRefreshing(): boolean {
		return this.deps.refreshCoordinator.isRefreshing;
	}

	get current(): number {
		return this.deps.refreshCoordinator.current;
	}

	get total(): number {
		return this.deps.refreshCoordinator.total;
	}

	start() {
		if (this.unsubscribe) {
			return;
		}
		this.unsubscribe = this.deps.refreshCoordinator.subscribe(this.deps.onStateChange);
	}

	dispose() {
		this.unsubscribe?.();
		this.unsubscribe = null;
	}

	async run(items: MediaItem<TFile>[]): Promise<void> {
		if (this.deps.refreshCoordinator.isRefreshing) {
			return;
		}
		this.deps.logger.info("refresh", "bulk_start", "Starting bulk media refresh.", {count: items.length});
		await this.deps.refreshCoordinator.run({
			items,
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
		});
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
