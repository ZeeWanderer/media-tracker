import assert from "node:assert/strict";
import test from "node:test";
import {setRequestUrlHandler} from "obsidian";
import {DesktopFaviconCache} from "../src/infra/cache/faviconCache.ts";

function createAdapter(files) {
	const existing = new Map(Object.entries(files));
	const calls = {
		exists: [],
		read: [],
		request: 0,
		write: 0,
		writeBinary: 0,
	};
	return {
		calls,
		async exists(path) {
			calls.exists.push(path);
			return existing.has(path);
		},
		async read(path) {
			calls.read.push(path);
			return existing.get(path);
		},
		getResourcePath(path) {
			return `app://vault/${path}`;
		},
		async write() {
			calls.write += 1;
			throw new Error("Warm cache must not write.");
		},
		async writeBinary() {
			calls.writeBinary += 1;
			throw new Error("Warm cache must not write binary data.");
		},
	};
}

test("warms restart favicons from disk without network access", async () => {
	const cacheRoot = ".obsidian/plugins/media-tracker/cache/favicons";
	const fileName = "cached-example-12345678.png";
	const adapter = createAdapter({
		[`${cacheRoot}/index.json`]: JSON.stringify({
			version: 1,
			entries: {
				"https://cached.example": {
					fileName,
					contentType: "image/png",
					updated: 1,
					byteLength: 128,
				},
			},
		}),
		[`${cacheRoot}/${fileName}`]: "binary-placeholder",
	});
	setRequestUrlHandler(async () => {
		adapter.calls.request += 1;
		throw new Error("Warm cache unexpectedly used the network.");
	});
	const cache = new DesktopFaviconCache({
		vault: {configDir: ".obsidian", adapter},
	}, "media-tracker");

	const first = await cache.warmFromDisk([
		"https://cached.example/one",
		"https://cached.example/two",
		"https://missing.example/page",
	]);

	assert.deepEqual(first, {requested: 2, memoryHits: 0, diskHits: 1});
	assert.equal(adapter.calls.request, 0);
	assert.deepEqual(adapter.calls.read, [`${cacheRoot}/index.json`]);
	assert.equal(
		cache.getMemoryCachedFavicon("https://cached.example/anything"),
		`app://vault/${cacheRoot}/${fileName}`,
	);

	const second = await cache.warmFromDisk(["https://cached.example/three"]);
	assert.deepEqual(second, {requested: 1, memoryHits: 1, diskHits: 0});
	assert.equal(adapter.calls.request, 0);
	cache.dispose();
	assert.equal(await cache.ensureFavicon("https://cached.example/four"), null);
});

test("discards an in-flight favicon response after disposal", async () => {
	const adapter = createAdapter({});
	let markRequestStarted;
	const requestStarted = new Promise((resolve) => {
		markRequestStarted = resolve;
	});
	let releaseRequest;
	const requestGate = new Promise((resolve) => {
		releaseRequest = resolve;
	});
	setRequestUrlHandler(async () => {
		adapter.calls.request += 1;
		markRequestStarted();
		await requestGate;
		return {
			status: 200,
			arrayBuffer: new ArrayBuffer(4),
			headers: {"content-type": "image/png"},
			text: "",
		};
	});
	const cache = new DesktopFaviconCache({
		vault: {configDir: ".obsidian", adapter},
	}, "media-tracker");

	const pending = cache.ensureFavicon("https://network.example/page");
	await requestStarted;
	cache.dispose();
	releaseRequest();

	assert.equal(await pending, null);
	assert.equal(adapter.calls.request, 1);
	assert.equal(adapter.calls.write, 0);
	assert.equal(adapter.calls.writeBinary, 0);
});
