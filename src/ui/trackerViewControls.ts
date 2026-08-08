import {MEDIA_STATUS_LABELS, MEDIA_TYPE_LABELS} from "./mediaUiConfig";
import {STATUS_FILTERS, TYPE_FILTERS, type DisplayMode, type StatusFilter, type TypeFilter} from "./trackerFiltering";

export type TrackerControlsState = {
	searchQuery: string;
	typeFilter: TypeFilter;
	statusFilter: StatusFilter;
	displayMode: DisplayMode;
};

export type TrackerControlsHandlers = {
	onSearchChange: (value: string) => void;
	onSearchClear: () => void;
	onTypeFilterChange: (value: TypeFilter) => void;
	onStatusFilterChange: (value: StatusFilter) => void;
	onDisplayModeChange: (value: DisplayMode) => void;
};

export function renderTrackerControls(
	container: HTMLElement,
	state: TrackerControlsState,
	handlers: TrackerControlsHandlers,
): {searchInput: HTMLInputElement; clearButton: HTMLButtonElement} {
	const controls = container.createDiv({cls: "media-tracker__filters"});

	const searchWrap = controls.createDiv({cls: "media-tracker__search-wrap"});
	const search = searchWrap.createEl("input");
	search.type = "search";
	search.placeholder = "Search title, alias, author, or ID";
	search.value = state.searchQuery;
	search.classList.add("media-tracker__search");
	const clearButton = searchWrap.createEl("button");
	clearButton.type = "button";
	clearButton.classList.add("media-tracker__search-clear");
	clearButton.setAttr("aria-label", "Clear search");
	clearButton.setAttr("title", "Clear search");
	clearButton.addEventListener("click", () => {
		search.value = "";
		handlers.onSearchClear();
		search.focus();
	});

	if (search.value) {
		clearButton.addClass("is-visible");
	}
	search.addEventListener("input", () => {
		handlers.onSearchChange(search.value);
		clearButton.toggleClass("is-visible", !!search.value);
	});

	const typeSelect = controls.createEl("select");
	for (const option of TYPE_FILTERS) {
		typeSelect.createEl("option", {
			value: option,
			text: option === "all" ? "All types" : MEDIA_TYPE_LABELS[option],
		});
	}
	typeSelect.value = state.typeFilter;
	typeSelect.addEventListener("change", () => {
		handlers.onTypeFilterChange(typeSelect.value as TypeFilter);
	});

	const statusSelect = controls.createEl("select");
	for (const option of STATUS_FILTERS) {
		statusSelect.createEl("option", {
			value: option,
			text: option === "all" ? "All statuses" : MEDIA_STATUS_LABELS[option],
		});
	}
	statusSelect.value = state.statusFilter;
	statusSelect.addEventListener("change", () => {
		handlers.onStatusFilterChange(statusSelect.value as StatusFilter);
	});

	const displaySelect = controls.createEl("select");
	displaySelect.createEl("option", {value: "cards", text: "Cards"});
	displaySelect.createEl("option", {value: "details", text: "Details"});
	displaySelect.value = state.displayMode;
	displaySelect.addEventListener("change", () => {
		handlers.onDisplayModeChange(displaySelect.value as DisplayMode);
	});

	return {searchInput: search, clearButton};
}
