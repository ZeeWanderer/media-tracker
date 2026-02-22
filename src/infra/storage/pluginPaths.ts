import {App} from "obsidian";

function normalizePathSegment(value: string): string {
	return value
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

function joinPath(base: string, segment: string): string {
	const normalizedBase = normalizePathSegment(base);
	const normalizedSegment = normalizePathSegment(segment);
	return normalizedSegment.length ? `${normalizedBase}/${normalizedSegment}` : normalizedBase;
}

export function getPluginRootPath(app: App, pluginId: string): string {
	const configDir = normalizePathSegment(app.vault.configDir);
	const pluginsRoot = joinPath(configDir, "plugins");
	return joinPath(pluginsRoot, pluginId);
}

export function getPluginCacheDirectory(app: App, pluginId: string): string {
	return joinPath(getPluginRootPath(app, pluginId), "cache");
}

export function getPluginCachePath(app: App, pluginId: string, relativePath: string): string {
	return joinPath(getPluginCacheDirectory(app, pluginId), relativePath);
}

export function getPluginLogsDirectory(app: App, pluginId: string): string {
	return joinPath(getPluginRootPath(app, pluginId), "logs");
}

export function getPluginAssetsDirectory(app: App, pluginId: string): string {
	return joinPath(getPluginRootPath(app, pluginId), "assets");
}
