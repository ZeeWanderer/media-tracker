import {App, FileSystemAdapter} from "obsidian";
import {spawn} from "child_process";
import * as path from "path";

type GitCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	errorMessage?: string;
};

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

function getVaultBasePath(app: App): string | null {
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		return null;
	}
	return adapter.getBasePath();
}

function runGit(args: string[], cwd: string): Promise<GitCommandResult> {
	return new Promise((resolve) => {
		const child = spawn("git", args, {cwd, windowsHide: true});
		let stdout = "";
		let stderr = "";
		let settled = false;

		const finish = (result: GitCommandResult) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(result);
		};

		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});

		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});

		child.on("error", (error: Error) => {
			finish({
				exitCode: -1,
				stdout,
				stderr,
				errorMessage: error.message,
			});
		});

		child.on("close", (code: number | null) => {
			finish({
				exitCode: code ?? -1,
				stdout,
				stderr,
			});
		});
	});
}

function isGitMissing(result: GitCommandResult): boolean {
	if (result.errorMessage && /enoent/i.test(result.errorMessage)) {
		return true;
	}
	return result.exitCode === -1 && !result.stdout.trim().length && !result.stderr.trim().length;
}

function summarizeGitError(result: GitCommandResult): string {
	const stderr = result.stderr.trim();
	if (stderr.length) {
		return stderr;
	}
	const stdout = result.stdout.trim();
	if (stdout.length) {
		return stdout;
	}
	return "Git command failed.";
}

function hasNoUpstream(result: GitCommandResult): boolean {
	const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
	return output.includes("no upstream configured")
		|| output.includes("no upstream branch")
		|| output.includes("head does not point to a branch");
}

function parseAheadBehind(raw: string): {ahead: number; behind: number} | null {
	const parts = raw.trim().split(/\s+/);
	const aheadRaw = parts[0];
	const behindRaw = parts[1];
	if (!aheadRaw || !behindRaw) {
		return null;
	}
	const ahead = Number.parseInt(aheadRaw, 10);
	const behind = Number.parseInt(behindRaw, 10);
	if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
		return null;
	}
	return {ahead, behind};
}

function normalizePathValue(value: string): string {
	const normalized = path.normalize(path.resolve(value));
	if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
		return normalized.toLowerCase();
	}
	return normalized;
}

function getRepoPathWithinVault(vaultPath: string, repoRoot: string): string | null {
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
	const configDir = app.vault.configDir.replace(/^\/+|\/+$/g, "");
	return [
		`${configDir}/plugins/${pluginId}/cache/`,
		`${configDir}/plugins/${pluginId}/logs/`,
	];
}

export async function isVaultGitRepository(app: App): Promise<boolean> {
	const vaultPath = getVaultBasePath(app);
	if (!vaultPath) {
		return false;
	}
	const result = await runGit(["rev-parse", "--is-inside-work-tree"], vaultPath);
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

	const repoCheck = await runGit(["rev-parse", "--is-inside-work-tree"], vaultPath);
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

	const rootResult = await runGit(["rev-parse", "--show-toplevel"], vaultPath);
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

export async function createVaultUpdateCommit(app: App): Promise<VaultCommitResult> {
	const vaultPath = getVaultBasePath(app);
	if (!vaultPath) {
		return {
			status: "not_repo",
			message: "Vault adapter is not filesystem-based.",
		};
	}

	const repoCheck = await runGit(["rev-parse", "--is-inside-work-tree"], vaultPath);
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

	const upstreamResult = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], vaultPath);
	if (upstreamResult.exitCode === 0) {
		const fetchResult = await runGit(["fetch", "--quiet"], vaultPath);
		if (fetchResult.exitCode !== 0) {
			return {
				status: "failed",
				message: `Failed to check remote status: ${summarizeGitError(fetchResult)}`,
			};
		}

		const aheadBehindResult = await runGit(["rev-list", "--left-right", "--count", "HEAD...@{u}"], vaultPath);
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

	const addResult = await runGit(["add", "-A"], vaultPath);
	if (addResult.exitCode !== 0) {
		return {
			status: "failed",
			message: summarizeGitError(addResult),
		};
	}

	const diffResult = await runGit(["diff", "--cached", "--quiet", "--exit-code"], vaultPath);
	if (diffResult.exitCode === 0) {
		return {
			status: "no_changes",
			message: "No changes to commit.",
		};
	}
	if (diffResult.exitCode !== 1) {
		return {
			status: "failed",
			message: summarizeGitError(diffResult),
		};
	}

	const commitMessage = getUpdateCommitMessage();
	const commitResult = await runGit(["commit", "-m", commitMessage], vaultPath);
	if (commitResult.exitCode !== 0) {
		const output = `${commitResult.stdout}\n${commitResult.stderr}`.toLowerCase();
		if (output.includes("nothing to commit")) {
			return {
				status: "no_changes",
				message: "No changes to commit.",
			};
		}
		return {
			status: "failed",
			message: summarizeGitError(commitResult),
		};
	}

	const pushResult = await runGit(["push"], vaultPath);
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
