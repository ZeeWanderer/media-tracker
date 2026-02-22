import {App} from "obsidian";
import {
	createVaultUpdateCommit as createVaultUpdateCommitInfra,
	ensurePluginGitignoreEntries as ensurePluginGitignoreEntriesInfra,
	isVaultGitRepository as isVaultGitRepositoryInfra,
	type VaultCommitResult,
	type VaultGitignoreUpdateResult,
} from "../infra/git/vaultGit";

export type {
	VaultCommitResult,
	VaultGitignoreUpdateResult,
};

export async function isVaultGitRepository(app: App): Promise<boolean> {
	return isVaultGitRepositoryInfra(app);
}

export async function createVaultUpdateCommit(app: App): Promise<VaultCommitResult> {
	return createVaultUpdateCommitInfra(app);
}

export async function ensurePluginGitignoreEntries(
	app: App,
	pluginId: string,
): Promise<VaultGitignoreUpdateResult> {
	return ensurePluginGitignoreEntriesInfra(app, pluginId);
}
