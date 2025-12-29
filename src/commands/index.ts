import MediaTrackerPlugin from "../main";
import {MEDIA_TRACKER_VIEW} from "../ui/trackerView";
import {NewMediaModal} from "../ui/newMediaModal";

export function registerCommands(plugin: MediaTrackerPlugin) {
	plugin.addCommand({
		id: "open-media-tracker",
		name: "Open media tracker",
		callback: () => openMediaTracker(plugin),
	});

	plugin.addCommand({
		id: "create-media-note",
		name: "Create media note",
		callback: () => {
			new NewMediaModal(plugin).open();
		},
	});
}

export async function openMediaTracker(plugin: MediaTrackerPlugin) {
	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({type: MEDIA_TRACKER_VIEW, active: true});
	plugin.app.workspace.revealLeaf(leaf);
}
