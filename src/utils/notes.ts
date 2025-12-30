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

export async function setNovelProgress(app: App, file: import("obsidian").TFile, value: string) {
	const trimmed = value.trim();
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter) {
			return;
		}
		if (!trimmed.length) {
			delete frontmatter.progress;
			delete frontmatter.progressLabel;
			delete frontmatter.progressUnit;
			return;
		}

		const chapterMatch = trimmed.match(/^(?:ch|chapter)\s+(.+)$/i);
		const chapterValue = chapterMatch?.[1]?.trim();
		const numeric = chapterValue ?? trimmed;
		if (/^\d+(?:\.\d+)?$/.test(numeric)) {
			frontmatter.progress = numeric;
			frontmatter.progressUnit = "ch";
			delete frontmatter.progressLabel;
			return;
		}

		frontmatter.progressLabel = trimmed;
	});
}

export async function setSeriesProgress(app: App, file: import("obsidian").TFile, value: string) {
	const trimmed = value.trim();
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter) {
			return;
		}
		if (!trimmed.length) {
			delete frontmatter.season;
			delete frontmatter.episode;
			return;
		}

		const seMatch = trimmed.match(/S\s*(\d+)\s*E\s*(\d+)/i);
		const altMatch = trimmed.match(/(\d+)\s*x\s*(\d+)/i);
		const match = seMatch ?? altMatch;
		if (!match || !match[1] || !match[2]) {
			return;
		}
		frontmatter.season = Number.parseInt(match[1], 10);
		frontmatter.episode = Number.parseInt(match[2], 10);
	});
}

export async function setMediaLink(
	app: App,
	file: import("obsidian").TFile,
	key: "patreon" | "kemono" | "royalroad" | "imdb" | "hdrezka",
	url: string,
) {
	const trimmed = url.trim();
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter) {
			return;
		}
		if (!trimmed.length) {
			delete frontmatter[key];
			return;
		}
		frontmatter[key] = trimmed;
	});
}

export async function setCustomLink(
	app: App,
	file: import("obsidian").TFile,
	label: string,
	url: string,
) {
	const trimmedLabel = label.trim();
	const trimmedUrl = url.trim();
	if (!trimmedLabel.length) {
		return;
	}
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter) {
			return;
		}
		const links = frontmatter.links;
		if (!trimmedUrl.length) {
			if (links && typeof links === "object" && !Array.isArray(links)) {
				delete (links as Record<string, unknown>)[trimmedLabel];
			}
			return;
		}
		if (!links || typeof links !== "object" || Array.isArray(links)) {
			frontmatter.links = {};
		}
		(frontmatter.links as Record<string, unknown>)[trimmedLabel] = trimmedUrl;
	});
}
