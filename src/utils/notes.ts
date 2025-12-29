import {App, Notice} from "obsidian";
import {MediaTrackerSettings} from "../settings";
import {NewMediaDraft} from "../types";

function sanitizeFileName(name: string): string {
	return name
		.replace(/[\\/#%&{}<>*? $!'":@+`|=]/g, "-")
		.replace(/\s+/g, " ")
		.trim();
}

function formatYamlString(value: string): string {
	const trimmed = value.trim();
	if (!trimmed.length) {
		return "";
	}
	if (/[:#\n]/.test(trimmed)) {
		return JSON.stringify(trimmed);
	}
	return trimmed;
}

function pushLine(lines: string[], key: string, value: string | undefined) {
	if (!value) {
		return;
	}
	const formatted = formatYamlString(value);
	if (!formatted.length) {
		return;
	}
	lines.push(`${key}: ${formatted}`);
}

export function buildFrontmatter(draft: NewMediaDraft): string {
	const lines: string[] = [];
	lines.push("---");
	lines.push(`type: ${draft.type}`);
	pushLine(lines, "title", draft.title);
	pushLine(lines, "status", draft.status);
	pushLine(lines, "author", draft.author);
	pushLine(lines, "progress", draft.progress);
	pushLine(lines, "season", draft.season);
	pushLine(lines, "episode", draft.episode);
	pushLine(lines, "year", draft.year);
	pushLine(lines, "patreon", draft.patreon);
	pushLine(lines, "kemono", draft.kemono);
	pushLine(lines, "royalroad", draft.royalroad);
	pushLine(lines, "imdb", draft.imdb);
	lines.push("---");
	lines.push("");
	return lines.join("\n");
}

async function ensureFolder(app: App, folder: string) {
	const segments = folder.split("/").filter((segment) => segment.length);
	let current = "";
	for (const segment of segments) {
		current = current ? `${current}/${segment}` : segment;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current);
		}
	}
}

export async function createMediaNote(app: App, settings: MediaTrackerSettings, draft: NewMediaDraft) {
	const baseFolder = settings.mediaFolder.trim() || "Media";
	await ensureFolder(app, baseFolder);

	const safeName = sanitizeFileName(draft.title);
	if (!safeName.length) {
		new Notice("Please enter a title.");
		return;
	}

	const filePath = `${baseFolder}/${safeName}.md`;
	if (app.vault.getAbstractFileByPath(filePath)) {
		new Notice("A note with this title already exists.");
		return;
	}

	const content = buildFrontmatter(draft);
	const file = await app.vault.create(filePath, content);
	const leaf = app.workspace.getLeaf("tab");
	await leaf.openFile(file);
}
