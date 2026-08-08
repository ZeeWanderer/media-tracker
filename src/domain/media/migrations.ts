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

type MediaMigrationStep = {
	toVersion: number;
	migrate: (snapshot: LatestMediaSnapshot) => LatestMediaSnapshot;
};

function migrateV3ToV4(snapshot: LatestMediaSnapshot): LatestMediaSnapshot {
	return {
		...snapshot,
		alternateTitles: snapshot.alternateTitles ? [...snapshot.alternateTitles] : undefined,
	};
}

function migrateV4ToV5(snapshot: LatestMediaSnapshot): LatestMediaSnapshot {
	return {
		...snapshot,
		repeatProgress: snapshot.repeatProgress,
		repeatProgressLabel: snapshot.repeatProgressLabel,
		repeatProgressUnit: snapshot.repeatProgressUnit,
		repeatSeason: snapshot.repeatSeason,
		repeatEpisode: snapshot.repeatEpisode,
	};
}

const MEDIA_MIGRATION_STEPS = new Map<number, MediaMigrationStep>([
	[3, {toVersion: 4, migrate: migrateV3ToV4}],
	[4, {toVersion: 5, migrate: migrateV4ToV5}],
]);

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

	if (fromVersion !== 0 && fromVersion !== CURRENT_MEDIA_SCHEMA_VERSION) {
		let version = fromVersion;
		while (version < CURRENT_MEDIA_SCHEMA_VERSION) {
			const step = MEDIA_MIGRATION_STEPS.get(version);
			if (!step) {
				unsupportedSourceVersion = fromVersion;
				break;
			}
			migratedSnapshot = step.migrate(migratedSnapshot);
			version = step.toVersion;
			appliedVersions.push(version);
		}
		if (fromVersion > CURRENT_MEDIA_SCHEMA_VERSION) {
			unsupportedSourceVersion = fromVersion;
		}
	}
	migratedSnapshot.version = CURRENT_MEDIA_SCHEMA_VERSION;

	return {
		snapshot: migratedSnapshot,
		fromVersion,
		toVersion: CURRENT_MEDIA_SCHEMA_VERSION,
		appliedVersions,
		unsupportedSourceVersion,
	};
}
