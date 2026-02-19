import {App, TFile} from "obsidian";
import {MediaTrackerSettings} from "../../settings";
import {MediaItem} from "../../types";
import {listMediaItems} from "../../domain/media/readModel";

export function listTrackedMedia(app: App, settings: MediaTrackerSettings): MediaItem[] {
	return listMediaItems(app, settings);
}

export function listTrackedMediaFiles(app: App, settings: MediaTrackerSettings): TFile[] {
	const baseFolder = settings.mediaFolder.trim() || "Media";
	return app.vault.getFiles().filter((file) => file.path.startsWith(`${baseFolder}/`));
}
