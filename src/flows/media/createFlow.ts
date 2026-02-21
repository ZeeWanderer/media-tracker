import {App, Notice, TFolder} from "obsidian";
import {MediaTrackerSettings} from "../../settings";
import {MediaItem, MediaType, NewMediaDraft} from "../../types";
import {ANILIST_TYPES, IMDB_TYPES} from "../../domain/media/config";
import {buildMediaFrontmatter, sanitizeMediaFileName, sanitizeNewMediaDraft} from "../../domain/media/draft";
import {extractAnilistId, extractImdbId, getAnilistIdFromLinks, getImdbIdFromLinks} from "../../domain/media/links";
import {listTrackedMedia} from "./queryFlow";

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

function resolveCreationPaths(
	app: App,
	baseFolder: string,
	safeTitle: string,
	type: MediaType,
): {workFolder: string; filePath: string; disambiguated: boolean; fileName: string} {
	let folderAttempt = 1;
	while (folderAttempt <= 1000) {
		const folderName = folderAttempt === 1 ? safeTitle : `${safeTitle} (${folderAttempt})`;
		const workFolder = `${baseFolder}/${folderName}`;
		const existing = app.vault.getAbstractFileByPath(workFolder);
		if (existing && !(existing instanceof TFolder)) {
			folderAttempt += 1;
			continue;
		}

		let fileAttempt = 1;
		while (fileAttempt <= 1000) {
			const fileName = fileAttempt === 1 ? `${type}.md` : `${type}-${fileAttempt}.md`;
			const filePath = `${workFolder}/${fileName}`;
			if (!app.vault.getAbstractFileByPath(filePath)) {
				return {
					workFolder,
					filePath,
					disambiguated: fileAttempt > 1 || folderAttempt > 1,
					fileName,
				};
			}
			fileAttempt += 1;
		}
		folderAttempt += 1;
	}
	throw new Error(`Unable to find an available note path for "${safeTitle}" (${type}).`);
}

function resolveDraftImdbId(draft: NewMediaDraft): string | undefined {
	const fromField = draft.imdbId ? (extractImdbId(draft.imdbId) ?? draft.imdbId.trim().toLowerCase()) : undefined;
	if (fromField && fromField.length) {
		return fromField;
	}
	const fromLinks = getImdbIdFromLinks(draft.links ?? []);
	return fromLinks ?? undefined;
}

function resolveDraftAnilistId(draft: NewMediaDraft): number | undefined {
	const fromField = draft.anilistId ? extractAnilistId(draft.anilistId) : null;
	if (fromField && Number.isFinite(fromField)) {
		return fromField;
	}
	const fromLinks = getAnilistIdFromLinks(draft.links ?? []);
	return fromLinks ?? undefined;
}

function findConflictingIdItem(
	items: MediaItem[],
	imdbId: string | undefined,
	anilistId: number | undefined,
): {kind: "imdb" | "anilist"; value: string; item: MediaItem} | null {
	if (imdbId) {
		const imdbConflict = items.find((item) => item.imdbId?.toLowerCase() === imdbId.toLowerCase());
		if (imdbConflict) {
			return {kind: "imdb", value: imdbId, item: imdbConflict};
		}
	}
	if (anilistId !== undefined) {
		const anilistConflict = items.find((item) => {
			if (item.anilistId === anilistId) {
				return true;
			}
			if (Array.isArray(item.anilistIds) && item.anilistIds.includes(anilistId)) {
				return true;
			}
			return false;
		});
		if (anilistConflict) {
			return {kind: "anilist", value: String(anilistId), item: anilistConflict};
		}
	}
	return null;
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
	const existingItems = listTrackedMedia(app, settings);

	const draftImdbId = resolveDraftImdbId(normalizedDraft);
	const draftAnilistId = resolveDraftAnilistId(normalizedDraft);
	const idConflict = findConflictingIdItem(existingItems, draftImdbId, draftAnilistId);
	if (idConflict) {
		const idLabel = idConflict.kind === "imdb" ? "IMDb ID" : "AniList ID";
		new Notice(`${idLabel} ${idConflict.value} already exists in "${idConflict.item.title}" (${idConflict.item.file.path}).`);
		return false;
	}

	const safeName = sanitizeMediaFileName(normalizedDraft.title);
	if (!safeName.length) {
		new Notice("Please enter a title.");
		return false;
	}

	const {workFolder, filePath, disambiguated, fileName} = resolveCreationPaths(app, baseFolder, safeName, normalizedDraft.type);

	await ensureFolder(app, workFolder);

	const content = buildMediaFrontmatter(normalizedDraft);
	const file = await app.vault.create(filePath, content);
	if (disambiguated) {
		new Notice(`Created as "${workFolder}/${fileName}" because this title/type already existed.`);
	}
	const leaf = app.workspace.getLeaf("tab");
	await leaf.openFile(file);
	return true;
}
