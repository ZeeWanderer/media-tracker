import {ItemView, Notice, WorkspaceLeaf} from "obsidian";
import type MediaTrackerPlugin from "../main";
import type {PluginLogEntry} from "../infra/logging/pluginLogger";
import {MEDIA_TRACKER_PLUGIN_LOG_VIEW} from "./viewIds";

export {MEDIA_TRACKER_PLUGIN_LOG_VIEW};

function formatTimestamp(value: number): string {
	return new Date(value).toLocaleString();
}

function formatMeta(meta: Record<string, unknown> | undefined): string {
	if (!meta) {
		return "";
	}
	try {
		return JSON.stringify(meta);
	} catch {
		return "[meta]";
	}
}

function levelRank(level: PluginLogEntry["level"]): number {
	switch (level) {
		case "error":
			return 0;
		case "warn":
			return 1;
		case "info":
			return 2;
		case "debug":
		default:
			return 3;
	}
}

function sortEntries(entries: PluginLogEntry[]): PluginLogEntry[] {
	return [...entries].sort((a, b) => {
		const timeDiff = b.timestamp - a.timestamp;
		if (timeDiff !== 0) {
			return timeDiff;
		}
		return levelRank(a.level) - levelRank(b.level);
	});
}

export class MediaTrackerPluginLogView extends ItemView {
	plugin: MediaTrackerPlugin;
	private loadCounter = 0;

	constructor(leaf: WorkspaceLeaf, plugin: MediaTrackerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return MEDIA_TRACKER_PLUGIN_LOG_VIEW;
	}

	getDisplayText(): string {
		return "Media plugin log";
	}

	getIcon(): string {
		return "terminal-square";
	}

	async onOpen() {
		this.render();
	}

	render() {
		const token = ++this.loadCounter;
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass("media-tracker", "media-tracker__plugin-log");

		const header = contentEl.createDiv({cls: "media-tracker__header"});
		header.createEl("h2", {text: "Media plugin log"});
		const actions = header.createDiv({cls: "media-tracker__actions"});

		const refreshButton = actions.createEl("button", {cls: "media-tracker__button", text: "Refresh"});
		refreshButton.addEventListener("click", () => this.render());

		const clearButton = actions.createEl("button", {cls: "media-tracker__button", text: "Clear logs"});
		clearButton.addEventListener("click", () => {
			void this.clearLogs();
		});

		const body = contentEl.createDiv({cls: "media-tracker__plugin-log-list"});
		body.setText("Loading logs...");
		void this.renderEntries(body, token);
	}

	private async clearLogs() {
		const confirmed = window.confirm("Delete all plugin log files?");
		if (!confirmed) {
			return;
		}
		await this.plugin.logger.clearLogs();
		new Notice("Plugin logs cleared.");
		this.render();
	}

	private async renderEntries(container: HTMLElement, token: number) {
		const entries = await this.plugin.logger.readRecentEntries(500);
		if (token !== this.loadCounter) {
			return;
		}

		container.empty();
		if (!entries.length) {
			const empty = container.createDiv({cls: "media-tracker__empty"});
			empty.setText("No plugin logs available.");
			return;
		}

		const list = container.createDiv({cls: "media-tracker__plugin-log-rows"});
		const sorted = sortEntries(entries);
		for (const entry of sorted) {
			const row = list.createDiv({cls: `media-tracker__plugin-log-entry media-tracker__plugin-log-entry--${entry.level}`});
			row.createEl("span", {text: formatTimestamp(entry.timestamp), cls: "media-tracker__plugin-log-time"});
			row.createEl("span", {text: entry.level, cls: "media-tracker__plugin-log-level"});
			row.createEl("span", {text: `${entry.scope}.${entry.event}`, cls: "media-tracker__plugin-log-source"});
			row.createEl("span", {text: entry.message, cls: "media-tracker__plugin-log-message"});
			const metaText = formatMeta(entry.meta);
			if (metaText.length) {
				row.createEl("code", {text: metaText, cls: "media-tracker__plugin-log-meta"});
			}
		}
	}
}

export async function openPluginLog(plugin: MediaTrackerPlugin) {
	const leaf = plugin.app.workspace.getLeaf("tab");
	await leaf.setViewState({type: MEDIA_TRACKER_PLUGIN_LOG_VIEW, active: true});
	await plugin.app.workspace.revealLeaf(leaf);
}
