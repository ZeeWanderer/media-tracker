import type {App, Plugin} from "obsidian";
import type {MediaTrackerSettings} from "../core/pluginSettingsModel";
import type {PluginLogger} from "../infra/logging/pluginLogger";
import {MEDIA_TRACKER_VIEW} from "../ui/viewIds";
import {NewMediaModal} from "../ui/newMediaModal";
import {openMediaUpdateLog} from "../ui/updateLogView";
import {openPluginLog} from "../ui/pluginLogView";

type CommandsPluginDeps = Pick<Plugin, "addCommand"> & {
	app: App;
	settings: MediaTrackerSettings;
	logger: PluginLogger;
};

export function registerCommands(plugin: CommandsPluginDeps) {
	plugin.addCommand({
		id: "open-media-tracker",
		name: "Open media tracker",
		callback: () => {
			void openMediaTracker(plugin);
		},
	});

	plugin.addCommand({
		id: "create-media-note",
		name: "Create media note",
		callback: () => {
			new NewMediaModal({
				app: plugin.app,
				settings: plugin.settings,
				logger: plugin.logger,
			}).open();
		},
	});

	plugin.addCommand({
		id: "open-media-update-log",
		name: "Open media update log",
		callback: () => {
			void openMediaUpdateLog(plugin);
		},
	});

	plugin.addCommand({
		id: "open-media-plugin-log",
		name: "Open media plugin log",
		callback: () => {
			void openPluginLog(plugin);
		},
	});
}

export async function openMediaTracker(plugin: {app: App}) {
	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({type: MEDIA_TRACKER_VIEW, active: true});
	await plugin.app.workspace.revealLeaf(leaf);
}
