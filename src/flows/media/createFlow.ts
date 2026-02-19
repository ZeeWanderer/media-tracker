import {App, Notice} from "obsidian";
import {MediaTrackerSettings} from "../../settings";
import {MediaType, NewMediaDraft} from "../../types";
import {ANILIST_TYPES, IMDB_TYPES} from "../../domain/media/config";
import {buildMediaFrontmatter, sanitizeMediaFileName, sanitizeNewMediaDraft} from "../../domain/media/draft";

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

export function sanitizeMediaDraft(draft: NewMediaDraft): NewMediaDraft {
	return sanitizeNewMediaDraft(draft);
}

export function updateMediaDraftType(draft: NewMediaDraft, nextType: MediaType): NewMediaDraft {
	return sanitizeNewMediaDraft({
		...draft,
		type: nextType,
		imdbId: IMDB_TYPES.has(nextType) ? draft.imdbId : undefined,
		anilistId: ANILIST_TYPES.has(nextType) ? draft.anilistId : undefined,
	});
}

export async function createMediaNoteFromDraft(
	app: App,
	settings: MediaTrackerSettings,
	draft: NewMediaDraft,
): Promise<boolean> {
	const normalizedDraft = sanitizeNewMediaDraft(draft);
	const baseFolder = settings.mediaFolder.trim() || "Media";
	await ensureFolder(app, baseFolder);

	const safeName = sanitizeMediaFileName(normalizedDraft.title);
	if (!safeName.length) {
		new Notice("Please enter a title.");
		return false;
	}

	const filePath = `${baseFolder}/${safeName}.md`;
	if (app.vault.getAbstractFileByPath(filePath)) {
		new Notice("A note with this title already exists.");
		return false;
	}

	const content = buildMediaFrontmatter(normalizedDraft);
	const file = await app.vault.create(filePath, content);
	const leaf = app.workspace.getLeaf("tab");
	await leaf.openFile(file);
	return true;
}
