import {ItemView, Menu, Notice, WorkspaceLeaf} from "obsidian";
import MediaTrackerPlugin from "../main";
import {MediaItem, MediaStatus, MediaType} from "../types";
import {getTitleSortKey} from "../domain/media/readModel";
import {MEDIA_TYPES, TMDB_TYPES} from "../domain/media/config";
import {MEDIA_STATUS_LABELS} from "./mediaStatusLabels";
import {MEDIA_TYPE_LABELS} from "./mediaTypeConfig";
import {NewMediaModal} from "./newMediaModal";
import {LinkModal} from "./linkModal";
import {
	addLinkToMediaNote,
	deleteMediaNote,
	listTrackedMedia,
	listTrackedMediaFiles,
	normalizeAllMediaNoteFrontmatter,
	normalizeMediaNoteFrontmatter,
	refreshTrackedMedia,
	refreshTrackedMediaLatest,
	updateMediaNoteProgress,
	updateMediaNoteStatus,
} from "../flows/media";
import {renderCard, renderTableHeader, renderTableRow, type RenderHandlers, type SortDirection, type SortKey} from "./trackerRenderer";
import {getFaviconCacheKey} from "../infra/cache/faviconCache";
import {KNOWN_ICON_BASES, getAnilistUrl, getKnownIconAsset} from "../domain/media/links";
import {createVaultUpdateCommit, isVaultGitRepository} from "../infra/git/vaultGit";

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
	private knownIconAssets = new Map<string, string>();
	private knownIconAssetsPromise: Promise<void> | null = null;
	private gitRepository: boolean | null = null;
	private gitRepositoryPromise: Promise<void> | null = null;
	private isRefreshing = false;
	private isCreatingGitCommit = false;

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

	private runTask(task: () => Promise<void>, errorMessage: string) {
		void task().catch((error) => {
			console.error(error);
			new Notice(errorMessage);
		});
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
		this.ensureGitRepositoryState();

		const header = contentEl.createDiv({cls: "media-tracker__header"});
		header.createEl("h2", {text: "Media tracker"});

		const actions = header.createDiv({cls: "media-tracker__actions"});
		const refreshButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button media-tracker__refresh-button"});
		refreshButton.setAttr("aria-label", "Refresh media updates");
		refreshButton.setAttr("title", this.getRefreshTooltip());
		refreshButton.appendChild(this.createRefreshIcon());
		const refreshLabel = refreshButton.createSpan({cls: "media-tracker__refresh-label"});
		if (this.isRefreshing) {
			refreshButton.disabled = true;
			refreshButton.addClass("is-disabled");
		}
		refreshButton.addEventListener("click", () => {
			if (this.isRefreshing) {
				return;
			}
			void this.runRefresh(refreshButton, refreshLabel);
		});
		const cleanupButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button media-tracker__cleanup-button"});
		cleanupButton.setAttr("aria-label", "Cleanup media frontmatter");
		cleanupButton.setAttr("title", "Normalize media frontmatter fields");
		cleanupButton.appendChild(this.createCleanupIcon());
		cleanupButton.addEventListener("click", () => {
			const confirmed = window.confirm("Normalize frontmatter for all media notes? This standardizes media fields and links.");
			if (!confirmed) {
				return;
			}
			this.runTask(async () => {
				const files = listTrackedMediaFiles(this.app, this.plugin.settings);
				const changed = await normalizeAllMediaNoteFrontmatter(this.app, files);
				new Notice(`Normalized ${changed} of ${files.length} media notes.`);
				this.render();
			}, "Failed to normalize frontmatter.");
		});
		if (this.gitRepository) {
			const commitButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button media-tracker__commit-button"});
			commitButton.type = "button";
			commitButton.setAttr("aria-label", "Create and push git commit");
			commitButton.setAttr("title", "Create and push commit: [update] <datetime>");
			commitButton.appendChild(this.createGitCommitIcon());
			if (this.isCreatingGitCommit) {
				commitButton.disabled = true;
				commitButton.addClass("is-disabled");
			}
			commitButton.addEventListener("click", () => {
				this.runTask(async () => {
					await this.createGitCommit();
				}, "Failed to create git commit.");
			});
		}
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

		const items = listTrackedMedia(this.app, this.plugin.settings);
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
			onOpenNote: (item) => {
				const fullItem = item as MediaItem;
				this.runTask(async () => {
					await this.app.workspace.getLeaf("tab").openFile(fullItem.file);
				}, `Failed to open "${fullItem.title}".`);
			},
			onContextMenu: (event, item) => {
				event.preventDefault();
				this.openCardMenu(event, item as MediaItem);
			},
			onStatusChange: (item, status) => {
				const fullItem = item as MediaItem;
				this.runTask(async () => {
					await updateMediaNoteStatus(this.app, fullItem.file, status);
				}, `Failed to update status for "${fullItem.title}".`);
			},
			onProgressEdit: (target, item) => {
				this.openProgressEditor(target, item as MediaItem);
			},
			onProgressAdvance: (item, nextValue) => {
				const fullItem = item as MediaItem;
				this.runTask(async () => {
					await updateMediaNoteProgress(this.app, fullItem.file, fullItem.type, nextValue);
				}, `Failed to update progress for "${fullItem.title}".`);
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
				const cached = this.plugin.faviconCache.getMemoryCachedFavicon(value);
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

	private async runRefresh(refreshButton: HTMLButtonElement, refreshLabel: HTMLSpanElement) {
		this.isRefreshing = true;
		refreshButton.disabled = true;
		refreshButton.addClass("is-disabled");
		try {
			const items = listTrackedMedia(this.app, this.plugin.settings);
			await refreshTrackedMedia(this.app, this.plugin.settings, items, (current, total) => {
				refreshLabel.setText(`${current}/${total}`);
				refreshButton.addClass("media-tracker__refresh-button--progress");
			});
			await this.plugin.saveSettings();
		} catch (error) {
			console.error(error);
			new Notice("Failed to refresh media updates.");
		} finally {
			this.isRefreshing = false;
			refreshLabel.setText("");
			refreshButton.removeClass("media-tracker__refresh-button--progress");
			refreshButton.removeClass("is-disabled");
			refreshButton.disabled = false;
			this.render();
		}
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

	private createGitCommitIcon(): SVGSVGElement {
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("aria-hidden", "true");
		svg.classList.add("media-tracker__commit-icon");

		const center = document.createElementNS("http://www.w3.org/2000/svg", "circle");
		center.setAttribute("cx", "12");
		center.setAttribute("cy", "12");
		center.setAttribute("r", "4");
		center.setAttribute("fill", "none");
		center.setAttribute("stroke", "currentColor");
		center.setAttribute("stroke-width", "2");
		svg.appendChild(center);

		const left = document.createElementNS("http://www.w3.org/2000/svg", "line");
		left.setAttribute("x1", "3");
		left.setAttribute("y1", "12");
		left.setAttribute("x2", "8");
		left.setAttribute("y2", "12");
		left.setAttribute("stroke", "currentColor");
		left.setAttribute("stroke-width", "2");
		left.setAttribute("stroke-linecap", "round");
		svg.appendChild(left);

		const right = document.createElementNS("http://www.w3.org/2000/svg", "line");
		right.setAttribute("x1", "16");
		right.setAttribute("y1", "12");
		right.setAttribute("x2", "21");
		right.setAttribute("y2", "12");
		right.setAttribute("stroke", "currentColor");
		right.setAttribute("stroke-width", "2");
		right.setAttribute("stroke-linecap", "round");
		svg.appendChild(right);

		return svg;
	}

	private ensureGitRepositoryState() {
		if (this.gitRepository !== null || this.gitRepositoryPromise) {
			return;
		}
		this.gitRepositoryPromise = (async () => {
			this.gitRepository = await isVaultGitRepository(this.app);
		})()
			.catch((error: unknown) => {
				console.error(error);
				this.gitRepository = false;
			})
			.finally(() => {
				this.gitRepositoryPromise = null;
				this.render();
			});
	}

	private async createGitCommit() {
		if (this.isCreatingGitCommit) {
			return;
		}
		this.isCreatingGitCommit = true;
		this.render();
		try {
			const result = await createVaultUpdateCommit(this.app);
			switch (result.status) {
				case "created_and_pushed":
					new Notice(result.message);
					break;
				case "created_push_failed":
					new Notice(result.message, 10000);
					break;
				case "no_changes":
					new Notice("No changes to commit.");
					break;
				case "needs_pull":
					new Notice(result.message, 10000);
					break;
				case "not_repo":
					this.gitRepository = false;
					new Notice("Vault is not a Git repository.");
					break;
				case "git_missing":
					new Notice("Git executable is not available.");
					break;
				case "failed":
				default:
					new Notice(result.message);
					break;
			}
		} finally {
			this.isCreatingGitCommit = false;
			this.render();
		}
	}

	private openProgressEditor(target: HTMLElement, item: MediaItem) {
		const input = document.createElement("input");
		input.type = "text";
		input.classList.add("media-tracker__progress-input");
		input.value = item.progress ?? "";
		input.size = Math.max(4, input.value.length);

		const finish = async (save: boolean) => {
			if (save) {
				await updateMediaNoteProgress(this.app, item.file, item.type, input.value);
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
				.onClick(() => {
					this.runTask(async () => {
						await refreshTrackedMediaLatest(this.app, this.plugin.settings, item);
						this.render();
					}, `Failed to refresh latest updates for "${item.title}".`);
				}));
			menu.addSeparator();
		}

		menu.addItem((itemMenu) => {
			itemMenu.setTitle("Add link");
			itemMenu.setIcon("link");
			itemMenu.onClick(() => {
				new LinkModal(this.app, {
					title: "Add link",
					onSubmit: (url) => {
						this.runTask(async () => {
							await addLinkToMediaNote(this.app, item.file, url);
						}, `Failed to add link for "${item.title}".`);
					},
				}).open();
			});
		});

		menu.addSeparator();
		menu.addItem((itemMenu) => itemMenu
			.setTitle("Clean note")
			.setIcon("wand-2")
			.onClick(() => {
				this.runTask(async () => {
					await normalizeMediaNoteFrontmatter(this.app, item.file);
					this.render();
				}, `Failed to clean "${item.title}".`);
			}));

		menu.addSeparator();
		menu.addItem((itemMenu) => itemMenu
			.setTitle("Delete note…")
			.setIcon("trash")
			.onClick(() => {
				const confirmed = window.confirm(`Delete "${item.title}"?`);
				if (!confirmed) {
					return;
				}
				this.runTask(async () => {
					await deleteMediaNote(this.app, item.file);
				}, `Failed to delete "${item.title}".`);
			}));

		menu.showAtMouseEvent(event);
	}

	private async ensureFavicons(items: MediaItem[]) {
		const pending: Promise<string | null>[] = [];
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
				if (!key) {
					continue;
				}
				if (this.plugin.faviconCache.getMemoryCachedFavicon(link)) {
					continue;
				}
				pending.push(this.plugin.faviconCache.ensureFavicon(link));
			}
		}

		if (!pending.length) {
			return;
		}

		const results = await Promise.all(pending);
		if (results.some((value) => value !== null)) {
			this.render();
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
