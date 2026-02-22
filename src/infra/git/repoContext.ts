import {App} from "obsidian";
import {
	GIT_FAST_TIMEOUT_MS,
	isGitMissing,
	runGit,
	summarizeGitError,
} from "./gitProcess";
import {getVaultBasePath} from "./vaultGitPaths";

export type VaultGitRepoContext = {
	vaultPath: string;
	repoRoot: string;
};

type VaultGitRepoContextFailure =
	| {
		status: "not_repo";
		message: string;
	}
	| {
		status: "git_missing";
		message: string;
	}
	| {
		status: "failed";
		message: string;
	};

export type ResolveVaultGitRepoContextResult =
	| {
		ok: true;
		context: VaultGitRepoContext;
	}
	| {
		ok: false;
		failure: VaultGitRepoContextFailure;
	};

export async function resolveVaultGitRepoContext(
	app: App,
): Promise<ResolveVaultGitRepoContextResult> {
	const vaultPath = getVaultBasePath(app);
	if (!vaultPath) {
		return {
			ok: false,
			failure: {
				status: "not_repo",
				message: "Vault adapter is not filesystem-based.",
			},
		};
	}

	const repoCheck = await runGit(["rev-parse", "--is-inside-work-tree"], vaultPath, {timeoutMs: GIT_FAST_TIMEOUT_MS});
	if (isGitMissing(repoCheck)) {
		return {
			ok: false,
			failure: {
				status: "git_missing",
				message: "Git is not available in this environment.",
			},
		};
	}
	if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
		return {
			ok: false,
			failure: {
				status: "not_repo",
				message: "Vault is not a Git repository.",
			},
		};
	}

	const rootResult = await runGit(["rev-parse", "--show-toplevel"], vaultPath, {timeoutMs: GIT_FAST_TIMEOUT_MS});
	if (rootResult.exitCode !== 0) {
		return {
			ok: false,
			failure: {
				status: "failed",
				message: `Failed to determine repository root: ${summarizeGitError(rootResult)}`,
			},
		};
	}
	const repoRoot = rootResult.stdout.trim();
	if (!repoRoot.length) {
		return {
			ok: false,
			failure: {
				status: "failed",
				message: "Failed to determine repository root.",
			},
		};
	}

	return {
		ok: true,
		context: {
			vaultPath,
			repoRoot,
		},
	};
}
