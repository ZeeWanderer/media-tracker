import {TAbstractFile, TFile, TFolder} from "obsidian";
import {normalizeMediaFolder} from "./pluginSettings";

type ViewRefreshManagerDeps = {
	getMediaFolder: () => string;
	invalidateTrackerItemCaches: () => void;
	refreshTrackerViews: () => void;
	refreshUpdateLogViews: () => void;
	refreshPluginLogViews: () => void;
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
		this.deps.refreshTrackerViews();
		this.deps.refreshUpdateLogViews();
		this.deps.refreshPluginLogViews();
	}

	invalidateTrackerItemCaches() {
		this.deps.invalidateTrackerItemCaches();
	}

	refreshTrackerViews() {
		this.deps.refreshTrackerViews();
	}

	refreshUpdateLogViews() {
		this.deps.refreshUpdateLogViews();
	}

	refreshPluginLogViews() {
		this.deps.refreshPluginLogViews();
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
