import {LibraryRefreshCoordinator} from "./libraryRefreshOrchestrator";
import type {PluginLogger} from "../infra/logging/pluginLogger";
import type {MediaTrackerSettings} from "./pluginSettingsModel";
import type {MediaItem} from "../domain/media/models";

type StartupLibraryUpdateDeps = {
	getSettings: () => MediaTrackerSettings;
	saveSettingsData: () => Promise<void>;
	listTrackedItems: () => MediaItem<TFile>[];
	refreshCoordinator: LibraryRefreshCoordinator;
	invalidateTrackerItemCaches: () => void;
	scheduleRefresh: () => void;
	logger: PluginLogger;
};

export class StartupLibraryUpdateService {
	constructor(private readonly deps: StartupLibraryUpdateDeps) {}

	async runIfDue() {
		const settings = this.deps.getSettings();
		const now = Date.now();
		if (!this.isDue(settings, now)) {
			this.deps.logger.debug("refresh", "startup_skipped", "Startup library update skipped due to throttle.", {
				enabled: settings.startupLibraryUpdateEnabled,
				lastRun: settings.startupLibraryUpdateLastRun ?? null,
				throttleMode: settings.startupLibraryUpdateThrottleMode,
				intervalHours: settings.startupLibraryUpdateIntervalHours,
			});
			return;
		}

		try {
			const items = this.deps.listTrackedItems();
			this.deps.logger.info("refresh", "startup_started", "Starting startup library update.", {
				count: items.length,
				throttleMode: settings.startupLibraryUpdateThrottleMode,
				intervalHours: settings.startupLibraryUpdateIntervalHours,
			});
			if (!items.length) {
				settings.startupLibraryUpdateLastRun = Date.now();
				await this.deps.saveSettingsData();
				this.deps.logger.info("refresh", "startup_no_items", "Startup library update skipped because no media notes were found.");
				return;
			}

			const result = await this.deps.refreshCoordinator.run({
				items,
				onCompleted: async (run, currentSettings) => {
					currentSettings.startupLibraryUpdateLastRun = Number.isFinite(run.finishedAt) && run.finishedAt > 0
						? run.finishedAt
						: Date.now();
					await this.deps.saveSettingsData();
					this.deps.logger.info("refresh", "startup_completed", "Startup library update completed.", {
						total: run.total,
						updated: run.updated,
						unchanged: run.unchanged,
						failed: run.failed,
						skipped: run.skipped,
						durationMs: run.durationMs,
					});
				},
				onFailed: (error) => {
					this.deps.logger.error("refresh", "startup_failed", "Startup library update failed.", {
						error: error instanceof Error ? error.message : String(error),
					});
				},
			});
			if (result.status === "busy") {
				this.deps.logger.debug("refresh", "startup_busy", "Startup library update skipped because another refresh is running.");
			}
		} finally {
			this.deps.invalidateTrackerItemCaches();
			this.deps.scheduleRefresh();
		}
	}

	private getIntervalMs(settings: MediaTrackerSettings): number {
		switch (settings.startupLibraryUpdateThrottleMode) {
			case "week":
				return 7 * 24 * 60 * 60 * 1000;
			case "hours":
				return Math.max(1, settings.startupLibraryUpdateIntervalHours) * 60 * 60 * 1000;
			case "day":
			default:
				return 24 * 60 * 60 * 1000;
		}
	}

	private isDue(settings: MediaTrackerSettings, now: number): boolean {
		if (!settings.startupLibraryUpdateEnabled) {
			return false;
		}
		const lastRun = settings.startupLibraryUpdateLastRun ?? 0;
		if (lastRun <= 0) {
			return true;
		}
		return (now - lastRun) >= this.getIntervalMs(settings);
	}
}
import type {TFile} from "obsidian";
