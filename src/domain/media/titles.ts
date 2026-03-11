import {parseStringArray, toTrimmedString} from "./fieldCodecs";

export const LEGACY_ALTERNATE_TITLE_FIELDS = [
	"alternativeTitles",
	"altTitles",
	"aliases",
	"synonyms",
	"titles",
] as const;

function parseTitleList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return parseStringArray(value) ?? [];
	}
	const single = toTrimmedString(value);
	return single ? [single] : [];
}

export function normalizeAlternateTitles(
	values: readonly string[] | undefined,
	primaryTitle?: string,
): string[] | undefined {
	const normalizedPrimary = toTrimmedString(primaryTitle)?.toLowerCase();
	const seen = new Set<string>();
	const alternateTitles: string[] = [];

	for (const value of values ?? []) {
		const normalized = toTrimmedString(value);
		if (!normalized) {
			continue;
		}
		const normalizedKey = normalized.toLowerCase();
		if (normalizedPrimary && normalizedKey === normalizedPrimary) {
			continue;
		}
		if (seen.has(normalizedKey)) {
			continue;
		}
		seen.add(normalizedKey);
		alternateTitles.push(normalized);
	}

	return alternateTitles.length ? alternateTitles : undefined;
}

export function mergeAlternateTitles(
	primaryTitle: string | undefined,
	...groups: Array<readonly string[] | undefined>
): string[] | undefined {
	const merged: string[] = [];
	for (const group of groups) {
		if (!group?.length) {
			continue;
		}
		merged.push(...group);
	}
	return normalizeAlternateTitles(merged, primaryTitle);
}

export function collectAlternateTitles(
	frontmatter: Record<string, unknown>,
	primaryTitle?: string,
): string[] | undefined {
	const collected: string[] = [];
	collected.push(...parseTitleList(frontmatter.alternateTitles));
	for (const key of LEGACY_ALTERNATE_TITLE_FIELDS) {
		collected.push(...parseTitleList(frontmatter[key]));
	}
	return normalizeAlternateTitles(collected, primaryTitle);
}
