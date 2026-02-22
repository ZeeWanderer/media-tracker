import {App, ItemView, Notice, WorkspaceLeaf} from "obsidian";
import {MediaItem, UpdateLogRun} from "../types";
import {MEDIA_STATUS_LABELS} from "./mediaStatusLabels";
import {MEDIA_TYPE_LABELS} from "./mediaTypeConfig";
import {NewMediaModal} from "./newMediaModal";
import {
	normalizeAllMediaNoteFrontmatter,
} from "../flows/media";
import {listMediaItems} from "../domain/media/readModel";
import {renderCard, renderTableHeader, renderTableRow, type SortDirection, type SortKey} from "./trackerRenderer";
import {openMediaUpdateLog} from "./updateLogView";
import {TrackerGitService, TrackerIconService} from "./trackerServices";
import {TrackerRefreshService} from "./trackerRefreshService";
import {runLoggedTask, type TaskLogContext} from "./taskRunner";
import {createCleanupIcon, createGitCommitIcon, createRefreshIcon, createUpdateLogIcon} from "./trackerIcons";
import {TrackerInteractionController} from "./trackerInteractionController";
import {
	DisplayMode,
	matchesTrackerFilters,
	matchesTrackerSearch,
	sortTrackerItems,
	STATUS_FILTERS,
	TrackerFilterState,
	TYPE_FILTERS,
	TypeFilter,
	StatusFilter,
} from "./trackerFiltering";
import {MEDIA_TRACKER_VIEW} from "./viewIds";
import type {MediaTrackerSettings} from "../core/pluginSettingsModel";
import type {DesktopFaviconCache} from "../infra/cache/faviconCache";
import type {PluginLogger} from "../infra/logging/pluginLogger";
export {MEDIA_TRACKER_VIEW};

type TrackerViewPluginDeps = {
	app: App;
	manifest: {id: string};
	settings: MediaTrackerSettings;
	logger: PluginLogger;
	faviconCache: DesktopFaviconCache;
	updateSettings: (mutator: (settings: MediaTrackerSettings) => void) => Promise<void>;
	suppressNextViewRefresh: () => void;
	setActiveUpdateRun: (run: UpdateLogRun | null) => void;
	recordCompletedUpdateRun: (run: UpdateLogRun) => Promise<void>;
};

export class MediaTrackerView extends ItemView {
	plugin: TrackerViewPluginDeps;
	private typeFilter: TypeFilter = "all";
	private statusFilter: StatusFilter = "all";
	private displayMode: DisplayMode;
	private searchQuery = "";
	private sortKey: SortKey = "title";
	private sortDirection: SortDirection = "asc";
	private readonly gitService: TrackerGitService;
	private readonly iconService: TrackerIconService;
	private readonly refreshService: TrackerRefreshService;
	private readonly interactionController: TrackerInteractionController;
	private refreshButton: HTMLButtonElement | null = null;
	private refreshLabel: HTMLSpanElement | null = null;
	private trackedItemsCache: MediaItem[] = [];
	private trackedItemsCacheDirty = true;
	private visibleItems: MediaItem[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: TrackerViewPluginDeps) {
		super(leaf);
		this.plugin = plugin;
		this.displayMode = plugin.settings.displayMode ?? "cards";
		this.gitService = new TrackerGitService({
			app: this.app,
			pluginId: this.plugin.manifest.id,
			getMediaFolder: () => this.plugin.settings.mediaFolder,
			logger: this.plugin.logger,
			onStateChange: () => this.requestRender(),
		});
		this.iconService = new TrackerIconService({
			app: this.app,
			pluginId: this.plugin.manifest.id,
			faviconCache: this.plugin.faviconCache,
			onStateChange: () => this.requestRender(),
		});
		this.refreshService = new TrackerRefreshService({
			app: this.app,
			getSettings: () => this.plugin.settings,
			logger: this.plugin.logger,
			setActiveUpdateRun: (run) => this.plugin.setActiveUpdateRun(run),
			recordCompletedUpdateRun: (run) => this.plugin.recordCompletedUpdateRun(run),
			openUpdateLog: () => openMediaUpdateLog(this.plugin),
			onStateChange: () => this.updateRefreshButtonState(),
		});
		this.interactionController = new TrackerInteractionController({
			app: this.app,
			getSettings: () => this.plugin.settings,
			suppressNextViewRefresh: () => this.plugin.suppressNextViewRefresh(),
			logger: this.plugin.logger,
			runTask: (task, errorMessage, logContext) => this.runTask(task, errorMessage, logContext),
			invalidateItemsCache: () => this.invalidateItemsCache(),
			render: () => this.requestRender(),
			getDisplayMode: () => this.displayMode,
			getSortKey: () => this.sortKey,
			getTrackedItems: () => this.getTrackedItems(),
			getLinkIconUrl: (value) => this.iconService.getLinkIconUrl(value),
		});
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
		this.requestRender();
	}

	invalidateItemsCache() {
		this.trackedItemsCacheDirty = true;
	}

	private getTrackedItems(): MediaItem[] {
		if (this.trackedItemsCacheDirty) {
			this.trackedItemsCache = listMediaItems(this.app, this.plugin.settings);
			this.trackedItemsCacheDirty = false;
		}
		return this.trackedItemsCache;
	}

	private getFilterState(): TrackerFilterState {
		return {
			typeFilter: this.typeFilter,
			statusFilter: this.statusFilter,
			searchQuery: this.searchQuery,
			sortKey: this.sortKey,
			sortDirection: this.sortDirection,
		};
	}

	private runTask(task: () => Promise<void>, errorMessage: string, logContext?: TaskLogContext): Promise<boolean> {
		return runLoggedTask(task, errorMessage, {
			logger: this.plugin.logger,
			defaultScope: "ui.tracker",
		}, logContext);
	}

	requestRender() {
		this.render();
		this.gitService.ensureRepositoryState();
		void this.ensureVisibleIcons();
	}

	private async ensureVisibleIcons() {
		const snapshot = [...this.visibleItems];
		if (!snapshot.length) {
			return;
		}
		await this.iconService.ensureKnownIconAssets();
		await this.iconService.ensureFavicons(snapshot);
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
		this.refreshButton = null;
		this.refreshLabel = null;

		const header = contentEl.createDiv({cls: "media-tracker__header"});
		header.createEl("h2", {text: "Media tracker"});

		const actions = header.createDiv({cls: "media-tracker__actions"});
		const refreshButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button media-tracker__refresh-button"});
		refreshButton.setAttr("aria-label", "Refresh media updates");
		refreshButton.appendChild(createRefreshIcon());
		const refreshLabel = refreshButton.createSpan({cls: "media-tracker__refresh-label"});
		this.refreshButton = refreshButton;
		this.refreshLabel = refreshLabel;
		this.updateRefreshButtonState();
		refreshButton.addEventListener("click", () => {
			if (this.refreshService.isRefreshing) {
				return;
			}
			void this.runRefresh();
		});
		const updateLogButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button media-tracker__update-log-button"});
		updateLogButton.type = "button";
		updateLogButton.setAttr("aria-label", "Open update log");
		updateLogButton.setAttr("title", "Open update log");
		updateLogButton.appendChild(createUpdateLogIcon());
		updateLogButton.addEventListener("click", () => {
			void openMediaUpdateLog(this.plugin);
		});
		const cleanupButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button media-tracker__cleanup-button"});
		cleanupButton.setAttr("aria-label", "Cleanup media frontmatter");
		cleanupButton.setAttr("title", "Normalize media frontmatter fields");
		cleanupButton.appendChild(createCleanupIcon());
		cleanupButton.addEventListener("click", () => {
			const confirmed = window.confirm("Normalize frontmatter for all media notes? This standardizes media fields and links.");
			if (!confirmed) {
				return;
			}
			const files = this.getTrackedItems().map((item) => item.file);
			this.runTask(async () => {
				const changed = await normalizeAllMediaNoteFrontmatter(this.app, files);
				this.plugin.logger.info("ui.tracker", "cleanup_all_counts", "Frontmatter normalization results.", {
					total: files.length,
					changed,
				});
				new Notice(`Normalized ${changed} of ${files.length} media notes.`);
				this.invalidateItemsCache();
				this.requestRender();
			}, "Failed to normalize frontmatter.", {
				event: "cleanup_all",
				logStart: true,
				successMessage: "Finished frontmatter normalization for all tracked notes.",
				meta: {total: files.length},
			});
		});
		if (this.gitService.hasRepository) {
			const commitButton = actions.createEl("button", {cls: "media-tracker__button media-tracker__icon-button media-tracker__commit-button"});
			commitButton.type = "button";
			commitButton.setAttr("aria-label", "Create and push git commit");
			commitButton.setAttr("title", "Create and push commit: [update] <datetime>");
			commitButton.appendChild(createGitCommitIcon());
			if (this.gitService.isCreatingCommit) {
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

		const items = this.getTrackedItems();
		const filterState = this.getFilterState();
		const filtered = items
			.filter((item) => matchesTrackerFilters(item, filterState))
			.filter((item) => matchesTrackerSearch(item, filterState.searchQuery));
		const sorted = this.displayMode === "details" ? sortTrackerItems(filtered, filterState) : filtered;
		this.visibleItems = filtered;

		if (filtered.length === 0) {
			const empty = contentEl.createDiv({cls: "media-tracker__empty"});
			empty.setText("No media entries yet. Create one to get started.");
			return;
		}

			const handlers = this.interactionController.getRenderHandlers();
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
			this.requestRender();
			search.focus();
		});

		if (search.value) {
			clearButton.addClass("is-visible");
		}
		search.addEventListener("input", () => {
			this.searchQuery = search.value;
			this.requestRender();
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
			this.typeFilter = typeSelect.value as TypeFilter;
			this.requestRender();
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
			this.statusFilter = statusSelect.value as StatusFilter;
			this.requestRender();
		});

		const displaySelect = controls.createEl("select");
		displaySelect.createEl("option", {value: "cards", text: "Cards"});
		displaySelect.createEl("option", {value: "details", text: "Details"});
		displaySelect.value = this.displayMode;
		displaySelect.addEventListener("change", () => {
			this.displayMode = displaySelect.value as DisplayMode;
			void this.plugin.updateSettings((settings) => {
				settings.displayMode = this.displayMode;
			});
			this.requestRender();
		});

		return {searchInput, clearButton};
	}

	private handleSortChange(key: SortKey) {
		if (this.sortKey === key) {
			this.sortDirection = this.sortDirection === "asc" ? "desc" : "asc";
		} else {
			this.sortKey = key;
			this.sortDirection = "asc";
		}
		this.requestRender();
	}

	private getRefreshTooltip(): string {
		if (!this.plugin.settings.tmdbLastSync) {
			return "Check latest updates (never updated)";
		}
		const date = new Date(this.plugin.settings.tmdbLastSync);
		return `Check latest updates (last updated ${date.toLocaleString()})`;
	}

	private updateRefreshButtonState() {
		const refreshButton = this.refreshButton;
		const refreshLabel = this.refreshLabel;
		if (!refreshButton || !refreshLabel) {
			return;
		}
		const showProgress = this.refreshService.isRefreshing && this.refreshService.total > 0;
		refreshLabel.setText(showProgress ? `${this.refreshService.current}/${this.refreshService.total}` : "");
		refreshButton.disabled = this.refreshService.isRefreshing;
		refreshButton.toggleClass("is-disabled", this.refreshService.isRefreshing);
		refreshButton.toggleClass("media-tracker__refresh-button--running", this.refreshService.isRefreshing);
		refreshButton.toggleClass("media-tracker__refresh-button--progress", showProgress);
		if (this.refreshService.isRefreshing) {
			if (showProgress) {
				refreshButton.setAttr(
					"title",
					`Refreshing media updates (${this.refreshService.current}/${this.refreshService.total})`,
				);
			} else {
				refreshButton.setAttr("title", "Refreshing media updates");
			}
			return;
		}
		refreshButton.setAttr("title", this.getRefreshTooltip());
	}

	private async runRefresh() {
		await this.refreshService.run(this.getTrackedItems());
		this.invalidateItemsCache();
		this.requestRender();
	}

	private async createGitCommit() {
		const result = await this.gitService.createCommit();
		if (!result) {
			return;
		}
		switch (result.status) {
			case "created_and_pushed":
				this.plugin.logger.info("git", "commit_pushed", result.message);
				new Notice(result.message);
				break;
			case "created_push_failed":
				this.plugin.logger.warn("git", "commit_push_failed", result.message);
				new Notice(result.message, 10000);
				break;
			case "no_changes":
				this.plugin.logger.info("git", "commit_no_changes", result.message);
				new Notice(result.message);
				break;
			case "needs_pull":
				this.plugin.logger.warn("git", "commit_needs_pull", result.message);
				new Notice(result.message, 10000);
				break;
			case "not_repo":
				this.gitService.markNotRepository();
				this.plugin.logger.warn("git", "commit_not_repo", "Vault is not a Git repository.");
				new Notice("Vault is not a Git repository.");
				break;
			case "git_missing":
				this.plugin.logger.error("git", "git_missing", "Git executable is not available.");
				new Notice("Git executable is not available.");
				break;
			case "failed":
			default:
				this.plugin.logger.error("git", "commit_failed", result.message);
				new Notice(result.message);
				break;
		}
	}

}
