import {App, TFile} from "obsidian";
import {MediaStatus, MediaType} from "../../types";
import {cleanMediaFrontmatter, normalizeMediaFilesFrontmatter, updateMediaFrontmatter, updateMediaSnapshot} from "../../domain/media";
import {collectLinks, extractAnilistId, normalizeStoredLink, setLinks} from "../../domain/media/links";
import {applyProgressInputToFields} from "../../domain/media/progress";

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

export async function deleteMediaNote(app: App, file: TFile): Promise<void> {
	await app.fileManager.trashFile(file);
}
