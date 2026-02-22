import {App} from "obsidian";
import {
	getPluginGitignoreEntries as getPluginGitignoreEntriesForPlugin,
	getRepoPathWithinVault,
} from "./vaultGitPaths";
import {resolveVaultGitRepoContext} from "./repoContext";

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
	const contextResult = await resolveVaultGitRepoContext(app);
	if (!contextResult.ok) {
		return {
			status: contextResult.failure.status,
			message: contextResult.failure.message,
		};
	}
	const {vaultPath, repoRoot} = contextResult.context;

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
