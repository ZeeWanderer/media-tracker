import {TFile, TFolder, type App} from "obsidian";
import {decodeMediaSnapshot} from "../../domain/media/frontmatter";
import {getTitleSortKey, mapMediaSnapshotToRecord} from "../../domain/media/readModel";
import {normalizeVaultFolderOrDefault} from "../../pathUtils";
import type {MediaItem} from "../../domain/media/models";

export type MediaReadQuery = {
	mediaFolder: string;
};

function collectMarkdownFiles(root: TFolder): TFile[] {
	const files: TFile[] = [];
	const pending: TFolder[] = [root];
	while (pending.length) {
		const folder = pending.pop();
		if (!folder) {
			continue;
		}
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				files.push(child);
			} else if (child instanceof TFolder) {
				pending.push(child);
			}
		}
	}
	return files;
}

function readMediaItem(app: App, file: TFile, baseFolder: string): MediaItem<TFile> | null {
	const cache = app.metadataCache.getFileCache(file);
	const frontmatter = (cache?.frontmatter ?? {}) as Record<string, unknown>;
	const {snapshot} = decodeMediaSnapshot(frontmatter);
	const record = mapMediaSnapshotToRecord(snapshot, {
		basename: file.basename,
		parentName: file.parent?.name,
		parentPath: file.parent?.path,
		baseFolder,
	});
	return record ? {...record, file} : null;
}

export function listMediaItems(app: App, query: MediaReadQuery): MediaItem<TFile>[] {
	const baseFolder = normalizeVaultFolderOrDefault(query.mediaFolder, "Media");
	const root = app.vault.getAbstractFileByPath(baseFolder);
	if (!(root instanceof TFolder)) {
		return [];
	}
	const items = collectMarkdownFiles(root)
		.map((file) => readMediaItem(app, file, baseFolder))
		.filter((item): item is MediaItem<TFile> => item !== null);
	items.sort((a, b) => getTitleSortKey(a.title).localeCompare(getTitleSortKey(b.title)));
	return items;
}
