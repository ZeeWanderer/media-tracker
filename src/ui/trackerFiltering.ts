import {MediaItem, MediaStatus, MediaType} from "../types";
import {MEDIA_STATUSES, MEDIA_TYPES} from "../domain/media/config";
import {getTitleSortKey} from "../domain/media/readModel";
import {MEDIA_STATUS_LABELS} from "./mediaStatusLabels";
import {MEDIA_TYPE_LABELS} from "./mediaTypeConfig";
import type {SortDirection, SortKey} from "./trackerRenderer";

export type DisplayMode = "cards" | "details";
export type TypeFilter = MediaType | "all";
export type StatusFilter = MediaStatus | "all";

export type TrackerFilterState = {
	typeFilter: TypeFilter;
	statusFilter: StatusFilter;
	searchQuery: string;
	sortKey: SortKey;
	sortDirection: SortDirection;
};

export const TYPE_FILTERS: TypeFilter[] = ["all", ...MEDIA_TYPES];
export const STATUS_FILTERS: StatusFilter[] = ["all", ...MEDIA_STATUSES];

export function matchesTrackerFilters(item: MediaItem, state: TrackerFilterState): boolean {
	if (state.typeFilter !== "all" && item.type !== state.typeFilter) {
		return false;
	}
	if (state.statusFilter !== "all" && item.status !== state.statusFilter) {
		return false;
	}
	return true;
}

export function matchesTrackerSearch(item: MediaItem, searchQuery: string): boolean {
	const query = searchQuery.trim().toLowerCase();
	if (!query.length) {
		return true;
	}
	const title = item.title.toLowerCase();
	const author = item.author ? item.author.toLowerCase() : "";
	return title.includes(query) || author.includes(query);
}

export function sortTrackerItems(items: MediaItem[], state: TrackerFilterState): MediaItem[] {
	const direction = state.sortDirection === "asc" ? 1 : -1;
	return [...items].sort((a, b) => {
		switch (state.sortKey) {
			case "type":
				return direction * MEDIA_TYPE_LABELS[a.type].localeCompare(MEDIA_TYPE_LABELS[b.type]);
			case "status":
				return direction * MEDIA_STATUS_LABELS[a.status].localeCompare(MEDIA_STATUS_LABELS[b.status]);
			case "progress":
				return direction * (a.progress ?? "").localeCompare(b.progress ?? "");
			case "title":
			default:
				return direction * getTitleSortKey(a.title).localeCompare(getTitleSortKey(b.title));
		}
	});
}
