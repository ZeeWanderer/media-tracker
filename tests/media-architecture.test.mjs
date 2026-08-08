import assert from "node:assert/strict";
import test from "node:test";
import {
	decodeMediaSnapshot,
	normalizeMediaFrontmatter,
} from "../src/domain/media/frontmatter.ts";
import {findMediaIdentityConflict} from "../src/domain/media/links.ts";
import {mapMediaSnapshotToRecord} from "../src/domain/media/readModel.ts";
import {
	buildDirectChainFromMedia,
	collapseSeasonMetadata,
	isSeasonCandidate,
} from "../src/infra/api/anilist/seasonModel.ts";
import {isVaultPathInCommitScope} from "../src/infra/git/vaultGitPaths.ts";
import {TrackerRefreshService} from "../src/ui/trackerRefreshService.ts";
import {
	executeRefreshProviderPlan,
	getRefreshProviderPlan,
} from "../src/flows/media/providerSelection.ts";

function createAnimeItem(overrides = {}) {
	return {
		file: {path: "Media/Example/anime.md"},
		title: "Example",
		alternateTitles: [],
		type: "anime",
		status: "active",
		links: [],
		...overrides,
	};
}

test("runs explicit v3 to v5 migration steps and canonicalizes identities", () => {
	const frontmatter = {
		mediaTrackerVersion: 3,
		media: "anime",
		status: "ACTIVE",
		title: "Primary",
		aliases: ["Alias", "Primary"],
		anilist: "https://anilist.co/anime/123/example",
		imdb: "https://www.imdb.com/title/tt1234567/",
		links: {watch: "https://example.com/watch"},
	};

	const result = normalizeMediaFrontmatter(frontmatter);
	const decoded = decodeMediaSnapshot(frontmatter);

	assert.deepEqual(result.appliedVersions, [4, 5]);
	assert.equal(frontmatter.mediaTrackerVersion, 5);
	assert.equal(frontmatter.type, "anime");
	assert.equal(frontmatter.media, "anime");
	assert.deepEqual(decoded.snapshot.alternateTitles, ["Alias"]);
	assert.equal(decoded.snapshot.anilistId, 123);
	assert.equal(decoded.snapshot.imdbId, "tt1234567");
	assert.deepEqual(decoded.snapshot.links, ["https://example.com/watch"]);
});

test("maps snapshots to pure records with production folder-title fallback", () => {
	const {snapshot} = decodeMediaSnapshot({
		mediaTrackerVersion: 5,
		type: "series",
		status: "active",
		season: 2,
		episode: 3,
		links: [],
	});
	const nested = mapMediaSnapshotToRecord(snapshot, {
		basename: "series",
		parentName: "Folder title",
		parentPath: "Media/Folder title",
		baseFolder: "Media",
	});
	const direct = mapMediaSnapshotToRecord(snapshot, {
		basename: "series",
		parentName: "Media",
		parentPath: "Media",
		baseFolder: "Media",
	});

	assert.equal(nested?.title, "Folder title");
	assert.equal(nested?.progress, "S2E3");
	assert.equal(direct?.title, "series");
	assert.equal("file" in nested, false);
});

test("detects duplicate IMDB and any stored AniList season identity", () => {
	const first = {title: "First", imdbId: "tt1234567"};
	const second = {title: "Second", anilistId: 10, anilistIds: [10, 20, 30]};

	assert.deepEqual(
		findMediaIdentityConflict([first, second], {imdbId: "TT1234567"}),
		{kind: "imdb", value: "TT1234567", item: first},
	);
	assert.deepEqual(
		findMediaIdentityConflict([first, second], {anilistId: 20}),
		{kind: "anilist", value: "20", item: second},
	);
	assert.equal(findMediaIdentityConflict([first, second], {anilistId: 99}), null);
});

test("keeps named anime specials out of season chains", () => {
	const firstInspector = {
		id: 1,
		type: "ANIME",
		format: "ONA",
		title: {english: "PSYCHO-PASS 3: First Inspector"},
	};
	const splitCour = {
		id: 2,
		type: "ANIME",
		format: "ONA",
		title: {english: "Example Season 2 Part 2"},
	};
	const movie = {
		id: 3,
		type: "ANIME",
		format: "MOVIE",
		title: {english: "Example Movie"},
	};

	assert.equal(isSeasonCandidate(firstInspector), false);
	assert.equal(isSeasonCandidate(splitCour), true);
	assert.equal(isSeasonCandidate(movie), false);
});

test("builds direct TV season chains without standalone sequels", () => {
	const prequel = {id: 1, type: "ANIME", format: "TV", title: {english: "Example"}};
	const sequel = {id: 3, type: "ANIME", format: "TV", title: {english: "Example 3"}};
	const current = {
		id: 2,
		type: "ANIME",
		format: "TV",
		title: {english: "Example 2"},
		relations: {
			edges: [
				{relationType: "PREQUEL", node: prequel},
				{relationType: "SEQUEL", node: sequel},
			],
		},
	};

	assert.deepEqual(buildDirectChainFromMedia(current).map((media) => media.id), [1, 2, 3]);
});

test("collapses split cours into one displayed season", () => {
	const seasonIds = [1, 2, 3];
	const seasonById = new Map([
		[1, {id: 1, type: "ANIME", format: "TV", title: {english: "Example"}, episodes: 12}],
		[2, {id: 2, type: "ANIME", format: "TV", title: {english: "Example Part 2"}, episodes: 12}],
		[3, {id: 3, type: "ANIME", format: "TV", title: {english: "Example 2"}, episodes: 10}],
	]);
	const collapsed = collapseSeasonMetadata(seasonIds, seasonById, new Map());

	assert.equal(collapsed.seasonCount, 2);
	assert.equal(collapsed.seasonNumberById.get(1), 1);
	assert.equal(collapsed.seasonNumberById.get(2), 1);
	assert.equal(collapsed.seasonNumberById.get(3), 2);
	assert.deepEqual(Object.fromEntries(collapsed.seasonEpisodes), {"1": 24, "2": 10});
});

test("plans and executes TMDB fallback only for identified anime", async () => {
	const item = createAnimeItem({imdbId: "tt1234567"});
	const calls = [];
	const result = await executeRefreshProviderPlan(
		getRefreshProviderPlan(item),
		{
			async anilist() {
				calls.push("anilist");
				return {provider: "anilist", status: "failed", message: "AniList failed."};
			},
			async tmdb() {
				calls.push("tmdb");
				return {provider: "tmdb", status: "updated", message: "TMDB updated."};
			},
		},
	);

	assert.deepEqual(getRefreshProviderPlan(item), {primary: "anilist", fallbackOnFailure: "tmdb"});
	assert.deepEqual(calls, ["anilist", "tmdb"]);
	assert.equal(result?.result.provider, "tmdb");
	assert.deepEqual(result?.providersChecked, ["anilist", "tmdb"]);
	assert.deepEqual(result?.attempts.map((attempt) => attempt.provider), ["anilist", "tmdb"]);
});

test("does not invoke TMDB fallback for anime without a TMDB identity", async () => {
	const item = createAnimeItem();
	let tmdbCalls = 0;
	const result = await executeRefreshProviderPlan(
		getRefreshProviderPlan(item),
		{
			async anilist() {
				return {provider: "anilist", status: "failed", message: "AniList failed."};
			},
			async tmdb() {
				tmdbCalls += 1;
				return {provider: "tmdb", status: "updated", message: "Unexpected."};
			},
		},
	);

	assert.deepEqual(getRefreshProviderPlan(item), {primary: "anilist", fallbackOnFailure: undefined});
	assert.equal(tmdbCalls, 0);
	assert.equal(result?.result.provider, "anilist");
});

test("matches Git commit scope while excluding generated plugin state", () => {
	const scope = {
		mediaRoot: "Media",
		pluginRoot: ".obsidian/plugins/media-tracker",
		excludedPluginRoots: [
			".obsidian/plugins/media-tracker/cache",
			".obsidian/plugins/media-tracker/logs",
		],
		workspacePath: ".obsidian/workspace.json",
	};

	assert.equal(isVaultPathInCommitScope("Media/Show/series.md", scope), true);
	assert.equal(isVaultPathInCommitScope(".obsidian/plugins/media-tracker/main.js", scope), true);
	assert.equal(isVaultPathInCommitScope(".obsidian/workspace.json", scope), true);
	assert.equal(isVaultPathInCommitScope(".obsidian/plugins/media-tracker/cache/icon.png", scope), false);
	assert.equal(isVaultPathInCommitScope(".obsidian/plugins/media-tracker/logs/plugin.log", scope), false);
	assert.equal(isVaultPathInCommitScope("Media Archive/Show.md", scope), false);
});

test("subscribes refresh UI only while its view is open", () => {
	let subscriptions = 0;
	let unsubscriptions = 0;
	const listeners = new Set();
	const refreshCoordinator = {
		isRefreshing: false,
		current: 0,
		total: 0,
		subscribe(listener) {
			subscriptions += 1;
			listeners.add(listener);
			return () => {
				if (listeners.delete(listener)) {
					unsubscriptions += 1;
				}
			};
		},
	};
	const service = new TrackerRefreshService({
		refreshCoordinator,
		getSettings: () => ({updateNotificationMode: "quiet"}),
		logger: {info() {}, error() {}},
		onStateChange() {},
	});

	assert.equal(subscriptions, 0);
	service.start();
	service.start();
	assert.equal(subscriptions, 1);
	assert.equal(listeners.size, 1);
	service.dispose();
	service.dispose();
	assert.equal(unsubscriptions, 1);
	assert.equal(listeners.size, 0);
	service.start();
	assert.equal(subscriptions, 2);
	assert.equal(listeners.size, 1);
	service.dispose();
});
