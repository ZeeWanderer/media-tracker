import {CURRENT_MEDIA_SCHEMA_VERSION, MEDIA_SCHEMA_VERSION_KEY, type LatestMediaSnapshot} from "./schema";

export type MediaMigrationResult = {
	fromVersion: number;
	toVersion: number;
	appliedVersions: number[];
	unsupportedSourceVersion?: number;
};

export type MediaSnapshotMigrationResult = MediaMigrationResult & {
	snapshot: LatestMediaSnapshot;
};

export function readMediaSchemaVersion(frontmatter: Record<string, unknown>): number {
	const raw = frontmatter[MEDIA_SCHEMA_VERSION_KEY];
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return Math.max(0, Math.floor(raw));
	}
	if (typeof raw === "string") {
		const parsed = Number.parseInt(raw, 10);
		if (Number.isFinite(parsed)) {
			return Math.max(0, parsed);
		}
	}
	return 0;
}

export function migrateMediaSnapshotToLatest(
	fromVersion: number,
	snapshot: LatestMediaSnapshot,
): MediaSnapshotMigrationResult {
	// Current baseline contains only the latest schema. We intentionally do not
	// keep migration chains from historical versions in this codebase.
	const unsupportedSourceVersion = fromVersion === 0 || fromVersion === CURRENT_MEDIA_SCHEMA_VERSION
		? undefined
		: fromVersion;

	return {
		snapshot,
		fromVersion,
		toVersion: CURRENT_MEDIA_SCHEMA_VERSION,
		appliedVersions: [],
		unsupportedSourceVersion,
	};
}
