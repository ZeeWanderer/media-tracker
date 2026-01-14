import {App, TFile} from "obsidian";
import {collectLinks, setLinks} from "./links";
import {CURRENT_MEDIA_VERSION} from "./migration";

export function normalizeFrontmatter(frontmatter: Record<string, unknown>) {
	frontmatter.mediaTrackerVersion = CURRENT_MEDIA_VERSION;

	const type = frontmatter.type ?? frontmatter.media;
	if (type && !frontmatter.type) {
		frontmatter.type = type;
	}
	if ("media" in frontmatter) {
		delete frontmatter.media;
	}

	if (frontmatter.royalRoad && !frontmatter.royalroad) {
		frontmatter.royalroad = frontmatter.royalRoad;
	}
	if ("royalRoad" in frontmatter) {
		delete frontmatter.royalRoad;
	}

	if (frontmatter.chapter && !frontmatter.progress) {
		frontmatter.progress = frontmatter.chapter;
	}
	if ("chapter" in frontmatter) {
		delete frontmatter.chapter;
	}

	if (frontmatter.anilistId && !frontmatter.anilistIds) {
		frontmatter.anilistIds = [frontmatter.anilistId];
	}

	const links = collectLinks(frontmatter);
	setLinks(frontmatter, links);

	if (frontmatter.links && Array.isArray(frontmatter.links) && frontmatter.links.length === 0) {
		delete frontmatter.links;
	}
}

export async function updateFrontmatter(
	app: App,
	file: TFile,
	updater?: (frontmatter: Record<string, unknown>) => void,
) {
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter) {
			return;
		}
		updater?.(frontmatter);
		normalizeFrontmatter(frontmatter);
	});
}

export async function cleanFrontmatter(app: App, file: TFile) {
	await updateFrontmatter(app, file);
}
