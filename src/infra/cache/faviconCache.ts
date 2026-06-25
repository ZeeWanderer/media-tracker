import {App, DataAdapter, requestUrl} from "obsidian";
import {
	getFaviconCacheKey as getDomainFaviconCacheKey,
	toLinkUrl,
} from "../../domain/media/links";
import {ensureAdapterDirectory} from "../storage/adapterPath";
import {getPluginCacheDirectory} from "../storage/pluginPaths";

const FAVICON_CACHE_VERSION = 1;
const FAVICON_INDEX_FILE = "index.json";
const DEFAULT_MAX_MEMORY_ENTRIES = 128;
const DEFAULT_MAX_MEMORY_BYTES = 4 * 1024 * 1024;

type FaviconDiskEntry = {
	fileName: string;
	contentType: string;
	updated: number;
	byteLength: number;
};

type FaviconDiskIndex = {
	version: number;
	entries: Record<string, FaviconDiskEntry>;
};

type FaviconMemoryEntry = {
	url: string;
	byteLength: number;
};

type FetchedFavicon = {
	buffer: ArrayBuffer;
	contentType: string;
};

export type DesktopFaviconCacheOptions = {
	maxMemoryEntries?: number;
	maxMemoryBytes?: number;
};

export function getFaviconCacheKey(link: string): string | null {
	return getDomainFaviconCacheKey(link);
}

function createEmptyDiskIndex(): FaviconDiskIndex {
	return {
		version: FAVICON_CACHE_VERSION,
		entries: {},
	};
}

function normalizeContentType(value: string | undefined): string {
	const normalized = (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	if (normalized === "image/png") {
		return "image/png";
	}
	if (normalized === "image/jpeg") {
		return "image/jpeg";
	}
	if (normalized === "image/gif") {
		return "image/gif";
	}
	if (normalized === "image/webp") {
		return "image/webp";
	}
	if (normalized === "image/svg+xml") {
		return "image/svg+xml";
	}
	if (normalized === "image/vnd.microsoft.icon") {
		return "image/vnd.microsoft.icon";
	}
	if (normalized === "image/x-icon") {
		return "image/x-icon";
	}
	return "image/x-icon";
}

function getContentTypeExtension(contentType: string): string {
	switch (contentType) {
		case "image/png":
			return "png";
		case "image/jpeg":
			return "jpg";
		case "image/gif":
			return "gif";
		case "image/webp":
			return "webp";
		case "image/svg+xml":
			return "svg";
		case "image/vnd.microsoft.icon":
		case "image/x-icon":
		default:
			return "ico";
	}
}

function safeHostFromOrigin(origin: string): string {
	try {
		const hostname = new URL(origin).hostname.toLowerCase();
		const safe = hostname.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
		return safe.length ? safe : "favicon";
	} catch {
		return "favicon";
	}
}

function hashKey(value: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function getDiskFileName(origin: string, contentType: string): string {
	const extension = getContentTypeExtension(contentType);
	return `${safeHostFromOrigin(origin)}-${hashKey(origin)}.${extension}`;
}

function getCacheDirectory(app: App, pluginId: string): string {
	return `${getPluginCacheDirectory(app, pluginId)}/favicons`;
}

function getIndexPath(app: App, pluginId: string): string {
	return `${getCacheDirectory(app, pluginId)}/${FAVICON_INDEX_FILE}`;
}

function getCacheFilePath(app: App, pluginId: string, fileName: string): string {
	return `${getCacheDirectory(app, pluginId)}/${fileName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDiskEntry(value: unknown): FaviconDiskEntry | null {
	if (!isRecord(value)) {
		return null;
	}
	const fileName = value.fileName;
	const contentType = value.contentType;
	const updated = value.updated;
	const byteLength = value.byteLength;
	if (typeof fileName !== "string" || !fileName.length) {
		return null;
	}
	if (typeof contentType !== "string" || !contentType.length) {
		return null;
	}
	if (typeof updated !== "number" || !Number.isFinite(updated)) {
		return null;
	}
	if (typeof byteLength !== "number" || !Number.isFinite(byteLength) || byteLength <= 0) {
		return null;
	}
	return {
		fileName,
		contentType: normalizeContentType(contentType),
		updated: Math.floor(updated),
		byteLength: Math.floor(byteLength),
	};
}

function parseDiskIndex(raw: string): FaviconDiskIndex {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed)) {
			return createEmptyDiskIndex();
		}
		const rawEntries = parsed.entries;
		if (!isRecord(rawEntries)) {
			return createEmptyDiskIndex();
		}
		const entries: Record<string, FaviconDiskEntry> = {};
		for (const [key, value] of Object.entries(rawEntries)) {
			const parsedEntry = parseDiskEntry(value);
			if (parsedEntry) {
				entries[key] = parsedEntry;
			}
		}
		return {
			version: FAVICON_CACHE_VERSION,
			entries,
		};
	} catch {
		return createEmptyDiskIndex();
	}
}

function headerLookup(headers: Record<string, string> | undefined, name: string): string | undefined {
	if (!headers) {
		return undefined;
	}
	const lowered = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowered) {
			return value;
		}
	}
	return undefined;
}

function getDeclaredFaviconUrl(html: string, pageUrl: string): string | null {
	try {
		const document = new DOMParser().parseFromString(html, "text/html");
		const links = Array.from(document.querySelectorAll<HTMLLinkElement>("link[href]"));
		const icon = links.find((link) => link.relList.contains("icon"))
			?? links.find((link) => link.rel.toLowerCase() === "apple-touch-icon");
		if (!icon) {
			return null;
		}
		const href = icon.getAttribute("href");
		if (!href) {
			return null;
		}
		const resolved = new URL(href, pageUrl);
		return resolved.protocol === "http:" || resolved.protocol === "https:"
			? resolved.toString()
			: null;
	} catch {
		return null;
	}
}

class FaviconMemoryStore {
	private readonly entries = new Map<string, FaviconMemoryEntry>();
	private bytes = 0;

	constructor(
		private readonly maxEntries: number,
		private readonly maxBytes: number,
	) {}

	clear() {
		this.entries.clear();
		this.bytes = 0;
	}

	get(key: string): string | null {
		const entry = this.entries.get(key);
		if (!entry) {
			return null;
		}
		this.entries.delete(key);
		this.entries.set(key, entry);
		return entry.url;
	}

	set(key: string, url: string, byteLength: number) {
		const previous = this.entries.get(key);
		if (previous) {
			this.bytes -= previous.byteLength;
			this.entries.delete(key);
		}
		const normalizedSize = Math.max(1, Math.floor(byteLength));
		this.entries.set(key, {url, byteLength: normalizedSize});
		this.bytes += normalizedSize;
		this.enforceLimits();
	}

	private enforceLimits() {
		while (this.entries.size > this.maxEntries) {
			this.dropOldest();
		}
		while (this.bytes > this.maxBytes && this.entries.size > 1) {
			this.dropOldest();
		}
		if (this.bytes < 0) {
			this.bytes = 0;
		}
	}

	private dropOldest() {
		const oldest = this.entries.keys().next();
		if (oldest.done) {
			return;
		}
		const oldestKey = oldest.value;
		const entry = this.entries.get(oldestKey);
		if (entry) {
			this.bytes -= entry.byteLength;
		}
		this.entries.delete(oldestKey);
	}
}

export class DesktopFaviconCache {
	private readonly adapter: DataAdapter;
	private readonly memoryStore: FaviconMemoryStore;
	private diskIndex: FaviconDiskIndex | null = null;
	private diskIndexPromise: Promise<FaviconDiskIndex> | null = null;
	private readonly inflight = new Map<string, Promise<string | null>>();

	constructor(
		private readonly app: App,
		private readonly pluginId: string,
		options: DesktopFaviconCacheOptions = {},
	) {
		this.adapter = app.vault.adapter;
		const maxEntries = Math.max(8, Math.floor(options.maxMemoryEntries ?? DEFAULT_MAX_MEMORY_ENTRIES));
		const maxBytes = Math.max(64 * 1024, Math.floor(options.maxMemoryBytes ?? DEFAULT_MAX_MEMORY_BYTES));
		this.memoryStore = new FaviconMemoryStore(maxEntries, maxBytes);
	}

	dispose() {
		this.clearMemory();
		this.inflight.clear();
		this.diskIndex = null;
		this.diskIndexPromise = null;
	}

	clearMemory() {
		this.memoryStore.clear();
	}

	getMemoryCachedFavicon(link: string): string | null {
		const key = getFaviconCacheKey(link);
		if (!key) {
			return null;
		}
		return this.getMemoryCachedByKey(key);
	}

	async ensureFavicon(link: string): Promise<string | null> {
		const key = getFaviconCacheKey(link);
		if (!key) {
			return null;
		}

		const memoryHit = this.getMemoryCachedByKey(key);
		if (memoryHit) {
			return memoryHit;
		}

		const inflight = this.inflight.get(key);
		if (inflight) {
			return inflight;
		}

		const task = this.loadOrFetchFavicon(key, toLinkUrl(link) ?? key);
		this.inflight.set(key, task);
		try {
			return await task;
		} finally {
			this.inflight.delete(key);
		}
	}

	private getMemoryCachedByKey(key: string): string | null {
		return this.memoryStore.get(key);
	}

	private storeMemoryEntry(key: string, url: string, byteLength: number) {
		this.memoryStore.set(key, url, byteLength);
	}

	private async loadOrFetchFavicon(origin: string, pageUrl: string): Promise<string | null> {
		const index = await this.loadDiskIndex();
		const diskEntry = index.entries[origin];
		if (diskEntry) {
			const promoted = await this.promoteDiskEntry(origin, diskEntry);
			if (promoted) {
				return promoted;
			}
			delete index.entries[origin];
			await this.saveDiskIndex(index);
		}
		return this.fetchAndStoreFavicon(origin, pageUrl);
	}

	private async promoteDiskEntry(origin: string, entry: FaviconDiskEntry): Promise<string | null> {
		const path = getCacheFilePath(this.app, this.pluginId, entry.fileName);
		try {
			const exists = await this.adapter.exists(path);
			if (!exists) {
				return null;
			}
			const url = this.adapter.getResourcePath(path);
			this.storeMemoryEntry(origin, url, entry.byteLength);
			return url;
		} catch {
			return null;
		}
	}

	private async fetchFaviconImage(url: string): Promise<FetchedFavicon | null> {
		try {
			const response = await requestUrl({url});
			if (typeof response.status === "number" && response.status >= 400) {
				return null;
			}
			const buffer = response.arrayBuffer;
			if (!buffer || buffer.byteLength === 0) {
				return null;
			}

			const responseContentType = headerLookup(response.headers, "content-type");
			if (responseContentType && !responseContentType.toLowerCase().includes("image/")) {
				return null;
			}
			return {
				buffer,
				contentType: normalizeContentType(responseContentType),
			};
		} catch {
			return null;
		}
	}

	private async discoverFavicon(pageUrl: string): Promise<FetchedFavicon | null> {
		try {
			const response = await requestUrl({url: pageUrl});
			if (typeof response.status === "number" && response.status >= 400) {
				return null;
			}
			const faviconUrl = getDeclaredFaviconUrl(response.text, pageUrl);
			return faviconUrl ? this.fetchFaviconImage(faviconUrl) : null;
		} catch {
			return null;
		}
	}

	private async fetchAndStoreFavicon(origin: string, pageUrl: string): Promise<string | null> {
		const fetched = await this.fetchFaviconImage(`${origin}/favicon.ico`)
			?? await this.discoverFavicon(pageUrl);
		if (!fetched) {
			return null;
		}

		try {
			const {buffer, contentType} = fetched;
			const fileName = getDiskFileName(origin, contentType);
			const cacheDir = getCacheDirectory(this.app, this.pluginId);
			await ensureAdapterDirectory(this.adapter, cacheDir);
			const filePath = getCacheFilePath(this.app, this.pluginId, fileName);
			await this.adapter.writeBinary(filePath, buffer);

			const index = await this.loadDiskIndex();
			const previous = index.entries[origin];
			if (previous && previous.fileName !== fileName) {
				const previousPath = getCacheFilePath(this.app, this.pluginId, previous.fileName);
				try {
					const exists = await this.adapter.exists(previousPath);
					if (exists) {
						await this.adapter.remove(previousPath);
					}
				} catch {
					// Ignore stale file cleanup errors.
				}
			}
			index.entries[origin] = {
				fileName,
				contentType,
				updated: Date.now(),
				byteLength: buffer.byteLength,
			};
			await this.saveDiskIndex(index);

			const url = this.adapter.getResourcePath(filePath);
			this.storeMemoryEntry(origin, url, buffer.byteLength);
			return url;
		} catch {
			return null;
		}
	}

	private async loadDiskIndex(): Promise<FaviconDiskIndex> {
		if (this.diskIndex) {
			return this.diskIndex;
		}
		if (this.diskIndexPromise) {
			return this.diskIndexPromise;
		}

		const path = getIndexPath(this.app, this.pluginId);
		this.diskIndexPromise = (async () => {
			try {
				const exists = await this.adapter.exists(path);
				if (!exists) {
					const empty = createEmptyDiskIndex();
					this.diskIndex = empty;
					return empty;
				}
				const raw = await this.adapter.read(path);
				const parsed = parseDiskIndex(raw);
				this.diskIndex = parsed;
				return parsed;
			} catch {
				const empty = createEmptyDiskIndex();
				this.diskIndex = empty;
				return empty;
			}
		})().finally(() => {
			this.diskIndexPromise = null;
		});

		return this.diskIndexPromise;
	}

	private async saveDiskIndex(index: FaviconDiskIndex): Promise<void> {
		this.diskIndex = index;
		const cacheDir = getCacheDirectory(this.app, this.pluginId);
		await ensureAdapterDirectory(this.adapter, cacheDir);
		const path = getIndexPath(this.app, this.pluginId);
		const raw = JSON.stringify(index);
		await this.adapter.write(path, raw);
	}
}
