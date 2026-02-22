import type {
	MediaFrontmatterFieldKind,
	MediaFrontmatterFieldSchema,
} from "./schema";

export function toTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		if (typeof value === "number" && Number.isFinite(value)) {
			return String(value);
		}
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

export function toFiniteInteger(value: unknown): number | undefined {
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

export function parseNumberRecord(value: unknown): Record<string, number> | undefined {
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

export function parseStringArray(value: unknown): string[] | undefined {
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

export function parseNumberArray(value: unknown): number[] | undefined {
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

export function parseFieldValueByKind(kind: MediaFrontmatterFieldKind, value: unknown): unknown {
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

export function serializeFieldValueByKind(kind: MediaFrontmatterFieldKind, value: unknown): unknown {
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

function cloneSchemaDefaultValue(value: MediaFrontmatterFieldSchema["defaultValue"]): unknown {
	if (Array.isArray(value)) {
		return [...value];
	}
	if (value && typeof value === "object") {
		return {...value};
	}
	return value;
}

export function normalizeEnumString(
	value: string | undefined,
	enumValues: readonly string[] | undefined,
): string | undefined {
	if (!enumValues?.length) {
		return value;
	}
	if (!value) {
		return undefined;
	}
	const normalized = value.toLowerCase();
	for (const allowed of enumValues) {
		if (allowed.toLowerCase() === normalized) {
			return allowed;
		}
	}
	return undefined;
}

export function normalizeSchemaFieldValue(
	fieldSchema: MediaFrontmatterFieldSchema,
	value: unknown,
): unknown {
	let normalized = value;
	if (fieldSchema.kind === "string") {
		normalized = normalizeEnumString(
			typeof normalized === "string" ? normalized : undefined,
			fieldSchema.enumValues,
		);
	}
	if (normalized === undefined && fieldSchema.defaultValue !== undefined) {
		normalized = cloneSchemaDefaultValue(fieldSchema.defaultValue);
	}
	return normalized;
}
