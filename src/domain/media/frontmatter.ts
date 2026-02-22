import {App, TFile} from "obsidian";
import {
	type LatestMediaSnapshot,
} from "./schema";
import {
	migrateMediaSnapshotToLatest,
	readMediaSchemaVersion,
	type MediaMigrationResult,
} from "./migrations";
import {
	decodeLatestMediaSnapshot,
	encodeLatestMediaSnapshot,
	sanitizeLatestMediaSnapshot,
	validateLatestMediaSnapshot,
	type MediaValidationIssue,
} from "./validation";

export type MediaFrontmatterUpdater = (frontmatter: Record<string, unknown>) => void;
export type MediaSnapshotUpdater = (snapshot: LatestMediaSnapshot) => LatestMediaSnapshot | void;

export type MediaFrontmatterProcessResult = MediaMigrationResult & {
	issues: MediaValidationIssue[];
	changed: boolean;
};

export type MediaSnapshotDecodeResult = MediaMigrationResult & {
	snapshot: LatestMediaSnapshot;
	issues: MediaValidationIssue[];
};

function decodeAndValidateMediaSnapshot(frontmatter: Record<string, unknown>): MediaSnapshotDecodeResult {
	const fromVersion = readMediaSchemaVersion(frontmatter);
	const decoded = decodeLatestMediaSnapshot(frontmatter);
	const migration = migrateMediaSnapshotToLatest(fromVersion, decoded);
	const snapshot = sanitizeLatestMediaSnapshot(migration.snapshot);
	const issues = validateLatestMediaSnapshot(snapshot);
	if (migration.unsupportedSourceVersion !== undefined) {
		issues.push({
			field: "mediaTrackerVersion",
			message: `Schema v${migration.unsupportedSourceVersion} is not supported by this build.`,
			level: "warning",
		});
	}

	return {
		fromVersion: migration.fromVersion,
		toVersion: migration.toVersion,
		appliedVersions: migration.appliedVersions,
		unsupportedSourceVersion: migration.unsupportedSourceVersion,
		snapshot,
		issues,
	};
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
	return decodeAndValidateMediaSnapshot(frontmatter);
}

export function normalizeMediaFrontmatter(frontmatter: Record<string, unknown>): MediaFrontmatterProcessResult {
	const before = stableStringify(frontmatter);
	const decoded = decodeAndValidateMediaSnapshot(frontmatter);
	encodeLatestMediaSnapshot(decoded.snapshot, frontmatter);
	const after = stableStringify(frontmatter);
	return {
		fromVersion: decoded.fromVersion,
		toVersion: decoded.toVersion,
		appliedVersions: decoded.appliedVersions,
		unsupportedSourceVersion: decoded.unsupportedSourceVersion,
		issues: decoded.issues,
		changed: before !== after,
	};
}

export async function processMediaFrontmatter(
	app: App,
	file: TFile,
	updater?: MediaFrontmatterUpdater,
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

export async function updateMediaFrontmatter(
	app: App,
	file: TFile,
	updater: MediaFrontmatterUpdater,
): Promise<MediaFrontmatterProcessResult | null> {
	return processMediaFrontmatter(app, file, updater);
}

function cloneSnapshot(snapshot: LatestMediaSnapshot): LatestMediaSnapshot {
	return {
		...snapshot,
		links: [...(snapshot.links ?? [])],
		anilistIds: snapshot.anilistIds ? [...snapshot.anilistIds] : undefined,
		tmdbSeasonEpisodes: snapshot.tmdbSeasonEpisodes ? {...snapshot.tmdbSeasonEpisodes} : undefined,
		anilistSeasonEpisodes: snapshot.anilistSeasonEpisodes ? {...snapshot.anilistSeasonEpisodes} : undefined,
	};
}

export async function updateMediaSnapshot(
	app: App,
	file: TFile,
	updater: MediaSnapshotUpdater,
): Promise<MediaFrontmatterProcessResult | null> {
	return updateMediaFrontmatter(app, file, (frontmatter) => {
		const decoded = decodeMediaSnapshot(frontmatter);
		const baseSnapshot = cloneSnapshot(decoded.snapshot);
		const updatedSnapshot = updater(baseSnapshot) ?? baseSnapshot;
		encodeLatestMediaSnapshot(sanitizeLatestMediaSnapshot(updatedSnapshot), frontmatter);
	});
}

export async function normalizeMediaFilesFrontmatter(app: App, files: TFile[]): Promise<number> {
	let changed = 0;
	for (const file of files) {
		const result = await cleanMediaFrontmatter(app, file);
		if (result?.changed) {
			changed += 1;
		}
	}
	return changed;
}
