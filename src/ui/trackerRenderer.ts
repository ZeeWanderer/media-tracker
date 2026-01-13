import {MediaItem, MediaStatus} from "../types";
import {MEDIA_STATUS_LABELS} from "../utils/media";
import {MEDIA_TYPE_LABELS, NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES, TMDB_TYPES} from "../utils/mediaConfig";
import {extractImdbId, formatLinkLabel, getFaviconUrl, toLinkUrl} from "../utils/links";

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
	| "imdbId"
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
	getLinkIconUrl?: (value: string) => string | null;
};

const STATUS_OPTIONS: MediaStatus[] = ["planned", "active", "completed", "on-hold", "dropped"];

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
	if (NOVEL_PROGRESS_TYPES.has(item.type) || SEASON_EPISODE_TYPES.has(item.type)) {
		if (item.progress) {
			progressCell.appendChild(renderProgressMeta(item, handlers, true));
		} else {
			progressCell.textContent = item.progress ?? "-";
		}
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
	if ((NOVEL_PROGRESS_TYPES.has(item.type) || SEASON_EPISODE_TYPES.has(item.type)) && item.progress) {
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
	if (!TMDB_TYPES.has(item.type)) {
		return null;
	}
	const latest = getLatestSeasonEpisode(item);
	if (!latest) {
		const announcedSeason = getAnnouncedSeason(item.tmdbSeasonEpisodes, 0);
		if (announcedSeason === null) {
			return null;
		}
		return createBadge(`S${announcedSeason} Ann.`);
	}
	const announcedSeason = getAnnouncedSeason(item.tmdbSeasonEpisodes, latest.season);
	const latestBadge = createLatestBadge(item, latest);
	if (item.tmdbLatestAirDate || item.tmdbLatestName) {
		const parts = [];
		if (item.tmdbLatestName) {
			parts.push(item.tmdbLatestName);
		}
		if (item.tmdbLatestAirDate) {
			parts.push(item.tmdbLatestAirDate);
		}
		setAttrSafe(latestBadge, "title", parts.join(" • "));
	}
	if (announcedSeason !== null) {
		const group = document.createElement("span");
		group.classList.add("media-tracker__badge-group");
		group.appendChild(latestBadge);
		group.appendChild(createBadge(`S${announcedSeason} Ann.`));
		return group;
	}
	return latestBadge;
}

function createLatestBadge(
	item: MediaItemLike,
	latest: {season: number; episode: number},
): HTMLElement {
	let isNew = false;
	if (item.season !== undefined && item.episode !== undefined) {
		if (latest.season > item.season) {
			isNew = true;
		} else if (latest.season === item.season && latest.episode > item.episode) {
			isNew = true;
		}
	}
	const label = isNew
		? `New S${latest.season}E${latest.episode}`
		: `Latest S${latest.season}E${latest.episode}`;
	return createBadge(label, isNew);
}

function createBadge(text: string, isNew = false): HTMLElement {
	const badge = document.createElement("span");
	badge.classList.add("media-tracker__badge");
	if (isNew) {
		badge.classList.add("media-tracker__badge--new");
	}
	badge.textContent = text;
	return badge;
}

function getAnnouncedSeason(
	seasonEpisodes: Record<string, number> | undefined,
	latestSeason: number,
): number | null {
	if (!seasonEpisodes) {
		return null;
	}
	const announced = Object.entries(seasonEpisodes)
		.map(([key, value]) => ({season: Number(key), episodes: Number(value)}))
		.filter((entry) => Number.isFinite(entry.season) && Number.isFinite(entry.episodes))
		.filter((entry) => entry.episodes === 0 && entry.season > latestSeason)
		.map((entry) => entry.season);
	if (!announced.length) {
		return null;
	}
	return Math.max(...announced);
}

function renderLinks(container: HTMLElement, item: MediaItemLike, handlers: RenderHandlers): number {
	let count = 0;
	const links = item.links ?? [];
	for (const link of links) {
		count += renderLinkButton(container, link, handlers) ? 1 : 0;
	}
	const imdbId = item.imdbId;
	if (imdbId) {
		const normalized = extractImdbId(imdbId) ?? imdbId;
		const hasImdb = links.some((link) => extractImdbId(link) === normalized);
		if (!hasImdb) {
			count += renderLinkButton(container, normalized, handlers) ? 1 : 0;
		}
	}
	return count;
}

function renderLinkButton(
	container: HTMLElement,
	value: string,
	handlers: RenderHandlers,
): boolean {
	const url = toLinkUrl(value);
	if (!url) {
		return false;
	}
	const button = document.createElement("button");
	button.classList.add("media-tracker__button", "media-tracker__link-button");
	const text = document.createElement("span");
	text.textContent = formatLinkLabel(value);
	text.classList.add("media-tracker__link-label");
	button.appendChild(text);

	const iconUrl = handlers.getLinkIconUrl ? handlers.getLinkIconUrl(value) : getFaviconUrl(value);
	if (iconUrl) {
		const icon = document.createElement("img");
		icon.classList.add("media-tracker__link-icon");
		icon.alt = "";
		icon.src = iconUrl;
		button.prepend(icon);
		button.classList.add("media-tracker__link-button--icon");
		setAttrSafe(button, "aria-label", text.textContent ?? "Link");
		setAttrSafe(button, "title", text.textContent ?? "Link");
		icon.addEventListener("error", () => {
			icon.remove();
			button.classList.remove("media-tracker__link-button--icon");
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
	if (SEASON_EPISODE_TYPES.has(item.type) && item.season !== undefined && item.episode !== undefined) {
		const seasonKey = String(item.season);
		const isLatestSeason = item.tmdbLatestSeason !== undefined
			&& item.tmdbLatestEpisode !== undefined
			&& item.season === item.tmdbLatestSeason;
		const seasonEpisodeCount = isLatestSeason
			? item.tmdbLatestEpisode
			: item.tmdbSeasonEpisodes?.[seasonKey] ?? item.tmdbLatestSeasonEpisodes;
		if (seasonEpisodeCount && item.episode >= seasonEpisodeCount) {
			return isLatestSeason ? null : `S${item.season + 1}E1`;
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
	if (item.tmdbLatestSeason !== undefined && item.tmdbLatestEpisode !== undefined) {
		return {season: item.tmdbLatestSeason, episode: item.tmdbLatestEpisode};
	}
	const map = item.tmdbSeasonEpisodes;
	if (!map) {
		return null;
	}
	const seasons = Object.entries(map)
		.map(([key, value]) => ({season: Number(key), episodes: Number(value)}))
		.filter((entry) => Number.isFinite(entry.season) && Number.isFinite(entry.episodes) && entry.episodes > 0)
		.map((entry) => entry.season);
	if (!seasons.length) {
		return null;
	}
	const latestSeason = Math.max(...seasons);
	const latestEpisode = map[String(latestSeason)];
	if (latestEpisode === undefined || latestEpisode <= 0) {
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
