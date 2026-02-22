import {App, TFile, TFolder} from "obsidian";
import {MEDIA_STATUSES, MEDIA_TYPES, type MediaStatus} from "./config";
import {decodeMediaSnapshot} from "./frontmatter";
import {buildProgressDisplay} from "./progress";
import {normalizeVaultFolderOrDefault} from "../../pathUtils";
import type {MediaItem} from "./models";

export type MediaReadQuery = {
	mediaFolder: string;
};

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const TYPE_FILE_BASENAME_REGEX = new RegExp(
	`^(?:${MEDIA_TYPES.map((type) => escapeRegex(type)).join("|")})(?:-\\d+)?$`,
	"i",
);

function normalizeString(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length ? trimmed : undefined;
	}
	if (typeof value === "number") {
		return `${value}`;
	}
	return undefined;
}

function normalizeStatus(value: unknown): MediaStatus {
	const raw = normalizeString(value)?.toLowerCase();
	return MEDIA_STATUSES.find((status) => status === raw) ?? "planned";
}

function isTypeFileBasename(value: string): boolean {
	return TYPE_FILE_BASENAME_REGEX.test(value.trim());
}

function resolveFallbackTitle(file: TFile, baseFolder: string): string {
	const parent = file.parent;
	if (parent
		&& parent.path.startsWith(`${baseFolder}/`)
		&& parent.path !== baseFolder
		&& isTypeFileBasename(file.basename)) {
		return parent.name;
	}
	return file.basename;
}

function parseMediaItem(file: TFile, app: App, baseFolder: string): MediaItem | null {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
	const {snapshot} = decodeMediaSnapshot(frontmatter);
	const type = snapshot.type;
	if (!type) {
		return null;
	}

	const title = normalizeString(snapshot.title) ?? resolveFallbackTitle(file, baseFolder);
	const status = normalizeStatus(snapshot.status);

	return {
		file,
		title,
		type,
		status,
		author: snapshot.author,
		progress: buildProgressDisplay(type, snapshot),
		progressRaw: snapshot.progress,
		progressLabel: snapshot.progressLabel,
		season: snapshot.season,
		episode: snapshot.episode,
		year: snapshot.year,
		links: snapshot.links,
		imdbId: snapshot.imdbId,
		anilistId: snapshot.anilistId,
		anilistIds: snapshot.anilistIds,
		tmdbId: snapshot.tmdbId,
		tmdbLastChecked: snapshot.tmdbLastChecked,
		tmdbLatestSeason: snapshot.tmdbLatestSeason,
		tmdbLatestEpisode: snapshot.tmdbLatestEpisode,
		tmdbLatestSeasonEpisodes: snapshot.tmdbLatestSeasonEpisodes,
		tmdbSeasonEpisodes: snapshot.tmdbSeasonEpisodes,
		tmdbLatestAirDate: snapshot.tmdbLatestAirDate,
		tmdbLatestName: snapshot.tmdbLatestName,
		anilistLastChecked: snapshot.anilistLastChecked,
		anilistLatestEpisode: snapshot.anilistLatestEpisode,
		anilistNextEpisode: snapshot.anilistNextEpisode,
		anilistNextAiringAt: snapshot.anilistNextAiringAt,
		anilistChapters: snapshot.anilistChapters,
		anilistVolumes: snapshot.anilistVolumes,
		anilistSeason: snapshot.anilistSeason,
		anilistSeasonTotal: snapshot.anilistSeasonTotal,
		anilistSeasonEpisodes: snapshot.anilistSeasonEpisodes,
	};
}

export function getTitleSortKey(title: string): string {
	const trimmed = title.trim();
	return trimmed.replace(/^the\s+/i, "");
}

function collectMarkdownFilesInFolder(root: TFolder): TFile[] {
	const files: TFile[] = [];
	const pending: TFolder[] = [root];
	while (pending.length) {
		const folder = pending.pop();
		if (!folder) {
			continue;
		}
		for (const child of folder.children) {
			if (child instanceof TFile) {
				if (child.extension === "md") {
					files.push(child);
				}
				continue;
			}
			if (child instanceof TFolder) {
				pending.push(child);
			}
		}
	}
	return files;
}

export function listMediaItems(app: App, query: MediaReadQuery): MediaItem[] {
	const baseFolder = normalizeVaultFolderOrDefault(query.mediaFolder, "Media");
	const root = app.vault.getAbstractFileByPath(baseFolder);
	if (!(root instanceof TFolder)) {
		return [];
	}
	const files = collectMarkdownFilesInFolder(root);
	const items = files
		.map((file) => parseMediaItem(file, app, baseFolder))
		.filter((item): item is MediaItem => item !== null);

	items.sort((a, b) => getTitleSortKey(a.title).localeCompare(getTitleSortKey(b.title)));
	return items;
}
