import {MediaItem, MediaStatus} from "../types";
import {MEDIA_STATUS_LABELS, MEDIA_TYPE_LABELS} from "../utils/media";

export type SortKey = "title" | "type" | "status" | "progress";
export type SortDirection = "asc" | "desc";

export type MediaItemLike = Pick<
	MediaItem,
	| "title"
	| "type"
	| "status"
	| "author"
	| "progress"
	| "progressRaw"
	| "progressLabel"
	| "season"
	| "episode"
	| "links"
	| "extraLinks"
	| "tmdbLatestSeason"
	| "tmdbLatestEpisode"
	| "tmdbLatestSeasonEpisodes"
	| "tmdbSeasonEpisodes"
	| "tmdbLatestAirDate"
	| "tmdbLatestName"
>;

export type RenderHandlers = {
	onOpenNote?: (item: MediaItemLike) => void;
	onContextMenu?: (event: MouseEvent, item: MediaItemLike) => void;
	onStatusChange?: (item: MediaItemLike, status: MediaStatus) => void;
	onProgressEdit?: (target: HTMLElement, item: MediaItemLike) => void;
	onProgressAdvance?: (item: MediaItemLike, nextValue: string) => void;
	onLinkOpen?: (url: string) => void;
	getIconUrl?: (label: string) => string | null;
	getIconFallbackUrl?: (label: string, currentUrl: string) => string | null;
};

const STATUS_OPTIONS: MediaStatus[] = ["planned", "active", "completed", "on-hold", "dropped"];

const ICON_BASE: Record<string, string> = {
	Patreon: "patreon",
	Kemono: "kemono",
	RoyalRoad: "royalroad",
	HDRezka: "hdrezka",
	IMDB: "imdb",
};

export function getIconBaseName(label: string): string | null {
	return ICON_BASE[label] ?? null;
}

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
	if ((item.type === "novel" || item.type === "series") && item.progress) {
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
	if (item.progress && (item.type === "novel" || item.type === "series")) {
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

function renderProgressMeta(item: MediaItemLike, handlers: RenderHandlers, compact = false): HTMLElement {
	const wrapper = document.createElement("div");
	wrapper.classList.add("media-tracker__progress");
	if (compact) {
		wrapper.classList.add("media-tracker__progress--compact");
	}

	const label = document.createElement("button");
	label.type = "button";
	label.classList.add("media-tracker__progress-label");
	label.textContent = item.progress ?? "";
	label.addEventListener("click", (event) => {
		event.preventDefault();
		handlers.onProgressEdit?.(label, item);
	});
	const control = document.createElement("div");
	control.classList.add("media-tracker__progress-control");
	control.appendChild(label);

	const nextValue = getNextProgressValue(item);
	if (nextValue) {
		const increment = document.createElement("button");
		increment.type = "button";
		increment.classList.add("media-tracker__progress-add");
		increment.appendChild(createPlusIcon());
		setAttrSafe(increment, "title", "Advance chapter");
		increment.addEventListener("click", (event) => {
			event.preventDefault();
			handlers.onProgressAdvance?.(item, nextValue);
		});
		control.appendChild(increment);
	}

	wrapper.appendChild(control);
	const badge = renderLatestBadge(item);
	if (badge) {
		wrapper.appendChild(badge);
	}
	return wrapper;
}

function createPlusIcon(): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("media-tracker__plus-icon");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("fill", "currentColor");
	path.setAttribute("d", "M11 5h2v14h-2zM5 11h14v2H5z");
	svg.appendChild(path);
	return svg;
}

function renderLatestBadge(item: MediaItemLike): HTMLElement | null {
	if (item.type !== "series") {
		return null;
	}
	const latest = getLatestSeasonEpisode(item);
	if (!latest) {
		return null;
	}
	const badge = document.createElement("span");
	badge.classList.add("media-tracker__badge");
	let isNew = false;
	if (item.season && item.episode !== undefined) {
		if (latest.season > item.season) {
			isNew = true;
		} else if (latest.season === item.season && latest.episode > item.episode) {
			isNew = true;
		}
	}
	if (isNew) {
		badge.classList.add("media-tracker__badge--new");
		badge.textContent = `New S${latest.season}E${latest.episode}`;
	} else {
		badge.textContent = `Latest S${latest.season}E${latest.episode}`;
	}
	if (item.tmdbLatestAirDate || item.tmdbLatestName) {
		const parts = [];
		if (item.tmdbLatestName) {
			parts.push(item.tmdbLatestName);
		}
		if (item.tmdbLatestAirDate) {
			parts.push(item.tmdbLatestAirDate);
		}
		setAttrSafe(badge, "title", parts.join(" • "));
	}
	return badge;
}

function renderLinks(container: HTMLElement, item: MediaItemLike, handlers: RenderHandlers): number {
	let count = 0;
	if (item.type === "novel") {
		count += renderLinkButton(container, "Patreon", item.links.patreon, handlers) ? 1 : 0;
		count += renderLinkButton(container, "Kemono", item.links.kemono, handlers) ? 1 : 0;
		count += renderLinkButton(container, "RoyalRoad", item.links.royalroad, handlers) ? 1 : 0;
	} else {
		count += renderLinkButton(container, "IMDB", item.links.imdb, handlers) ? 1 : 0;
		count += renderLinkButton(container, "HDRezka", item.links.hdrezka, handlers) ? 1 : 0;
	}
	for (const extra of item.extraLinks ?? []) {
		count += renderLinkButton(container, extra.label, extra.url, handlers) ? 1 : 0;
	}
	return count;
}

function renderLinkButton(
	container: HTMLElement,
	label: string,
	url: string | null | undefined,
	handlers: RenderHandlers,
): boolean {
	if (!url) {
		return false;
	}
	const button = document.createElement("button");
	button.classList.add("media-tracker__button");
	const text = document.createElement("span");
	text.textContent = label;
	button.appendChild(text);

	const iconUrl = handlers.getIconUrl?.(label) ?? null;
	if (iconUrl) {
		const icon = document.createElement("img");
		icon.classList.add("media-tracker__link-icon");
		icon.alt = label;
		icon.src = iconUrl;
		button.classList.add("media-tracker__icon-button");
		button.prepend(icon);
		setAttrSafe(button, "aria-label", label);
		setAttrSafe(button, "title", label);
		text.classList.add("media-tracker__icon-fallback");
		icon.addEventListener("error", () => {
			const fallback = handlers.getIconFallbackUrl?.(label, icon.src);
			if (fallback && fallback !== icon.src) {
				icon.src = fallback;
				return;
			}
			icon.remove();
			button.classList.remove("media-tracker__icon-button");
			text.classList.remove("media-tracker__icon-fallback");
		});
	}

	container.appendChild(button);
	button.addEventListener("click", () => {
		if (handlers.onLinkOpen) {
			handlers.onLinkOpen(url);
		} else {
			window.open(url, "_blank", "noopener");
		}
	});
	return true;
}

export function getNextProgressValue(item: MediaItemLike): string | null {
	if (item.type === "series" && item.season && item.episode !== undefined) {
		const seasonKey = String(item.season);
		const seasonEpisodeCount = item.tmdbSeasonEpisodes?.[seasonKey] ?? item.tmdbLatestSeasonEpisodes;
		if (seasonEpisodeCount && item.episode >= seasonEpisodeCount) {
			return `S${item.season + 1}E1`;
		}
		return `S${item.season}E${item.episode + 1}`;
	}
	const raw = item.progressRaw?.trim();
	if (raw && /^\d+(?:\.\d+)?$/.test(raw)) {
		return incrementNumericString(raw);
	}
	const label = item.progressLabel?.trim() ?? item.progress?.trim();
	if (!label) {
		return null;
	}
	const match = label.match(/^(?:ch|chapter)?\s*(\d+(?:\.\d+)?)$/i);
	if (!match) {
		return null;
	}
	const value = match[1];
	if (!value) {
		return null;
	}
	return incrementNumericString(value);
}

function getLatestSeasonEpisode(item: MediaItemLike): {season: number; episode: number} | null {
	if (item.tmdbLatestSeason && item.tmdbLatestEpisode) {
		return {season: item.tmdbLatestSeason, episode: item.tmdbLatestEpisode};
	}
	const map = item.tmdbSeasonEpisodes;
	if (!map) {
		return null;
	}
	const seasons = Object.keys(map).map((key) => Number(key)).filter((val) => Number.isFinite(val));
	if (!seasons.length) {
		return null;
	}
	const latestSeason = Math.max(...seasons);
	const latestEpisode = map[String(latestSeason)];
	if (!latestEpisode) {
		return null;
	}
	return {season: latestSeason, episode: latestEpisode};
}

function incrementNumericString(value: string): string {
	if (value.includes(".")) {
		const parts = value.split(".");
		const tail = parts[parts.length - 1];
		if (!tail) {
			return value;
		}
		const next = Number.parseInt(tail, 10);
		if (Number.isNaN(next)) {
			return value;
		}
		parts[parts.length - 1] = String(next + 1);
		return parts.join(".");
	}
	const next = Number.parseInt(value, 10);
	if (Number.isNaN(next)) {
		return value;
	}
	return String(next + 1);
}

function setAttrSafe(el: HTMLElement, name: string, value: string) {
	const maybe = (el as HTMLElement & {setAttr?: (key: string, val: string) => void}).setAttr;
	if (maybe) {
		maybe.call(el, name, value);
	} else {
		el.setAttribute(name, value);
	}
}
