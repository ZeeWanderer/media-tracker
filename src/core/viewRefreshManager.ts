import {TAbstractFile, TFile, TFolder} from "obsidian";
import {normalizeMediaFolder} from "./pluginSettings";
import {normalizeVaultPathForCompare} from "../pathUtils";

type ViewRefreshManagerDeps = {
	getMediaFolder: () => string;
	invalidateTrackerItemCaches: () => void;
	refreshTrackerViews: () => void;
	refreshUpdateLogViews: () => void;
	refreshPluginLogViews: () => void;
};

export class ViewRefreshManager {
	private refreshTimer: number | null = null;
	private pendingTrackerRefresh = false;
	private pendingUpdateLogRefresh = false;
	private pendingPluginLogRefresh = false;

	constructor(private readonly deps: ViewRefreshManagerDeps) {}

	dispose() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.pendingTrackerRefresh = false;
		this.pendingUpdateLogRefresh = false;
		this.pendingPluginLogRefresh = false;
	}

	scheduleRefresh() {
		this.pendingTrackerRefresh = true;
		this.pendingUpdateLogRefresh = true;
		this.pendingPluginLogRefresh = true;
		this.scheduleDeferredRefresh();
	}

	handleMetadataMutation(file: TFile) {
		if (!this.shouldRefreshForMetadataFile(file)) {
			return;
		}
		this.deps.invalidateTrackerItemCaches();
		this.scheduleTrackerRefresh();
	}

	handleVaultDataMutation(file: TAbstractFile, oldPath?: string) {
		if (!this.shouldRefreshForVaultMutation(file, oldPath)) {
			return;
		}
		this.deps.invalidateTrackerItemCaches();
		this.scheduleTrackerRefresh();
	}

	private scheduleTrackerRefresh() {
		this.pendingTrackerRefresh = true;
		this.scheduleDeferredRefresh();
	}

	private scheduleDeferredRefresh() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.flushPendingRefreshes();
		}, 150);
	}

	private flushPendingRefreshes() {
		const shouldRefreshTracker = this.pendingTrackerRefresh;
		const shouldRefreshUpdateLog = this.pendingUpdateLogRefresh;
		const shouldRefreshPluginLog = this.pendingPluginLogRefresh;
		this.pendingTrackerRefresh = false;
		this.pendingUpdateLogRefresh = false;
		this.pendingPluginLogRefresh = false;
		if (shouldRefreshTracker) {
			this.deps.refreshTrackerViews();
		}
		if (shouldRefreshUpdateLog) {
			this.deps.refreshUpdateLogViews();
		}
		if (shouldRefreshPluginLog) {
			this.deps.refreshPluginLogViews();
		}
	}

	private shouldRefreshForMetadataFile(file: TFile): boolean {
		return this.isDisplayableMediaPath(file.path, false);
	}

	private shouldRefreshForVaultMutation(file: TAbstractFile, oldPath?: string): boolean {
		const isFolder = file instanceof TFolder;
		if (this.isDisplayableMediaPath(file.path, isFolder)) {
			return true;
		}
		if (oldPath && this.isDisplayableMediaPath(oldPath, isFolder)) {
			return true;
		}
		if (oldPath && this.isPathWithinMediaFolder(oldPath) && oldPath.toLowerCase().endsWith(".md")) {
			return true;
		}
		return false;
	}

	private isDisplayableMediaPath(path: string, isFolder: boolean): boolean {
		if (!this.isPathWithinMediaFolder(path)) {
			return false;
		}
		if (isFolder) {
			return true;
		}
		return path.toLowerCase().endsWith(".md");
	}

	private isPathWithinMediaFolder(path: string): boolean {
		const normalizedPath = normalizeVaultPathForCompare(path);
		const mediaFolder = normalizeVaultPathForCompare(normalizeMediaFolder(this.deps.getMediaFolder()));
		return normalizedPath === mediaFolder || normalizedPath.startsWith(`${mediaFolder}/`);
	}
}
