import {App, TFile} from "obsidian";
import {MediaTrackerSettings} from "../../settings";
import {MediaItem} from "../../types";
import {listMediaItems} from "../../domain/media/readModel";

export function listTrackedMedia(app: App, settings: MediaTrackerSettings): MediaItem[] {
	return listMediaItems(app, settings);
}

export function listTrackedMediaFiles(app: App, settings: MediaTrackerSettings): TFile[] {
	return listTrackedMedia(app, settings).map((item) => item.file);
}
