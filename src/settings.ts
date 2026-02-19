import {App, Notice, PluginSettingTab, Setting} from "obsidian";
import MediaTrackerPlugin from "./main";
import {UpdateLogRun, UpdateNotificationMode} from "./types";
import {PluginLogLevel, getPluginLogDirectory} from "./infra/logging/pluginLogger";
import {openPluginLog} from "./ui/pluginLogView";
import {ensurePluginGitignoreEntries} from "./infra/git/vaultGit";

export type StartupUpdateThrottleMode = "day" | "week" | "hours";

export interface MediaTrackerSettings {
	mediaFolder: string;
	displayMode: "cards" | "details";
	tmdbApiKey: string;
	tmdbMinIntervalMs: number;
	tmdbLastSync?: number;
	updateNotificationMode: UpdateNotificationMode;
	autoOpenUpdateLogOnFailure: boolean;
	startupLibraryUpdateEnabled: boolean;
	startupLibraryUpdateThrottleMode: StartupUpdateThrottleMode;
	startupLibraryUpdateIntervalHours: number;
	startupLibraryUpdateLastRun?: number;
	updateLogRuns: UpdateLogRun[];
	loggingEnabled: boolean;
	loggingLevel: PluginLogLevel;
	loggingMaxFiles: number;
}

export const DEFAULT_SETTINGS: MediaTrackerSettings = {
	mediaFolder: "Media",
	displayMode: "cards",
	tmdbApiKey: "",
	tmdbMinIntervalMs: 300,
	updateNotificationMode: "summary",
	autoOpenUpdateLogOnFailure: true,
	startupLibraryUpdateEnabled: false,
	startupLibraryUpdateThrottleMode: "day",
	startupLibraryUpdateIntervalHours: 24,
	updateLogRuns: [],
	loggingEnabled: true,
	loggingLevel: "info",
	loggingMaxFiles: 14,
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

		new Setting(containerEl)
			.setName("Update notifications")
			.setDesc("Control notices shown after refresh.")
			.addDropdown((dropdown) => dropdown
				.addOption("quiet", "Quiet (failures only)")
				.addOption("summary", "Summary")
				.addOption("verbose", "Verbose")
				.setValue(this.plugin.settings.updateNotificationMode)
				.onChange(async (value) => {
					if (value === "quiet" || value === "summary" || value === "verbose") {
						this.plugin.settings.updateNotificationMode = value;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName("Auto-open update log on failures")
			.setDesc("When refresh ends with failures, open the update log tab automatically.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.autoOpenUpdateLogOnFailure)
				.onChange(async (value) => {
					this.plugin.settings.autoOpenUpdateLogOnFailure = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl("h3", {text: "Startup updates"});

		new Setting(containerEl)
			.setName("Update library on startup")
			.setDesc("Run a full library refresh when the plugin loads, subject to throttle settings.")
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.startupLibraryUpdateEnabled)
				.onChange(async (value) => {
					this.plugin.settings.startupLibraryUpdateEnabled = value;
					await this.plugin.saveSettings();
					this.display();
				}));

		new Setting(containerEl)
			.setName("Startup update throttle")
			.setDesc("How often startup refresh is allowed to run.")
			.addDropdown((dropdown) => dropdown
				.addOption("day", "Once per day")
				.addOption("week", "Once per week")
				.addOption("hours", "Custom hours")
				.setValue(this.plugin.settings.startupLibraryUpdateThrottleMode)
				.onChange(async (value) => {
					if (value === "day" || value === "week" || value === "hours") {
						this.plugin.settings.startupLibraryUpdateThrottleMode = value;
						await this.plugin.saveSettings();
						this.display();
					}
				}));

		new Setting(containerEl)
			.setName("Startup interval (hours)")
			.setDesc("Used only when throttle is set to custom hours.")
			.addText((text) => {
				text.setPlaceholder("24");
				text.setValue(String(this.plugin.settings.startupLibraryUpdateIntervalHours));
				text.inputEl.disabled = this.plugin.settings.startupLibraryUpdateThrottleMode !== "hours";
				text.onChange(async (value) => {
					const parsed = Number.parseFloat(value);
					if (Number.isFinite(parsed) && parsed > 0) {
						this.plugin.settings.startupLibraryUpdateIntervalHours = parsed;
					} else {
						this.plugin.settings.startupLibraryUpdateIntervalHours = DEFAULT_SETTINGS.startupLibraryUpdateIntervalHours;
					}
					await this.plugin.saveSettings();
				});
			});

		containerEl.createEl("h3", {text: "Developer logging"});

		new Setting(containerEl)
			.setName("Enable plugin logging")
			.setDesc(`Write structured plugin logs to: ${getPluginLogDirectory(this.app, this.plugin.manifest.id)}`)
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.loggingEnabled)
				.onChange(async (value) => {
					this.plugin.settings.loggingEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Log level")
			.setDesc("Minimum severity to persist.")
			.addDropdown((dropdown) => dropdown
				.addOption("debug", "Debug")
				.addOption("info", "Info")
				.addOption("warn", "Warn")
				.addOption("error", "Error")
				.setValue(this.plugin.settings.loggingLevel)
				.onChange(async (value) => {
					if (value === "debug" || value === "info" || value === "warn" || value === "error") {
						this.plugin.settings.loggingLevel = value;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName("Max log files")
			.setDesc("Maximum number of daily log files to keep.")
			.addText((text) => text
				.setPlaceholder("14")
				.setValue(String(this.plugin.settings.loggingMaxFiles))
				.onChange(async (value) => {
					const parsed = Number.parseInt(value, 10);
					this.plugin.settings.loggingMaxFiles = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.loggingMaxFiles;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName("Open plugin log")
			.setDesc(`Log path: ${getPluginLogDirectory(this.app, this.plugin.manifest.id)}`)
			.addButton((button) => button
				.setButtonText("Open log")
				.onClick(() => {
					void openPluginLog(this.plugin);
				}));

		new Setting(containerEl)
			.setName("Update repository .gitignore")
			.setDesc("Add plugin cache/log directories to .gitignore if the vault is a Git repository.")
			.addButton((button) => button
				.setButtonText("Update .gitignore")
				.onClick(() => {
					void this.updateGitignore();
				}));
	}

	private async updateGitignore() {
		const result = await ensurePluginGitignoreEntries(this.app, this.plugin.manifest.id);
		switch (result.status) {
			case "updated":
				this.plugin.logger.info("settings", "gitignore_updated", result.message, {
					path: result.gitignorePath,
					added: result.addedEntries,
				});
				new Notice(result.message);
				return;
			case "already_up_to_date":
				this.plugin.logger.info("settings", "gitignore_noop", result.message, {path: result.gitignorePath});
				new Notice(result.message);
				return;
			case "not_repo":
			case "git_missing":
			case "unsupported_root":
				this.plugin.logger.warn("settings", "gitignore_skipped", result.message);
				new Notice(result.message, 8000);
				return;
			case "failed":
			default:
				this.plugin.logger.error("settings", "gitignore_failed", result.message);
				new Notice(result.message, 10000);
		}
	}
}
