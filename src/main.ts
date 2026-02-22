import {Plugin} from "obsidian";
import {MediaTrackerSettingTab} from "./settings";
import {openMediaTracker, registerCommands} from "./commands";
import {MediaTrackerView} from "./ui/trackerView";
import {MediaTrackerUpdateLogView, openMediaUpdateLog} from "./ui/updateLogView";
import {MediaTrackerPluginLogView} from "./ui/pluginLogView";
import {DesktopFaviconCache} from "./infra/cache/faviconCache";
import {PluginLogger} from "./infra/logging/pluginLogger";
import {listTrackedMedia, refreshTrackedMedia} from "./flows/media";
import {UpdateLogRun} from "./types";
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
import {
	MEDIA_TRACKER_PLUGIN_LOG_VIEW,
	MEDIA_TRACKER_UPDATE_LOG_VIEW,
	MEDIA_TRACKER_VIEW,
} from "./ui/viewIds";

type TrackerCacheView = {
	invalidateItemsCache?: () => void;
};

type RefreshableView = {
	render?: () => void;
	requestRender?: () => void;
};

export default class MediaTrackerPlugin extends Plugin {
	settings: MediaTrackerSettings;
	faviconCache!: DesktopFaviconCache;
	logger!: PluginLogger;
	private updateRunState!: UpdateRunState;
	private startupUpdateService!: StartupLibraryUpdateService;
	private pendingRunCheckpointStore!: PendingUpdateRunCheckpointStore;
	private viewRefreshManager!: ViewRefreshManager;

	async onload() {
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
			refreshUpdateLogViews: () => this.viewRefreshManager.refreshUpdateLogViews(),
			loadPendingRunCheckpoint: () => this.pendingRunCheckpointStore.load(),
			savePendingRunCheckpoint: (run) => this.pendingRunCheckpointStore.save(run),
			logger: this.logger,
		});
		this.startupUpdateService = new StartupLibraryUpdateService({
			getSettings: () => this.settings,
			saveSettingsData: () => this.saveData(this.settings),
			listTrackedItems: () => listTrackedMedia(this.app, this.settings),
			refreshTrackedItems: (items, onRunUpdate) => refreshTrackedMedia(this.app, this.settings, items, undefined, onRunUpdate),
			setActiveUpdateRun: (run) => this.setActiveUpdateRun(run),
			recordCompletedUpdateRun: (run) => this.recordCompletedUpdateRun(run),
			invalidateTrackerItemCaches: () => this.viewRefreshManager.invalidateTrackerItemCaches(),
			scheduleRefresh: () => this.viewRefreshManager.scheduleRefresh(),
			openUpdateLog: () => openMediaUpdateLog(this),
			logger: this.logger,
		});
		this.logger.info("plugin", "loaded", "Media Tracker loaded.");
		await this.updateRunState.restorePendingUpdateRunIfAny();

		this.registerView(MEDIA_TRACKER_VIEW, (leaf) => new MediaTrackerView(leaf, this));
		this.registerView(MEDIA_TRACKER_UPDATE_LOG_VIEW, (leaf) => new MediaTrackerUpdateLogView(leaf, this));
		this.registerView(MEDIA_TRACKER_PLUGIN_LOG_VIEW, (leaf) => new MediaTrackerPluginLogView(leaf, this));
		registerCommands(this);
		this.addSettingTab(new MediaTrackerSettingTab(this.app, this));
		this.addRibbonIcon("film", "Open media tracker", () => openMediaTracker(this));

		this.registerEvent(this.app.metadataCache.on("changed", (file) => this.viewRefreshManager.handleMetadataMutation(file)));
		this.registerEvent(this.app.vault.on("create", (file) => this.viewRefreshManager.handleVaultDataMutation(file)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.viewRefreshManager.handleVaultDataMutation(file)));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.viewRefreshManager.handleVaultDataMutation(file, oldPath)));
		void this.startupUpdateService.runIfDue();
	}

	onunload() {
		this.viewRefreshManager?.dispose();
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
			this.viewRefreshManager.invalidateTrackerItemCaches();
		}
		this.viewRefreshManager.scheduleRefresh();
	}

	scheduleRefresh() {
		this.viewRefreshManager.scheduleRefresh();
	}

	suppressNextViewRefresh() {
		this.viewRefreshManager.suppressNextViewRefresh();
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
			const view = leaf.view as TrackerCacheView;
			view.invalidateItemsCache?.();
		}
	}

	private refreshViewsByType(viewType: string) {
		const leaves = this.app.workspace.getLeavesOfType(viewType);
		for (const leaf of leaves) {
			const view = leaf.view as RefreshableView;
			if (view.requestRender) {
				view.requestRender();
			} else {
				view.render?.();
			}
		}
	}
}
