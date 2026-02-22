import {App} from "obsidian";
import {
	GIT_FAST_TIMEOUT_MS,
	isGitMissing,
	runGit,
	summarizeGitError,
} from "./gitProcess";
import {
	getPluginGitignoreEntries as getPluginGitignoreEntriesForPlugin,
	getRepoPathWithinVault,
	getVaultBasePath,
} from "./vaultGitPaths";

type VaultGitignoreStatus =
	| "updated"
	| "already_up_to_date"
	| "not_repo"
	| "git_missing"
	| "unsupported_root"
	| "failed";

export type VaultGitignoreUpdateResult = {
	status: VaultGitignoreStatus;
	message: string;
	gitignorePath?: string;
	addedEntries?: string[];
};

function normalizeIgnorePattern(value: string): string {
	return value.trim().replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
}

function hasIgnorePattern(lines: string[], pattern: string): boolean {
	const target = normalizeIgnorePattern(pattern);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed.length || trimmed.startsWith("#") || trimmed.startsWith("!")) {
			continue;
		}
		if (normalizeIgnorePattern(trimmed) === target) {
			return true;
		}
	}
	return false;
}

export function getPluginGitignoreEntries(app: App, pluginId: string): string[] {
	return getPluginGitignoreEntriesForPlugin(app, pluginId);
}

export async function ensurePluginGitignoreEntries(
	app: App,
	pluginId: string,
): Promise<VaultGitignoreUpdateResult> {
	const vaultPath = getVaultBasePath(app);
	if (!vaultPath) {
		return {
			status: "not_repo",
			message: "Vault adapter is not filesystem-based.",
		};
	}

	const repoCheck = await runGit(["rev-parse", "--is-inside-work-tree"], vaultPath, {timeoutMs: GIT_FAST_TIMEOUT_MS});
	if (isGitMissing(repoCheck)) {
		return {
			status: "git_missing",
			message: "Git is not available in this environment.",
		};
	}
	if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
		return {
			status: "not_repo",
			message: "Vault is not a Git repository.",
		};
	}

	const rootResult = await runGit(["rev-parse", "--show-toplevel"], vaultPath, {timeoutMs: GIT_FAST_TIMEOUT_MS});
	if (rootResult.exitCode !== 0) {
		return {
			status: "failed",
			message: summarizeGitError(rootResult),
		};
	}

	const repoRoot = rootResult.stdout.trim();
	if (!repoRoot.length) {
		return {
			status: "failed",
			message: "Failed to determine repository root.",
		};
	}

	const repoPath = getRepoPathWithinVault(vaultPath, repoRoot);
	if (repoPath === null) {
		return {
			status: "unsupported_root",
			message: "Repository root is outside vault scope; .gitignore update is not supported.",
		};
	}

	const gitignorePath = repoPath.length ? `${repoPath}/.gitignore` : ".gitignore";
	const adapter = app.vault.adapter;
	const exists = await adapter.exists(gitignorePath);
	const existing = exists ? await adapter.read(gitignorePath) : "";
	const lines = existing.length ? existing.split(/\r?\n/) : [];
	const patterns = getPluginGitignoreEntries(app, pluginId);
	const missing = patterns.filter((pattern) => !hasIgnorePattern(lines, pattern));
	if (!missing.length) {
		return {
			status: "already_up_to_date",
			message: `.gitignore already includes plugin cache/log entries (${gitignorePath}).`,
			gitignorePath,
			addedEntries: [],
		};
	}

	const header = "# Media Tracker plugin artifacts";
	const shouldAddHeader = !lines.some((line) => line.trim() === header);
	const base = existing.length && !existing.endsWith("\n") ? `${existing}\n` : existing;
	const appendLines: string[] = [];
	if (shouldAddHeader) {
		appendLines.push(header);
	}
	appendLines.push(...missing);
	const next = `${base}${appendLines.join("\n")}\n`;
	await adapter.write(gitignorePath, next);

	return {
		status: "updated",
		message: `${exists ? "Updated" : "Created"} ${gitignorePath} with ${missing.length} plugin ignore entr${missing.length === 1 ? "y" : "ies"}.`,
		gitignorePath,
		addedEntries: missing,
	};
}
