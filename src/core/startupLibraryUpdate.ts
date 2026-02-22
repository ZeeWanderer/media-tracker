import {PluginLogger} from "../infra/logging/pluginLogger";
import {MediaTrackerSettings} from "./pluginSettingsModel";
import {executeLibraryRefresh} from "./libraryRefreshOrchestrator";
import type {MediaItem} from "../domain/media/models";
import type {UpdateLogRun} from "./updateTypes";

type StartupLibraryUpdateDeps = {
	getSettings: () => MediaTrackerSettings;
	saveSettingsData: () => Promise<void>;
	listTrackedItems: () => MediaItem[];
	refreshTrackedItems: (items: MediaItem[], onRunUpdate?: (run: UpdateLogRun) => void) => Promise<UpdateLogRun>;
	setActiveUpdateRun: (run: UpdateLogRun | null) => void;
	recordCompletedUpdateRun: (run: UpdateLogRun) => Promise<void>;
	invalidateTrackerItemCaches: () => void;
	scheduleRefresh: () => void;
	openUpdateLog: () => Promise<void>;
	logger: PluginLogger;
};

export class StartupLibraryUpdateService {
	private updateInProgress = false;

	constructor(private readonly deps: StartupLibraryUpdateDeps) {}

	async runIfDue() {
		if (this.updateInProgress) {
			return;
		}
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

		this.updateInProgress = true;

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

			await executeLibraryRefresh(
				{
					getSettings: () => this.deps.getSettings(),
					runRefresh: (targets, _onProgress, onRunUpdate) => this.deps.refreshTrackedItems(targets, onRunUpdate),
					setActiveUpdateRun: (run) => this.deps.setActiveUpdateRun(run),
					recordCompletedUpdateRun: (run) => this.deps.recordCompletedUpdateRun(run),
					openUpdateLog: () => this.deps.openUpdateLog(),
				},
				{
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
				},
			);
		} finally {
			this.updateInProgress = false;
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
