import {Plugin} from "obsidian";
import {DEFAULT_SETTINGS, MediaTrackerSettings, MediaTrackerSettingTab} from "./settings";
import {openMediaTracker, registerCommands} from "./commands";
import {MEDIA_TRACKER_VIEW, MediaTrackerView} from "./ui/trackerView";
import {DesktopFaviconCache} from "./infra/cache/faviconCache";

export default class MediaTrackerPlugin extends Plugin {
	settings: MediaTrackerSettings;
	faviconCache!: DesktopFaviconCache;
	private refreshTimer: number | null = null;

	async onload() {
		await this.loadSettings();
		this.faviconCache = new DesktopFaviconCache(this.app, this.manifest.id);

		this.registerView(MEDIA_TRACKER_VIEW, (leaf) => new MediaTrackerView(leaf, this));
		registerCommands(this);
		this.addSettingTab(new MediaTrackerSettingTab(this.app, this));
		this.addRibbonIcon("film", "Open media tracker", () => openMediaTracker(this));

		this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("delete", () => this.scheduleRefresh()));
		this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
	}

	onunload() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
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
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.scheduleRefresh();
	}

	scheduleRefresh() {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => this.refreshViews(), 150);
	}

	refreshViews() {
		const leaves = this.app.workspace.getLeavesOfType(MEDIA_TRACKER_VIEW);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof MediaTrackerView) {
				view.render();
			}
		}
	}
}
