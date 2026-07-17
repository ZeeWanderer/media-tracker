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
	const appliedVersions: number[] = [];
	let migratedSnapshot: LatestMediaSnapshot = {
		...snapshot,
		version: CURRENT_MEDIA_SCHEMA_VERSION,
	};
	let unsupportedSourceVersion: number | undefined;

	switch (fromVersion) {
		case 0:
		case CURRENT_MEDIA_SCHEMA_VERSION:
			break;
		case 3:
			appliedVersions.push(4, CURRENT_MEDIA_SCHEMA_VERSION);
			break;
		case 4:
			appliedVersions.push(CURRENT_MEDIA_SCHEMA_VERSION);
			break;
		default:
			unsupportedSourceVersion = fromVersion;
			break;
	}

	return {
		snapshot: migratedSnapshot,
		fromVersion,
		toVersion: CURRENT_MEDIA_SCHEMA_VERSION,
		appliedVersions,
		unsupportedSourceVersion,
	};
}
