import {App, Notice} from "obsidian";
import type MediaTrackerPlugin from "../main";
import type {MediaItem} from "../types";
import {
	addLinkToMediaNote,
	deleteMediaNote,
	normalizeMediaNoteFrontmatter,
	refreshTrackedMediaLatest,
	updateMediaNoteProgress,
	updateMediaNoteStatus,
} from "../flows/media";
import {applyProgressInputToFields, buildProgressDisplay} from "../domain/media/progress";
import {LinkModal} from "./linkModal";
import {showTrackerCardMenu} from "./trackerCardMenu";
import {openInlineProgressEditor} from "./inlineProgressEditor";
import {renderProgressMeta, type RenderHandlers, type SortKey} from "./trackerRenderer";
import type {DisplayMode} from "./trackerFiltering";
import type {TaskLogContext} from "./taskRunner";

type TrackerInteractionDeps = {
	app: App;
	plugin: MediaTrackerPlugin;
	runTask: (task: () => Promise<void>, errorMessage: string, logContext?: TaskLogContext) => Promise<boolean>;
	invalidateItemsCache: () => void;
	render: () => void;
	getDisplayMode: () => DisplayMode;
	getSortKey: () => SortKey;
	getTrackedItems: () => MediaItem[];
	getLinkIconUrl: (value: string) => string | null;
};

export class TrackerInteractionController {
	constructor(private readonly deps: TrackerInteractionDeps) {}

	getRenderHandlers(): RenderHandlers {
		return {
			onOpenNote: (item) => {
				const fullItem = item as MediaItem;
				this.deps.runTask(async () => {
					await this.deps.app.workspace.getLeaf("tab").openFile(fullItem.file);
				}, `Failed to open "${fullItem.title}".`);
			},
			onContextMenu: (event, item) => {
				event.preventDefault();
				this.openCardMenu(event, item as MediaItem);
			},
			onStatusChange: (item, status) => {
				const fullItem = item as MediaItem;
				const previousStatus = fullItem.status;
				this.deps.runTask(async () => {
					await updateMediaNoteStatus(this.deps.app, fullItem.file, status);
				}, `Failed to update status for "${fullItem.title}".`, {
					event: "status_update",
					logStart: true,
					successMessage: `Updated status for "${fullItem.title}".`,
					meta: {
						...this.getItemLogMeta(fullItem),
						fromStatus: previousStatus,
						toStatus: status,
					},
				});
			},
			onProgressEdit: (target, item) => {
				this.openProgressEditor(target, item as MediaItem);
			},
			onProgressAdvance: (target, item, nextValue) => {
				const fullItem = item as MediaItem;
				this.deps.runTask(async () => {
					this.deps.plugin.suppressNextViewRefresh();
					await updateMediaNoteProgress(this.deps.app, fullItem.file, fullItem.type, nextValue);
					const optimistic = this.applyProgressValueToItem(fullItem, nextValue);
					this.refreshProgressControl(target, fullItem.file.path, optimistic);
				}, `Failed to update progress for "${fullItem.title}".`, {
					event: "progress_advance",
					logStart: true,
					successMessage: `Updated progress for "${fullItem.title}".`,
					meta: {
						...this.getItemLogMeta(fullItem),
						previousProgress: fullItem.progress ?? "",
						nextProgress: nextValue,
					},
				});
			},
			onLinkOpen: (url) => {
				window.open(url, "_blank", "noopener");
			},
			getLinkIconUrl: (value) => {
				return this.deps.getLinkIconUrl(value);
			},
		};
	}

	private getItemLogMeta(item: MediaItem): Record<string, unknown> {
		return {
			title: item.title,
			filePath: item.file.path,
			type: item.type,
			status: item.status,
		};
	}

	private openProgressEditor(target: HTMLElement, item: MediaItem) {
		openInlineProgressEditor({
			target,
			value: item.progress ?? "",
			onCommit: (nextProgress, input) => {
				this.deps.runTask(async () => {
					this.deps.plugin.suppressNextViewRefresh();
					await updateMediaNoteProgress(this.deps.app, item.file, item.type, nextProgress);
					const optimistic = this.applyProgressValueToItem(item, nextProgress);
					this.refreshProgressControl(input, item.file.path, optimistic);
				}, `Failed to update progress for "${item.title}".`, {
					event: "progress_edit",
					logStart: true,
					successMessage: `Updated progress for "${item.title}".`,
					meta: {
						...this.getItemLogMeta(item),
						previousProgress: item.progress ?? "",
						nextProgress,
					},
				});
			},
		});
	}

	private refreshProgressControl(target: HTMLElement, filePath: string, optimistic?: MediaItem) {
		if (this.deps.getDisplayMode() === "details" && this.deps.getSortKey() === "progress") {
			this.deps.render();
			return;
		}
		const container = target.closest(".media-tracker__progress");
		if (!container) {
			this.deps.render();
			return;
		}
		const latest = optimistic ?? this.deps.getTrackedItems()
			.find((candidate) => candidate.file.path === filePath);
		if (!latest) {
			this.deps.render();
			return;
		}
		const compact = container.classList.contains("media-tracker__progress--compact");
		const replacement = renderProgressMeta(latest, this.getRenderHandlers(), compact);
		container.replaceWith(replacement);
	}

	private applyProgressValueToItem(item: MediaItem, value: string): MediaItem {
		const applied = applyProgressInputToFields(item.type, value, {
			progress: item.progressRaw,
			progressLabel: item.progressLabel,
			progressUnit: "ch",
			season: item.season,
			episode: item.episode,
			year: item.year,
		});
		if (!applied.accepted) {
			return item;
		}
		const nextProgress = buildProgressDisplay(item.type, {
			progress: applied.next.progress,
			progressLabel: applied.next.progressLabel,
			progressUnit: applied.next.progressUnit,
			season: applied.next.season,
			episode: applied.next.episode,
			year: applied.next.year,
		});
		return {
			...item,
			progress: nextProgress,
			progressRaw: applied.next.progress,
			progressLabel: applied.next.progressLabel,
			season: applied.next.season,
			episode: applied.next.episode,
		};
	}

	private openCardMenu(event: MouseEvent, item: MediaItem) {
		showTrackerCardMenu(event, item, {
			onOpenNote: () => {
				void this.deps.app.workspace.getLeaf("tab").openFile(item.file);
			},
			onRefreshLatest: () => {
				this.deps.runTask(async () => {
					const result = await refreshTrackedMediaLatest(this.deps.app, this.deps.plugin.settings, item);
					const meta = {
						...this.getItemLogMeta(item),
						provider: result.provider,
						status: result.status,
					};
					if (result.status === "failed") {
						this.deps.plugin.logger.warn("refresh", "single_result", `${item.title}: ${result.message}`, meta);
					} else {
						this.deps.plugin.logger.info("refresh", "single_result", `${item.title}: ${result.message}`, meta);
					}
					new Notice(`${item.title}: ${result.message}`, result.status === "failed" ? 10000 : 4000);
					this.deps.invalidateItemsCache();
					this.deps.render();
				}, `Failed to refresh latest updates for "${item.title}".`, {
					scope: "refresh",
					event: "single_refresh",
					logStart: true,
					logSuccess: false,
					startMessage: `Refreshing latest data for "${item.title}".`,
					meta: this.getItemLogMeta(item),
				});
			},
			onAddLink: () => {
				new LinkModal(this.deps.app, {
					title: "Add link",
					onSubmit: (url) => {
						this.deps.runTask(async () => {
							await addLinkToMediaNote(this.deps.app, item.file, url);
						}, `Failed to add link for "${item.title}".`, {
							event: "add_link",
							logStart: true,
							successMessage: `Added link for "${item.title}".`,
							meta: {
								...this.getItemLogMeta(item),
								url,
							},
						});
					},
				}).open();
			},
			onCleanNote: () => {
				this.deps.runTask(async () => {
					await normalizeMediaNoteFrontmatter(this.deps.app, item.file);
					this.deps.invalidateItemsCache();
					this.deps.render();
				}, `Failed to clean "${item.title}".`, {
					event: "clean_note",
					logStart: true,
					successMessage: `Cleaned "${item.title}".`,
					meta: this.getItemLogMeta(item),
				});
			},
			onDeleteNote: () => {
				const confirmed = window.confirm(`Delete "${item.title}"?`);
				if (!confirmed) {
					return;
				}
				this.deps.runTask(async () => {
					await deleteMediaNote(this.deps.app, item.file);
				}, `Failed to delete "${item.title}".`, {
					event: "delete_note",
					logStart: true,
					successMessage: `Deleted "${item.title}".`,
					meta: this.getItemLogMeta(item),
				});
			},
		});
	}
}
