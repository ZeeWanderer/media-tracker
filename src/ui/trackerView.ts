import {ItemView, Menu, WorkspaceLeaf} from "obsidian";
import MediaTrackerPlugin from "../main";
import {MediaItem, MediaStatus, MediaType} from "../types";
import {MEDIA_STATUS_LABELS, MEDIA_TYPE_LABELS, getMediaItems, getTitleSortKey} from "../utils/media";
import {NewMediaModal} from "./newMediaModal";
import {setCustomLink, setMediaLink, setNovelProgress, setSeriesProgress} from "../utils/notes";
import {LinkModal} from "./linkModal";
import {refreshAllSeries, refreshSeriesLatest} from "../utils/tmdb";

export const MEDIA_TRACKER_VIEW = "media-tracker-view";

const TYPE_FILTERS: Array<MediaType | "all"> = ["all", "novel", "series", "movie"];
const STATUS_FILTERS: Array<MediaStatus | "all"> = ["all", "planned", "active", "completed", "on-hold", "dropped"];

type DisplayMode = "cards" | "details";
type SortKey = "title" | "type" | "status" | "progress";
type SortDirection = "asc" | "desc";

export class MediaTrackerView extends ItemView {
	plugin: MediaTrackerPlugin;
	private typeFilter: MediaType | "all" = "all";
	private statusFilter: MediaStatus | "all" = "all";
	private displayMode: DisplayMode;
	private searchQuery = "";
	private sortKey: SortKey = "title";
	private sortDirection: SortDirection = "asc";

	constructor(leaf: WorkspaceLeaf, plugin: MediaTrackerPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.displayMode = plugin.settings.displayMode ?? "cards";
	}

	getViewType(): string {
		return MEDIA_TRACKER_VIEW;
	}

	getDisplayText(): string {
		return "Media tracker";
	}

	getIcon(): string {
		return "film";
	}

	async onOpen() {
		this.render();
	}

	render() {
		const {contentEl} = this;
		const activeEl = document.activeElement;
		const shouldRefocus = activeEl instanceof HTMLInputElement
			&& activeEl.classList.contains("media-tracker__search");
		const selectionStart = shouldRefocus ? activeEl.selectionStart ?? null : null;
		const selectionEnd = shouldRefocus ? activeEl.selectionEnd ?? null : null;
		const searchValue = shouldRefocus ? activeEl.value : this.searchQuery;

		contentEl.empty();
		contentEl.addClass("media-tracker");

		const header = contentEl.createDiv({cls: "media-tracker__header"});
		header.createEl("h2", {text: "Media tracker"});

		const actions = header.createDiv({cls: "media-tracker__actions"});
		const refreshButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button", text: "⟳"});
		refreshButton.setAttr("aria-label", "Refresh series updates");
		refreshButton.setAttr("title", this.getRefreshTooltip());
		refreshButton.addEventListener("click", async () => {
			const items = getMediaItems(this.app, this.plugin.settings);
			await refreshAllSeries(this.app, this.plugin.settings, items, (current, total) => {
				refreshButton.setText(`⟳ ${current}/${total}`);
			});
			this.plugin.settings.tmdbLastSync = Date.now();
			await this.plugin.saveSettings();
			refreshButton.setText("⟳");
			refreshButton.setAttr("title", this.getRefreshTooltip());
			this.render();
		});
		const addButton = actions.createEl("button", {cls: "media-tracker__button", text: "New entry"});
		addButton.addEventListener("click", () => new NewMediaModal(this.plugin).open());

		const {searchInput, clearButton} = this.renderControls(contentEl);
		if (shouldRefocus && searchInput) {
			searchInput.value = searchValue;
			searchInput.focus();
			if (selectionStart !== null && selectionEnd !== null) {
				searchInput.setSelectionRange(selectionStart, selectionEnd);
			}
			clearButton?.toggleClass("is-visible", !!searchInput.value);
		}

		const items = getMediaItems(this.app, this.plugin.settings);
		const filtered = items
			.filter((item) => this.matchesFilters(item))
			.filter((item) => this.matchesSearch(item));
		const sorted = this.displayMode === "details" ? this.sortItems(filtered) : filtered;

		if (filtered.length === 0) {
			const empty = contentEl.createDiv({cls: "media-tracker__empty"});
			empty.setText("No media entries yet. Create one to get started.");
			return;
		}

		if (this.displayMode === "details") {
			const list = contentEl.createDiv({cls: "media-tracker__table"});
			list.appendChild(this.renderTableHeader());
			for (const item of sorted) {
				list.appendChild(this.renderTableRow(item));
			}
		} else {
			const list = contentEl.createDiv({cls: "media-tracker__list"});
			for (const item of filtered) {
				list.appendChild(this.renderCard(item));
			}
		}
	}

	private renderControls(container: HTMLElement): {searchInput: HTMLInputElement | null; clearButton: HTMLButtonElement | null} {
		const controls = container.createDiv({cls: "media-tracker__filters"});

		const searchWrap = controls.createDiv({cls: "media-tracker__search-wrap"});
		const search = searchWrap.createEl("input");
		search.type = "search";
		search.placeholder = "Search title or author";
		search.value = this.searchQuery;
		search.classList.add("media-tracker__search");
		const clearButton = searchWrap.createEl("button");
		clearButton.type = "button";
		clearButton.classList.add("media-tracker__search-clear");
		clearButton.setAttr("aria-label", "Clear search");
		clearButton.setAttr("title", "Clear search");
		clearButton.addEventListener("click", () => {
			search.value = "";
			this.searchQuery = "";
			this.render();
			search.focus();
		});

		if (search.value) {
			clearButton.addClass("is-visible");
		}
		search.addEventListener("input", () => {
			this.searchQuery = search.value;
			this.render();
			clearButton.toggleClass("is-visible", !!search.value);
		});
		let searchInput: HTMLInputElement | null = search;

		const typeSelect = controls.createEl("select");
		for (const option of TYPE_FILTERS) {
			typeSelect.createEl("option", {
				value: option,
				text: option === "all" ? "All types" : MEDIA_TYPE_LABELS[option],
			});
		}
		typeSelect.value = this.typeFilter;
		typeSelect.addEventListener("change", () => {
			this.typeFilter = typeSelect.value as MediaType | "all";
			this.render();
		});

		const statusSelect = controls.createEl("select");
		for (const option of STATUS_FILTERS) {
			statusSelect.createEl("option", {
				value: option,
				text: option === "all" ? "All statuses" : MEDIA_STATUS_LABELS[option],
			});
		}
		statusSelect.value = this.statusFilter;
		statusSelect.addEventListener("change", () => {
			this.statusFilter = statusSelect.value as MediaStatus | "all";
			this.render();
		});

		const displaySelect = controls.createEl("select");
		displaySelect.createEl("option", {value: "cards", text: "Cards"});
		displaySelect.createEl("option", {value: "details", text: "Details"});
		displaySelect.value = this.displayMode;
		displaySelect.addEventListener("change", () => {
			this.displayMode = displaySelect.value as DisplayMode;
			this.plugin.settings.displayMode = this.displayMode;
			void this.plugin.saveSettings();
			this.render();
		});

		return {searchInput, clearButton};
	}

	private matchesFilters(item: MediaItem): boolean {
		if (this.typeFilter !== "all" && item.type !== this.typeFilter) {
			return false;
		}
		if (this.statusFilter !== "all" && item.status !== this.statusFilter) {
			return false;
		}
		return true;
	}

	private matchesSearch(item: MediaItem): boolean {
		const query = this.searchQuery.trim().toLowerCase();
		if (!query.length) {
			return true;
		}
		const title = item.title.toLowerCase();
		const author = item.author ? item.author.toLowerCase() : "";
		return title.includes(query) || author.includes(query);
	}

	private renderCard(item: MediaItem): HTMLElement {
		const card = document.createElement("div");
		card.classList.add("media-tracker__card");
		card.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			this.openCardMenu(event, item);
		});

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
		const statusLabel = MEDIA_STATUS_LABELS[item.status];
		rowOne.appendChild(this.renderStatusSelect(item, statusLabel));
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
			rowTwo.appendChild(this.renderProgressMeta(item));
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
		openNoteButton.addEventListener("click", async () => {
			await this.app.workspace.getLeaf("tab").openFile(item.file);
		});

		const linkGroup = document.createElement("div");
		linkGroup.classList.add("media-tracker__links");
		const linkCount = this.renderLinks(linkGroup, item);
		if (linkCount > 0) {
			actions.appendChild(linkGroup);
		}
		card.appendChild(actions);

		return card;
	}

	private renderTableHeader(): HTMLElement {
		const row = document.createElement("div");
		row.classList.add("media-tracker__table-row", "media-tracker__table-header");
		row.appendChild(this.createSortableHeader("Title", "title"));
		row.appendChild(this.createSortableHeader("Progress", "progress"));
		row.appendChild(this.createSortableHeader("Type", "type"));
		row.appendChild(this.createSortableHeader("Status", "status"));
		const linksHeader = document.createElement("div");
		linksHeader.classList.add("media-tracker__table-cell");
		linksHeader.textContent = "Links";
		row.appendChild(linksHeader);
		return row;
	}

	private renderTableRow(item: MediaItem): HTMLElement {
		const row = document.createElement("div");
		row.classList.add("media-tracker__table-row");
		row.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			this.openCardMenu(event, item);
		});

		const titleCell = document.createElement("div");
		titleCell.classList.add("media-tracker__table-cell", "media-tracker__table-title");
		titleCell.textContent = item.title;
		row.appendChild(titleCell);

		const progressCell = document.createElement("div");
		progressCell.classList.add("media-tracker__table-cell");
		if ((item.type === "novel" || item.type === "series") && item.progress) {
			progressCell.appendChild(this.renderProgressMeta(item, true));
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
		statusCell.appendChild(this.renderStatusSelect(item, MEDIA_STATUS_LABELS[item.status]));
		row.appendChild(statusCell);

		const linksCell = document.createElement("div");
		linksCell.classList.add("media-tracker__table-cell", "media-tracker__table-links");
		const openButton = document.createElement("button");
		openButton.textContent = "Note";
		openButton.classList.add("media-tracker__button");
		openButton.addEventListener("click", async () => {
			await this.app.workspace.getLeaf("tab").openFile(item.file);
		});
		linksCell.appendChild(openButton);

		this.renderLinks(linksCell, item);
		row.appendChild(linksCell);

		return row;
	}

	private renderProgressMeta(item: MediaItem, compact = false): HTMLElement {
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
			this.openProgressEditor(label, item);
		});
		const control = document.createElement("div");
		control.classList.add("media-tracker__progress-control");
		control.appendChild(label);

		const nextValue = this.getNextProgressValue(item);
		if (nextValue) {
			const increment = document.createElement("button");
			increment.type = "button";
			increment.classList.add("media-tracker__progress-add");
			increment.textContent = "+";
			increment.setAttr("title", "Advance chapter");
			increment.addEventListener("click", async (event) => {
				event.preventDefault();
				if (item.type === "series") {
					await setSeriesProgress(this.app, item.file, nextValue);
				} else {
					await setNovelProgress(this.app, item.file, nextValue);
				}
			});
			control.appendChild(increment);
		}

		wrapper.appendChild(control);

		const badge = this.renderLatestBadge(item);
		if (badge) {
			wrapper.appendChild(badge);
		}

		return wrapper;
	}

	private renderLatestBadge(item: MediaItem): HTMLElement | null {
		if (item.type !== "series") {
			return null;
		}
		if (!item.tmdbLatestSeason || !item.tmdbLatestEpisode) {
			return null;
		}
		const badge = document.createElement("span");
		badge.classList.add("media-tracker__badge");
		let isNew = false;
		if (item.season && item.episode !== undefined) {
			if (item.tmdbLatestSeason > item.season) {
				isNew = true;
			} else if (item.tmdbLatestSeason === item.season && item.tmdbLatestEpisode > item.episode) {
				isNew = true;
			}
		}
		if (isNew) {
			badge.classList.add("media-tracker__badge--new");
			badge.textContent = `New S${item.tmdbLatestSeason}E${item.tmdbLatestEpisode}`;
		} else {
			badge.textContent = `Latest S${item.tmdbLatestSeason}E${item.tmdbLatestEpisode}`;
		}
		if (item.tmdbLatestAirDate || item.tmdbLatestName) {
			const parts = [];
			if (item.tmdbLatestName) {
				parts.push(item.tmdbLatestName);
			}
			if (item.tmdbLatestAirDate) {
				parts.push(item.tmdbLatestAirDate);
			}
			badge.setAttr("title", parts.join(" • "));
		}
		return badge;
	}

	private getRefreshTooltip(): string {
		if (!this.plugin.settings.tmdbLastSync) {
			return "Check latest episodes (never updated)";
		}
		const date = new Date(this.plugin.settings.tmdbLastSync);
		return `Check latest episodes (last updated ${date.toLocaleString()})`;
	}

	private renderStatusSelect(item: MediaItem, currentLabel: string): HTMLElement {
		const wrapper = document.createElement("div");
		wrapper.classList.add("media-tracker__status");
		const select = document.createElement("select");
		select.classList.add("media-tracker__status-select");
		for (const option of STATUS_FILTERS) {
			if (option === "all") {
				continue;
			}
			const label = MEDIA_STATUS_LABELS[option as MediaStatus];
			const optionEl = document.createElement("option");
			optionEl.value = option;
			optionEl.textContent = label;
			if (label === currentLabel) {
				optionEl.selected = true;
			}
			select.appendChild(optionEl);
		}
		select.addEventListener("change", async () => {
			await this.app.fileManager.processFrontMatter(item.file, (frontmatter) => {
				frontmatter.status = select.value;
			});
		});
		wrapper.appendChild(select);
		return wrapper;
	}

	private openProgressEditor(target: HTMLElement, item: MediaItem) {
		const input = document.createElement("input");
		input.type = "text";
		input.classList.add("media-tracker__progress-input");
		input.value = item.progress ?? "";
		input.size = Math.max(4, input.value.length);

		const finish = async (save: boolean) => {
			if (save) {
				if (item.type === "series") {
					await setSeriesProgress(this.app, item.file, input.value);
				} else {
					await setNovelProgress(this.app, item.file, input.value);
				}
			}
			this.render();
		};

		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				void finish(true);
			}
			if (event.key === "Escape") {
				event.preventDefault();
				void finish(false);
			}
		});
		input.addEventListener("blur", () => {
			void finish(true);
		});

		target.replaceWith(input);
		input.focus();
		input.select();
	}

	private getNextProgressValue(item: MediaItem): string | null {
		if (item.type === "series" && item.season && item.episode !== undefined) {
			return `S${item.season}E${item.episode + 1}`;
		}
		const raw = item.progressRaw?.trim();
		if (raw && /^\d+(?:\.\d+)?$/.test(raw)) {
			return this.incrementNumericString(raw);
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
		return this.incrementNumericString(value);
	}

	private incrementNumericString(value: string): string {
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

	private createSortableHeader(label: string, key: SortKey): HTMLElement {
		const cell = document.createElement("button");
		cell.type = "button";
		cell.classList.add("media-tracker__table-cell", "media-tracker__table-sort");
		cell.dataset.key = key;
		const arrow = this.sortKey === key ? (this.sortDirection === "asc" ? " ▲" : " ▼") : "";
		cell.textContent = `${label}${arrow}`;
		cell.addEventListener("click", () => {
			if (this.sortKey === key) {
				this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
			} else {
				this.sortKey = key;
				this.sortDirection = "asc";
			}
			this.render();
		});
		return cell;
	}

	private sortItems(items: MediaItem[]): MediaItem[] {
		const direction = this.sortDirection === "asc" ? 1 : -1;
		return [...items].sort((a, b) => {
			switch (this.sortKey) {
				case "type":
					return direction * MEDIA_TYPE_LABELS[a.type].localeCompare(MEDIA_TYPE_LABELS[b.type]);
				case "status":
					return direction * MEDIA_STATUS_LABELS[a.status].localeCompare(MEDIA_STATUS_LABELS[b.status]);
				case "progress":
					return direction * this.getProgressValue(a).localeCompare(this.getProgressValue(b));
				case "title":
				default:
					return direction * getTitleSortKey(a.title).localeCompare(getTitleSortKey(b.title));
			}
		});
	}

	private getProgressValue(item: MediaItem): string {
		return item.progress ?? "";
	}

	private renderLinks(container: HTMLElement, item: MediaItem): number {
		let count = 0;
		if (item.type === "novel") {
			count += this.renderLinkButton(container, "Patreon", item.links.patreon) ? 1 : 0;
			count += this.renderLinkButton(container, "Kemono", item.links.kemono) ? 1 : 0;
			count += this.renderLinkButton(container, "RoyalRoad", item.links.royalroad) ? 1 : 0;
		} else {
			count += this.renderLinkButton(container, "IMDB", item.links.imdb) ? 1 : 0;
			count += this.renderLinkButton(container, "HDRezka", item.links.hdrezka) ? 1 : 0;
		}
		for (const extra of item.extraLinks ?? []) {
			count += this.renderLinkButton(container, extra.label, extra.url) ? 1 : 0;
		}
		return count;
	}

	private renderLinkButton(container: HTMLElement, label: string, url: string | null | undefined): boolean {
		if (!url) {
			return false;
		}
		const button = document.createElement("button");
		button.classList.add("media-tracker__button");
		const text = document.createElement("span");
		text.textContent = label;
		button.appendChild(text);

		const icon = this.createLinkIcon(label);
		if (icon) {
			button.classList.add("media-tracker__icon-button");
			button.prepend(icon);
			button.setAttr("aria-label", label);
			button.setAttr("title", label);
			text.classList.add("media-tracker__icon-fallback");
			icon.addEventListener("error", () => {
				if (icon.dataset.fallback === "failed") {
					icon.remove();
					button.classList.remove("media-tracker__icon-button");
					text.classList.remove("media-tracker__icon-fallback");
				}
			});
		}
		container.appendChild(button);
		button.addEventListener("click", () => {
			window.open(url, "_blank", "noopener");
		});
		return true;
	}

	private createLinkIcon(label: string): HTMLImageElement | null {
		const mapping: Record<string, string> = {
			Patreon: "patreon",
			Kemono: "kemono",
			RoyalRoad: "royalroad",
			HDRezka: "hdrezka",
			IMDB: "imdb",
		};
		const baseName = mapping[label];
		if (!baseName) {
			return null;
		}
		const img = document.createElement("img");
		img.classList.add("media-tracker__link-icon");
		img.alt = label;
		img.src = this.getAssetUrl(`${baseName}.ico`);
		img.dataset.fallback = "ico";
		img.addEventListener("error", () => {
			if (img.dataset.fallback === "ico") {
				img.dataset.fallback = "png";
				img.src = this.getAssetUrl(`${baseName}.png`);
				return;
			}
			if (img.dataset.fallback === "png") {
				img.dataset.fallback = "failed";
			}
		});
		return img;
	}

	private getAssetUrl(fileName: string): string {
		const pluginDir = `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		return this.app.vault.adapter.getResourcePath(`${pluginDir}/assets/${fileName}`);
	}

	private openCardMenu(event: MouseEvent, item: MediaItem) {
		const menu = new Menu();
		menu.addItem((itemMenu) => itemMenu
			.setTitle("Open note")
			.onClick(() => {
				void this.app.workspace.getLeaf("tab").openFile(item.file);
			}));
		menu.addSeparator();
		if (item.type === "series") {
			menu.addItem((itemMenu) => itemMenu
				.setTitle("Check latest episode")
				.onClick(async () => {
					await refreshSeriesLatest(this.app, this.plugin.settings, item, this.plugin.settings.tmdbMinIntervalMs);
					this.render();
				}));
			menu.addSeparator();
		}

		const addLink = (label: string, key: "patreon" | "kemono" | "royalroad" | "imdb" | "hdrezka") => {
			new LinkModal(this.app, {
				title: `Set ${label} link`,
				onSubmit: async (_, url) => {
					await setMediaLink(this.app, item.file, key, url);
				},
			}).open();
		};

		const linkMenu = new Menu();
		linkMenu.addItem((itemMenu) => itemMenu
			.setTitle("Back")
			.setIcon("arrow-left")
			.onClick(() => {
				this.openCardMenu(event, item);
			}));
		linkMenu.addSeparator();
		if (item.type === "novel") {
			linkMenu.addItem((itemMenu) => itemMenu.setTitle("Set Patreon link").onClick(() => addLink("Patreon", "patreon")));
			linkMenu.addItem((itemMenu) => itemMenu.setTitle("Set Kemono link").onClick(() => addLink("Kemono", "kemono")));
			linkMenu.addItem((itemMenu) => itemMenu.setTitle("Set RoyalRoad link").onClick(() => addLink("RoyalRoad", "royalroad")));
		} else {
			linkMenu.addItem((itemMenu) => itemMenu.setTitle("Set IMDB link").onClick(() => addLink("IMDB", "imdb")));
			linkMenu.addItem((itemMenu) => itemMenu.setTitle("Set HDRezka link").onClick(() => addLink("HDRezka", "hdrezka")));
		}
		linkMenu.addSeparator();
		linkMenu.addItem((itemMenu) => itemMenu.setTitle("Add custom link").onClick(() => {
			new LinkModal(this.app, {
				title: "Add custom link",
				showLabel: true,
				onSubmit: async (label, url) => {
					await setCustomLink(this.app, item.file, label, url);
				},
			}).open();
		}));

		menu.addItem((itemMenu) => {
			itemMenu.setTitle("Links →");
			itemMenu.setIcon("link");
			itemMenu.onClick(() => {
				linkMenu.showAtMouseEvent(event);
			});
		});

		menu.addSeparator();
		menu.addItem((itemMenu) => itemMenu
			.setTitle("Delete note…")
			.setIcon("trash")
			.onClick(async () => {
				const confirmed = window.confirm(`Delete "${item.title}"?`);
				if (!confirmed) {
					return;
				}
				await this.app.vault.delete(item.file);
			}));

		menu.showAtMouseEvent(event);
	}
}
