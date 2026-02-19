import {App, FileSystemAdapter} from "obsidian";
import {spawn} from "child_process";

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

export async function isVaultGitRepository(app: App): Promise<boolean> {
	const vaultPath = getVaultBasePath(app);
	if (!vaultPath) {
		return false;
	}
	const result = await runGit(["rev-parse", "--is-inside-work-tree"], vaultPath);
	return result.exitCode === 0 && result.stdout.trim() === "true";
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
