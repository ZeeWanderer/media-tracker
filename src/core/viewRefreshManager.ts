import {App, TAbstractFile, TFile, TFolder} from "obsidian";
import {normalizeMediaFolder} from "./pluginSettings";
import {
	MEDIA_TRACKER_PLUGIN_LOG_VIEW,
	MEDIA_TRACKER_UPDATE_LOG_VIEW,
	MEDIA_TRACKER_VIEW,
} from "../ui/viewIds";

// Minimal interfaces to avoid runtime coupling to concrete view classes.
type TrackerCacheView = {
	invalidateItemsCache?: () => void;
};

type RefreshableView = {
	render?: () => void;
	requestRender?: () => void;
};

type ViewRefreshManagerDeps = {
	app: App;
	getMediaFolder: () => string;
};

export class ViewRefreshManager {
	private refreshTimer: number | null = null;
	private skippedRefreshEvents = 0;

	constructor(private readonly deps: ViewRefreshManagerDeps) {}

	dispose() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
			this.refreshTimer = null;
		}
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

	handleMetadataMutation(file: TFile) {
		if (!this.shouldRefreshForMetadataFile(file)) {
			return;
		}
		this.invalidateTrackerItemCaches();
		this.scheduleRefresh();
	}

	handleVaultDataMutation(file: TAbstractFile, oldPath?: string) {
		if (!this.shouldRefreshForVaultMutation(file, oldPath)) {
			return;
		}
		this.invalidateTrackerItemCaches();
		this.scheduleRefresh();
	}

	refreshViews() {
		this.refreshTrackerViews();
		this.refreshUpdateLogViews();
		this.refreshPluginLogViews();
	}

	invalidateTrackerItemCaches() {
		const leaves = this.deps.app.workspace.getLeavesOfType(MEDIA_TRACKER_VIEW);
		for (const leaf of leaves) {
			const view = leaf.view as TrackerCacheView;
			view.invalidateItemsCache?.();
		}
	}

	refreshTrackerViews() {
		const leaves = this.deps.app.workspace.getLeavesOfType(MEDIA_TRACKER_VIEW);
		for (const leaf of leaves) {
			const view = leaf.view as RefreshableView;
			if (view.requestRender) {
				view.requestRender();
			} else {
				view.render?.();
			}
		}
	}

	refreshUpdateLogViews() {
		const leaves = this.deps.app.workspace.getLeavesOfType(MEDIA_TRACKER_UPDATE_LOG_VIEW);
		for (const leaf of leaves) {
			const view = leaf.view as RefreshableView;
			view.render?.();
		}
	}

	refreshPluginLogViews() {
		const leaves = this.deps.app.workspace.getLeavesOfType(MEDIA_TRACKER_PLUGIN_LOG_VIEW);
		for (const leaf of leaves) {
			const view = leaf.view as RefreshableView;
			view.render?.();
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
		const normalizedPath = this.normalizeVaultPath(path);
		const mediaFolder = this.normalizeVaultPath(normalizeMediaFolder(this.deps.getMediaFolder()));
		return normalizedPath === mediaFolder || normalizedPath.startsWith(`${mediaFolder}/`);
	}

	private normalizeVaultPath(value: string): string {
		return value
			.replace(/\\/g, "/")
			.replace(/^\/+|\/+$/g, "")
			.toLowerCase();
	}
}
