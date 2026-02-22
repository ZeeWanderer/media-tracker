import {
	migrateMediaSnapshotToLatest,
	readMediaSchemaVersion,
	type MediaMigrationResult,
} from "./migrations";
import type {LatestMediaSnapshot} from "./schema";
import {
	decodeLatestMediaSnapshot,
	sanitizeLatestMediaSnapshot,
	validateLatestMediaSnapshot,
	type MediaValidationIssue,
} from "./validation";

export type DecodedMediaSnapshotResult = MediaMigrationResult & {
	snapshot: LatestMediaSnapshot;
	issues: MediaValidationIssue[];
};

export function decodeAndValidateMediaSnapshot(frontmatter: Record<string, unknown>): DecodedMediaSnapshotResult {
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
