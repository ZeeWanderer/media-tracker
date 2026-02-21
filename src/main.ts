import {Plugin} from "obsidian";
import {DEFAULT_SETTINGS, MediaTrackerSettings, MediaTrackerSettingTab} from "./settings";
import {openMediaTracker, registerCommands} from "./commands";
import {MEDIA_TRACKER_VIEW, MediaTrackerView} from "./ui/trackerView";
import {MEDIA_TRACKER_UPDATE_LOG_VIEW, MediaTrackerUpdateLogView, openMediaUpdateLog} from "./ui/updateLogView";
import {MEDIA_TRACKER_PLUGIN_LOG_VIEW, MediaTrackerPluginLogView} from "./ui/pluginLogView";
import {DesktopFaviconCache} from "./infra/cache/faviconCache";
import {PluginLogger} from "./infra/logging/pluginLogger";
import {listTrackedMedia, refreshTrackedMedia} from "./flows/media";
import {UpdateLogRun} from "./types";

export default class MediaTrackerPlugin extends Plugin {
	settings: MediaTrackerSettings;
	faviconCache!: DesktopFaviconCache;
	logger!: PluginLogger;
	private refreshTimer: number | null = null;
	private startupUpdateInProgress = false;
	private skippedRefreshEvents = 0;

	async onload() {
		await this.loadSettings();
		this.faviconCache = new DesktopFaviconCache(this.app, this.manifest.id);
		this.logger = new PluginLogger(this.app, this.manifest.id, {
			enabled: this.settings.loggingEnabled,
			level: this.settings.loggingLevel,
			maxLogFiles: this.settings.loggingMaxFiles,
		});
		this.logger.info("plugin", "loaded", "Media Tracker loaded.");

		this.registerView(MEDIA_TRACKER_VIEW, (leaf) => new MediaTrackerView(leaf, this));
		this.registerView(MEDIA_TRACKER_UPDATE_LOG_VIEW, (leaf) => new MediaTrackerUpdateLogView(leaf, this));
		this.registerView(MEDIA_TRACKER_PLUGIN_LOG_VIEW, (leaf) => new MediaTrackerPluginLogView(leaf, this));
		registerCommands(this);
		this.addSettingTab(new MediaTrackerSettingTab(this.app, this));
		this.addRibbonIcon("film", "Open media tracker", () => openMediaTracker(this));

		this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
		void this.runStartupLibraryUpdateIfDue();
	}

	onunload() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.logger?.info("plugin", "unloaded", "Media Tracker unloaded.");
		void this.logger?.dispose();
		this.faviconCache?.dispose();
	}

	async loadSettings() {
		const loaded = await this.loadData() as (Partial<MediaTrackerSettings> & {faviconCache?: unknown}) | null;
		let hasLegacyFaviconCache = false;
		if (loaded && typeof loaded === "object" && "faviconCache" in loaded) {
			delete loaded.faviconCache;
			hasLegacyFaviconCache = true;
		}
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
		if (hasLegacyFaviconCache) {
			await this.saveData(this.settings);
		}
		if (this.settings.updateNotificationMode !== "quiet"
			&& this.settings.updateNotificationMode !== "summary"
			&& this.settings.updateNotificationMode !== "verbose") {
			this.settings.updateNotificationMode = DEFAULT_SETTINGS.updateNotificationMode;
		}
		if (typeof this.settings.autoOpenUpdateLogOnFailure !== "boolean") {
			this.settings.autoOpenUpdateLogOnFailure = DEFAULT_SETTINGS.autoOpenUpdateLogOnFailure;
		}
		if (typeof this.settings.startupLibraryUpdateEnabled !== "boolean") {
			this.settings.startupLibraryUpdateEnabled = DEFAULT_SETTINGS.startupLibraryUpdateEnabled;
		}
		if (this.settings.startupLibraryUpdateThrottleMode !== "day"
			&& this.settings.startupLibraryUpdateThrottleMode !== "week"
			&& this.settings.startupLibraryUpdateThrottleMode !== "hours") {
			this.settings.startupLibraryUpdateThrottleMode = DEFAULT_SETTINGS.startupLibraryUpdateThrottleMode;
		}
		if (!Number.isFinite(this.settings.startupLibraryUpdateIntervalHours)
			|| this.settings.startupLibraryUpdateIntervalHours <= 0) {
			this.settings.startupLibraryUpdateIntervalHours = DEFAULT_SETTINGS.startupLibraryUpdateIntervalHours;
		}
		if (!Number.isFinite(this.settings.startupLibraryUpdateLastRun ?? Number.NaN)
			|| (this.settings.startupLibraryUpdateLastRun ?? 0) <= 0) {
			delete this.settings.startupLibraryUpdateLastRun;
		}
		if (!Array.isArray(this.settings.updateLogRuns)) {
			this.settings.updateLogRuns = [];
		}
		if (typeof this.settings.loggingEnabled !== "boolean") {
			this.settings.loggingEnabled = DEFAULT_SETTINGS.loggingEnabled;
		}
		if (this.settings.loggingLevel !== "debug"
			&& this.settings.loggingLevel !== "info"
			&& this.settings.loggingLevel !== "warn"
			&& this.settings.loggingLevel !== "error") {
			this.settings.loggingLevel = DEFAULT_SETTINGS.loggingLevel;
		}
		if (!Number.isFinite(this.settings.loggingMaxFiles) || this.settings.loggingMaxFiles <= 0) {
			this.settings.loggingMaxFiles = DEFAULT_SETTINGS.loggingMaxFiles;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.logger?.updateOptions({
			enabled: this.settings.loggingEnabled,
			level: this.settings.loggingLevel,
			maxLogFiles: this.settings.loggingMaxFiles,
		});
		this.scheduleRefresh();
	}

	scheduleRefresh() {
		if (this.skippedRefreshEvents > 0) {
			this.skippedRefreshEvents -= 1;
			return;
		}
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => this.refreshViews(), 150);
	}

	suppressNextViewRefresh() {
		this.skippedRefreshEvents += 1;
	}

	refreshViews() {
		const leaves = this.app.workspace.getLeavesOfType(MEDIA_TRACKER_VIEW);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof MediaTrackerView) {
				view.render();
			}
		}
		const updateLogLeaves = this.app.workspace.getLeavesOfType(MEDIA_TRACKER_UPDATE_LOG_VIEW);
		for (const leaf of updateLogLeaves) {
			const view = leaf.view;
			if (view instanceof MediaTrackerUpdateLogView) {
				view.render();
			}
		}
	}

	private getStartupUpdateIntervalMs(): number {
		switch (this.settings.startupLibraryUpdateThrottleMode) {
			case "week":
				return 7 * 24 * 60 * 60 * 1000;
			case "hours":
				return Math.max(1, this.settings.startupLibraryUpdateIntervalHours) * 60 * 60 * 1000;
			case "day":
			default:
				return 24 * 60 * 60 * 1000;
		}
	}

	private isStartupLibraryUpdateDue(now: number): boolean {
		if (!this.settings.startupLibraryUpdateEnabled) {
			return false;
		}
		const lastRun = this.settings.startupLibraryUpdateLastRun ?? 0;
		if (lastRun <= 0) {
			return true;
		}
		return (now - lastRun) >= this.getStartupUpdateIntervalMs();
	}

	private appendUpdateRun(run: UpdateLogRun) {
		const maxRuns = 25;
		const maxEntriesPerRun = 1500;
		const trimmedRun: UpdateLogRun = {
			...run,
			entries: run.entries.slice(0, maxEntriesPerRun),
		};
		const currentRuns = this.settings.updateLogRuns ?? [];
		this.settings.updateLogRuns = [trimmedRun, ...currentRuns].slice(0, maxRuns);
	}

	private async runStartupLibraryUpdateIfDue() {
		if (this.startupUpdateInProgress) {
			return;
		}
		const now = Date.now();
		if (!this.isStartupLibraryUpdateDue(now)) {
			this.logger.debug("refresh", "startup_skipped", "Startup library update skipped due to throttle.", {
				enabled: this.settings.startupLibraryUpdateEnabled,
				lastRun: this.settings.startupLibraryUpdateLastRun ?? null,
				throttleMode: this.settings.startupLibraryUpdateThrottleMode,
				intervalHours: this.settings.startupLibraryUpdateIntervalHours,
			});
			return;
		}

		this.startupUpdateInProgress = true;
		this.settings.startupLibraryUpdateLastRun = now;
		await this.saveData(this.settings);

		try {
			const items = listTrackedMedia(this.app, this.settings);
			this.logger.info("refresh", "startup_started", "Starting startup library update.", {
				count: items.length,
				throttleMode: this.settings.startupLibraryUpdateThrottleMode,
				intervalHours: this.settings.startupLibraryUpdateIntervalHours,
			});
			if (!items.length) {
				this.logger.info("refresh", "startup_no_items", "Startup library update skipped because no media notes were found.");
				return;
			}

			const run = await refreshTrackedMedia(this.app, this.settings, items);
			this.appendUpdateRun(run);
			await this.saveData(this.settings);
			this.logger.info("refresh", "startup_completed", "Startup library update completed.", {
				total: run.total,
				updated: run.updated,
				unchanged: run.unchanged,
				failed: run.failed,
				skipped: run.skipped,
				durationMs: run.durationMs,
			});
			if (run.failed > 0 && this.settings.autoOpenUpdateLogOnFailure) {
				await openMediaUpdateLog(this);
			}
		} catch (error) {
			console.error(error);
			this.logger.error("refresh", "startup_failed", "Startup library update failed.", {
				error: error instanceof Error ? error.message : String(error),
			});
		} finally {
			this.startupUpdateInProgress = false;
			this.scheduleRefresh();
		}
	}
}
