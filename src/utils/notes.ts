import {App, Notice} from "obsidian";
import {MediaTrackerSettings} from "../settings";
import {NewMediaDraft} from "../types";
import {collectLinks, extractAnilistId, filterAnilistLinks, filterImdbLinks, getImdbIdFromLinks, normalizeLinks, normalizeStoredLink, setLinks} from "./links";
import {CURRENT_MEDIA_VERSION} from "./migration";
import {updateFrontmatter} from "./frontmatter";

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
	lines.push(`mediaTrackerVersion: ${CURRENT_MEDIA_VERSION}`);
	pushLine(lines, "title", draft.title);
	pushLine(lines, "status", draft.status);
	pushLine(lines, "author", draft.author);
	pushLine(lines, "progress", draft.progress);
	pushLine(lines, "season", draft.season);
	pushLine(lines, "episode", draft.episode);
	pushLine(lines, "year", draft.year);

	const normalizedLinks = normalizeLinks(draft.links ?? []);
	const imdbId = draft.imdbId ?? getImdbIdFromLinks(normalizedLinks);
	pushLine(lines, "imdbId", imdbId);
	const anilistId = draft.anilistId ? extractAnilistId(draft.anilistId) : undefined;
	if (anilistId) {
		pushLine(lines, "anilistId", String(anilistId));
	}
	const storedLinks = filterImdbLinks(filterAnilistLinks(normalizedLinks));

	if (storedLinks.length) {
		lines.push("links:");
		for (const link of storedLinks) {
			lines.push(`  - ${formatYamlString(link)}`);
		}
	}

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
	await updateFrontmatter(app, file, (frontmatter) => {
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
	await updateFrontmatter(app, file, (frontmatter) => {
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

export async function addMediaLink(
	app: App,
	file: import("obsidian").TFile,
	url: string,
) {
	const anilistId = extractAnilistId(url);
	const normalized = normalizeStoredLink(url);
	if (!normalized) {
		return;
	}
	await updateFrontmatter(app, file, (frontmatter) => {
		if (anilistId) {
			frontmatter.anilistId = anilistId;
			return;
		}
		const links = collectLinks(frontmatter);
		if (!links.includes(normalized)) {
			links.push(normalized);
		}
		setLinks(frontmatter, links);
	});
}
