import {App, TFile} from "obsidian";
import {
	CURRENT_MEDIA_SCHEMA_VERSION,
	type LatestMediaSnapshot,
	type MediaSnapshotV3,
} from "./schema";
import {
	migrateMediaSnapshotToLatest,
	readMediaSchemaVersion,
	type MediaMigrationResult,
	type MediaSnapshotMigrationResult,
} from "./migrations";
import {
	decodeLatestMediaSnapshot,
	encodeLatestMediaSnapshot,
	sanitizeLatestMediaSnapshot,
	validateLatestMediaSnapshot,
	type MediaValidationIssue,
} from "./validation";
import {
	cleanMediaFrontmatter,
	normalizeMediaFrontmatter,
	processMediaFrontmatter,
	type MediaFrontmatterProcessResult,
} from "./store";

export type MediaFrontmatterUpdater = (frontmatter: Record<string, unknown>) => void;
export type MediaSnapshotUpdater = (snapshot: LatestMediaSnapshot) => LatestMediaSnapshot | void;

export type MediaSnapshotDecodeResult = MediaMigrationResult & {
	snapshot: LatestMediaSnapshot;
	issues: MediaValidationIssue[];
};

export function decodeMediaSnapshot(frontmatter: Record<string, unknown>): MediaSnapshotDecodeResult {
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

export {
	CURRENT_MEDIA_SCHEMA_VERSION,
	cleanMediaFrontmatter,
	decodeLatestMediaSnapshot,
	encodeLatestMediaSnapshot,
	migrateMediaSnapshotToLatest,
	normalizeMediaFrontmatter,
	processMediaFrontmatter,
	readMediaSchemaVersion,
	sanitizeLatestMediaSnapshot,
	validateLatestMediaSnapshot,
};

export type {
	LatestMediaSnapshot,
	MediaFrontmatterProcessResult,
	MediaMigrationResult,
	MediaSnapshotMigrationResult,
	MediaSnapshotV3,
	MediaValidationIssue,
};
