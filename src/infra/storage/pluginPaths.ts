import {App} from "obsidian";
import {joinVaultRelativePath, normalizeVaultRelativePath} from "../../pathUtils";

export function getPluginRootPath(app: App, pluginId: string): string {
	const configDir = normalizeVaultRelativePath(app.vault.configDir);
	const pluginsRoot = joinVaultRelativePath(configDir, "plugins");
	return joinVaultRelativePath(pluginsRoot, pluginId);
}

export function getPluginCacheDirectory(app: App, pluginId: string): string {
	return joinVaultRelativePath(getPluginRootPath(app, pluginId), "cache");
}

export function getPluginCachePath(app: App, pluginId: string, relativePath: string): string {
	return joinVaultRelativePath(getPluginCacheDirectory(app, pluginId), relativePath);
}

export function getPluginLogsDirectory(app: App, pluginId: string): string {
	return joinVaultRelativePath(getPluginRootPath(app, pluginId), "logs");
}

export function getPluginAssetsDirectory(app: App, pluginId: string): string {
	return joinVaultRelativePath(getPluginRootPath(app, pluginId), "assets");
}
