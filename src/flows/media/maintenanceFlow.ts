import {App, TFile, TFolder} from "obsidian";
import {cleanMediaFrontmatter, normalizeMediaFilesFrontmatter, updateMediaFrontmatter, updateMediaSnapshot} from "../../domain/media";
import {collectLinks, extractAnilistId, normalizeStoredLink, setLinks} from "../../domain/media/links";
import {
	applyProgressInputToFields,
	applyProgressInputToRepeatFields,
	buildProgressDisplay,
	hasRepeatProgress,
	isRepeatProgressCaughtUp,
	type RepeatProgressFields,
} from "../../domain/media/progress";
import {normalizeVaultFolderOrDefault} from "../../pathUtils";
import {NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES, type MediaStatus, type MediaType} from "../../domain/media/config";
import type {LatestMediaSnapshot} from "../../domain/media/schema";

export async function updateMediaNoteStatus(app: App, file: TFile, status: MediaStatus): Promise<void> {
	await updateMediaSnapshot(app, file, (snapshot) => {
		snapshot.status = status;
	});
}

export async function updateMediaNoteProgress(
	app: App,
	file: TFile,
	type: MediaType,
	value: string,
): Promise<void> {
	await updateMediaSnapshot(app, file, (snapshot) => {
		const applied = applyProgressInputToFields(type, value, {
			progress: snapshot.progress,
			progressLabel: snapshot.progressLabel,
			progressUnit: snapshot.progressUnit,
			season: snapshot.season,
			episode: snapshot.episode,
			year: snapshot.year,
		});
		if (!applied.accepted) {
			return;
		}
		snapshot.progress = applied.next.progress;
		snapshot.progressLabel = applied.next.progressLabel;
		snapshot.progressUnit = applied.next.progressUnit;
		snapshot.season = applied.next.season;
		snapshot.episode = applied.next.episode;
	});
}

export type RepeatProgressUpdateResult = "updated" | "caught-up" | "rejected";

function assignRepeatProgress(snapshot: LatestMediaSnapshot, progress: RepeatProgressFields) {
	snapshot.repeatProgress = progress.repeatProgress;
	snapshot.repeatProgressLabel = progress.repeatProgressLabel;
	snapshot.repeatProgressUnit = progress.repeatProgressUnit;
	snapshot.repeatSeason = progress.repeatSeason;
	snapshot.repeatEpisode = progress.repeatEpisode;
}

function clearRepeatProgress(snapshot: LatestMediaSnapshot) {
	assignRepeatProgress(snapshot, {});
}

export async function startMediaNoteRepeat(
	app: App,
	file: TFile,
	type: MediaType,
): Promise<boolean> {
	let started = false;
	await updateMediaSnapshot(app, file, (snapshot) => {
		if (hasRepeatProgress(snapshot) || !buildProgressDisplay(type, snapshot)) {
			return;
		}
		if (SEASON_EPISODE_TYPES.has(type)) {
			snapshot.repeatSeason = 1;
			snapshot.repeatEpisode = 0;
			started = true;
			return;
		}
		if (NOVEL_PROGRESS_TYPES.has(type)) {
			snapshot.repeatProgress = "0";
			snapshot.repeatProgressUnit = snapshot.progressUnit ?? "ch";
			started = true;
		}
	});
	return started;
}

export async function stopMediaNoteRepeat(app: App, file: TFile): Promise<void> {
	await updateMediaSnapshot(app, file, (snapshot) => {
		clearRepeatProgress(snapshot);
	});
}

export async function updateMediaNoteRepeatProgress(
	app: App,
	file: TFile,
	type: MediaType,
	value: string,
): Promise<RepeatProgressUpdateResult> {
	let result: RepeatProgressUpdateResult = "rejected";
	await updateMediaSnapshot(app, file, (snapshot) => {
		const applied = applyProgressInputToRepeatFields(type, value, snapshot);
		if (!applied.accepted) {
			return;
		}
		assignRepeatProgress(snapshot, applied.next);
		if (isRepeatProgressCaughtUp(type, snapshot)) {
			clearRepeatProgress(snapshot);
			result = "caught-up";
			return;
		}
		result = "updated";
	});
	return result;
}

export async function addLinkToMediaNote(
	app: App,
	file: TFile,
	url: string,
): Promise<void> {
	const anilistId = extractAnilistId(url);
	const normalized = normalizeStoredLink(url);
	if (!normalized) {
		return;
	}
	await updateMediaFrontmatter(app, file, (frontmatter) => {
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

export async function normalizeMediaNoteFrontmatter(app: App, file: TFile): Promise<void> {
	await cleanMediaFrontmatter(app, file);
}

export async function normalizeAllMediaNoteFrontmatter(app: App, files: TFile[]): Promise<number> {
	return normalizeMediaFilesFrontmatter(app, files);
}

async function deleteEmptyMediaFolderAncestors(
	app: App,
	folder: TFolder | null,
	mediaFolder: string | undefined,
) {
	const baseFolder = normalizeVaultFolderOrDefault(mediaFolder, "Media");
	let currentPath = folder?.path;
	while (currentPath && currentPath !== baseFolder && currentPath.startsWith(`${baseFolder}/`)) {
		const current = app.vault.getAbstractFileByPath(currentPath);
		if (!(current instanceof TFolder) || current.children.length > 0) {
			return;
		}
		const parentPath = current.parent?.path;
		await app.vault.delete(current);
		currentPath = parentPath;
	}
}

export async function deleteMediaNote(app: App, file: TFile, mediaFolder?: string): Promise<void> {
	const parent = file.parent;
	await app.fileManager.trashFile(file);
	await deleteEmptyMediaFolderAncestors(app, parent, mediaFolder);
}
