import {collectLinks, getAnilistIdFromFrontmatter, getAnilistIdFromLinks, getImdbIdFromFrontmatter, getImdbIdFromLinks, normalizeLinks, setLinks} from "./links";
import type {MediaStatus, MediaType} from "../../types";
import {CURRENT_MEDIA_SCHEMA_VERSION, MEDIA_SCHEMA_VERSION_KEY, MEDIA_STATUS_SET, MEDIA_TYPE_SET, type LatestMediaSnapshot} from "./schema";

export type MediaValidationIssue = {
	field: string;
	message: string;
	level: "error" | "warning";
};

function toTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

function toFiniteInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.floor(value);
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (!trimmed.length) {
			return undefined;
		}
		const parsed = Number.parseInt(trimmed, 10);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
}

function parseNumberRecord(value: unknown): Record<string, number> | undefined {
	if (!value) {
		return undefined;
	}
	let rawObject: Record<string, unknown> | null = null;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				rawObject = parsed as Record<string, unknown>;
			}
		} catch {
			return undefined;
		}
	} else if (typeof value === "object" && !Array.isArray(value)) {
		rawObject = value as Record<string, unknown>;
	}
	if (!rawObject) {
		return undefined;
	}
	const entries = Object.entries(rawObject)
		.filter(([key, item]) => Number.isFinite(Number(key)) && Number.isFinite(Number(item)));
	if (!entries.length) {
		return undefined;
	}
	return Object.fromEntries(entries.map(([key, item]) => [String(Number(key)), Number(item)]));
}

function parseMediaType(value: unknown): MediaType | undefined {
	const raw = toTrimmedString(value)?.toLowerCase();
	if (!raw) {
		return undefined;
	}
	return MEDIA_TYPE_SET.has(raw as MediaType) ? raw as MediaType : undefined;
}

function parseMediaStatus(value: unknown): MediaStatus {
	const raw = toTrimmedString(value)?.toLowerCase();
	if (!raw) {
		return "planned";
	}
	return MEDIA_STATUS_SET.has(raw as MediaStatus) ? raw as MediaStatus : "planned";
}

function parseAnilistIds(frontmatter: Record<string, unknown>): number[] | undefined {
	const values = Array.isArray(frontmatter.anilistIds)
		? frontmatter.anilistIds
			.map((entry) => toFiniteInteger(entry))
			.filter((entry): entry is number => entry !== undefined)
		: [];
	const idFromField = getAnilistIdFromFrontmatter(frontmatter);
	const idFromLinks = getAnilistIdFromLinks(collectLinks(frontmatter));
	if (idFromField && !values.includes(idFromField)) {
		values.unshift(idFromField);
	}
	if (idFromLinks && !values.includes(idFromLinks)) {
		values.push(idFromLinks);
	}
	if (!values.length) {
		return undefined;
	}
	return values;
}

function setOptionalString(frontmatter: Record<string, unknown>, key: string, value: string | undefined) {
	if (value && value.length) {
		frontmatter[key] = value;
	} else if (key in frontmatter) {
		delete frontmatter[key];
	}
}

function setOptionalNumber(frontmatter: Record<string, unknown>, key: string, value: number | undefined) {
	if (value !== undefined) {
		frontmatter[key] = value;
	} else if (key in frontmatter) {
		delete frontmatter[key];
	}
}

function setOptionalNumberRecord(frontmatter: Record<string, unknown>, key: string, value: Record<string, number> | undefined) {
	if (value && Object.keys(value).length) {
		frontmatter[key] = JSON.stringify(value);
	} else if (key in frontmatter) {
		delete frontmatter[key];
	}
}

export function decodeLatestMediaSnapshot(frontmatter: Record<string, unknown>): LatestMediaSnapshot {
	const links = collectLinks(frontmatter);
	const type = parseMediaType(frontmatter.type ?? frontmatter.media);
	const anilistIds = parseAnilistIds(frontmatter);
	const anilistId = anilistIds?.[0];
	const imdbId = getImdbIdFromFrontmatter(frontmatter) ?? getImdbIdFromLinks(links);
	return {
		version: CURRENT_MEDIA_SCHEMA_VERSION,
		type,
		status: parseMediaStatus(frontmatter.status),
		title: toTrimmedString(frontmatter.title),
		author: toTrimmedString(frontmatter.author),
		progress: toTrimmedString(frontmatter.progress),
		progressLabel: toTrimmedString(frontmatter.progressLabel),
		progressUnit: toTrimmedString(frontmatter.progressUnit),
		season: toFiniteInteger(frontmatter.season),
		episode: toFiniteInteger(frontmatter.episode),
		year: toFiniteInteger(frontmatter.year),
		links,
		imdbId: imdbId ?? undefined,
		tmdbId: toFiniteInteger(frontmatter.tmdbId),
		tmdbLastChecked: toFiniteInteger(frontmatter.tmdbLastChecked),
		tmdbLatestSeason: toFiniteInteger(frontmatter.tmdbLatestSeason),
		tmdbLatestEpisode: toFiniteInteger(frontmatter.tmdbLatestEpisode),
		tmdbLatestSeasonEpisodes: toFiniteInteger(frontmatter.tmdbLatestSeasonEpisodes),
		tmdbSeasonEpisodes: parseNumberRecord(frontmatter.tmdbSeasonEpisodes),
		tmdbLatestAirDate: toTrimmedString(frontmatter.tmdbLatestAirDate),
		tmdbLatestName: toTrimmedString(frontmatter.tmdbLatestName),
		anilistId,
		anilistIds,
		anilistLastChecked: toFiniteInteger(frontmatter.anilistLastChecked),
		anilistLatestEpisode: toFiniteInteger(frontmatter.anilistLatestEpisode),
		anilistNextEpisode: toFiniteInteger(frontmatter.anilistNextEpisode),
		anilistNextAiringAt: toFiniteInteger(frontmatter.anilistNextAiringAt),
		anilistChapters: toFiniteInteger(frontmatter.anilistChapters),
		anilistVolumes: toFiniteInteger(frontmatter.anilistVolumes),
		anilistSeason: toFiniteInteger(frontmatter.anilistSeason),
		anilistSeasonTotal: toFiniteInteger(frontmatter.anilistSeasonTotal),
		anilistSeasonEpisodes: parseNumberRecord(frontmatter.anilistSeasonEpisodes),
	};
}

export function sanitizeLatestMediaSnapshot(snapshot: LatestMediaSnapshot): LatestMediaSnapshot {
	const normalizedType = snapshot.type && MEDIA_TYPE_SET.has(snapshot.type) ? snapshot.type : undefined;
	const normalizedStatus = MEDIA_STATUS_SET.has(snapshot.status) ? snapshot.status : "planned";
	const normalizedLinks = normalizeLinks(snapshot.links ?? []);
	const anilistIds = (snapshot.anilistIds ?? [])
		.filter((value): value is number => Number.isFinite(value));
	if (snapshot.anilistId !== undefined && Number.isFinite(snapshot.anilistId) && !anilistIds.includes(snapshot.anilistId)) {
		anilistIds.unshift(snapshot.anilistId);
	}
	const normalizedAnilistIds = anilistIds.length ? Array.from(new Set(anilistIds)) : undefined;
	const normalizedAnilistId = normalizedAnilistIds?.[0];

	return {
		...snapshot,
		version: CURRENT_MEDIA_SCHEMA_VERSION,
		type: normalizedType,
		status: normalizedStatus,
		links: normalizedLinks,
		imdbId: toTrimmedString(snapshot.imdbId),
		anilistId: normalizedAnilistId,
		anilistIds: normalizedAnilistIds,
		tmdbSeasonEpisodes: parseNumberRecord(snapshot.tmdbSeasonEpisodes),
		anilistSeasonEpisodes: parseNumberRecord(snapshot.anilistSeasonEpisodes),
	};
}

export function validateLatestMediaSnapshot(snapshot: LatestMediaSnapshot): MediaValidationIssue[] {
	const issues: MediaValidationIssue[] = [];
	if (!snapshot.type) {
		issues.push({
			field: "type",
			message: "Missing media type.",
			level: "error",
		});
	}
	if (snapshot.season !== undefined && snapshot.episode === undefined) {
		issues.push({
			field: "episode",
			message: "Season is set without episode.",
			level: "warning",
		});
	}
	if (snapshot.episode !== undefined && snapshot.season === undefined) {
		issues.push({
			field: "season",
			message: "Episode is set without season.",
			level: "warning",
		});
	}
	return issues;
}

export function encodeLatestMediaSnapshot(
	snapshot: LatestMediaSnapshot,
	frontmatter: Record<string, unknown>,
) {
	frontmatter[MEDIA_SCHEMA_VERSION_KEY] = CURRENT_MEDIA_SCHEMA_VERSION;
	setOptionalString(frontmatter, "type", snapshot.type);
	setOptionalString(frontmatter, "status", snapshot.status);
	setOptionalString(frontmatter, "title", toTrimmedString(snapshot.title));
	setOptionalString(frontmatter, "author", toTrimmedString(snapshot.author));
	setOptionalString(frontmatter, "progress", toTrimmedString(snapshot.progress));
	setOptionalString(frontmatter, "progressLabel", toTrimmedString(snapshot.progressLabel));
	setOptionalString(frontmatter, "progressUnit", toTrimmedString(snapshot.progressUnit));
	setOptionalNumber(frontmatter, "season", toFiniteInteger(snapshot.season));
	setOptionalNumber(frontmatter, "episode", toFiniteInteger(snapshot.episode));
	setOptionalNumber(frontmatter, "year", toFiniteInteger(snapshot.year));
	setOptionalString(frontmatter, "imdbId", toTrimmedString(snapshot.imdbId));

	const anilistIds = snapshot.anilistIds?.filter((value) => Number.isFinite(value));
	if (anilistIds?.length) {
		frontmatter.anilistIds = anilistIds;
		frontmatter.anilistId = anilistIds[0];
	} else if (snapshot.anilistId !== undefined && Number.isFinite(snapshot.anilistId)) {
		frontmatter.anilistId = snapshot.anilistId;
		delete frontmatter.anilistIds;
	} else {
		delete frontmatter.anilistIds;
		delete frontmatter.anilistId;
	}

	setOptionalNumber(frontmatter, "tmdbId", toFiniteInteger(snapshot.tmdbId));
	setOptionalNumber(frontmatter, "tmdbLastChecked", toFiniteInteger(snapshot.tmdbLastChecked));
	setOptionalNumber(frontmatter, "tmdbLatestSeason", toFiniteInteger(snapshot.tmdbLatestSeason));
	setOptionalNumber(frontmatter, "tmdbLatestEpisode", toFiniteInteger(snapshot.tmdbLatestEpisode));
	setOptionalNumber(frontmatter, "tmdbLatestSeasonEpisodes", toFiniteInteger(snapshot.tmdbLatestSeasonEpisodes));
	setOptionalNumberRecord(frontmatter, "tmdbSeasonEpisodes", parseNumberRecord(snapshot.tmdbSeasonEpisodes));
	setOptionalString(frontmatter, "tmdbLatestAirDate", toTrimmedString(snapshot.tmdbLatestAirDate));
	setOptionalString(frontmatter, "tmdbLatestName", toTrimmedString(snapshot.tmdbLatestName));

	setOptionalNumber(frontmatter, "anilistLastChecked", toFiniteInteger(snapshot.anilistLastChecked));
	setOptionalNumber(frontmatter, "anilistLatestEpisode", toFiniteInteger(snapshot.anilistLatestEpisode));
	setOptionalNumber(frontmatter, "anilistNextEpisode", toFiniteInteger(snapshot.anilistNextEpisode));
	setOptionalNumber(frontmatter, "anilistNextAiringAt", toFiniteInteger(snapshot.anilistNextAiringAt));
	setOptionalNumber(frontmatter, "anilistChapters", toFiniteInteger(snapshot.anilistChapters));
	setOptionalNumber(frontmatter, "anilistVolumes", toFiniteInteger(snapshot.anilistVolumes));
	setOptionalNumber(frontmatter, "anilistSeason", toFiniteInteger(snapshot.anilistSeason));
	setOptionalNumber(frontmatter, "anilistSeasonTotal", toFiniteInteger(snapshot.anilistSeasonTotal));
	setOptionalNumberRecord(frontmatter, "anilistSeasonEpisodes", parseNumberRecord(snapshot.anilistSeasonEpisodes));

	setLinks(frontmatter, snapshot.links ?? []);
}
