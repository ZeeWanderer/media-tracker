import {App} from "obsidian";
import * as fs from "fs";
import {
	GIT_FAST_TIMEOUT_MS,
	GIT_NETWORK_TIMEOUT_MS,
	GIT_WRITE_TIMEOUT_MS,
	hasNoUpstream,
	parseAheadBehind,
	runGit,
	summarizeGitError,
} from "./gitProcess";
import {
	resolveCommitScopePaths,
} from "./vaultGitPaths";
import {resolveVaultGitRepoContext} from "./repoContext";

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

type VaultCommitChangeStatus =
	| "has_changes"
	| "no_changes"
	| "not_repo"
	| "git_missing"
	| "failed";

export type VaultCommitChangeResult = {
	status: VaultCommitChangeStatus;
	message: string;
};

export type VaultCommitScope = {
	mediaFolder: string;
	pluginId: string;
};

async function resolveScopedPathspecs(
	app: App,
	vaultPath: string,
	repoRoot: string,
	scope: VaultCommitScope,
): Promise<string[]> {
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
	return scopePathspecs;
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
	const contextResult = await resolveVaultGitRepoContext(app);
	return contextResult.ok;
}

export async function getVaultUpdateCommitChangeState(
	app: App,
	scope: VaultCommitScope,
): Promise<VaultCommitChangeResult> {
	const contextResult = await resolveVaultGitRepoContext(app);
	if (!contextResult.ok) {
		return {
			status: contextResult.failure.status,
			message: contextResult.failure.message,
		};
	}
	const {vaultPath, repoRoot} = contextResult.context;
	const scopePathspecs = await resolveScopedPathspecs(app, vaultPath, repoRoot, scope);
	if (!scopePathspecs.length) {
		return {
			status: "failed",
			message: "No commit scope paths inside the repository scope were found.",
		};
	}

	const statusResult = await runGit(
		["status", "--porcelain", "--", ...scopePathspecs],
		vaultPath,
		{timeoutMs: GIT_FAST_TIMEOUT_MS},
	);
	if (statusResult.exitCode !== 0) {
		return {
			status: "failed",
			message: summarizeGitError(statusResult),
		};
	}

	const hasChanges = statusResult.stdout.trim().length > 0;
	return {
		status: hasChanges ? "has_changes" : "no_changes",
		message: hasChanges
			? "Scoped changes are available to commit."
			: "No scoped changes to commit.",
	};
}

export async function createVaultUpdateCommit(
	app: App,
	scope: VaultCommitScope,
): Promise<VaultCommitResult> {
	const contextResult = await resolveVaultGitRepoContext(app);
	if (!contextResult.ok) {
		return {
			status: contextResult.failure.status,
			message: contextResult.failure.message,
		};
	}
	const {vaultPath, repoRoot} = contextResult.context;

	const scopePathspecs = await resolveScopedPathspecs(app, vaultPath, repoRoot, scope);
	if (!scopePathspecs.length) {
		return {
			status: "failed",
			message: "No commit scope paths inside the repository scope were found.",
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
			message: "No scoped changes to commit.",
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
				message: "No scoped changes to commit.",
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
