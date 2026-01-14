import {ItemView, Menu, Notice, WorkspaceLeaf} from "obsidian";
import MediaTrackerPlugin from "../main";
import {MediaItem, MediaStatus, MediaType} from "../types";
import {MEDIA_STATUS_LABELS, getMediaItems, getTitleSortKey} from "../utils/media";
import {MEDIA_TYPE_LABELS, MEDIA_TYPES, SEASON_EPISODE_TYPES, TMDB_TYPES} from "../utils/mediaConfig";
import {NewMediaModal} from "./newMediaModal";
import {addMediaLink, setNovelProgress, setSeriesProgress} from "../utils/notes";
import {LinkModal} from "./linkModal";
import {refreshAllMedia, refreshMediaLatest} from "../utils/refresh";
import {renderCard, renderTableHeader, renderTableRow, type RenderHandlers, type SortDirection, type SortKey} from "./trackerRenderer";
import {KNOWN_ICON_BASES, getAnilistUrl, getKnownIconAsset} from "../utils/links";
import {fetchFaviconDataUrl, getCachedFavicon, getFaviconCacheKey} from "../utils/favicon";
import {cleanFrontmatter, updateFrontmatter} from "../utils/frontmatter";

export const MEDIA_TRACKER_VIEW = "media-tracker-view";

const TYPE_FILTERS: Array<MediaType | "all"> = ["all", ...MEDIA_TYPES];
const STATUS_FILTERS: Array<MediaStatus | "all"> = ["all", "planned", "active", "completed", "on-hold", "dropped"];

type DisplayMode = "cards" | "details";

export class MediaTrackerView extends ItemView {
	plugin: MediaTrackerPlugin;
	private typeFilter: MediaType | "all" = "all";
	private statusFilter: MediaStatus | "all" = "all";
	private displayMode: DisplayMode;
	private searchQuery = "";
	private sortKey: SortKey = "title";
	private sortDirection: SortDirection = "asc";
	private faviconInflight = new Set<string>();
	private knownIconAssets = new Map<string, string>();
	private knownIconAssetsPromise: Promise<void> | null = null;

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
		void this.ensureKnownIconAssets();

		const header = contentEl.createDiv({cls: "media-tracker__header"});
		header.createEl("h2", {text: "Media tracker"});

		const actions = header.createDiv({cls: "media-tracker__actions"});
		const refreshButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button media-tracker__refresh-button"});
		refreshButton.setAttr("aria-label", "Refresh media updates");
		refreshButton.setAttr("title", this.getRefreshTooltip());
		refreshButton.appendChild(this.createRefreshIcon());
		const refreshLabel = refreshButton.createSpan({cls: "media-tracker__refresh-label"});
		refreshButton.addEventListener("click", async () => {
			const items = getMediaItems(this.app, this.plugin.settings);
			await refreshAllMedia(this.app, this.plugin.settings, items, (current, total) => {
				refreshLabel.setText(`${current}/${total}`);
				refreshButton.addClass("media-tracker__refresh-button--progress");
			});
			this.plugin.settings.tmdbLastSync = Date.now();
			await this.plugin.saveSettings();
			refreshLabel.setText("");
			refreshButton.removeClass("media-tracker__refresh-button--progress");
			refreshButton.setAttr("title", this.getRefreshTooltip());
			this.render();
		});
		const cleanupButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button media-tracker__cleanup-button"});
		cleanupButton.setAttr("aria-label", "Cleanup media frontmatter");
		cleanupButton.setAttr("title", "Remove unused frontmatter fields");
		cleanupButton.appendChild(this.createCleanupIcon());
		cleanupButton.addEventListener("click", async () => {
			const confirmed = window.confirm("Clean up frontmatter for all media notes? This removes unknown fields.");
			if (!confirmed) {
				return;
			}
			const items = getMediaItems(this.app, this.plugin.settings);
			let changed = 0;
			for (const item of items) {
				let modified = false;
				const before = JSON.stringify(this.app.metadataCache.getFileCache(item.file)?.frontmatter ?? {});
				await cleanFrontmatter(this.app, item.file);
				const after = JSON.stringify(this.app.metadataCache.getFileCache(item.file)?.frontmatter ?? {});
				modified = before !== after;
				if (modified) {
					changed += 1;
				}
			}
			new Notice(`Cleaned ${changed} of ${items.length} media notes.`);
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

		void this.ensureFavicons(filtered);

		if (filtered.length === 0) {
			const empty = contentEl.createDiv({cls: "media-tracker__empty"});
			empty.setText("No media entries yet. Create one to get started.");
			return;
		}

		const handlers = this.getRenderHandlers();
		if (this.displayMode === "details") {
			const list = contentEl.createDiv({cls: "media-tracker__table"});
			list.appendChild(renderTableHeader(this.sortKey, this.sortDirection, (key) => this.handleSortChange(key)));
			for (const item of sorted) {
				list.appendChild(renderTableRow(item, handlers));
			}
		} else {
			const list = contentEl.createDiv({cls: "media-tracker__list"});
			for (const item of filtered) {
				list.appendChild(renderCard(item, handlers));
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

	private getRenderHandlers(): RenderHandlers {
		return {
			onOpenNote: async (item) => {
				const fullItem = item as MediaItem;
				await this.app.workspace.getLeaf("tab").openFile(fullItem.file);
			},
			onContextMenu: (event, item) => {
				event.preventDefault();
				this.openCardMenu(event, item as MediaItem);
			},
			onStatusChange: async (item, status) => {
				const fullItem = item as MediaItem;
				await updateFrontmatter(this.app, fullItem.file, (frontmatter) => {
					frontmatter.status = status;
				});
			},
			onProgressEdit: (target, item) => {
				this.openProgressEditor(target, item as MediaItem);
			},
			onProgressAdvance: async (item, nextValue) => {
				const fullItem = item as MediaItem;
			if (SEASON_EPISODE_TYPES.has(fullItem.type)) {
				await setSeriesProgress(this.app, fullItem.file, nextValue);
			} else {
				await setNovelProgress(this.app, fullItem.file, nextValue);
			}
			},
			onLinkOpen: (url) => {
				window.open(url, "_blank", "noopener");
			},
			getLinkIconUrl: (value) => {
				const base = getKnownIconAsset(value);
				const asset = base ? this.knownIconAssets.get(base) : null;
				if (asset) {
					return this.getAssetUrl(asset);
				}
				const cached = getCachedFavicon(this.plugin.settings, value);
				return cached ?? null;
			},
		};
	}

	private handleSortChange(key: SortKey) {
		if (this.sortKey === key) {
			this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
		} else {
			this.sortKey = key;
			this.sortDirection = "asc";
		}
		this.render();
	}

	private getRefreshTooltip(): string {
		if (!this.plugin.settings.tmdbLastSync) {
			return "Check latest updates (never updated)";
		}
		const date = new Date(this.plugin.settings.tmdbLastSync);
		return `Check latest updates (last updated ${date.toLocaleString()})`;
	}

	private createRefreshIcon(): SVGSVGElement {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("aria-hidden", "true");
		svg.classList.add("media-tracker__refresh-icon");
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute(
			"d",
			"M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 .34-.03.67-.08 1h2.02c.04-.33.06-.66.06-1 0-4.42-3.58-8-8-8zm-6 6c0-.34.03-.67.08-1H4.06c-.04.33-.06.66-.06 1 0 4.42 3.58 8 8 8v3l4-4-4-4v3c-3.31 0-6-2.69-6-6z",
		);
		path.setAttribute("fill", "currentColor");
		svg.appendChild(path);
		return svg;
	}

	private createCleanupIcon(): SVGSVGElement {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("aria-hidden", "true");
		svg.classList.add("media-tracker__cleanup-icon");
		const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute(
			"d",
			"m19.36 2.72l1.42 1.42l-5.72 5.71c1.07 1.54 1.22 3.39.32 4.59L9.06 8.12c1.2-.9 3.05-.75 4.59.32zM5.93 17.57c-2.01-2.01-3.24-4.41-3.58-6.65l4.88-2.09l7.44 7.44l-2.09 4.88c-2.24-.34-4.64-1.57-6.65-3.58",
		);
		path.setAttribute("fill", "currentColor");
		svg.appendChild(path);
		return svg;
	}

	private openProgressEditor(target: HTMLElement, item: MediaItem) {
		const input = document.createElement("input");
		input.type = "text";
		input.classList.add("media-tracker__progress-input");
		input.value = item.progress ?? "";
		input.size = Math.max(4, input.value.length);

		const finish = async (save: boolean) => {
			if (save) {
				if (SEASON_EPISODE_TYPES.has(item.type)) {
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
		if (SEASON_EPISODE_TYPES.has(item.type) && item.season !== undefined && item.episode !== undefined) {
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

	private openCardMenu(event: MouseEvent, item: MediaItem) {
		const menu = new Menu();
		menu.addItem((itemMenu) => itemMenu
			.setTitle("Open note")
			.onClick(() => {
				void this.app.workspace.getLeaf("tab").openFile(item.file);
			}));
		menu.addSeparator();
		if (TMDB_TYPES.has(item.type) || item.type === "anime" || item.type === "manga") {
			menu.addItem((itemMenu) => itemMenu
				.setTitle(item.type === "manga" ? "Check latest chapter" : "Check latest episode")
				.onClick(async () => {
					await refreshMediaLatest(this.app, this.plugin.settings, item, this.plugin.settings.tmdbMinIntervalMs);
					this.render();
				}));
			menu.addSeparator();
		}

		menu.addItem((itemMenu) => {
			itemMenu.setTitle("Add link");
			itemMenu.setIcon("link");
			itemMenu.onClick(() => {
				new LinkModal(this.app, {
					title: "Add link",
					onSubmit: async (url) => {
						await addMediaLink(this.app, item.file, url);
					},
				}).open();
			});
		});

		menu.addSeparator();
		menu.addItem((itemMenu) => itemMenu
			.setTitle("Clean note")
			.setIcon("wand-2")
			.onClick(async () => {
				await cleanFrontmatter(this.app, item.file);
				this.render();
			}));

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

	private async ensureFavicons(items: MediaItem[]) {
		const cache = this.plugin.settings.faviconCache ?? {};
		for (const item of items) {
			const links = [...(item.links ?? [])];
			if (item.anilistId) {
				links.push(getAnilistUrl(item.anilistId, item.type === "manga" ? "manga" : "anime"));
			}
			for (const link of links) {
				const base = getKnownIconAsset(link);
				const asset = base ? this.knownIconAssets.get(base) : null;
				if (asset) {
					continue;
				}
				const key = getFaviconCacheKey(link);
				if (!key || cache[key] || this.faviconInflight.has(key)) {
					continue;
				}
				this.faviconInflight.add(key);
				void this.fetchAndStoreFavicon(link);
			}
		}
	}

	private async fetchAndStoreFavicon(link: string) {
		const result = await fetchFaviconDataUrl(link);
		const key = result?.key;
		if (key) {
			this.plugin.settings.faviconCache = {
				...this.plugin.settings.faviconCache,
				[key]: {dataUrl: result.dataUrl, updated: Date.now()},
			};
			await this.plugin.saveSettings();
			this.render();
			this.faviconInflight.delete(key);
			return;
		}
		if (key) {
			this.faviconInflight.delete(key);
		}
	}

	private getAssetUrl(fileName: string): string {
		const pluginDir = `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		return this.app.vault.adapter.getResourcePath(`${pluginDir}/assets/${fileName}`);
	}

	private async ensureKnownIconAssets() {
		if (this.knownIconAssetsPromise) {
			return this.knownIconAssetsPromise;
		}
		const pluginDir = `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		this.knownIconAssetsPromise = (async () => {
			for (const base of KNOWN_ICON_BASES) {
				const extensions = ["svg", "png", "ico"];
				for (const ext of extensions) {
					try {
						const name = `${base}.${ext}`;
						const exists = await this.app.vault.adapter.exists(`${pluginDir}/assets/${name}`);
						if (exists) {
							this.knownIconAssets.set(base, name);
							break;
						}
					} catch {
						// Ignore missing assets or adapter errors.
					}
				}
			}
		})().finally(() => {
			this.knownIconAssetsPromise = null;
		});
		return this.knownIconAssetsPromise;
	}
}
