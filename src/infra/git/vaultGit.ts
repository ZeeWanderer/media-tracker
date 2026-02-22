import {App} from "obsidian";
import * as fs from "fs";
import {
	GIT_FAST_TIMEOUT_MS,
	GIT_NETWORK_TIMEOUT_MS,
	GIT_WRITE_TIMEOUT_MS,
	hasNoUpstream,
	isGitMissing,
	parseAheadBehind,
	runGit,
	summarizeGitError,
} from "./gitProcess";
import {
	getPluginGitignoreEntries as getPluginGitignoreEntriesForPlugin,
	getRepoPathWithinVault,
	getVaultBasePath,
	resolveCommitScopePaths,
} from "./vaultGitPaths";

type VaultCommitStatus =
	| "created_and_pushed"
	| "created_push_failed"
	| "no_changes"
	| "needs_pull"
	| "not_repo"
	| "git_missing"
	| "failed";

export type VaultCommitResult = {
	status: VaultCommitStatus;
	message: string;
	commitMessage?: string;
};

export type VaultCommitScope = {
	mediaFolder: string;
	pluginId: string;
};

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

function padTwo(value: number): string {
	return String(value).padStart(2, "0");
}

function formatDateTime(value: Date): string {
	const year = value.getFullYear();
	const month = padTwo(value.getMonth() + 1);
	const day = padTwo(value.getDate());
	const hours = padTwo(value.getHours());
	const minutes = padTwo(value.getMinutes());
	const seconds = padTwo(value.getSeconds());
	return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export function getUpdateCommitMessage(value: Date = new Date()): string {
	return `[update] ${formatDateTime(value)}`;
}

export function getPluginGitignoreEntries(app: App, pluginId: string): string[] {
	return getPluginGitignoreEntriesForPlugin(app, pluginId);
}

export async function isVaultGitRepository(app: App): Promise<boolean> {
	const vaultPath = getVaultBasePath(app);
	if (!vaultPath) {
		return false;
	}
	const result = await runGit(["rev-parse", "--is-inside-work-tree"], vaultPath, {timeoutMs: GIT_FAST_TIMEOUT_MS});
	return result.exitCode === 0 && result.stdout.trim() === "true";
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

export async function createVaultUpdateCommit(
	app: App,
	scope: VaultCommitScope,
): Promise<VaultCommitResult> {
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
			message: `Failed to determine repository root: ${summarizeGitError(rootResult)}`,
		};
	}
	const repoRoot = rootResult.stdout.trim();
	if (!repoRoot.length) {
		return {
			status: "failed",
			message: "Failed to determine repository root.",
		};
	}

	const scopeCandidates = resolveCommitScopePaths(
		app,
		vaultPath,
		repoRoot,
		scope.mediaFolder,
		scope.pluginId,
	);
	const scopePathspecs: string[] = [];
	for (const candidate of scopeCandidates) {
		if (fs.existsSync(candidate.absolutePath)) {
			scopePathspecs.push(candidate.repoRelativePath);
			continue;
		}
		const trackedResult = await runGit(
			["ls-files", "--error-unmatch", "--", candidate.repoRelativePath],
			vaultPath,
			{timeoutMs: GIT_FAST_TIMEOUT_MS},
		);
		if (trackedResult.exitCode === 0) {
			scopePathspecs.push(candidate.repoRelativePath);
		}
	}
	if (!scopePathspecs.length) {
		return {
			status: "failed",
			message: "No media/plugin paths inside the repository scope were found.",
		};
	}

	const upstreamResult = await runGit(
		["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
		vaultPath,
		{timeoutMs: GIT_FAST_TIMEOUT_MS},
	);
	if (upstreamResult.exitCode === 0) {
		const fetchResult = await runGit(["fetch", "--quiet"], vaultPath, {timeoutMs: GIT_NETWORK_TIMEOUT_MS});
		if (fetchResult.exitCode !== 0) {
			return {
				status: "failed",
				message: `Failed to check remote status: ${summarizeGitError(fetchResult)}`,
			};
		}

		const aheadBehindResult = await runGit(
			["rev-list", "--left-right", "--count", "HEAD...@{u}"],
			vaultPath,
			{timeoutMs: GIT_FAST_TIMEOUT_MS},
		);
		if (aheadBehindResult.exitCode !== 0) {
			return {
				status: "failed",
				message: `Failed to compare with upstream: ${summarizeGitError(aheadBehindResult)}`,
			};
		}

		const parsed = parseAheadBehind(aheadBehindResult.stdout);
		if (!parsed) {
			return {
				status: "failed",
				message: "Failed to parse upstream comparison.",
			};
		}
		if (parsed.behind > 0) {
			return {
				status: "needs_pull",
				message: `Branch is behind upstream by ${parsed.behind} commit${parsed.behind === 1 ? "" : "s"}. Pull first, then commit.`,
			};
		}
	} else if (!hasNoUpstream(upstreamResult)) {
		return {
			status: "failed",
			message: summarizeGitError(upstreamResult),
		};
	}

	const addResult = await runGit(["add", "-A", "--", ...scopePathspecs], vaultPath, {timeoutMs: GIT_WRITE_TIMEOUT_MS});
	if (addResult.exitCode !== 0) {
		return {
			status: "failed",
			message: summarizeGitError(addResult),
		};
	}

	const diffResult = await runGit(["diff", "--cached", "--quiet", "--exit-code", "--", ...scopePathspecs], vaultPath, {
		timeoutMs: GIT_WRITE_TIMEOUT_MS,
	});
	if (diffResult.exitCode === 0) {
		return {
			status: "no_changes",
			message: "No media/plugin changes to commit.",
		};
	}
	if (diffResult.exitCode !== 1) {
		return {
			status: "failed",
			message: summarizeGitError(diffResult),
		};
	}

	const commitMessage = getUpdateCommitMessage();
	const commitResult = await runGit(
		["commit", "-m", commitMessage, "--only", "--", ...scopePathspecs],
		vaultPath,
		{timeoutMs: GIT_WRITE_TIMEOUT_MS},
	);
	if (commitResult.exitCode !== 0) {
		const output = `${commitResult.stdout}\n${commitResult.stderr}`.toLowerCase();
		if (output.includes("nothing to commit")) {
			return {
				status: "no_changes",
				message: "No media/plugin changes to commit.",
			};
		}
		return {
			status: "failed",
			message: summarizeGitError(commitResult),
		};
	}

	const pushResult = await runGit(["push"], vaultPath, {timeoutMs: GIT_NETWORK_TIMEOUT_MS});
	if (pushResult.exitCode === 0) {
		return {
			status: "created_and_pushed",
			message: `Created and pushed commit ${commitMessage}.`,
			commitMessage,
		};
	}

	return {
		status: "created_push_failed",
		message: `Commit ${commitMessage} created, but push failed: ${summarizeGitError(pushResult)}`,
		commitMessage,
	};
}
