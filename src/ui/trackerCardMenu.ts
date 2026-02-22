import {Menu} from "obsidian";
import {TMDB_TYPES} from "../domain/media/config";
import type {MediaItem} from "../domain/media/models";

type TrackerCardMenuHandlers = {
	onOpenNote: () => void;
	onRefreshLatest: () => void;
	onAddLink: () => void;
	onCleanNote: () => void;
	onDeleteNote: () => void;
};

function canRefreshLatest(item: MediaItem): boolean {
	return TMDB_TYPES.has(item.type) || item.type === "anime" || item.type === "manga";
}

export function showTrackerCardMenu(
	event: MouseEvent,
	item: MediaItem,
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
