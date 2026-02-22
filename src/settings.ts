import {App, Notice, Plugin, PluginSettingTab, Setting, TextComponent} from "obsidian";
import {getPluginLogDirectory} from "./infra/logging/pluginLogger";
import {openPluginLog} from "./ui/pluginLogView";
import {ensurePluginGitignoreEntries} from "./infra/git/gitignoreFlow";
import {DEFAULT_SETTINGS, MediaTrackerSettings} from "./core/pluginSettingsModel";
import type {PluginLogger} from "./infra/logging/pluginLogger";

type SettingsTabPluginDeps = Plugin & {
	settings: MediaTrackerSettings;
	manifest: {id: string};
	logger: PluginLogger;
	updateSettings: (mutator: (settings: MediaTrackerSettings) => void) => Promise<void>;
};

export class MediaTrackerSettingTab extends PluginSettingTab {
	plugin: SettingsTabPluginDeps;
	private readonly textSettingDebounceMs = 450;
	private readonly textSettingTimers = new Map<string, number>();
	private readonly pendingTextSettingValues = new Map<string, string>();
	private readonly textSettingUpdaters = new Map<string, (settings: MediaTrackerSettings, value: string) => void>();

	constructor(app: App, plugin: SettingsTabPluginDeps) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		this.flushAllPendingTextSettingUpdates();
		super.hide();
	}

	private bindDebouncedTextSetting(
		key: string,
		text: TextComponent,
		value: string,
		updater: (settings: MediaTrackerSettings, value: string) => void,
	) {
		this.textSettingUpdaters.set(key, updater);
		const pending = this.pendingTextSettingValues.get(key);
		text.setValue(pending ?? value);
		text.onChange((nextValue) => this.scheduleTextSettingUpdate(key, nextValue));
		text.inputEl.addEventListener("blur", () => this.flushTextSettingUpdate(key));
	}

	private scheduleTextSettingUpdate(key: string, value: string) {
		this.pendingTextSettingValues.set(key, value);
		const existingTimer = this.textSettingTimers.get(key);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
		}
		const timer = window.setTimeout(() => {
			this.textSettingTimers.delete(key);
			this.flushTextSettingUpdate(key);
		}, this.textSettingDebounceMs);
		this.textSettingTimers.set(key, timer);
	}

	private flushTextSettingUpdate(key: string) {
		const existingTimer = this.textSettingTimers.get(key);
		if (existingTimer !== undefined) {
			window.clearTimeout(existingTimer);
			this.textSettingTimers.delete(key);
		}
		const value = this.pendingTextSettingValues.get(key);
		const updater = this.textSettingUpdaters.get(key);
		if (value === undefined || !updater) {
			return;
		}
		this.pendingTextSettingValues.delete(key);
		void this.plugin.updateSettings((settings) => {
			updater(settings, value);
		});
	}

	private flushAllPendingTextSettingUpdates() {
		const updates = Array.from(this.pendingTextSettingValues.entries());
		for (const timer of this.textSettingTimers.values()) {
			window.clearTimeout(timer);
		}
		this.textSettingTimers.clear();
		this.pendingTextSettingValues.clear();
		if (!updates.length) {
			return;
		}
		void this.plugin.updateSettings((settings) => {
			for (const [key, value] of updates) {
				const updater = this.textSettingUpdaters.get(key);
				if (updater) {
					updater(settings, value);
				}
			}
		});
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl("h2", {text: "Media Tracker settings"});

			new Setting(containerEl)
				.setName("Media folder")
				.setDesc("Folder path inside your vault that stores media notes.")
				.addText((text) => {
					text.setPlaceholder("Media");
					this.bindDebouncedTextSetting(
						"media_folder",
						text,
						this.plugin.settings.mediaFolder,
						(settings, value) => {
							settings.mediaFolder = value.trim() || DEFAULT_SETTINGS.mediaFolder;
						},
					);
				});

			new Setting(containerEl)
				.setName("TMDb API key")
				.setDesc("Optional. Used to check latest episodes for series.")
				.addText((text) => {
					text.setPlaceholder("tmdb api key");
					this.bindDebouncedTextSetting(
						"tmdb_api_key",
						text,
						this.plugin.settings.tmdbApiKey,
						(settings, value) => {
							settings.tmdbApiKey = value.trim();
						},
					);
				});

			new Setting(containerEl)
				.setName("TMDb rate limit (ms)")
				.setDesc("Minimum delay between TMDb requests when bulk refreshing.")
				.addText((text) => {
					text.setPlaceholder("300");
					this.bindDebouncedTextSetting(
						"tmdb_min_interval_ms",
						text,
						String(this.plugin.settings.tmdbMinIntervalMs),
						(settings, value) => {
							const parsed = Number.parseInt(value, 10);
							settings.tmdbMinIntervalMs = Number.isFinite(parsed) ? parsed : DEFAULT_SETTINGS.tmdbMinIntervalMs;
						},
					);
				});

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
							await this.plugin.updateSettings((settings) => {
								settings.updateNotificationMode = value;
							});
						}
					}));

			new Setting(containerEl)
				.setName("Auto-open update log on failures")
				.setDesc("When refresh ends with failures, open the update log tab automatically.")
				.addToggle((toggle) => toggle
					.setValue(this.plugin.settings.autoOpenUpdateLogOnFailure)
					.onChange(async (value) => {
						await this.plugin.updateSettings((settings) => {
							settings.autoOpenUpdateLogOnFailure = value;
						});
					}));

		containerEl.createEl("h3", {text: "Startup updates"});

			new Setting(containerEl)
				.setName("Update library on startup")
				.setDesc("Run a full library refresh when the plugin loads, subject to throttle settings.")
				.addToggle((toggle) => toggle
					.setValue(this.plugin.settings.startupLibraryUpdateEnabled)
					.onChange(async (value) => {
						await this.plugin.updateSettings((settings) => {
							settings.startupLibraryUpdateEnabled = value;
						});
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
							await this.plugin.updateSettings((settings) => {
								settings.startupLibraryUpdateThrottleMode = value;
							});
							this.display();
						}
					}));

			new Setting(containerEl)
				.setName("Startup interval (hours)")
				.setDesc("Used only when throttle is set to custom hours.")
				.addText((text) => {
					text.setPlaceholder("24");
					this.bindDebouncedTextSetting(
						"startup_library_interval_hours",
						text,
						String(this.plugin.settings.startupLibraryUpdateIntervalHours),
						(settings, value) => {
							const parsed = Number.parseFloat(value);
							if (Number.isFinite(parsed) && parsed > 0) {
								settings.startupLibraryUpdateIntervalHours = parsed;
							} else {
								settings.startupLibraryUpdateIntervalHours = DEFAULT_SETTINGS.startupLibraryUpdateIntervalHours;
							}
						},
					);
					text.inputEl.disabled = this.plugin.settings.startupLibraryUpdateThrottleMode !== "hours";
				});

		containerEl.createEl("h3", {text: "Developer logging"});

			new Setting(containerEl)
				.setName("Enable plugin logging")
				.setDesc(`Write structured plugin logs to: ${getPluginLogDirectory(this.app, this.plugin.manifest.id)}`)
				.addToggle((toggle) => toggle
					.setValue(this.plugin.settings.loggingEnabled)
					.onChange(async (value) => {
						await this.plugin.updateSettings((settings) => {
							settings.loggingEnabled = value;
						});
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
							await this.plugin.updateSettings((settings) => {
								settings.loggingLevel = value;
							});
						}
					}));

			new Setting(containerEl)
				.setName("Max log files")
				.setDesc("Maximum number of daily log files to keep.")
				.addText((text) => {
					text.setPlaceholder("14");
					this.bindDebouncedTextSetting(
						"logging_max_files",
						text,
						String(this.plugin.settings.loggingMaxFiles),
						(settings, value) => {
							const parsed = Number.parseInt(value, 10);
							settings.loggingMaxFiles = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.loggingMaxFiles;
						},
					);
				});

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
