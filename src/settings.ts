import {App, PluginSettingTab, Setting} from "obsidian";
import MediaTrackerPlugin from "./main";

export interface MediaTrackerSettings {
	mediaFolder: string;
	displayMode: "cards" | "details";
	tmdbApiKey: string;
	tmdbMinIntervalMs: number;
	tmdbLastSync?: number;
}

export const DEFAULT_SETTINGS: MediaTrackerSettings = {
	mediaFolder: "Media",
	displayMode: "cards",
	tmdbApiKey: "",
	tmdbMinIntervalMs: 300,
};

export class MediaTrackerSettingTab extends PluginSettingTab {
	plugin: MediaTrackerPlugin;

	constructor(app: App, plugin: MediaTrackerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl("h2", {text: "Media Tracker settings"});

		new Setting(containerEl)
			.setName("Media folder")
			.setDesc("Folder path inside your vault that stores media notes.")
			.addText((text) => text
				.setPlaceholder("Media")
				.setValue(this.plugin.settings.mediaFolder)
				.onChange(async (value) => {
					this.plugin.settings.mediaFolder = value.trim() || DEFAULT_SETTINGS.mediaFolder;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("TMDb API key")
			.setDesc("Optional. Used to check latest episodes for series.")
			.addText((text) => text
				.setPlaceholder("tmdb api key")
				.setValue(this.plugin.settings.tmdbApiKey)
				.onChange(async (value) => {
					this.plugin.settings.tmdbApiKey = value.trim();
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("TMDb rate limit (ms)")
			.setDesc("Minimum delay between TMDb requests when bulk refreshing.")
			.addText((text) => text
				.setPlaceholder("300")
				.setValue(String(this.plugin.settings.tmdbMinIntervalMs))
				.onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.tmdbMinIntervalMs = Number.isFinite(parsed) ? parsed : DEFAULT_SETTINGS.tmdbMinIntervalMs;
					await this.plugin.saveSettings();
				}));
	}
}
