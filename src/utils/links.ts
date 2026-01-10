export const LEGACY_LINK_FIELDS = ["patreon", "kemono", "royalroad", "royalRoad", "imdb", "hdrezka"] as const;

export function extractImdbId(value: string): string | null {
	const match = value.match(/tt\d{7,}/i);
	if (!match) {
		return null;
	}
	return match[0].toLowerCase();
}

export function isImdbId(value: string): boolean {
	return /^tt\d{7,}$/i.test(value.trim());
}

export function normalizeStoredLink(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed.length) {
		return null;
	}
	const imdbId = extractImdbId(trimmed);
	if (imdbId) {
		return imdbId;
	}
	return trimmed;
}

export function normalizeLinks(values: string[]): string[] {
	const links: string[] = [];
	for (const value of values) {
		const normalized = normalizeStoredLink(value);
		if (!normalized) {
			continue;
		}
		if (!links.includes(normalized)) {
			links.push(normalized);
		}
	}
	return links;
}

export function filterImdbLinks(values: string[]): string[] {
	return values.filter((value) => !isImdbId(value));
}

export function getImdbIdFromLinks(values: string[]): string | undefined {
	for (const value of values) {
		const imdbId = extractImdbId(value);
		if (imdbId) {
			return imdbId;
		}
	}
	return undefined;
}

export function getImdbIdFromFrontmatter(frontmatter: Record<string, unknown>): string | undefined {
	const raw = typeof frontmatter.imdbId === "string"
		? frontmatter.imdbId
		: typeof frontmatter.imdb === "string"
			? frontmatter.imdb
			: undefined;
	if (!raw) {
		return undefined;
	}
	return extractImdbId(raw) ?? raw;
}

export function collectLinks(frontmatter: Record<string, unknown>): string[] {
	const links: string[] = [];
	const rawLinks = frontmatter.links;
	if (Array.isArray(rawLinks)) {
		for (const entry of rawLinks) {
			if (typeof entry === "string") {
				links.push(entry);
			}
		}
	} else if (rawLinks && typeof rawLinks === "object") {
		for (const value of Object.values(rawLinks)) {
			if (typeof value === "string") {
				links.push(value);
			}
		}
	}
	for (const key of LEGACY_LINK_FIELDS) {
		const value = frontmatter[key];
		if (typeof value === "string") {
			links.push(value);
		}
	}
	return normalizeLinks(links);
}

export function setLinks(frontmatter: Record<string, unknown>, links: string[]) {
	const normalized = normalizeLinks(links);
	const imdbId = getImdbIdFromLinks(normalized);
	const storedLinks = filterImdbLinks(normalized);
	if (storedLinks.length) {
		frontmatter.links = storedLinks;
	} else if ("links" in frontmatter) {
		delete frontmatter.links;
	}
	for (const key of LEGACY_LINK_FIELDS) {
		if (key in frontmatter) {
			delete frontmatter[key];
		}
	}
	if (imdbId) {
		frontmatter.imdbId = imdbId;
	}
}

export function toLinkUrl(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed.length) {
		return null;
	}
	const imdbId = extractImdbId(trimmed);
	if (imdbId) {
		return `https://www.imdb.com/title/${imdbId}/`;
	}
	if (/^https?:\/\//i.test(trimmed)) {
		return trimmed;
	}
	return `https://${trimmed}`;
}

export function getLinkHost(value: string): string | null {
	const url = toLinkUrl(value);
	if (!url) {
		return null;
	}
	try {
		return new URL(url).hostname.replace(/^www\./i, "");
	} catch {
		return null;
	}
}

export function getKnownIconAsset(value: string): string | null {
	const host = getLinkHost(value);
	if (!host) {
		return null;
	}
	if (host.endsWith("patreon.com")) {
		return "patreon.ico";
	}
	if (host.startsWith("kemono")) {
		return "kemono.ico";
	}
	if (host.endsWith("royalroad.com")) {
		return "royalroad.ico";
	}
	if (host.includes("rezka")) {
		return "hdrezka.ico";
	}
	if (host.endsWith("imdb.com")) {
		return "imdb.png";
	}
	return null;
}

export function formatLinkLabel(value: string): string {
	const imdbId = extractImdbId(value);
	if (imdbId) {
		return `imdb.com/title/${imdbId}`;
	}
	const host = getLinkHost(value);
	if (host) {
		return host;
	}
	return value;
}

export function getFaviconUrl(value: string): string | null {
	const url = toLinkUrl(value);
	if (!url) {
		return null;
	}
	try {
		const parsed = new URL(url);
		return `${parsed.origin}/favicon.ico`;
	} catch {
		return null;
	}
}
