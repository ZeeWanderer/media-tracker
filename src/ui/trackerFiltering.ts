import {MEDIA_STATUSES, MEDIA_TYPES} from "../domain/media/config";
import {extractAnilistId, extractImdbId, extractTmdbId} from "../domain/media";
import {getTitleSortKey} from "../domain/media/readModel";
import {MEDIA_STATUS_LABELS, MEDIA_TYPE_LABELS} from "./mediaUiConfig";
import type {SortDirection, SortKey} from "./trackerRenderTypes";
import type {MediaRecord} from "../domain/media/models";
import type {MediaStatus, MediaType} from "../domain/media/config";

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

export function matchesTrackerFilters(item: MediaRecord, state: TrackerFilterState): boolean {
	if (state.typeFilter !== "all" && item.type !== state.typeFilter) {
		return false;
	}
	if (state.statusFilter !== "all" && item.status !== state.statusFilter) {
		return false;
	}
	return true;
}

export type NormalizedTrackerSearchQuery = {
	text: string;
	imdbId?: string;
	anilistId?: number;
	tmdbId?: number;
};

export function normalizeTrackerSearchQuery(searchQuery: string): NormalizedTrackerSearchQuery {
	const trimmed = searchQuery.trim();
	return {
		text: trimmed.toLowerCase(),
		imdbId: extractImdbId(trimmed) ?? undefined,
		anilistId: extractAnilistId(trimmed) ?? undefined,
		tmdbId: extractTmdbId(trimmed) ?? undefined,
	};
}

export function matchesTrackerSearch(item: MediaRecord, normalizedSearchQuery: NormalizedTrackerSearchQuery): boolean {
	const hasIdentityQuery = normalizedSearchQuery.imdbId !== undefined
		|| normalizedSearchQuery.anilistId !== undefined
		|| normalizedSearchQuery.tmdbId !== undefined;
	if (!normalizedSearchQuery.text.length && !hasIdentityQuery) {
		return true;
	}
	const searchableTitles = [item.title, ...(item.alternateTitles ?? [])]
		.map((title) => title.toLowerCase());
	if (searchableTitles.some((title) => title.includes(normalizedSearchQuery.text))) {
		return true;
	}
	const author = item.author ? item.author.toLowerCase() : "";
	if (author.includes(normalizedSearchQuery.text)) {
		return true;
	}
	if (normalizedSearchQuery.imdbId && item.imdbId?.toLowerCase() === normalizedSearchQuery.imdbId) {
		return true;
	}
	if (normalizedSearchQuery.anilistId !== undefined) {
		if (item.anilistId === normalizedSearchQuery.anilistId) {
			return true;
		}
		if (item.anilistIds?.includes(normalizedSearchQuery.anilistId)) {
			return true;
		}
	}
	if (normalizedSearchQuery.tmdbId !== undefined && item.tmdbId === normalizedSearchQuery.tmdbId) {
		return true;
	}
	return false;
}

export function sortTrackerItems<TItem extends MediaRecord>(items: TItem[], state: TrackerFilterState): TItem[] {
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
