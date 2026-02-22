import {spawn} from "child_process";

function getProcessEnv(): Record<string, string | undefined> {
	const value = (globalThis as unknown as {process?: {env?: Record<string, string | undefined>}}).process?.env;
	return value ?? {};
}

export type GitCommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	errorMessage?: string;
	timedOut?: boolean;
};

export type GitRunOptions = {
	timeoutMs?: number;
};

export const GIT_FAST_TIMEOUT_MS = 10_000;
export const GIT_DEFAULT_TIMEOUT_MS = 60_000;
export const GIT_WRITE_TIMEOUT_MS = 120_000;
export const GIT_NETWORK_TIMEOUT_MS = 180_000;

export function runGit(args: string[], cwd: string, options: GitRunOptions = {}): Promise<GitCommandResult> {
	return new Promise((resolve) => {
		const timeoutCandidate = options.timeoutMs;
		const timeoutMs = Number.isFinite(timeoutCandidate) && (timeoutCandidate ?? 0) > 0
			? Math.floor(timeoutCandidate as number)
			: GIT_DEFAULT_TIMEOUT_MS;
			const child = spawn("git", args, {
				cwd,
				windowsHide: true,
				env: {
					...getProcessEnv(),
					GIT_TERMINAL_PROMPT: "0",
					GCM_INTERACTIVE: "Never",
				},
			});
		let stdout = "";
		let stderr = "";
		let settled = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

		const finish = (result: GitCommandResult) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutHandle !== null) {
				clearTimeout(timeoutHandle);
				timeoutHandle = null;
			}
			resolve(result);
		};

		timeoutHandle = setTimeout(() => {
			const command = ["git", ...args].join(" ");
			finish({
				exitCode: -1,
				stdout,
				stderr,
				errorMessage: `Git command timed out after ${timeoutMs}ms: ${command}`,
				timedOut: true,
			});
			try {
				child.kill("SIGKILL");
			} catch {
				// Ignore kill errors after timeout finalization.
			}
		}, timeoutMs);

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

export function isGitMissing(result: GitCommandResult): boolean {
	if (result.timedOut) {
		return false;
	}
	if (result.errorMessage && /enoent/i.test(result.errorMessage)) {
		return true;
	}
	return result.exitCode === -1 && !result.stdout.trim().length && !result.stderr.trim().length;
}

export function summarizeGitError(result: GitCommandResult): string {
	if (result.timedOut && result.errorMessage) {
		return result.errorMessage;
	}
	const stderr = result.stderr.trim();
	if (stderr.length) {
		return stderr;
	}
	const stdout = result.stdout.trim();
	if (stdout.length) {
		return stdout;
	}
	if (result.errorMessage && result.errorMessage.trim().length) {
		return result.errorMessage.trim();
	}
	return "Git command failed.";
}

export function hasNoUpstream(result: GitCommandResult): boolean {
	const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
	return output.includes("no upstream configured")
		|| output.includes("no upstream branch")
		|| output.includes("head does not point to a branch");
}

export function parseAheadBehind(raw: string): {ahead: number; behind: number} | null {
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
