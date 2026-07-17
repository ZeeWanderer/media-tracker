import {collectLinks, getAnilistIdFromFrontmatter, getAnilistIdFromLinks, getImdbIdFromFrontmatter, getImdbIdFromLinks, normalizeLinks, setLinks} from "./links";
import type {MediaStatus, MediaType} from "./config";
import {
	CURRENT_MEDIA_SCHEMA_VERSION,
	MEDIA_FRONTMATTER_SCHEMA,
	MEDIA_SCHEMA_VERSION_KEY,
	type LatestMediaSnapshot,
	type MediaFrontmatterFieldSchema,
} from "./schema";
import {
	normalizeEnumString,
	normalizeSchemaFieldValue,
	parseFieldValueByKind,
	parseNumberRecord,
	parseStringArray,
	serializeFieldValueByKind,
	toFiniteInteger,
	toTrimmedString,
} from "./fieldCodecs";
import {collectAlternateTitles, LEGACY_ALTERNATE_TITLE_FIELDS, normalizeAlternateTitles} from "./titles";

export type MediaValidationIssue = {
	field: string;
	message: string;
	level: "error" | "warning";
};

function setOptionalField(frontmatter: Record<string, unknown>, key: string, value: unknown) {
	if (value === undefined) {
		if (key in frontmatter) {
			delete frontmatter[key];
		}
		return;
	}
	frontmatter[key] = value;
}

const SPECIAL_FIELD_KEYS = new Set([
	"type",
	"status",
	"links",
	"imdbId",
	"anilistId",
	"anilistIds",
]);

function getSchemaFieldEntries(): Array<[string, MediaFrontmatterFieldSchema]> {
	return Object.entries(MEDIA_FRONTMATTER_SCHEMA.fields);
}

function snapshotToRecord(snapshot: LatestMediaSnapshot): Record<string, unknown> {
	return snapshot as unknown as Record<string, unknown>;
}

function decodeSchemaFields(frontmatter: Record<string, unknown>): Record<string, unknown> {
	const decoded: Record<string, unknown> = {};
	for (const [key, fieldSchema] of getSchemaFieldEntries()) {
		const raw = key === "type"
			? frontmatter[key] ?? frontmatter.media
			: frontmatter[key];
		const parsed = parseFieldValueByKind(fieldSchema.kind, raw);
		const normalized = normalizeSchemaFieldValue(fieldSchema, parsed);
		if (normalized !== undefined) {
			decoded[key] = normalized;
		}
	}
	return decoded;
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

export function decodeLatestMediaSnapshot(frontmatter: Record<string, unknown>): LatestMediaSnapshot {
	const schemaDecoded = decodeSchemaFields(frontmatter);
	const links = collectLinks(frontmatter);
	const type = schemaDecoded.type as MediaType | undefined;
	const anilistIds = parseAnilistIds(frontmatter);
	const anilistId = anilistIds?.[0];
	const imdbId = getImdbIdFromFrontmatter(frontmatter) ?? getImdbIdFromLinks(links);
	const primaryTitle = toTrimmedString(schemaDecoded.title);
	const alternateTitles = collectAlternateTitles(frontmatter, primaryTitle);

	const snapshot: LatestMediaSnapshot = {
		version: CURRENT_MEDIA_SCHEMA_VERSION,
		type,
		status: (schemaDecoded.status as MediaStatus | undefined) ?? "planned",
		links,
	};
	for (const [key, value] of Object.entries(schemaDecoded)) {
		if (SPECIAL_FIELD_KEYS.has(key)) {
			continue;
		}
		snapshotToRecord(snapshot)[key] = value;
	}
	if (primaryTitle) {
		snapshot.title = primaryTitle;
	}
	if (alternateTitles?.length) {
		snapshot.alternateTitles = alternateTitles;
	}
	if (imdbId) {
		snapshot.imdbId = imdbId;
	}
	if (anilistId !== undefined) {
		snapshot.anilistId = anilistId;
	}
	if (anilistIds?.length) {
		snapshot.anilistIds = anilistIds;
	}
	return snapshot;
}

export function sanitizeLatestMediaSnapshot(snapshot: LatestMediaSnapshot): LatestMediaSnapshot {
	const normalizedLinks = normalizeLinks(snapshot.links ?? []);
	const normalizedSnapshot: LatestMediaSnapshot = {
		...snapshot,
		version: CURRENT_MEDIA_SCHEMA_VERSION,
		links: normalizedLinks,
	};
	const normalizedRecord = snapshotToRecord(normalizedSnapshot);
	for (const [key, fieldSchema] of getSchemaFieldEntries()) {
		if (key === "links" || key === "anilistId" || key === "anilistIds") {
			continue;
		}
		const parsed = parseFieldValueByKind(fieldSchema.kind, normalizedRecord[key]);
		const normalizedValue = normalizeSchemaFieldValue(fieldSchema, parsed);
		if (normalizedValue === undefined) {
			delete normalizedRecord[key];
		} else {
			normalizedRecord[key] = normalizedValue;
		}
	}

	const anilistIds = (snapshot.anilistIds ?? [])
		.filter((value): value is number => Number.isFinite(value));
	if (snapshot.anilistId !== undefined && Number.isFinite(snapshot.anilistId) && !anilistIds.includes(snapshot.anilistId)) {
		anilistIds.unshift(snapshot.anilistId);
	}
	const normalizedAnilistIds = anilistIds.length ? Array.from(new Set(anilistIds)) : undefined;
	const normalizedAnilistId = normalizedAnilistIds?.[0];

	return {
		...normalizedSnapshot,
		type: normalizedRecord.type as MediaType | undefined,
		status: (normalizedRecord.status as MediaStatus | undefined) ?? "planned",
		title: toTrimmedString(normalizedRecord.title),
		alternateTitles: normalizeAlternateTitles(
			parseStringArray(normalizedRecord.alternateTitles),
			toTrimmedString(normalizedRecord.title),
		),
		imdbId: toTrimmedString(normalizedRecord.imdbId),
		anilistId: normalizedAnilistId,
		anilistIds: normalizedAnilistIds,
		tmdbSeasonEpisodes: parseNumberRecord(normalizedRecord.tmdbSeasonEpisodes),
		anilistSeasonEpisodes: parseNumberRecord(normalizedRecord.anilistSeasonEpisodes),
	};
}

export function validateLatestMediaSnapshot(snapshot: LatestMediaSnapshot): MediaValidationIssue[] {
	const issues: MediaValidationIssue[] = [];
	const snapshotRecord = snapshotToRecord(snapshot);
	for (const [key, fieldSchema] of getSchemaFieldEntries()) {
		const parsed = parseFieldValueByKind(fieldSchema.kind, snapshotRecord[key]);
		const normalized = normalizeSchemaFieldValue(fieldSchema, parsed);
		if (fieldSchema.required && normalized === undefined) {
			issues.push({
				field: key,
				message: `Missing required field "${key}".`,
				level: "error",
			});
		}
		if (fieldSchema.kind === "string" && fieldSchema.enumValues?.length) {
			const raw = toTrimmedString(snapshotRecord[key]);
			if (raw !== undefined && normalizeEnumString(raw, fieldSchema.enumValues) === undefined) {
				issues.push({
					field: key,
					message: `Invalid value "${raw}" for "${key}".`,
					level: "warning",
				});
			}
		}
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
	if (snapshot.repeatSeason !== undefined && snapshot.repeatEpisode === undefined) {
		issues.push({
			field: "repeatEpisode",
			message: "Repeat season is set without repeat episode.",
			level: "warning",
		});
	}
	if (snapshot.repeatEpisode !== undefined && snapshot.repeatSeason === undefined) {
		issues.push({
			field: "repeatSeason",
			message: "Repeat episode is set without repeat season.",
			level: "warning",
		});
	}
	return issues;
}

export function encodeLatestMediaSnapshot(
	snapshot: LatestMediaSnapshot,
	frontmatter: Record<string, unknown>,
) {
	frontmatter[MEDIA_SCHEMA_VERSION_KEY] = MEDIA_FRONTMATTER_SCHEMA.version;
	for (const [key, fieldSchema] of getSchemaFieldEntries()) {
		if (key === "links" || key === "anilistId" || key === "anilistIds") {
			continue;
		}
		const rawValue = snapshotToRecord(snapshot)[key];
		const parsedValue = parseFieldValueByKind(fieldSchema.kind, rawValue);
		const normalizedValue = normalizeSchemaFieldValue(fieldSchema, parsedValue);
		const encodedValue = serializeFieldValueByKind(fieldSchema.kind, normalizedValue);
		setOptionalField(frontmatter, key, encodedValue);
	}

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

	setLinks(frontmatter, snapshot.links ?? []);
	for (const key of LEGACY_ALTERNATE_TITLE_FIELDS) {
		if (key in frontmatter) {
			delete frontmatter[key];
		}
	}
}
