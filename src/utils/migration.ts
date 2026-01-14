import {normalizeFrontmatter} from "./frontmatter";

export const CURRENT_MEDIA_VERSION = 3;

export function migrateFrontmatter(frontmatter: Record<string, unknown>) {
	normalizeFrontmatter(frontmatter);
}
