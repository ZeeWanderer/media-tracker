import {MEDIA_STATUSES} from "../domain/media/config";
import {MEDIA_STATUS_LABELS} from "./mediaStatusLabels";
import {MEDIA_TYPE_LABELS} from "./mediaTypeConfig";
import {renderLinks} from "./trackerLinkRenderer";
import {renderProgressMeta, supportsInteractiveProgress} from "./trackerProgressRenderer";
import type {MediaStatus} from "../domain/media/config";
import type {MediaItemLike, RenderHandlers, SortDirection, SortKey} from "./trackerRenderTypes";
export type {MediaItemLike, RenderHandlers, SortDirection, SortKey} from "./trackerRenderTypes";

const STATUS_OPTIONS: MediaStatus[] = [...MEDIA_STATUSES];

export function renderTableHeader(
	sortKey: SortKey,
	sortDirection: SortDirection,
	onSortChange?: (key: SortKey) => void,
): HTMLElement {
	const row = document.createElement("div");
	row.classList.add("media-tracker__table-row", "media-tracker__table-header");
	row.appendChild(createSortableHeader("Title", "title", sortKey, sortDirection, onSortChange));
	row.appendChild(createSortableHeader("Progress", "progress", sortKey, sortDirection, onSortChange));
	row.appendChild(createSortableHeader("Type", "type", sortKey, sortDirection, onSortChange));
	row.appendChild(createSortableHeader("Status", "status", sortKey, sortDirection, onSortChange));
	const linksHeader = document.createElement("div");
	linksHeader.classList.add("media-tracker__table-cell");
	linksHeader.textContent = "Links";
	row.appendChild(linksHeader);
	return row;
}

export function renderTableRow(item: MediaItemLike, handlers: RenderHandlers): HTMLElement {
	const row = document.createElement("div");
	row.classList.add("media-tracker__table-row");
	if (handlers.onContextMenu) {
		row.addEventListener("contextmenu", (event) => handlers.onContextMenu?.(event, item));
	}

	const titleCell = document.createElement("div");
	titleCell.classList.add("media-tracker__table-cell", "media-tracker__table-title");
	titleCell.textContent = item.title;
	row.appendChild(titleCell);

	const progressCell = document.createElement("div");
	progressCell.classList.add("media-tracker__table-cell");
	if (supportsInteractiveProgress(item)) {
		progressCell.appendChild(renderProgressMeta(item, handlers, true));
	} else {
		progressCell.textContent = item.progress ?? "-";
	}
	row.appendChild(progressCell);

	const typeCell = document.createElement("div");
	typeCell.classList.add("media-tracker__table-cell");
	typeCell.textContent = MEDIA_TYPE_LABELS[item.type];
	row.appendChild(typeCell);

	const statusCell = document.createElement("div");
	statusCell.classList.add("media-tracker__table-cell");
	statusCell.appendChild(renderStatusSelect(item, handlers));
	row.appendChild(statusCell);

	const linksCell = document.createElement("div");
	linksCell.classList.add("media-tracker__table-cell", "media-tracker__table-links");
	const openButton = document.createElement("button");
	openButton.textContent = "Note";
	openButton.classList.add("media-tracker__button");
	openButton.addEventListener("click", () => handlers.onOpenNote?.(item));
	linksCell.appendChild(openButton);

	renderLinks(linksCell, item, handlers);
	row.appendChild(linksCell);
	return row;
}

export function renderCard(item: MediaItemLike, handlers: RenderHandlers): HTMLElement {
	const card = document.createElement("div");
	card.classList.add("media-tracker__card");
	if (handlers.onContextMenu) {
		card.addEventListener("contextmenu", (event) => handlers.onContextMenu?.(event, item));
	}

	const titleRow = document.createElement("div");
	titleRow.classList.add("media-tracker__card-title");
	const titleText = document.createElement("span");
	titleText.textContent = item.title;
	titleText.addEventListener("click", () => handlers.onCopyTitle?.(item));
	const typePill = document.createElement("span");
	typePill.textContent = MEDIA_TYPE_LABELS[item.type];
	typePill.classList.add("media-tracker__pill");
	titleRow.appendChild(titleText);
	titleRow.appendChild(typePill);
	card.appendChild(titleRow);

	const meta = document.createElement("div");
	meta.classList.add("media-tracker__meta-grid");

	const rowOne = document.createElement("div");
	rowOne.classList.add("media-tracker__meta-row");
	rowOne.appendChild(renderStatusSelect(item, handlers));
	if (item.author) {
		const author = document.createElement("div");
		author.classList.add("media-tracker__meta-item", "media-tracker__meta-author");
		author.textContent = item.author;
		rowOne.appendChild(author);
	} else {
		const author = document.createElement("div");
		author.classList.add("media-tracker__meta-item", "media-tracker__meta-placeholder", "media-tracker__meta-author");
		author.textContent = " ";
		rowOne.appendChild(author);
	}
	meta.appendChild(rowOne);

	const rowTwo = document.createElement("div");
	rowTwo.classList.add("media-tracker__meta-row");
	if (supportsInteractiveProgress(item)) {
		rowTwo.appendChild(renderProgressMeta(item, handlers));
	} else if (item.progress) {
		const progress = document.createElement("div");
		progress.classList.add("media-tracker__meta-item");
		progress.textContent = item.progress;
		rowTwo.appendChild(progress);
	} else {
		const progress = document.createElement("div");
		progress.classList.add("media-tracker__meta-item", "media-tracker__meta-placeholder");
		progress.textContent = " ";
		rowTwo.appendChild(progress);
	}
	meta.appendChild(rowTwo);
	card.appendChild(meta);

	const actions = document.createElement("div");
	actions.classList.add("media-tracker__actions-row");
	const openNoteButton = document.createElement("button");
	openNoteButton.textContent = "Note";
	openNoteButton.classList.add("media-tracker__button", "media-tracker__note-button");
	actions.appendChild(openNoteButton);
	openNoteButton.addEventListener("click", () => handlers.onOpenNote?.(item));

	const linkGroup = document.createElement("div");
	linkGroup.classList.add("media-tracker__links");
	const linkCount = renderLinks(linkGroup, item, handlers);
	if (linkCount > 0) {
		actions.appendChild(linkGroup);
	}
	card.appendChild(actions);
	return card;
}

function createSortableHeader(
	label: string,
	key: SortKey,
	sortKey: SortKey,
	sortDirection: SortDirection,
	onSortChange?: (key: SortKey) => void,
): HTMLElement {
	const cell = document.createElement("button");
	cell.type = "button";
	cell.classList.add("media-tracker__table-cell", "media-tracker__table-sort");
	cell.dataset.key = key;
	const arrow = sortKey === key ? (sortDirection === "asc" ? " ▲" : " ▼") : "";
	cell.textContent = `${label}${arrow}`;
	if (onSortChange) {
		cell.addEventListener("click", () => {
			onSortChange(key);
		});
	}
	return cell;
}

function renderStatusSelect(item: MediaItemLike, handlers: RenderHandlers): HTMLElement {
	const wrapper = document.createElement("div");
	wrapper.classList.add("media-tracker__status");
	const select = document.createElement("select");
	select.classList.add("media-tracker__status-select");
	for (const option of STATUS_OPTIONS) {
		const label = MEDIA_STATUS_LABELS[option];
		const optionEl = document.createElement("option");
		optionEl.value = option;
		optionEl.textContent = label;
		if (option === item.status) {
			optionEl.selected = true;
		}
		select.appendChild(optionEl);
	}
	select.addEventListener("change", () => {
		handlers.onStatusChange?.(item, select.value as MediaStatus);
	});
	wrapper.appendChild(select);
	return wrapper;
}
