import {App, ItemView, Notice, TAbstractFile, WorkspaceLeaf} from "obsidian";
import {NewMediaModal} from "./newMediaModal";
import {
	normalizeAllMediaNoteFrontmatter,
} from "../flows/media";
import {listMediaItems} from "../domain/media/readModel";
import {renderCard, renderTableHeader, renderTableRow} from "./trackerRenderer";
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
	normalizeTrackerSearchQuery,
	sortTrackerItems,
	TrackerFilterState,
	StatusFilter,
	TypeFilter,
} from "./trackerFiltering";
import {MEDIA_TRACKER_VIEW} from "./viewIds";
import type {MediaTrackerSettings} from "../core/pluginSettingsModel";
import type {DesktopFaviconCache} from "../infra/cache/faviconCache";
import type {PluginLogger} from "../infra/logging/pluginLogger";
import type {MediaItem} from "../domain/media/models";
import type {UpdateLogRun} from "../core/updateTypes";
import {renderTrackerControls} from "./trackerViewControls";
import type {SortDirection, SortKey} from "./trackerRenderTypes";
import {normalizeMediaFolder} from "../core/pluginSettings";
import {getPluginCacheDirectory, getPluginLogsDirectory, getPluginRootPath} from "../infra/storage/pluginPaths";
import {joinVaultRelativePath, normalizeVaultPathForCompare} from "../pathUtils";
export {MEDIA_TRACKER_VIEW};

const SEARCH_RENDER_DEBOUNCE_MS = 120;
const ICON_REFRESH_DEBOUNCE_MS = 160;
const COMMIT_SCOPE_REFRESH_DEBOUNCE_MS = 220;
const MAX_ICON_PREFETCH_ITEMS = 200;

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
	private searchRenderTimer: number | null = null;
	private iconRefreshTimer: number | null = null;
	private commitScopeRefreshTimer: number | null = null;

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
		this.registerEvent(this.app.vault.on("modify", (file) => this.onCommitScopeMutation(file)));
		this.registerEvent(this.app.vault.on("create", (file) => this.onCommitScopeMutation(file)));
		this.registerEvent(this.app.vault.on("delete", (file) => this.onCommitScopeMutation(file)));
		this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
			this.onCommitScopeMutation(file);
			this.onCommitScopePath(oldPath);
		}));
		this.requestRender();
	}

	async onClose() {
		this.cancelSearchRenderTimer();
		this.cancelIconRefreshTimer();
		this.cancelCommitScopeRefreshTimer();
	}

	invalidateItemsCache() {
		this.trackedItemsCacheDirty = true;
		this.gitService.invalidateScopedChangesState();
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
		this.gitService.ensureScopedChangesState();
		this.scheduleVisibleIconsRefresh();
	}

	private async ensureVisibleIcons() {
		const snapshot = this.visibleItems.slice(0, MAX_ICON_PREFETCH_ITEMS);
		if (!snapshot.length) {
			return;
		}
		await this.iconService.ensureKnownIconAssets();
		await this.iconService.ensureFavicons(snapshot);
	}

	private cancelSearchRenderTimer() {
		if (this.searchRenderTimer !== null) {
			window.clearTimeout(this.searchRenderTimer);
			this.searchRenderTimer = null;
		}
	}

	private scheduleSearchRender() {
		this.cancelSearchRenderTimer();
		this.searchRenderTimer = window.setTimeout(() => {
			this.searchRenderTimer = null;
			this.requestRender();
		}, SEARCH_RENDER_DEBOUNCE_MS);
	}

	private cancelIconRefreshTimer() {
		if (this.iconRefreshTimer !== null) {
			window.clearTimeout(this.iconRefreshTimer);
			this.iconRefreshTimer = null;
		}
	}

	private scheduleVisibleIconsRefresh() {
		this.cancelIconRefreshTimer();
		this.iconRefreshTimer = window.setTimeout(() => {
			this.iconRefreshTimer = null;
			void this.ensureVisibleIcons();
		}, ICON_REFRESH_DEBOUNCE_MS);
	}

	private cancelCommitScopeRefreshTimer() {
		if (this.commitScopeRefreshTimer !== null) {
			window.clearTimeout(this.commitScopeRefreshTimer);
			this.commitScopeRefreshTimer = null;
		}
	}

	private scheduleCommitScopeRefresh() {
		this.cancelCommitScopeRefreshTimer();
		this.commitScopeRefreshTimer = window.setTimeout(() => {
			this.commitScopeRefreshTimer = null;
			this.gitService.invalidateScopedChangesState();
			this.requestRender();
		}, COMMIT_SCOPE_REFRESH_DEBOUNCE_MS);
	}

	private onCommitScopeMutation(file: TAbstractFile) {
		this.onCommitScopePath(file.path);
	}

	private onCommitScopePath(path: string) {
		if (!this.isPathInCommitScope(path)) {
			return;
		}
		this.scheduleCommitScopeRefresh();
	}

	private isPathInCommitScope(path: string): boolean {
		const normalizedPath = normalizeVaultPathForCompare(path);
		const mediaRoot = normalizeVaultPathForCompare(normalizeMediaFolder(this.plugin.settings.mediaFolder));
		const pluginRoot = normalizeVaultPathForCompare(getPluginRootPath(this.app, this.plugin.manifest.id));
		const pluginCacheRoot = normalizeVaultPathForCompare(getPluginCacheDirectory(this.app, this.plugin.manifest.id));
		const pluginLogsRoot = normalizeVaultPathForCompare(getPluginLogsDirectory(this.app, this.plugin.manifest.id));
		const workspacePath = normalizeVaultPathForCompare(
			joinVaultRelativePath(this.app.vault.configDir, "workspace.json"),
		);
		if (this.isPathInScope(normalizedPath, pluginCacheRoot) || this.isPathInScope(normalizedPath, pluginLogsRoot)) {
			return false;
		}
		if (normalizedPath === workspacePath) {
			return true;
		}
		return this.isPathInScope(normalizedPath, mediaRoot) || this.isPathInScope(normalizedPath, pluginRoot);
	}

	private isPathInScope(path: string, scopeRoot: string): boolean {
		return path === scopeRoot || path.startsWith(`${scopeRoot}/`);
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
				void this.runTask(async () => {
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
			commitButton.appendChild(createGitCommitIcon());
			const noCommitChanges = this.gitService.commitChangesKnown && !this.gitService.hasCommitEligibleChanges;
			const commitDisabled = this.gitService.isCreatingCommit || noCommitChanges;
			commitButton.setAttr(
				"title",
				noCommitChanges
					? "No scoped changes to commit."
					: "Create and push commit: [update] <datetime>",
			);
			if (commitDisabled) {
				commitButton.disabled = true;
				commitButton.addClass("is-disabled");
			}
			commitButton.addEventListener("click", () => {
				void this.runTask(async () => {
					await this.createGitCommit();
				}, "Failed to create git commit.");
			});
		}
		const addButton = actions.createEl("button", {cls: "media-tracker__button", text: "New entry"});
		addButton.addEventListener("click", () => new NewMediaModal(this.plugin).open());

		const {searchInput, clearButton} = renderTrackerControls(
			contentEl,
			{
				searchQuery: this.searchQuery,
				typeFilter: this.typeFilter,
				statusFilter: this.statusFilter,
				displayMode: this.displayMode,
			},
				{
					onSearchChange: (value) => {
						this.searchQuery = value;
						this.scheduleSearchRender();
					},
					onSearchClear: () => {
						this.searchQuery = "";
						this.cancelSearchRenderTimer();
						this.requestRender();
					},
				onTypeFilterChange: (value) => {
					this.typeFilter = value;
					this.requestRender();
				},
				onStatusFilterChange: (value) => {
					this.statusFilter = value;
					this.requestRender();
				},
				onDisplayModeChange: (value) => {
					this.displayMode = value;
					void this.plugin.updateSettings((settings) => {
						settings.displayMode = this.displayMode;
					});
					this.requestRender();
				},
			},
		);
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
			const normalizedSearchQuery = normalizeTrackerSearchQuery(filterState.searchQuery);
			const filtered: MediaItem[] = [];
			for (const item of items) {
				if (!matchesTrackerFilters(item, filterState)) {
					continue;
				}
				if (!matchesTrackerSearch(item, normalizedSearchQuery)) {
					continue;
				}
				filtered.push(item);
			}
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
				const fragment = document.createDocumentFragment();
				for (const item of sorted) {
					fragment.appendChild(renderTableRow(item, handlers));
				}
				list.appendChild(fragment);
			} else {
				const list = contentEl.createDiv({cls: "media-tracker__list"});
				const fragment = document.createDocumentFragment();
				for (const item of filtered) {
					fragment.appendChild(renderCard(item, handlers));
				}
				list.appendChild(fragment);
			}
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
