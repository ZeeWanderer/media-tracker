import assert from "node:assert/strict";
import test from "node:test";
import {TFile} from "obsidian";
import {ViewRefreshManager} from "../src/core/viewRefreshManager.ts";
import {createMediaNoteFromDraft} from "../src/flows/media/createFlow.ts";
import {
	addLinkToMediaNote,
	deleteMediaNote,
	startMediaNoteRepeat,
	updateMediaNoteProgress,
	updateMediaNoteStatus,
} from "../src/flows/media/maintenanceFlow.ts";
import {executeTrackedMediaRefresh} from "../src/flows/media/refreshFlow.ts";
import {listMediaItems} from "../src/infra/storage/mediaLibraryStore.ts";
import {PluginLogger} from "../src/infra/logging/pluginLogger.ts";
import {createFakeVaultApp} from "./support/fakeVault.mjs";

function createDraft(overrides = {}) {
	return {
		title: "Lifecycle Show",
		type: "anime",
		status: "active",
		season: "1",
		episode: "2",
		anilistId: "123",
		links: ["https://watch.example/lifecycle"],
		...overrides,
	};
}

test("creates, mutates, disambiguates, and deletes media notes through production flows", async () => {
	const fixture = createFakeVaultApp();
	const settings = {mediaFolder: "Media"};
	const first = await createMediaNoteFromDraft(fixture.app, settings, createDraft());

	assert.equal(first.status, "created");
	assert.equal(first.file.path, "Media/Lifecycle Show/anime.md");
	assert.equal(first.disambiguated, false);
	assert.equal(fixture.getFrontmatter(first.file.path).mediaTrackerVersion, 5);
	assert.equal(fixture.getFrontmatter(first.file.path).anilistId, 123);
	assert.equal(listMediaItems(fixture.app, settings).length, 1);

	const duplicate = await createMediaNoteFromDraft(
		fixture.app,
		settings,
		createDraft({title: "Different title"}),
	);
	assert.equal(duplicate.status, "rejected");
	assert.equal(duplicate.reason, "id_conflict");
	assert.equal(duplicate.conflict.kind, "anilist");

	await updateMediaNoteStatus(fixture.app, first.file, "on-hold");
	await updateMediaNoteProgress(fixture.app, first.file, "anime", "S2E4");
	await addLinkToMediaNote(fixture.app, first.file, "https://reader.example/extra");
	assert.equal(await startMediaNoteRepeat(fixture.app, first.file, "anime"), true);
	const updated = listMediaItems(fixture.app, settings)[0];
	assert.equal(updated.status, "on-hold");
	assert.equal(updated.progress, "S2E4");
	assert.equal(updated.repeatProgress, "S1E0");
	assert.deepEqual(updated.links, [
		"https://watch.example/lifecycle",
		"https://reader.example/extra",
	]);

	const second = await createMediaNoteFromDraft(
		fixture.app,
		settings,
		createDraft({anilistId: "456"}),
	);
	assert.equal(second.status, "created");
	assert.equal(second.file.path, "Media/Lifecycle Show/anime-2.md");
	assert.equal(second.disambiguated, true);

	await deleteMediaNote(fixture.app, second.file, settings.mediaFolder);
	assert.equal(fixture.hasPath("Media/Lifecycle Show"), true);
	await deleteMediaNote(fixture.app, first.file, settings.mediaFolder);
	assert.equal(fixture.hasPath("Media/Lifecycle Show"), false);
	assert.equal(fixture.hasPath("Media"), true);

	await fixture.app.vault.createFolder("Media/Parent");
	await fixture.app.vault.createFolder("Media/Parent/Child");
	const nested = await fixture.app.vault.create("Media/Parent/Child/series.md", "---\n---\n");
	await deleteMediaNote(fixture.app, nested, settings.mediaFolder);
	assert.equal(fixture.hasPath("Media/Parent/Child"), false);
	assert.equal(fixture.hasPath("Media/Parent"), false);
	assert.equal(fixture.hasPath("Media"), true);
	assert.deepEqual(fixture.trashCalls.slice(-3), [
		"Media/Parent/Child/series.md",
		"Media/Parent/Child",
		"Media/Parent",
	]);
});

test("executes prioritized refresh queues with fallback accounting and isolated failures", async () => {
	const items = [
		{
			file: {path: "Media/Checked/anime.md"},
			title: "Checked anime",
			type: "anime",
			status: "active",
			links: [],
			anilistLastChecked: 20,
		},
		{
			file: {path: "Media/Never/anime.md"},
			title: "Never checked anime",
			type: "anime",
			status: "active",
			links: [],
			imdbId: "tt1234567",
		},
		{
			file: {path: "Media/Series/series.md"},
			title: "Failing series",
			type: "series",
			status: "active",
			links: [],
		},
		{
			file: {path: "Media/Novel/novel.md"},
			title: "Unrefreshable novel",
			type: "novel",
			status: "active",
			links: [],
		},
	];
	const calls = [];
	const progress = [];
	const snapshots = [];
	const run = await executeTrackedMediaRefresh(
		items,
		async (item) => {
			calls.push(item.title);
			if (item.title === "Failing series") {
				throw new Error("fixture failure");
			}
			if (item.title === "Never checked anime") {
				return {
					provider: "tmdb",
					status: "updated",
					message: "Updated after fallback.",
					providersChecked: ["anilist", "tmdb"],
					attempts: [
						{provider: "anilist", status: "failed", message: "AniList failed."},
						{provider: "tmdb", status: "updated", message: "TMDB updated."},
					],
				};
			}
			return {
				provider: "anilist",
				status: "unchanged",
				message: "No change.",
				providersChecked: ["anilist"],
				attempts: [{provider: "anilist", status: "unchanged", message: "No change."}],
			};
		},
		(current, total) => progress.push([current, total]),
		(snapshot) => snapshots.push(structuredClone(snapshot)),
	);

	assert.deepEqual(
		calls.filter((title) => title.includes("anime")),
		["Never checked anime", "Checked anime"],
	);
	assert.equal(calls.includes("Unrefreshable novel"), false);
	assert.equal(run.total, 3);
	assert.equal(run.updated, 1);
	assert.equal(run.unchanged, 1);
	assert.equal(run.failed, 1);
	assert.equal(run.skipped, 0);
	assert.deepEqual(run.providerProgress, {
		anilist: {total: 2, completed: 2},
		tmdb: {total: 2, completed: 2},
	});
	assert.deepEqual(progress[0], [0, 3]);
	assert.deepEqual(progress.at(-1), [3, 3]);
	assert.equal(snapshots.at(-1).entries.length, 3);
	assert.match(
		run.entries.find((entry) => entry.title === "Failing series").message,
		/fixture failure/,
	);
});

test("debounces relevant view renders and cancels pending work on dispose", async (t) => {
	const previousWindow = globalThis.window;
	globalThis.window = globalThis;
	t.after(() => {
		if (previousWindow === undefined) {
			delete globalThis.window;
		} else {
			globalThis.window = previousWindow;
		}
	});
	let invalidations = 0;
	let trackerRenders = 0;
	let updateLogRenders = 0;
	let pluginLogRenders = 0;
	const manager = new ViewRefreshManager({
		getMediaFolder: () => "Media",
		invalidateTrackerItemCaches: () => {
			invalidations += 1;
		},
		refreshTrackerViews: () => {
			trackerRenders += 1;
		},
		refreshUpdateLogViews: () => {
			updateLogRenders += 1;
		},
		refreshPluginLogViews: () => {
			pluginLogRenders += 1;
		},
	});

	manager.handleMetadataMutation(new TFile("Media/One/anime.md"));
	manager.handleMetadataMutation(new TFile("Media/Two/series.md"));
	manager.handleMetadataMutation(new TFile("Notes/ignored.md"));
	assert.equal(invalidations, 2);
	await new Promise((resolve) => setTimeout(resolve, 180));
	assert.equal(trackerRenders, 1);
	assert.equal(updateLogRenders, 0);
	assert.equal(pluginLogRenders, 0);

	manager.scheduleRefresh();
	manager.dispose();
	await new Promise((resolve) => setTimeout(resolve, 180));
	assert.equal(trackerRenders, 1);
	assert.equal(updateLogRenders, 0);
	assert.equal(pluginLogRenders, 0);
});

test("logger disposal drains an active flush without scheduling more work", async (t) => {
	const previousWindow = globalThis.window;
	globalThis.window = globalThis;
	t.after(() => {
		if (previousWindow === undefined) {
			delete globalThis.window;
		} else {
			globalThis.window = previousWindow;
		}
	});
	const directories = new Set();
	const files = new Map();
	let releaseFirstWrite;
	const firstWriteGate = new Promise((resolve) => {
		releaseFirstWrite = resolve;
	});
	let writes = 0;
	let appends = 0;
	const adapter = {
		async exists(path) {
			return directories.has(path) || files.has(path);
		},
		async mkdir(path) {
			directories.add(path);
		},
		async write(path, payload) {
			writes += 1;
			if (writes === 1) {
				await firstWriteGate;
			}
			files.set(path, payload);
		},
		async append(path, payload) {
			appends += 1;
			files.set(path, `${files.get(path) ?? ""}${payload}`);
		},
		async list(directory) {
			return {
				files: Array.from(files.keys()).filter((file) => file.startsWith(`${directory}/`)),
				folders: [],
			};
		},
		async remove(path) {
			files.delete(path);
		},
	};
	const logger = new PluginLogger({
		vault: {configDir: ".obsidian", adapter},
	}, "media-tracker");

	logger.info("fixture", "first", "First entry.");
	const activeFlush = logger.flush();
	logger.info("fixture", "second", "Second entry.");
	const dispose = logger.dispose();
	releaseFirstWrite();
	await Promise.all([activeFlush, dispose]);
	logger.info("fixture", "ignored", "Must not be queued after disposal.");

	assert.equal(writes, 1);
	assert.equal(appends, 1);
	const payload = Array.from(files.values()).join("");
	assert.match(payload, /"event":"first"/);
	assert.match(payload, /"event":"second"/);
	assert.doesNotMatch(payload, /"event":"ignored"/);
});
