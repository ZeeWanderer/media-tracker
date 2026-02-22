import {App, FileSystemAdapter} from "obsidian";
import * as path from "path";
import {getPluginCacheDirectory, getPluginLogsDirectory, getPluginRootPath} from "../storage/pluginPaths";

export type RepoScopePath = {
	repoRelativePath: string;
	absolutePath: string;
};

export function getVaultBasePath(app: App): string | null {
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		return null;
	}
	return adapter.getBasePath();
}

function normalizePathValue(value: string): string {
	const normalized = path.normalize(path.resolve(value));
	if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
		return normalized.toLowerCase();
	}
	return normalized;
}

function normalizeVaultRelativePath(value: string): string {
	return value
		.replace(/\\/g, "/")
		.replace(/^\/+|\/+$/g, "");
}

export function getRepoPathWithinVault(vaultPath: string, repoRoot: string): string | null {
	const normalizedVault = normalizePathValue(vaultPath);
	const normalizedRepo = normalizePathValue(repoRoot);
	if (normalizedVault === normalizedRepo) {
		return "";
	}
	const relative = path.relative(vaultPath, repoRoot);
	if (!relative.length || relative.startsWith("..") || path.isAbsolute(relative)) {
		return null;
	}
	const normalizedRelative = normalizePathValue(path.join(vaultPath, relative));
	if (!normalizedRelative.startsWith(`${normalizedVault}${path.sep}`)) {
		return null;
	}
	return relative.split(path.sep).join("/");
}

function resolveRepoScopePath(vaultPath: string, repoRoot: string, vaultRelativePath: string): RepoScopePath | null {
	const normalizedRelative = normalizeVaultRelativePath(vaultRelativePath);
	if (!normalizedRelative.length) {
		return null;
	}
	const absolutePath = path.resolve(vaultPath, ...normalizedRelative.split("/"));
	const normalizedRepoRoot = normalizePathValue(repoRoot);
	const normalizedAbsolutePath = normalizePathValue(absolutePath);
	if (normalizedAbsolutePath !== normalizedRepoRoot
		&& !normalizedAbsolutePath.startsWith(`${normalizedRepoRoot}${path.sep}`)) {
		return null;
	}
	const repoRelative = path.relative(repoRoot, absolutePath);
	if (repoRelative.startsWith("..") || path.isAbsolute(repoRelative)) {
		return null;
	}
	return {
		repoRelativePath: repoRelative.length ? repoRelative.split(path.sep).join("/") : ".",
		absolutePath,
	};
}

export function resolveCommitScopePaths(
	app: App,
	vaultPath: string,
	repoRoot: string,
	mediaFolder: string,
	pluginId: string,
): RepoScopePath[] {
	const normalizedMediaFolder = normalizeVaultRelativePath(mediaFolder) || "Media";
	const pluginRoot = normalizeVaultRelativePath(getPluginRootPath(app, pluginId));
	const candidates = [normalizedMediaFolder, pluginRoot];
	const paths = new Map<string, RepoScopePath>();
	for (const candidate of candidates) {
		const resolved = resolveRepoScopePath(vaultPath, repoRoot, candidate);
		if (!resolved) {
			continue;
		}
		paths.set(resolved.repoRelativePath, resolved);
	}
	return [...paths.values()];
}

export function getPluginGitignoreEntries(app: App, pluginId: string): string[] {
	const pluginCacheDir = normalizeVaultRelativePath(getPluginCacheDirectory(app, pluginId));
	const pluginLogsDir = normalizeVaultRelativePath(getPluginLogsDirectory(app, pluginId));
	return [
		`${pluginCacheDir}/`,
		`${pluginLogsDir}/`,
	];
}
