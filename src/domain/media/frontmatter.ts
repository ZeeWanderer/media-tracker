import {
	collectLinks,
	getAnilistIdFromFrontmatter,
	getAnilistIdFromLinks,
	getImdbIdFromFrontmatter,
	getImdbIdFromLinks,
	normalizeLinks,
	setLinks,
} from "./links";
import {collectAlternateTitles, LEGACY_ALTERNATE_TITLE_FIELDS, normalizeAlternateTitles} from "./titles";
import {
	CURRENT_MEDIA_SCHEMA_VERSION,
	MEDIA_FRONTMATTER_SCHEMA,
	MEDIA_SCHEMA_VERSION_KEY,
	type LatestMediaSnapshot,
	type MediaFrontmatterField,
	type MediaFrontmatterFieldKind,
	type MediaFrontmatterFieldSchema,
} from "./schema";
import {
	migrateMediaSnapshotToLatest,
	readMediaSchemaVersion,
	type MediaMigrationResult,
} from "./migrations";
import type {MediaStatus, MediaType} from "./config";

export type MediaValidationIssue = {
	field: string;
	message: string;
	level: "error" | "warning";
};

export type MediaFrontmatterProcessResult = MediaMigrationResult & {
	issues: MediaValidationIssue[];
	changed: boolean;
};

export type MediaSnapshotDecodeResult = MediaMigrationResult & {
	snapshot: LatestMediaSnapshot;
	issues: MediaValidationIssue[];
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
	if (typeof value !== "string" || !value.trim().length) {
		return undefined;
	}
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const normalized = value
		.map((entry) => toTrimmedString(entry))
		.filter((entry): entry is string => entry !== undefined);
	return normalized.length ? normalized : undefined;
}

function parseNumberArray(value: unknown): number[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const normalized = value
		.map((entry) => toFiniteInteger(entry))
		.filter((entry): entry is number => entry !== undefined);
	return normalized.length ? normalized : undefined;
}

function parseNumberRecord(value: unknown): Record<string, number> | undefined {
	let rawObject: Record<string, unknown> | undefined;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				rawObject = parsed as Record<string, unknown>;
			}
		} catch {
			return undefined;
		}
	} else if (value && typeof value === "object" && !Array.isArray(value)) {
		rawObject = value as Record<string, unknown>;
	}
	if (!rawObject) {
		return undefined;
	}
	const entries = Object.entries(rawObject)
		.filter(([key, item]) => Number.isFinite(Number(key)) && Number.isFinite(Number(item)))
		.map(([key, item]) => [String(Number(key)), Number(item)] as const);
	return entries.length ? Object.fromEntries(entries) : undefined;
}

function parseFieldValue(kind: MediaFrontmatterFieldKind, value: unknown): unknown {
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

function normalizeEnumString(value: string | undefined, enumValues?: readonly string[]): string | undefined {
	if (!enumValues?.length || !value) {
		return value;
	}
	const normalized = value.toLowerCase();
	return enumValues.find((allowed) => allowed.toLowerCase() === normalized);
}

function cloneDefaultValue(value: MediaFrontmatterFieldSchema["defaultValue"]): unknown {
	if (Array.isArray(value)) {
		return [...value];
	}
	if (value && typeof value === "object") {
		return {...value};
	}
	return value;
}

function normalizeFieldValue(field: MediaFrontmatterFieldSchema, value: unknown): unknown {
	let normalized = value;
	if (field.kind === "string") {
		normalized = normalizeEnumString(
			typeof normalized === "string" ? normalized : undefined,
			field.enumValues,
		);
	}
	return normalized === undefined && field.defaultValue !== undefined
		? cloneDefaultValue(field.defaultValue)
		: normalized;
}

function getSchemaFieldEntries(): Array<[MediaFrontmatterField, MediaFrontmatterFieldSchema]> {
	return Object.entries(MEDIA_FRONTMATTER_SCHEMA.fields) as Array<[
		MediaFrontmatterField,
		MediaFrontmatterFieldSchema,
	]>;
}

function snapshotToRecord(snapshot: LatestMediaSnapshot): Record<MediaFrontmatterField, unknown> {
	return snapshot as unknown as Record<MediaFrontmatterField, unknown>;
}

function decodeSchemaFields(frontmatter: Record<string, unknown>): Partial<Record<MediaFrontmatterField, unknown>> {
	const decoded: Partial<Record<MediaFrontmatterField, unknown>> = {};
	for (const [key, field] of getSchemaFieldEntries()) {
		const raw = key === "type" ? frontmatter[key] ?? frontmatter.media : frontmatter[key];
		const normalized = normalizeFieldValue(field, parseFieldValue(field.kind, raw));
		if (normalized !== undefined) {
			decoded[key] = normalized;
		}
	}
	return decoded;
}

function parseAnilistIds(frontmatter: Record<string, unknown>): number[] | undefined {
	const values = parseNumberArray(frontmatter.anilistIds) ?? [];
	const idFromField = getAnilistIdFromFrontmatter(frontmatter);
	const idFromLinks = getAnilistIdFromLinks(collectLinks(frontmatter));
	if (idFromField !== undefined && !values.includes(idFromField)) {
		values.unshift(idFromField);
	}
	if (idFromLinks !== undefined && !values.includes(idFromLinks)) {
		values.push(idFromLinks);
	}
	return values.length ? values : undefined;
}

function decodeLatestMediaSnapshot(frontmatter: Record<string, unknown>): LatestMediaSnapshot {
	const decoded = decodeSchemaFields(frontmatter);
	const links = collectLinks(frontmatter);
	const type = decoded.type as MediaType | undefined;
	const anilistIds = parseAnilistIds(frontmatter);
	const imdbId = getImdbIdFromFrontmatter(frontmatter) ?? getImdbIdFromLinks(links);
	const primaryTitle = toTrimmedString(decoded.title);
	const alternateTitles = collectAlternateTitles(frontmatter, primaryTitle);
	const snapshot: LatestMediaSnapshot = {
		version: CURRENT_MEDIA_SCHEMA_VERSION,
		type,
		status: (decoded.status as MediaStatus | undefined) ?? "planned",
		links,
	};

	const snapshotRecord = snapshotToRecord(snapshot);
	for (const [key, value] of Object.entries(decoded) as Array<[MediaFrontmatterField, unknown]>) {
		if (key === "type" || key === "status" || key === "links" || key === "imdbId"
			|| key === "anilistId" || key === "anilistIds") {
			continue;
		}
		snapshotRecord[key] = value;
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
	if (anilistIds?.length) {
		snapshot.anilistId = anilistIds[0];
		snapshot.anilistIds = anilistIds;
	}
	return snapshot;
}

export function sanitizeMediaSnapshot(snapshot: LatestMediaSnapshot): LatestMediaSnapshot {
	const normalized: LatestMediaSnapshot = {
		...snapshot,
		version: CURRENT_MEDIA_SCHEMA_VERSION,
		links: normalizeLinks(snapshot.links ?? []),
	};
	const record = snapshotToRecord(normalized);
	for (const [key, field] of getSchemaFieldEntries()) {
		if (key === "links" || key === "anilistId" || key === "anilistIds") {
			continue;
		}
		const value = normalizeFieldValue(field, parseFieldValue(field.kind, record[key]));
		if (value === undefined) {
			delete record[key];
		} else {
			record[key] = value;
		}
	}

	const anilistIds = parseNumberArray(snapshot.anilistIds) ?? [];
	if (snapshot.anilistId !== undefined && Number.isFinite(snapshot.anilistId)
		&& !anilistIds.includes(snapshot.anilistId)) {
		anilistIds.unshift(Math.floor(snapshot.anilistId));
	}
	const uniqueAnilistIds = anilistIds.length ? Array.from(new Set(anilistIds)) : undefined;
	return {
		...normalized,
		type: record.type as MediaType | undefined,
		status: (record.status as MediaStatus | undefined) ?? "planned",
		title: toTrimmedString(record.title),
		alternateTitles: normalizeAlternateTitles(parseStringArray(record.alternateTitles), toTrimmedString(record.title)),
		imdbId: toTrimmedString(record.imdbId),
		anilistId: uniqueAnilistIds?.[0],
		anilistIds: uniqueAnilistIds,
		tmdbSeasonEpisodes: parseNumberRecord(record.tmdbSeasonEpisodes),
		anilistSeasonEpisodes: parseNumberRecord(record.anilistSeasonEpisodes),
	};
}

export function validateMediaSnapshot(snapshot: LatestMediaSnapshot): MediaValidationIssue[] {
	const issues: MediaValidationIssue[] = [];
	const record = snapshotToRecord(snapshot);
	for (const [key, field] of getSchemaFieldEntries()) {
		const parsed = parseFieldValue(field.kind, record[key]);
		const normalized = normalizeFieldValue(field, parsed);
		if (field.required && normalized === undefined) {
			issues.push({field: key, message: `Missing required field "${key}".`, level: "error"});
		}
		if (field.kind === "string" && field.enumValues?.length) {
			const raw = toTrimmedString(record[key]);
			if (raw !== undefined && normalizeEnumString(raw, field.enumValues) === undefined) {
				issues.push({field: key, message: `Invalid value "${raw}" for "${key}".`, level: "warning"});
			}
		}
	}
	if (snapshot.season !== undefined && snapshot.episode === undefined) {
		issues.push({field: "episode", message: "Season is set without episode.", level: "warning"});
	}
	if (snapshot.episode !== undefined && snapshot.season === undefined) {
		issues.push({field: "season", message: "Episode is set without season.", level: "warning"});
	}
	if (snapshot.repeatSeason !== undefined && snapshot.repeatEpisode === undefined) {
		issues.push({field: "repeatEpisode", message: "Repeat season is set without repeat episode.", level: "warning"});
	}
	if (snapshot.repeatEpisode !== undefined && snapshot.repeatSeason === undefined) {
		issues.push({field: "repeatSeason", message: "Repeat episode is set without repeat season.", level: "warning"});
	}
	return issues;
}

function setOptionalField(frontmatter: Record<string, unknown>, key: string, value: unknown) {
	if (value === undefined) {
		delete frontmatter[key];
		return;
	}
	frontmatter[key] = value;
}

export function encodeMediaSnapshot(snapshot: LatestMediaSnapshot, frontmatter: Record<string, unknown>) {
	const normalized = sanitizeMediaSnapshot(snapshot);
	const record = snapshotToRecord(normalized);
	frontmatter[MEDIA_SCHEMA_VERSION_KEY] = MEDIA_FRONTMATTER_SCHEMA.version;
	for (const [key, field] of getSchemaFieldEntries()) {
		if (key === "links" || key === "anilistId" || key === "anilistIds") {
			continue;
		}
		const value = normalizeFieldValue(field, parseFieldValue(field.kind, record[key]));
		setOptionalField(frontmatter, key, value);
	}

	if (normalized.anilistIds?.length) {
		frontmatter.anilistIds = normalized.anilistIds;
		frontmatter.anilistId = normalized.anilistIds[0];
	} else if (normalized.anilistId !== undefined) {
		frontmatter.anilistId = normalized.anilistId;
		delete frontmatter.anilistIds;
	} else {
		delete frontmatter.anilistId;
		delete frontmatter.anilistIds;
	}
	setLinks(frontmatter, normalized.links);
	for (const key of LEGACY_ALTERNATE_TITLE_FIELDS) {
		delete frontmatter[key];
	}
}

function stableNormalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => stableNormalize(entry));
	}
	if (value && typeof value === "object") {
		const normalized: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			normalized[key] = stableNormalize((value as Record<string, unknown>)[key]);
		}
		return normalized;
	}
	return value;
}

function stableStringify(value: unknown): string {
	return JSON.stringify(stableNormalize(value));
}

export function decodeMediaSnapshot(frontmatter: Record<string, unknown>): MediaSnapshotDecodeResult {
	const fromVersion = readMediaSchemaVersion(frontmatter);
	const decoded = decodeLatestMediaSnapshot(frontmatter);
	const migration = migrateMediaSnapshotToLatest(fromVersion, decoded);
	const snapshot = sanitizeMediaSnapshot(migration.snapshot);
	const issues = validateMediaSnapshot(snapshot);
	if (migration.unsupportedSourceVersion !== undefined) {
		issues.push({
			field: MEDIA_SCHEMA_VERSION_KEY,
			message: `Schema v${migration.unsupportedSourceVersion} is not supported by this build.`,
			level: "warning",
		});
	}
	return {...migration, snapshot, issues};
}

export function normalizeMediaFrontmatter(frontmatter: Record<string, unknown>): MediaFrontmatterProcessResult {
	const before = stableStringify(frontmatter);
	const decoded = decodeMediaSnapshot(frontmatter);
	if (decoded.unsupportedSourceVersion !== undefined) {
		return {
			fromVersion: decoded.fromVersion,
			toVersion: decoded.toVersion,
			appliedVersions: decoded.appliedVersions,
			unsupportedSourceVersion: decoded.unsupportedSourceVersion,
			issues: decoded.issues,
			changed: false,
		};
	}
	encodeMediaSnapshot(decoded.snapshot, frontmatter);
	return {
		fromVersion: decoded.fromVersion,
		toVersion: decoded.toVersion,
		appliedVersions: decoded.appliedVersions,
		unsupportedSourceVersion: decoded.unsupportedSourceVersion,
		issues: decoded.issues,
		changed: before !== stableStringify(frontmatter),
	};
}
