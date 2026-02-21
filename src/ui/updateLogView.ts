import {ItemView, WorkspaceLeaf} from "obsidian";
import type MediaTrackerPlugin from "../main";
import {UpdateLogEntry, UpdateLogRun} from "../types";

export const MEDIA_TRACKER_UPDATE_LOG_VIEW = "media-tracker-update-log-view";

function formatDuration(durationMs: number): string {
	const seconds = Math.round(durationMs / 100) / 10;
	return `${seconds.toFixed(1)}s`;
}

function formatStatus(value: string): string {
	return value.replace("-", " ");
}

function sortEntries(entries: UpdateLogEntry[]): UpdateLogEntry[] {
	const severity = (entry: UpdateLogEntry): number => {
		switch (entry.status) {
			case "failed":
				return 0;
			case "updated":
				return 1;
			case "unchanged":
				return 2;
			case "skipped":
			default:
				return 3;
		}
	};
	return [...entries].sort((a, b) => {
		const diff = severity(a) - severity(b);
		if (diff !== 0) {
			return diff;
		}
		return a.title.localeCompare(b.title);
	});
}

function formatProviderProgress(
	provider: string,
	progress: {completed: number; total: number} | undefined,
): string {
	if (!progress) {
		return `${provider} 0/0`;
	}
	return `${provider} ${progress.completed}/${progress.total}`;
}

export class MediaTrackerUpdateLogView extends ItemView {
	plugin: MediaTrackerPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: MediaTrackerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return MEDIA_TRACKER_UPDATE_LOG_VIEW;
	}

	getDisplayText(): string {
		return "Media update log";
	}

	getIcon(): string {
		return "list";
	}

	async onOpen() {
		this.render();
	}

	render() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass("media-tracker", "media-tracker__update-log");

		const header = contentEl.createDiv({cls: "media-tracker__header"});
		header.createEl("h2", {text: "Media update log"});

		const activeRun = this.plugin.getActiveUpdateRun();
		const persistedRuns = this.plugin.settings.updateLogRuns ?? [];
		const runs = activeRun
			? persistedRuns.filter((run) => run.startedAt !== activeRun.startedAt)
			: persistedRuns;
		if (!activeRun && !runs.length) {
			const empty = contentEl.createDiv({cls: "media-tracker__empty"});
			empty.setText("No update runs recorded yet.");
			return;
		}

		const list = contentEl.createDiv({cls: "media-tracker__update-log-list"});
		if (activeRun) {
			this.renderRun(list, activeRun, true);
		}
		for (const run of runs) {
			this.renderRun(list, run);
		}
	}

	private renderRun(container: HTMLElement, run: UpdateLogRun, inProgress = false) {
		const card = container.createDiv({cls: "media-tracker__update-run"});
		const started = new Date(run.startedAt);
		const titleRow = card.createDiv({cls: "media-tracker__update-run-title"});
		titleRow.createEl("h3", {text: started.toLocaleString()});
		if (inProgress) {
			titleRow.createEl("span", {text: "In progress", cls: "media-tracker__update-run-badge"});
		}
		titleRow.createEl("span", {text: formatDuration(run.durationMs), cls: "media-tracker__update-run-duration"});

		const summary = card.createDiv({cls: "media-tracker__update-run-summary"});
		summary.setText(
			`${run.total} checked · ${run.updated} updated · ${run.unchanged} unchanged · ${run.failed} failed · ${run.skipped} skipped`,
		);
		if (inProgress && run.providerProgress) {
			const providerSummary = card.createDiv({cls: "media-tracker__update-run-provider-summary"});
			providerSummary.setText(
				`${formatProviderProgress("AniList", run.providerProgress.anilist)} · ${formatProviderProgress("TMDB", run.providerProgress.tmdb)}`,
			);
		}

		const entries = inProgress ? run.entries : sortEntries(run.entries);
		if (!entries.length) {
			return;
		}

		const rows = card.createDiv({cls: "media-tracker__update-run-entries"});
		for (const entry of entries) {
			const row = rows.createDiv({cls: `media-tracker__update-entry media-tracker__update-entry--${entry.status}`});
			row.createEl("span", {
				text: formatStatus(entry.status),
				cls: "media-tracker__update-entry-status",
			});
			row.createEl("span", {
				text: `${entry.title} (${entry.provider})`,
				cls: "media-tracker__update-entry-title",
			});
			row.createEl("span", {
				text: entry.message,
				cls: "media-tracker__update-entry-message",
			});
		}
	}
}

export async function openMediaUpdateLog(plugin: MediaTrackerPlugin) {
	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({type: MEDIA_TRACKER_UPDATE_LOG_VIEW, active: true});
	await plugin.app.workspace.revealLeaf(leaf);
}
