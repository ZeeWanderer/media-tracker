import {App, TFile} from "obsidian";
import {migrateMediaSnapshotToLatest, readMediaSchemaVersion, type MediaMigrationResult} from "./migrations";
import {decodeLatestMediaSnapshot, encodeLatestMediaSnapshot, sanitizeLatestMediaSnapshot, validateLatestMediaSnapshot, type MediaValidationIssue} from "./validation";

export type MediaFrontmatterProcessResult = MediaMigrationResult & {
	issues: MediaValidationIssue[];
	changed: boolean;
};

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

export function normalizeMediaFrontmatter(frontmatter: Record<string, unknown>): MediaFrontmatterProcessResult {
	const before = stableStringify(frontmatter);
	const fromVersion = readMediaSchemaVersion(frontmatter);
	const decoded = decodeLatestMediaSnapshot(frontmatter);
	const migration = migrateMediaSnapshotToLatest(fromVersion, decoded);
	const latest = sanitizeLatestMediaSnapshot(migration.snapshot);
	const issues = validateLatestMediaSnapshot(latest);
	if (migration.unsupportedSourceVersion !== undefined) {
		issues.push({
			field: "mediaTrackerVersion",
			message: `Schema v${migration.unsupportedSourceVersion} is not supported by this build.`,
			level: "warning",
		});
	}
	encodeLatestMediaSnapshot(latest, frontmatter);
	const after = stableStringify(frontmatter);
	return {
		fromVersion: migration.fromVersion,
		toVersion: migration.toVersion,
		appliedVersions: migration.appliedVersions,
		unsupportedSourceVersion: migration.unsupportedSourceVersion,
		issues,
		changed: before !== after,
	};
}

export async function processMediaFrontmatter(
	app: App,
	file: TFile,
	updater?: (frontmatter: Record<string, unknown>) => void,
): Promise<MediaFrontmatterProcessResult | null> {
	let result: MediaFrontmatterProcessResult | null = null;
	await app.fileManager.processFrontMatter(file, (frontmatter) => {
		if (!frontmatter || typeof frontmatter !== "object") {
			return;
		}
		const record = frontmatter as Record<string, unknown>;
		updater?.(record);
		result = normalizeMediaFrontmatter(record);
	});
	return result;
}

export async function cleanMediaFrontmatter(
	app: App,
	file: TFile,
): Promise<MediaFrontmatterProcessResult | null> {
	return processMediaFrontmatter(app, file);
}
