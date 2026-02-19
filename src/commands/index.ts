import MediaTrackerPlugin from "../main";
import {MEDIA_TRACKER_VIEW} from "../ui/trackerView";
import {NewMediaModal} from "../ui/newMediaModal";
import {openMediaUpdateLog} from "../ui/updateLogView";
import {openPluginLog} from "../ui/pluginLogView";

export function registerCommands(plugin: MediaTrackerPlugin) {
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
			new NewMediaModal(plugin).open();
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

export async function openMediaTracker(plugin: MediaTrackerPlugin) {
	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({type: MEDIA_TRACKER_VIEW, active: true});
	await plugin.app.workspace.revealLeaf(leaf);
}
