import {Notice, type App, type TFile} from "obsidian";
import {
	addLinkToMediaNote,
	deleteMediaNote,
	normalizeMediaNoteFrontmatter,
	refreshTrackedMediaLatest,
	startMediaNoteRepeat,
	stopMediaNoteRepeat,
	updateMediaNoteProgress,
	updateMediaNoteRepeatProgress,
	updateMediaNoteStatus,
} from "../flows/media";
import {LinkModal} from "./linkModal";
import {showTrackerCardMenu} from "./trackerCardMenu";
import {openInlineProgressEditor} from "./inlineProgressEditor";
import type {RenderHandlers} from "./trackerRenderTypes";
import type {TaskLogContext} from "./taskRunner";
import type {MediaTrackerSettings} from "../core/pluginSettingsModel";
import type {LibraryRefreshCoordinator} from "../core/libraryRefreshOrchestrator";
import type {PluginLogger} from "../infra/logging/pluginLogger";
import type {MediaItem} from "../domain/media/models";
import type {MediaStatus} from "../domain/media/config";

type VaultMediaItem = MediaItem<TFile>;

type TrackerInteractionDeps = {
	app: App;
	getSettings: () => MediaTrackerSettings;
	refreshCoordinator: LibraryRefreshCoordinator;
	logger: PluginLogger;
	runTask: (task: () => Promise<void>, errorMessage: string, logContext?: TaskLogContext) => Promise<boolean>;
	invalidateItemsCache: () => void;
	render: () => void;
	getLinkIconUrl: (value: string) => string | null;
};

export class TrackerInteractionController implements RenderHandlers<VaultMediaItem> {
	constructor(private readonly deps: TrackerInteractionDeps) {}

	onOpenNote(item: VaultMediaItem) {
		void this.deps.runTask(async () => {
			await this.deps.app.workspace.getLeaf("tab").openFile(item.file);
		}, `Failed to open "${item.title}".`);
	}

	onCopyTitle(item: VaultMediaItem) {
		void this.copyItemTitle(item);
	}

	onContextMenu(event: MouseEvent, item: VaultMediaItem) {
		event.preventDefault();
		this.openCardMenu(event, item);
	}

	onStatusChange(item: VaultMediaItem, status: MediaStatus) {
		const previousStatus = item.status;
		void this.deps.runTask(async () => {
			await updateMediaNoteStatus(this.deps.app, item.file, status);
			this.refreshAfterMutation();
		}, `Failed to update status for "${item.title}".`, {
			event: "status_update",
			logStart: true,
			successMessage: `Updated status for "${item.title}".`,
			meta: {
				...this.getItemLogMeta(item),
				fromStatus: previousStatus,
				toStatus: status,
			},
		});
	}

	onProgressEdit(target: HTMLElement, item: VaultMediaItem) {
		this.openProgressEditor(target, item);
	}

	onProgressAdvance(_target: HTMLElement, item: VaultMediaItem, nextValue: string) {
		void this.deps.runTask(async () => {
			await updateMediaNoteProgress(this.deps.app, item.file, item.type, nextValue);
			this.refreshAfterMutation();
		}, `Failed to update progress for "${item.title}".`, {
			event: "progress_advance",
			logStart: true,
			successMessage: `Updated progress for "${item.title}".`,
			meta: {
				...this.getItemLogMeta(item),
				previousProgress: item.progress ?? "",
				nextProgress: nextValue,
			},
		});
	}

	onRepeatProgressEdit(target: HTMLElement, item: VaultMediaItem) {
		this.openRepeatProgressEditor(target, item);
	}

	onRepeatProgressAdvance(_target: HTMLElement, item: VaultMediaItem, nextValue: string) {
		void this.deps.runTask(async () => {
			await this.applyRepeatProgressValue(item, nextValue);
		}, `Failed to update repeat progress for "${item.title}".`, {
			event: "repeat_progress_advance",
			logStart: true,
			successMessage: `Updated repeat progress for "${item.title}".`,
			meta: {
				...this.getItemLogMeta(item),
				previousProgress: item.repeatProgress ?? "",
				nextProgress: nextValue,
			},
		});
	}

	onLinkOpen(url: string) {
		window.open(url, "_blank", "noopener");
	}

	getLinkIconUrl(value: string): string | null {
		return this.deps.getLinkIconUrl(value);
	}

	private async copyItemTitle(item: VaultMediaItem) {
		const copied = await this.copyText(item.title);
		new Notice(copied ? `Copied "${item.title}".` : `Failed to copy "${item.title}".`);
	}

	private getItemLogMeta(item: VaultMediaItem): Record<string, unknown> {
		return {
			title: item.title,
			filePath: item.file.path,
			type: item.type,
			status: item.status,
		};
	}

	private async copyText(value: string): Promise<boolean> {
		if (!navigator.clipboard?.writeText) {
			return false;
		}
		try {
			await navigator.clipboard.writeText(value);
			return true;
		} catch {
			return false;
		}
	}

	private openProgressEditor(target: HTMLElement, item: VaultMediaItem) {
		openInlineProgressEditor({
			target,
			value: item.progress ?? "",
			onCommit: (nextProgress) => {
				void this.deps.runTask(async () => {
					await updateMediaNoteProgress(this.deps.app, item.file, item.type, nextProgress);
					this.refreshAfterMutation();
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

	private openRepeatProgressEditor(target: HTMLElement, item: VaultMediaItem) {
		openInlineProgressEditor({
			target,
			value: item.repeatProgress ?? "",
			onCommit: (nextProgress) => {
				void this.deps.runTask(async () => {
					await this.applyRepeatProgressValue(item, nextProgress);
				}, `Failed to update repeat progress for "${item.title}".`, {
					event: "repeat_progress_edit",
					logStart: true,
					successMessage: `Updated repeat progress for "${item.title}".`,
					meta: {
						...this.getItemLogMeta(item),
						previousProgress: item.repeatProgress ?? "",
						nextProgress,
					},
				});
			},
		});
	}

	private async applyRepeatProgressValue(item: VaultMediaItem, value: string) {
		const result = await updateMediaNoteRepeatProgress(this.deps.app, item.file, item.type, value);
		if (result === "rejected") {
			throw new Error(`Invalid repeat progress: ${value}`);
		}
		if (result === "caught-up") {
			new Notice(`Repeat caught up for "${item.title}".`);
		}
		this.refreshAfterMutation();
	}

	private refreshAfterMutation() {
		this.deps.invalidateItemsCache();
		this.deps.render();
	}

	private openCardMenu(event: MouseEvent, item: VaultMediaItem) {
		showTrackerCardMenu(event, item, {
			onOpenNote: () => {
				void this.deps.app.workspace.getLeaf("tab").openFile(item.file);
			},
			onStartRepeat: () => {
				void this.deps.runTask(async () => {
					const started = await startMediaNoteRepeat(this.deps.app, item.file, item.type);
					if (!started) {
						throw new Error("Item has no repeatable progress.");
					}
					this.refreshAfterMutation();
				}, `Failed to start repeating "${item.title}".`, {
					event: "repeat_start",
					logStart: true,
					successMessage: `Started repeating "${item.title}".`,
					meta: this.getItemLogMeta(item),
				});
			},
			onStopRepeat: () => {
				void this.deps.runTask(async () => {
					await stopMediaNoteRepeat(this.deps.app, item.file);
					this.refreshAfterMutation();
				}, `Failed to stop repeating "${item.title}".`, {
					event: "repeat_stop",
					logStart: true,
					successMessage: `Stopped repeating "${item.title}".`,
					meta: this.getItemLogMeta(item),
				});
			},
			onRefreshLatest: () => {
				void this.deps.runTask(async () => {
					const execution = await this.deps.refreshCoordinator.runExclusive(() => refreshTrackedMediaLatest(
						this.deps.app,
						this.deps.getSettings(),
						item,
						this.deps.logger,
					));
					if (execution.status === "busy") {
						new Notice("A media refresh is already running.");
						return;
					}
					const result = execution.value;
					const meta = {
						...this.getItemLogMeta(item),
						provider: result.provider,
						status: result.status,
					};
					if (result.status === "failed") {
						this.deps.logger.warn("refresh", "single_result", `${item.title}: ${result.message}`, meta);
					} else {
						this.deps.logger.info("refresh", "single_result", `${item.title}: ${result.message}`, meta);
					}
					new Notice(`${item.title}: ${result.message}`, result.status === "failed" ? 10000 : 4000);
					this.refreshAfterMutation();
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
						void this.deps.runTask(async () => {
							await addLinkToMediaNote(this.deps.app, item.file, url);
							this.refreshAfterMutation();
						}, `Failed to add link for "${item.title}".`, {
							event: "add_link",
							logStart: true,
							successMessage: `Added link for "${item.title}".`,
							meta: {...this.getItemLogMeta(item), url},
						});
					},
				}).open();
			},
			onCleanNote: () => {
				void this.deps.runTask(async () => {
					await normalizeMediaNoteFrontmatter(this.deps.app, item.file);
					this.refreshAfterMutation();
				}, `Failed to clean "${item.title}".`, {
					event: "clean_note",
					logStart: true,
					successMessage: `Cleaned "${item.title}".`,
					meta: this.getItemLogMeta(item),
				});
			},
			onDeleteNote: () => {
				if (!window.confirm(`Delete "${item.title}"?`)) {
					return;
				}
				void this.deps.runTask(async () => {
					await deleteMediaNote(this.deps.app, item.file, this.deps.getSettings().mediaFolder);
					this.refreshAfterMutation();
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
