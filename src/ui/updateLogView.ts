import {App, ItemView, WorkspaceLeaf} from "obsidian";
import {MEDIA_TRACKER_UPDATE_LOG_VIEW} from "./viewIds";
import type {MediaTrackerSettings} from "../core/pluginSettingsModel";
import type {UpdateLogEntry, UpdateLogRun} from "../core/updateTypes";

type UpdateLogViewDeps = {
	app: App;
	settings: MediaTrackerSettings;
	getActiveUpdateRun: () => UpdateLogRun | null;
};

type OpenUpdateLogDeps = {
	app: App;
};

export {MEDIA_TRACKER_UPDATE_LOG_VIEW};

function formatDuration(durationMs: number): string {
	const seconds = Math.round(durationMs / 100) / 10;
	return `${seconds.toFixed(1)}s`;
}

function formatStatus(value: string): string {
	return value.replace("-", " ");
}

function formatProvider(value: string): string {
	if (value === "anilist") {
		return "AniList";
	}
	if (value === "tmdb") {
		return "TMDB";
	}
	return value;
}

function sortEntriesByMostRecent(entries: UpdateLogEntry[]): UpdateLogEntry[] {
	return [...entries].reverse();
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

function resolveRunState(run: UpdateLogRun, inProgress: boolean): "in-progress" | "interrupted" | "completed" {
	if (inProgress) {
		return "in-progress";
	}
	if (run.state === "interrupted") {
		return "interrupted";
	}
	return "completed";
}

function formatAttemptSummary(entry: UpdateLogEntry): string | null {
	if (!entry.attempts || entry.attempts.length <= 1) {
		return null;
	}
	return entry.attempts
		.map((attempt) => `${formatProvider(attempt.provider)} ${formatStatus(attempt.status)}: ${attempt.message}`)
		.join(" | ");
}

export class MediaTrackerUpdateLogView extends ItemView {
	plugin: UpdateLogViewDeps;

	constructor(leaf: WorkspaceLeaf, plugin: UpdateLogViewDeps) {
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
		const runState = resolveRunState(run, inProgress);
		const titleRow = card.createDiv({cls: "media-tracker__update-run-title"});
		titleRow.createEl("h3", {text: started.toLocaleString()});
		if (runState === "in-progress") {
			titleRow.createEl("span", {
				text: "In progress",
				cls: "media-tracker__update-run-badge media-tracker__update-run-badge--in-progress",
			});
		} else if (runState === "interrupted") {
			titleRow.createEl("span", {
				text: "Interrupted",
				cls: "media-tracker__update-run-badge media-tracker__update-run-badge--interrupted",
			});
		}
		titleRow.createEl("span", {text: formatDuration(run.durationMs), cls: "media-tracker__update-run-duration"});

		const summary = card.createDiv({cls: "media-tracker__update-run-summary"});
		summary.setText(
			`${run.total} checked · ${run.updated} updated · ${run.unchanged} unchanged · ${run.failed} failed · ${run.skipped} skipped`,
		);
		if (runState !== "completed" && run.providerProgress) {
			const providerSummary = card.createDiv({cls: "media-tracker__update-run-provider-summary"});
			providerSummary.setText(
				`${formatProviderProgress("AniList", run.providerProgress.anilist)} · ${formatProviderProgress("TMDB", run.providerProgress.tmdb)}`,
			);
		}

		const entries = sortEntriesByMostRecent(run.entries);
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
			const message = row.createDiv({cls: "media-tracker__update-entry-message-wrap"});
			message.createEl("span", {
				text: entry.message,
				cls: "media-tracker__update-entry-message",
			});
			const attemptsSummary = formatAttemptSummary(entry);
			if (attemptsSummary) {
				message.createEl("span", {
					text: attemptsSummary,
					cls: "media-tracker__update-entry-attempts",
				});
			}
		}
	}
}

export async function openMediaUpdateLog(plugin: OpenUpdateLogDeps) {
	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({type: MEDIA_TRACKER_UPDATE_LOG_VIEW, active: true});
	await plugin.app.workspace.revealLeaf(leaf);
}
