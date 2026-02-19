import {App, DataAdapter} from "obsidian";

export type PluginLogLevel = "debug" | "info" | "warn" | "error";

export type PluginLogEntry = {
	timestamp: number;
	level: PluginLogLevel;
	scope: string;
	event: string;
	message: string;
	meta?: Record<string, unknown>;
};

export type PluginLoggerOptions = {
	enabled?: boolean;
	level?: PluginLogLevel;
	maxLogFiles?: number;
	maxRecentEntries?: number;
};

const LOG_DIR = "logs";
const LOG_FILE_EXT = ".ndjson";
const DEFAULT_MAX_LOG_FILES = 14;
const DEFAULT_MAX_RECENT_ENTRIES = 1000;

const LEVEL_VALUE: Record<PluginLogLevel, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function getPluginRoot(app: App, pluginId: string): string {
	return `${app.vault.configDir}/plugins/${pluginId}`;
}

export function getPluginLogDirectory(app: App, pluginId: string): string {
	return `${getPluginRoot(app, pluginId)}/${LOG_DIR}`;
}

function getLogFileName(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}${LOG_FILE_EXT}`;
}

function getLogFilePath(app: App, pluginId: string, date: Date): string {
	return `${getPluginLogDirectory(app, pluginId)}/${getLogFileName(date)}`;
}

async function ensureDirectory(adapter: DataAdapter, path: string): Promise<void> {
	const parts = path.split("/").filter((part) => part.length);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		const exists = await adapter.exists(current);
		if (!exists) {
			await adapter.mkdir(current);
		}
	}
}

function parseEntry(value: string): PluginLogEntry | null {
	try {
		const parsed = JSON.parse(value) as Partial<PluginLogEntry>;
		if (!parsed || typeof parsed !== "object") {
			return null;
		}
		const timestamp = parsed.timestamp;
		const level = parsed.level;
		const scope = parsed.scope;
		const event = parsed.event;
		const message = parsed.message;
		if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
			return null;
		}
		if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
			return null;
		}
		if (typeof scope !== "string" || !scope.length) {
			return null;
		}
		if (typeof event !== "string" || !event.length) {
			return null;
		}
			if (typeof message !== "string") {
				return null;
			}
			const meta = parsed.meta && typeof parsed.meta === "object" && !Array.isArray(parsed.meta)
				? parsed.meta
				: undefined;
		return {
			timestamp,
			level,
			scope,
			event,
			message,
			meta,
		};
	} catch {
		return null;
	}
}

function safeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
	if (!meta) {
		return undefined;
	}
	try {
		const serialized = JSON.stringify(meta);
		return JSON.parse(serialized) as Record<string, unknown>;
	} catch {
		return {
			serializationError: "Failed to serialize meta payload",
		};
	}
}

export class PluginLogger {
	private readonly adapter: DataAdapter;
	private queue: string[] = [];
	private recentEntries: PluginLogEntry[] = [];
	private flushTimer: number | null = null;
	private flushing = false;
	private enabled: boolean;
	private level: PluginLogLevel;
	private maxLogFiles: number;
	private maxRecentEntries: number;

	constructor(
		private readonly app: App,
		private readonly pluginId: string,
		options: PluginLoggerOptions = {},
	) {
		this.adapter = app.vault.adapter;
		this.enabled = options.enabled ?? true;
		this.level = options.level ?? "info";
		this.maxLogFiles = Math.max(1, Math.floor(options.maxLogFiles ?? DEFAULT_MAX_LOG_FILES));
		this.maxRecentEntries = Math.max(100, Math.floor(options.maxRecentEntries ?? DEFAULT_MAX_RECENT_ENTRIES));
	}

	updateOptions(options: PluginLoggerOptions) {
		if (typeof options.enabled === "boolean") {
			this.enabled = options.enabled;
		}
		if (options.level) {
			this.level = options.level;
		}
		if (typeof options.maxLogFiles === "number" && Number.isFinite(options.maxLogFiles)) {
			this.maxLogFiles = Math.max(1, Math.floor(options.maxLogFiles));
		}
		if (typeof options.maxRecentEntries === "number" && Number.isFinite(options.maxRecentEntries)) {
			this.maxRecentEntries = Math.max(100, Math.floor(options.maxRecentEntries));
		}
	}

	debug(scope: string, event: string, message: string, meta?: Record<string, unknown>) {
		this.log("debug", scope, event, message, meta);
	}

	info(scope: string, event: string, message: string, meta?: Record<string, unknown>) {
		this.log("info", scope, event, message, meta);
	}

	warn(scope: string, event: string, message: string, meta?: Record<string, unknown>) {
		this.log("warn", scope, event, message, meta);
	}

	error(scope: string, event: string, message: string, meta?: Record<string, unknown>) {
		this.log("error", scope, event, message, meta);
	}

	private shouldLog(level: PluginLogLevel): boolean {
		return LEVEL_VALUE[level] >= LEVEL_VALUE[this.level];
	}

	log(level: PluginLogLevel, scope: string, event: string, message: string, meta?: Record<string, unknown>) {
		if (!this.enabled || !this.shouldLog(level)) {
			return;
		}
		const entry: PluginLogEntry = {
			timestamp: Date.now(),
			level,
			scope,
			event,
			message,
			meta: safeMeta(meta),
		};
		this.recentEntries.push(entry);
		if (this.recentEntries.length > this.maxRecentEntries) {
			this.recentEntries.splice(0, this.recentEntries.length - this.maxRecentEntries);
		}

		this.queue.push(JSON.stringify(entry));
		this.scheduleFlush();
	}

	private scheduleFlush() {
		if (this.flushTimer !== null || this.flushing || !this.queue.length) {
			return;
		}
		this.flushTimer = window.setTimeout(() => {
			this.flushTimer = null;
			void this.flush();
		}, 300);
	}

	async flush(): Promise<void> {
		if (this.flushing || !this.queue.length) {
			return;
		}
		this.flushing = true;
		const payload = `${this.queue.join("\n")}\n`;
		this.queue = [];

		try {
			const directory = getPluginLogDirectory(this.app, this.pluginId);
			await ensureDirectory(this.adapter, directory);
			const path = getLogFilePath(this.app, this.pluginId, new Date());
			const exists = await this.adapter.exists(path);
			if (exists) {
				await this.adapter.append(path, payload);
			} else {
				await this.adapter.write(path, payload);
			}
			await this.cleanupOldLogFiles();
		} catch (error) {
			console.error(error);
		} finally {
			this.flushing = false;
			if (this.queue.length) {
				this.scheduleFlush();
			}
		}
	}

	private async cleanupOldLogFiles() {
		try {
			const directory = getPluginLogDirectory(this.app, this.pluginId);
			const exists = await this.adapter.exists(directory);
			if (!exists) {
				return;
			}
			const listed = await this.adapter.list(directory);
			const files = listed.files
				.filter((file) => file.endsWith(LOG_FILE_EXT))
				.sort((a, b) => b.localeCompare(a));
			if (files.length <= this.maxLogFiles) {
				return;
			}
			for (const file of files.slice(this.maxLogFiles)) {
				await this.adapter.remove(file);
			}
		} catch {
			// Ignore cleanup failures.
		}
	}

	async readRecentEntries(limit = 500): Promise<PluginLogEntry[]> {
		const capped = Math.max(1, Math.floor(limit));
		try {
			const directory = getPluginLogDirectory(this.app, this.pluginId);
			const exists = await this.adapter.exists(directory);
			if (!exists) {
				return this.getInMemoryEntries(capped);
			}
			const listed = await this.adapter.list(directory);
			const files = listed.files
				.filter((file) => file.endsWith(LOG_FILE_EXT))
				.sort((a, b) => b.localeCompare(a));
			const entries: PluginLogEntry[] = [];
			for (const file of files) {
				const raw = await this.adapter.read(file);
				const lines = raw.split("\n");
				for (let i = lines.length - 1; i >= 0; i -= 1) {
					const line = lines[i];
					if (!line) {
						continue;
					}
					const parsed = parseEntry(line);
					if (!parsed) {
						continue;
					}
					entries.push(parsed);
					if (entries.length >= capped) {
						return entries;
					}
				}
			}
			return entries;
		} catch {
			return this.getInMemoryEntries(capped);
		}
	}

	getInMemoryEntries(limit = 500): PluginLogEntry[] {
		const capped = Math.max(1, Math.floor(limit));
		return this.recentEntries.slice(-capped).reverse();
	}

	async clearLogs() {
		this.queue = [];
		this.recentEntries = [];
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		try {
			const directory = getPluginLogDirectory(this.app, this.pluginId);
			const exists = await this.adapter.exists(directory);
			if (!exists) {
				return;
			}
			const listed = await this.adapter.list(directory);
			for (const file of listed.files) {
				if (file.endsWith(LOG_FILE_EXT)) {
					await this.adapter.remove(file);
				}
			}
		} catch {
			// Ignore clear failures.
		}
	}

	async dispose() {
		if (this.flushTimer !== null) {
			window.clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		await this.flush();
	}
}
