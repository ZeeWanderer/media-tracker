import {collectLinks, setLinks} from "./links";

export const CURRENT_MEDIA_VERSION = 2;

export function migrateFrontmatter(frontmatter: Record<string, unknown>) {
	frontmatter.mediaTrackerVersion = CURRENT_MEDIA_VERSION;
	if (frontmatter.tmdbLatestSeasonEpisodes) {
		delete frontmatter.tmdbLatestSeasonEpisodes;
	}
	const links = collectLinks(frontmatter);
	setLinks(frontmatter, links);
}
