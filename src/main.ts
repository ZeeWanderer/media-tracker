import {Plugin} from "obsidian";
import {MediaTrackerSettingTab} from "./settings";
import {openMediaTracker, registerCommands} from "./commands";
import {MediaTrackerView} from "./ui/trackerView";
import {MediaTrackerUpdateLogView, openMediaUpdateLog} from "./ui/updateLogView";
import {MediaTrackerPluginLogView} from "./ui/pluginLogView";
import {DesktopFaviconCache} from "./infra/cache/faviconCache";
import {PluginLogger} from "./infra/logging/pluginLogger";
import {refreshTrackedMedia} from "./flows/media";
import {listMediaItems} from "./infra/storage/mediaLibraryStore";
import {UpdateLogRun} from "./core/updateTypes";
import {
	didMediaQuerySettingsChange,
	getMediaQuerySettingsSnapshot,
	normalizeLoadedSettings,
	normalizeMediaFolder,
} from "./core/pluginSettings";
import {UpdateRunState} from "./core/updateRunState";
import {StartupLibraryUpdateService} from "./core/startupLibraryUpdate";
import {MediaTrackerSettings} from "./core/pluginSettingsModel";
import {PendingUpdateRunCheckpointStore} from "./core/pendingUpdateRunCheckpointStore";
import {ViewRefreshManager} from "./core/viewRefreshManager";
import {LibraryRefreshCoordinator} from "./core/libraryRefreshOrchestrator";
import {TrackerGitService} from "./ui/trackerServices";
import {
	MEDIA_TRACKER_PLUGIN_LOG_VIEW,
	MEDIA_TRACKER_UPDATE_LOG_VIEW,
	MEDIA_TRACKER_VIEW,
} from "./ui/viewIds";

export default class MediaTrackerPlugin extends Plugin {
	settings: MediaTrackerSettings;
	faviconCache!: DesktopFaviconCache;
	logger!: PluginLogger;
	private updateRunState!: UpdateRunState;
	private startupUpdateService!: StartupLibraryUpdateService;
	private pendingRunCheckpointStore!: PendingUpdateRunCheckpointStore;
	private viewRefreshManager!: ViewRefreshManager;
	libraryRefreshCoordinator!: LibraryRefreshCoordinator;
	trackerGitService!: TrackerGitService;
	private settingsUpdateQueue: Promise<void> = Promise.resolve();
	private pluginActive = false;
	private runtimeStarted = false;

	async onload() {
		this.pluginActive = true;
		await this.loadSettings();
		this.faviconCache = new DesktopFaviconCache(this.app, this.manifest.id);
		this.logger = new PluginLogger(this.app, this.manifest.id, {
			enabled: this.settings.loggingEnabled,
			level: this.settings.loggingLevel,
			maxLogFiles: this.settings.loggingMaxFiles,
		});
		this.pendingRunCheckpointStore = new PendingUpdateRunCheckpointStore({
			app: this.app,
			pluginId: this.manifest.id,
		});
		this.viewRefreshManager = new ViewRefreshManager({
			getMediaFolder: () => this.settings.mediaFolder,
			invalidateTrackerItemCaches: () => this.invalidateTrackerItemCaches(),
			refreshTrackerViews: () => this.refreshViewsByType(MEDIA_TRACKER_VIEW),
			refreshUpdateLogViews: () => this.refreshViewsByType(MEDIA_TRACKER_UPDATE_LOG_VIEW),
			refreshPluginLogViews: () => this.refreshViewsByType(MEDIA_TRACKER_PLUGIN_LOG_VIEW),
		});
		this.updateRunState = new UpdateRunState({
			settings: this.settings,
			saveSettingsData: () => this.saveData(this.settings),
			refreshUpdateLogViews: () => this.refreshViewsByType(MEDIA_TRACKER_UPDATE_LOG_VIEW),
			loadPendingRunCheckpoint: () => this.pendingRunCheckpointStore.load(),
			savePendingRunCheckpoint: (run) => this.pendingRunCheckpointStore.save(run),
			logger: this.logger,
		});
		this.libraryRefreshCoordinator = new LibraryRefreshCoordinator({
			getSettings: () => this.settings,
			runRefresh: (items, onProgress, onRunUpdate) => refreshTrackedMedia(
				this.app,
				this.settings,
				items,
				onProgress,
				onRunUpdate,
				this.logger,
			),
			setActiveUpdateRun: (run) => this.setActiveUpdateRun(run),
			recordCompletedUpdateRun: (run) => this.recordCompletedUpdateRun(run),
			openUpdateLog: () => openMediaUpdateLog(this),
		});
		this.trackerGitService = new TrackerGitService({
			app: this.app,
			pluginId: this.manifest.id,
			getMediaFolder: () => this.settings.mediaFolder,
			logger: this.logger,
		});
		this.startupUpdateService = new StartupLibraryUpdateService({
			getSettings: () => this.settings,
			saveSettingsData: () => this.saveData(this.settings),
			listTrackedItems: () => listMediaItems(this.app, this.settings),
			refreshCoordinator: this.libraryRefreshCoordinator,
			invalidateTrackerItemCaches: () => this.invalidateTrackerItemCaches(),
			scheduleRefresh: () => this.viewRefreshManager.scheduleRefresh(),
			logger: this.logger,
		});
		this.logger.info("plugin", "loaded", "Media Tracker loaded.");

		this.registerView(MEDIA_TRACKER_VIEW, (leaf) => new MediaTrackerView(leaf, this));
		this.registerView(MEDIA_TRACKER_UPDATE_LOG_VIEW, (leaf) => new MediaTrackerUpdateLogView(leaf, this));
		this.registerView(MEDIA_TRACKER_PLUGIN_LOG_VIEW, (leaf) => new MediaTrackerPluginLogView(leaf, this));
		registerCommands(this);
		this.addSettingTab(new MediaTrackerSettingTab(this.app, this));
		this.addRibbonIcon("film", "Open media tracker", () => openMediaTracker(this));
		this.app.workspace.onLayoutReady(() => this.startRuntime());
	}

	private startRuntime() {
		if (!this.pluginActive || this.runtimeStarted) {
			return;
		}
		this.runtimeStarted = true;
		this.registerEvent(this.app.metadataCache.on("changed", (file) => this.viewRefreshManager.handleMetadataMutation(file)));
		this.registerEvent(this.app.vault.on("modify", (file) => this.trackerGitService.handleVaultPathMutation(file.path)));
		this.registerEvent(this.app.vault.on("create", (file) => {
			this.viewRefreshManager.handleVaultDataMutation(file);
			this.trackerGitService.handleVaultPathMutation(file.path);
		}));
		this.registerEvent(this.app.vault.on("delete", (file) => {
			this.viewRefreshManager.handleVaultDataMutation(file);
			this.trackerGitService.handleVaultPathMutation(file.path);
		}));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			this.viewRefreshManager.handleVaultDataMutation(file, oldPath);
			this.trackerGitService.handleVaultPathMutation(file.path);
			this.trackerGitService.handleVaultPathMutation(oldPath);
		}));
		this.invalidateTrackerItemCaches();
		this.viewRefreshManager.scheduleRefresh();
		void this.initializeRuntimeState();
	}

	private async initializeRuntimeState() {
		try {
			await this.updateRunState.restorePendingUpdateRunIfAny();
		} catch (error) {
			this.logger.error("plugin", "pending_run_restore_failed", "Failed to restore pending update state.", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
		if (!this.pluginActive) {
			return;
		}
		try {
			await this.startupUpdateService.runIfDue();
		} catch (error) {
			this.logger.error("plugin", "startup_update_failed", "Startup library update failed.", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	onunload() {
		this.pluginActive = false;
		this.viewRefreshManager?.dispose();
		this.trackerGitService?.dispose();
		this.updateRunState?.flushPendingUpdateRunPersist();
		this.logger?.info("plugin", "unloaded", "Media Tracker unloaded.");
		void this.logger?.dispose();
		this.faviconCache?.dispose();
	}

	async loadSettings() {
		const loaded = await this.loadData() as (Partial<MediaTrackerSettings> & {faviconCache?: unknown}) | null;
		const normalized = normalizeLoadedSettings(loaded);
		this.settings = normalized.settings;
		if (normalized.hadLegacyFaviconCache || normalized.hadLegacyPendingUpdateRun) {
			await this.saveData(this.settings);
		}
	}

	async updateSettings(mutator: (settings: MediaTrackerSettings) => void) {
		const run = this.settingsUpdateQueue.then(async () => {
			const previousQuerySettings = getMediaQuerySettingsSnapshot(this.settings);
			mutator(this.settings);
			this.settings.mediaFolder = normalizeMediaFolder(this.settings.mediaFolder);
			await this.saveData(this.settings);
				this.logger?.updateOptions({
					enabled: this.settings.loggingEnabled,
					level: this.settings.loggingLevel,
					maxLogFiles: this.settings.loggingMaxFiles,
				});
				const nextQuerySettings = getMediaQuerySettingsSnapshot(this.settings);
				if (didMediaQuerySettingsChange(previousQuerySettings, nextQuerySettings)) {
					this.invalidateTrackerItemCaches();
				}
				this.viewRefreshManager.scheduleRefresh();
			});
		this.settingsUpdateQueue = run.catch(() => {
			// Keep queue chain alive even if one settings update fails.
		});
		return run;
	}

	setActiveUpdateRun(run: UpdateLogRun | null) {
		this.updateRunState.setActiveUpdateRun(run);
	}

	getActiveUpdateRun(): UpdateLogRun | null {
		return this.updateRunState.getActiveUpdateRun();
	}

	async recordCompletedUpdateRun(run: UpdateLogRun) {
		await this.updateRunState.recordCompletedUpdateRun(run);
	}

	private invalidateTrackerItemCaches() {
		const leaves = this.app.workspace.getLeavesOfType(MEDIA_TRACKER_VIEW);
		for (const leaf of leaves) {
			if (leaf.view instanceof MediaTrackerView) {
				leaf.view.invalidateItemsCache();
			}
		}
	}

	private refreshViewsByType(viewType: string) {
		const leaves = this.app.workspace.getLeavesOfType(viewType);
		for (const leaf of leaves) {
			if (leaf.view instanceof MediaTrackerView) {
				leaf.view.requestRender();
			} else if (leaf.view instanceof MediaTrackerUpdateLogView || leaf.view instanceof MediaTrackerPluginLogView) {
				leaf.view.render();
			}
		}
	}
}
