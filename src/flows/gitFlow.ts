import {App} from "obsidian";
import {
	createVaultUpdateCommit as createVaultUpdateCommitInfra,
	ensurePluginGitignoreEntries as ensurePluginGitignoreEntriesInfra,
	isVaultGitRepository as isVaultGitRepositoryInfra,
	type VaultCommitScope,
	type VaultCommitResult,
	type VaultGitignoreUpdateResult,
} from "../infra/git/vaultGit";

export type {
	VaultCommitScope,
	VaultCommitResult,
	VaultGitignoreUpdateResult,
};

export async function isVaultGitRepository(app: App): Promise<boolean> {
	return isVaultGitRepositoryInfra(app);
}

export async function createVaultUpdateCommit(app: App, scope: VaultCommitScope): Promise<VaultCommitResult> {
	return createVaultUpdateCommitInfra(app, scope);
}

export async function ensurePluginGitignoreEntries(
	app: App,
	pluginId: string,
): Promise<VaultGitignoreUpdateResult> {
	return ensurePluginGitignoreEntriesInfra(app, pluginId);
}
