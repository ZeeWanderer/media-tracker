import type {App} from "obsidian";
import * as path from "path";
import {getPluginCacheDirectory, getPluginLogsDirectory, getPluginRootPath} from "../storage/pluginPaths";
import {joinVaultRelativePath, normalizeVaultPathForCompare, normalizeVaultRelativePath} from "../../pathUtils";

export type RepoScopePath = {
	repoRelativePath: string;
	absolutePath: string;
};

export type VaultCommitScope = {
	mediaRoot: string;
	pluginRoot: string;
	excludedPluginRoots: string[];
	workspacePath: string;
};

function isPathWithin(pathValue: string, scopeRoot: string): boolean {
	return pathValue === scopeRoot || pathValue.startsWith(`${scopeRoot}/`);
}

export function isVaultPathInCommitScope(pathValue: string, scope: VaultCommitScope): boolean {
	const path = normalizeVaultPathForCompare(pathValue);
	const mediaRoot = normalizeVaultPathForCompare(scope.mediaRoot);
	const pluginRoot = normalizeVaultPathForCompare(scope.pluginRoot);
	const workspacePath = normalizeVaultPathForCompare(scope.workspacePath);
	const excludedRoots = scope.excludedPluginRoots.map((root) => normalizeVaultPathForCompare(root));
	if (excludedRoots.some((root) => isPathWithin(path, root))) {
		return false;
	}
	return path === workspacePath || isPathWithin(path, mediaRoot) || isPathWithin(path, pluginRoot);
}

export function getVaultBasePath(app: App): string | null {
	const adapter = app.vault.adapter as unknown;
	if (!adapter || typeof adapter !== "object" || !("getBasePath" in adapter)
		|| typeof (adapter as {getBasePath?: unknown}).getBasePath !== "function") {
		return null;
	}
	return (adapter as {getBasePath: () => string}).getBasePath();
}

function normalizePathValue(value: string): string {
	const normalized = path.normalize(path.resolve(value));
	if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
		return normalized.toLowerCase();
	}
	return normalized;
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
	const workspacePath = joinVaultRelativePath(normalizeVaultRelativePath(app.vault.configDir), "workspace.json");
	const candidates = [normalizedMediaFolder, pluginRoot, workspacePath];
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
