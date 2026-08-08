import assert from "node:assert/strict";
import test from "node:test";
import {
	normalizeMediaFrontmatter,
} from "../src/domain/media/frontmatter.ts";
import {updateMediaSnapshot} from "../src/infra/storage/mediaFrontmatterStore.ts";
import {
	applyProgressInputToFields,
	applyProgressInputToRepeatFields,
	incrementChapterProgressForType,
	isRepeatProgressCaughtUp,
} from "../src/domain/media/progress.ts";
import {LibraryRefreshCoordinator} from "../src/core/libraryRefreshOrchestrator.ts";

test("normalizes supported v4 frontmatter to latest schema", () => {
	const frontmatter = {
		mediaTrackerVersion: 4,
		type: "series",
		status: "active",
		title: "Example",
		season: "2",
		episode: "3",
		links: [],
	};

	const result = normalizeMediaFrontmatter(frontmatter);

	assert.equal(result.changed, true);
	assert.deepEqual(result.appliedVersions, [5]);
	assert.equal(frontmatter.mediaTrackerVersion, 5);
	assert.equal(frontmatter.season, 2);
	assert.equal(frontmatter.episode, 3);
});

test("normalization is idempotent for current schema", () => {
	const frontmatter = {
		mediaTrackerVersion: 5,
		type: "novel",
		status: "active",
		title: "Example",
		progress: "12",
		progressUnit: "ch",
		links: ["https://example.com/read"],
	};

	const first = normalizeMediaFrontmatter(frontmatter);
	const second = normalizeMediaFrontmatter(frontmatter);

	assert.equal(first.changed, false);
	assert.equal(second.changed, false);
});

test("does not rewrite unsupported schema versions", () => {
	const frontmatter = {
		mediaTrackerVersion: 99,
		type: "series",
		status: "active",
		title: "Future note",
		futureProgressModel: {position: 4},
		links: [],
	};
	const original = structuredClone(frontmatter);

	const result = normalizeMediaFrontmatter(frontmatter);

	assert.equal(result.changed, false);
	assert.equal(result.unsupportedSourceVersion, 99);
	assert.deepEqual(frontmatter, original);
});

test("blocks snapshot mutations for unsupported schema versions", async () => {
	const frontmatter = {
		mediaTrackerVersion: 99,
		type: "series",
		status: "active",
		title: "Future note",
		links: [],
	};
	const original = structuredClone(frontmatter);
	let updaterCalled = false;
	const app = {
		fileManager: {
			async processFrontMatter(_file, updater) {
				updater(frontmatter);
			},
		},
	};

	await assert.rejects(
		() => updateMediaSnapshot(app, {}, (snapshot) => {
			updaterCalled = true;
			snapshot.status = "completed";
		}),
		/unsupported schema v99/,
	);

	assert.equal(updaterCalled, false);
	assert.deepEqual(frontmatter, original);
});

test("allows snapshot mutations for supported schema versions", async () => {
	const frontmatter = {
		mediaTrackerVersion: 4,
		type: "series",
		status: "active",
		title: "Supported note",
		links: [],
	};
	const app = {
		fileManager: {
			async processFrontMatter(_file, updater) {
				updater(frontmatter);
			},
		},
	};

	await updateMediaSnapshot(app, {}, (snapshot) => {
		snapshot.status = "completed";
	});

	assert.equal(frontmatter.mediaTrackerVersion, 5);
	assert.equal(frontmatter.status, "completed");
});

test("applies and compares series repeat progress", () => {
	const current = {
		season: 3,
		episode: 8,
		repeatSeason: 1,
		repeatEpisode: 6,
	};
	const applied = applyProgressInputToRepeatFields("anime", "S3E8", current);

	assert.equal(applied.accepted, true);
	assert.equal(applied.next.repeatSeason, 3);
	assert.equal(applied.next.repeatEpisode, 8);
	assert.equal(isRepeatProgressCaughtUp("anime", {...current, ...applied.next}), true);
});

test("rejects malformed series progress without changing fields", () => {
	const current = {season: 2, episode: 4};
	const applied = applyProgressInputToFields("series", "season two", current);

	assert.equal(applied.accepted, false);
	assert.deepEqual(applied.next, current);
});

test("increments manga special chapters to next whole chapter", () => {
	assert.equal(incrementChapterProgressForType("manga", "12.5"), "13");
	assert.equal(incrementChapterProgressForType("novel", "12.5"), "12.6");
});

test("serializes library refreshes across callers", async () => {
	let releaseRefresh;
	const refreshGate = new Promise((resolve) => {
		releaseRefresh = resolve;
	});
	let refreshCalls = 0;
	const completedRun = {
		startedAt: 1,
		finishedAt: 2,
		durationMs: 1,
		total: 0,
		updated: 0,
		unchanged: 0,
		failed: 0,
		skipped: 0,
		entries: [],
	};
	const coordinator = new LibraryRefreshCoordinator({
		getSettings: () => ({autoOpenUpdateLogOnFailure: false}),
		async runRefresh() {
			refreshCalls += 1;
			await refreshGate;
			return completedRun;
		},
		setActiveUpdateRun: () => {},
		recordCompletedUpdateRun: async () => {},
		openUpdateLog: async () => {},
	});

	const firstRefresh = coordinator.run({items: []});
	assert.equal(coordinator.isRefreshing, true);
	const overlappingRefresh = await coordinator.run({items: []});
	assert.deepEqual(overlappingRefresh, {status: "busy"});
	const overlappingSingleRefresh = await coordinator.runExclusive(async () => "unused");
	assert.deepEqual(overlappingSingleRefresh, {status: "busy"});
	assert.equal(refreshCalls, 1);

	releaseRefresh();
	const result = await firstRefresh;
	assert.equal(result.status, "completed");
	assert.equal(coordinator.isRefreshing, false);
});
