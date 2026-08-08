import type {App, TFile} from "obsidian";
import {
	decodeMediaSnapshot,
	encodeMediaSnapshot,
	normalizeMediaFrontmatter,
	type MediaFrontmatterProcessResult,
} from "../../domain/media/frontmatter";
import type {LatestMediaSnapshot} from "../../domain/media/schema";

export type MediaSnapshotUpdater = (snapshot: LatestMediaSnapshot) => LatestMediaSnapshot | void;

function toProcessResult(
	decoded: ReturnType<typeof decodeMediaSnapshot>,
	changed: boolean,
): MediaFrontmatterProcessResult {
	return {
		fromVersion: decoded.fromVersion,
		toVersion: decoded.toVersion,
		appliedVersions: decoded.appliedVersions,
		unsupportedSourceVersion: decoded.unsupportedSourceVersion,
		issues: decoded.issues,
		changed,
	};
}

function cloneSnapshot(snapshot: LatestMediaSnapshot): LatestMediaSnapshot {
	return {
		...snapshot,
		alternateTitles: snapshot.alternateTitles ? [...snapshot.alternateTitles] : undefined,
		links: [...snapshot.links],
		anilistIds: snapshot.anilistIds ? [...snapshot.anilistIds] : undefined,
		tmdbSeasonEpisodes: snapshot.tmdbSeasonEpisodes ? {...snapshot.tmdbSeasonEpisodes} : undefined,
		anilistSeasonEpisodes: snapshot.anilistSeasonEpisodes ? {...snapshot.anilistSeasonEpisodes} : undefined,
	};
}

async function processMediaFrontmatter(
	app: App,
	file: TFile,
	updater?: MediaSnapshotUpdater,
): Promise<MediaFrontmatterProcessResult | null> {
	let result: MediaFrontmatterProcessResult | null = null;
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter || typeof frontmatter !== "object") {
			return;
		}
		const record = frontmatter as Record<string, unknown>;
		const decoded = decodeMediaSnapshot(record);
		if (decoded.unsupportedSourceVersion !== undefined) {
			result = toProcessResult(decoded, false);
			if (updater) {
				throw new Error(`Cannot update media note with unsupported schema v${decoded.unsupportedSourceVersion}.`);
			}
			return;
		}
		if (updater) {
			const baseSnapshot = cloneSnapshot(decoded.snapshot);
			const updatedSnapshot = updater(baseSnapshot) ?? baseSnapshot;
			encodeMediaSnapshot(updatedSnapshot, record);
		}
		result = normalizeMediaFrontmatter(record);
	});
	return result;
}

export async function cleanMediaFrontmatter(
	app: App,
	file: TFile,
): Promise<MediaFrontmatterProcessResult | null> {
	return processMediaFrontmatter(app, file);
}

export async function updateMediaSnapshot(
	app: App,
	file: TFile,
	updater: MediaSnapshotUpdater,
): Promise<MediaFrontmatterProcessResult | null> {
	return processMediaFrontmatter(app, file, updater);
}

export async function normalizeMediaFilesFrontmatter(app: App, files: TFile[]): Promise<number> {
	let changed = 0;
	for (const file of files) {
		const result = await cleanMediaFrontmatter(app, file);
		if (result?.changed) {
			changed += 1;
		}
	}
	return changed;
}
