import {collectLinks, getAnilistIdFromFrontmatter, getAnilistIdFromLinks, getImdbIdFromFrontmatter, getImdbIdFromLinks, normalizeLinks, setLinks} from "./links";
import type {MediaStatus, MediaType} from "./config";
import {
	CURRENT_MEDIA_SCHEMA_VERSION,
	MEDIA_FRONTMATTER_SCHEMA,
	MEDIA_SCHEMA_VERSION_KEY,
	MEDIA_STATUS_SET,
	MEDIA_TYPE_SET,
	type LatestMediaSnapshot,
	type MediaFrontmatterFieldKind,
	type MediaFrontmatterFieldSchema,
} from "./schema";

export type MediaValidationIssue = {
	field: string;
	message: string;
	level: "error" | "warning";
};

function toTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		if (typeof value === "number" && Number.isFinite(value)) {
			return String(value);
		}
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

function parseStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const normalized = value
		.map((entry) => toTrimmedString(entry))
		.filter((entry): entry is string => entry !== undefined);
	if (!normalized.length) {
		return undefined;
	}
	return normalized;
}

function parseNumberArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const normalized = value
		.map((entry) => toFiniteInteger(entry))
		.filter((entry): entry is number => entry !== undefined);
	if (!normalized.length) {
		return undefined;
	}
	return normalized;
}

function parseFieldValueByKind(kind: MediaFrontmatterFieldKind, value: unknown): unknown {
	switch (kind) {
		case "string":
			return toTrimmedString(value);
		case "number":
			return toFiniteInteger(value);
		case "string-array":
			return parseStringArray(value);
		case "number-array":
			return parseNumberArray(value);
		case "number-record":
			return parseNumberRecord(value);
		default:
			return undefined;
	}
}

function serializeFieldValueByKind(kind: MediaFrontmatterFieldKind, value: unknown): unknown {
	switch (kind) {
		case "string":
			return toTrimmedString(value);
		case "number":
			return toFiniteInteger(value);
		case "string-array":
			return parseStringArray(value);
		case "number-array":
			return parseNumberArray(value);
		case "number-record": {
			const parsed = parseNumberRecord(value);
			if (!parsed || !Object.keys(parsed).length) {
				return undefined;
			}
			return JSON.stringify(parsed);
		}
		default:
			return undefined;
	}
}

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
		if (parsed !== undefined) {
			decoded[key] = parsed;
		}
	}
	return decoded;
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

export function decodeLatestMediaSnapshot(frontmatter: Record<string, unknown>): LatestMediaSnapshot {
	const schemaDecoded = decodeSchemaFields(frontmatter);
	const links = collectLinks(frontmatter);
	const type = parseMediaType(schemaDecoded.type);
	const anilistIds = parseAnilistIds(frontmatter);
	const anilistId = anilistIds?.[0];
	const imdbId = getImdbIdFromFrontmatter(frontmatter) ?? getImdbIdFromLinks(links);

	const snapshot: LatestMediaSnapshot = {
		version: CURRENT_MEDIA_SCHEMA_VERSION,
		type,
		status: parseMediaStatus(schemaDecoded.status),
		links,
	};
	for (const [key, value] of Object.entries(schemaDecoded)) {
		if (SPECIAL_FIELD_KEYS.has(key)) {
			continue;
		}
		snapshotToRecord(snapshot)[key] = value;
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
	frontmatter[MEDIA_SCHEMA_VERSION_KEY] = MEDIA_FRONTMATTER_SCHEMA.version;
	for (const [key, fieldSchema] of getSchemaFieldEntries()) {
		if (key === "links" || key === "anilistId" || key === "anilistIds") {
			continue;
		}
		const rawValue = snapshotToRecord(snapshot)[key];
		const encodedValue = serializeFieldValueByKind(fieldSchema.kind, rawValue);
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
}
