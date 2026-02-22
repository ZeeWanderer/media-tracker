import {Notice} from "obsidian";
import type MediaTrackerPlugin from "../main";
import {MediaItem, UpdateLogRun} from "../types";
import {formatRefreshRunSummary, refreshTrackedMedia} from "../flows/media";
import {openMediaUpdateLog} from "./updateLogView";

export class TrackerRefreshService {
	private refreshing = false;
	private progressCurrent = 0;
	private progressTotal = 0;

	constructor(
		private readonly plugin: MediaTrackerPlugin,
		private readonly onStateChange: () => void,
	) {}

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
		this.onStateChange();
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
		this.onStateChange();
		try {
			this.plugin.logger.info("refresh", "bulk_start", "Starting bulk media refresh.", {count: items.length});
			const run = await refreshTrackedMedia(
				this.plugin.app,
				this.plugin.settings,
				items,
				(current, total) => this.setProgress(current, total),
				(activeRun) => this.plugin.setActiveUpdateRun(activeRun),
			);
			await this.plugin.recordCompletedUpdateRun(run);
			this.notifyRefreshResult(run);
			this.plugin.logger.info("refresh", "bulk_complete", "Bulk media refresh completed.", {
				total: run.total,
				updated: run.updated,
				unchanged: run.unchanged,
				failed: run.failed,
				skipped: run.skipped,
				durationMs: run.durationMs,
			});
				if (run.failed > 0 && this.plugin.settings.autoOpenUpdateLogOnFailure) {
					await openMediaUpdateLog(this.plugin);
				}
			} catch (error) {
				this.plugin.logger.error("refresh", "bulk_failed", "Bulk media refresh failed.", {
					error: error instanceof Error ? error.message : String(error),
				});
			new Notice("Failed to refresh media updates.");
		} finally {
			this.refreshing = false;
			this.clearProgress();
			this.plugin.setActiveUpdateRun(null);
			this.onStateChange();
		}
	}

	private notifyRefreshResult(run: UpdateLogRun) {
		const mode = this.plugin.settings.updateNotificationMode;
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
