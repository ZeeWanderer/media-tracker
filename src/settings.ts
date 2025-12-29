import {App, PluginSettingTab, Setting} from "obsidian";
import MediaTrackerPlugin from "./main";

export interface MediaTrackerSettings {
	mediaFolder: string;
}

export const DEFAULT_SETTINGS: MediaTrackerSettings = {
	mediaFolder: "Media",
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
	}
}
