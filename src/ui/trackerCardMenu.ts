import {Menu} from "obsidian";
import {NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES, TMDB_TYPES} from "../domain/media/config";
import {hasRepeatProgress} from "../domain/media/progress";
import type {MediaRecord} from "../domain/media/models";

type TrackerCardMenuHandlers = {
	onOpenNote: () => void;
	onStartRepeat: () => void;
	onStopRepeat: () => void;
	onRefreshLatest: () => void;
	onAddLink: () => void;
	onCleanNote: () => void;
	onDeleteNote: () => void;
};

function canRefreshLatest(item: MediaRecord): boolean {
	return TMDB_TYPES.has(item.type) || item.type === "anime" || item.type === "manga";
}

function canRepeat(item: MediaRecord): boolean {
	return Boolean(item.progress)
		&& (NOVEL_PROGRESS_TYPES.has(item.type) || SEASON_EPISODE_TYPES.has(item.type));
}

export function showTrackerCardMenu(
	event: MouseEvent,
	item: MediaRecord,
	handlers: TrackerCardMenuHandlers,
) {
	const menu = new Menu();
	menu.addItem((itemMenu) => itemMenu
		.setTitle("Open note")
		.onClick(() => {
			handlers.onOpenNote();
		}));

	if (canRefreshLatest(item)) {
		menu.addSeparator();
		menu.addItem((itemMenu) => itemMenu
			.setTitle(item.type === "manga" ? "Check latest chapter" : "Check latest episode")
			.onClick(() => {
				handlers.onRefreshLatest();
			}));
	}

	if (canRepeat(item)) {
		menu.addSeparator();
		if (hasRepeatProgress(item)) {
			menu.addItem((itemMenu) => itemMenu
				.setTitle("Stop repeating")
				.setIcon("repeat")
				.onClick(() => {
					handlers.onStopRepeat();
				}));
		} else {
			menu.addItem((itemMenu) => itemMenu
				.setTitle("Start repeating")
				.setIcon("repeat")
				.onClick(() => {
					handlers.onStartRepeat();
				}));
		}
	}

	menu.addSeparator();
	menu.addItem((itemMenu) => {
		itemMenu.setTitle("Add link");
		itemMenu.setIcon("link");
		itemMenu.onClick(() => {
			handlers.onAddLink();
		});
	});

	menu.addSeparator();
	menu.addItem((itemMenu) => itemMenu
		.setTitle("Clean note")
		.setIcon("wand-2")
		.onClick(() => {
			handlers.onCleanNote();
		}));

	menu.addSeparator();
	menu.addItem((itemMenu) => itemMenu
		.setTitle("Delete note…")
		.setIcon("trash")
		.onClick(() => {
			handlers.onDeleteNote();
		}));

	menu.showAtMouseEvent(event);
}
