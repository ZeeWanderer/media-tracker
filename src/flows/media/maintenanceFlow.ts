import {App, TFile} from "obsidian";
import {MediaStatus, MediaType} from "../../types";
import {cleanMediaFrontmatter, processMediaFrontmatter} from "../../domain/media";
import {SEASON_EPISODE_TYPES} from "../../domain/media/config";
import {collectLinks, extractAnilistId, normalizeStoredLink, setLinks} from "../../domain/media/links";

async function updateMediaFrontmatter(
	app: App,
	file: TFile,
	updater: (frontmatter: Record<string, unknown>) => void,
): Promise<void> {
	await processMediaFrontmatter(app, file, updater);
}

export async function updateMediaNoteStatus(app: App, file: TFile, status: MediaStatus): Promise<void> {
	await updateMediaFrontmatter(app, file, (frontmatter) => {
		frontmatter.status = status;
	});
}

export async function updateMediaNoteProgress(
	app: App,
	file: TFile,
	type: MediaType,
	value: string,
): Promise<void> {
	const trimmed = value.trim();
	if (SEASON_EPISODE_TYPES.has(type)) {
		await updateMediaFrontmatter(app, file, (frontmatter) => {
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
		return;
	}
	await updateMediaFrontmatter(app, file, (frontmatter) => {
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
	let changed = 0;
	for (const file of files) {
		const before = JSON.stringify(app.metadataCache.getFileCache(file)?.frontmatter ?? {});
		await cleanMediaFrontmatter(app, file);
		const after = JSON.stringify(app.metadataCache.getFileCache(file)?.frontmatter ?? {});
		if (before !== after) {
			changed += 1;
		}
	}
	return changed;
}

export async function deleteMediaNote(app: App, file: TFile): Promise<void> {
	await app.fileManager.trashFile(file);
}
