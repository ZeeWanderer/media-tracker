import {App} from "obsidian";
import {MediaItem} from "../types";
import {createVaultUpdateCommit, isVaultGitRepository, type VaultCommitResult} from "../infra/git/vaultGit";
import {getAnilistUrl, getFaviconCacheKey, getKnownIconAsset, KNOWN_ICON_BASES} from "../domain/media/links";
import {getPluginAssetsDirectory} from "../infra/storage/pluginPaths";
import type {DesktopFaviconCache} from "../infra/cache/faviconCache";
import type {PluginLogger} from "../infra/logging/pluginLogger";

type TrackerGitServiceDeps = {
	app: App;
	pluginId: string;
	getMediaFolder: () => string;
	logger?: Pick<PluginLogger, "error">;
	onStateChange: () => void;
};

type TrackerIconServiceDeps = {
	app: App;
	pluginId: string;
	faviconCache: Pick<DesktopFaviconCache, "getMemoryCachedFavicon" | "ensureFavicon">;
	onStateChange: () => void;
};

export class TrackerGitService {
	private repository: boolean | null = null;
	private repositoryPromise: Promise<void> | null = null;
	private creatingCommit = false;

	constructor(private readonly deps: TrackerGitServiceDeps) {}

	get hasRepository(): boolean {
		return this.repository === true;
	}

	get isCreatingCommit(): boolean {
		return this.creatingCommit;
	}

	markNotRepository() {
		this.repository = false;
		this.deps.onStateChange();
	}

	ensureRepositoryState() {
		if (this.repository !== null || this.repositoryPromise) {
			return;
		}
		this.repositoryPromise = (async () => {
			this.repository = await isVaultGitRepository(this.deps.app);
		})()
			.catch((error: unknown) => {
				this.deps.logger?.error("git", "repo_check_failed", "Failed to check git repository state.", {
					error: error instanceof Error ? error.message : String(error),
				});
				this.repository = false;
			})
			.finally(() => {
				this.repositoryPromise = null;
				this.deps.onStateChange();
			});
	}

	async createCommit(): Promise<VaultCommitResult | null> {
		if (this.creatingCommit) {
			return null;
		}
		this.creatingCommit = true;
		this.deps.onStateChange();
		try {
			return await createVaultUpdateCommit(this.deps.app, {
				mediaFolder: this.deps.getMediaFolder(),
				pluginId: this.deps.pluginId,
			});
		} finally {
			this.creatingCommit = false;
			this.deps.onStateChange();
		}
	}
}

export class TrackerIconService {
	private knownIconAssets = new Map<string, string>();
	private knownIconAssetsPromise: Promise<void> | null = null;

	constructor(private readonly deps: TrackerIconServiceDeps) {}

	getLinkIconUrl(value: string): string | null {
		const base = getKnownIconAsset(value);
		const asset = base ? this.knownIconAssets.get(base) : null;
		if (asset) {
			return this.getAssetUrl(asset);
		}
		const cached = this.deps.faviconCache.getMemoryCachedFavicon(value);
		return cached ?? null;
	}

	async ensureKnownIconAssets() {
		if (this.knownIconAssetsPromise) {
			return this.knownIconAssetsPromise;
		}
		const assetsDir = getPluginAssetsDirectory(this.deps.app, this.deps.pluginId);
		this.knownIconAssetsPromise = (async () => {
			for (const base of KNOWN_ICON_BASES) {
				const extensions = ["svg", "png", "ico"];
				for (const ext of extensions) {
					try {
						const name = `${base}.${ext}`;
						const exists = await this.deps.app.vault.adapter.exists(`${assetsDir}/${name}`);
						if (exists) {
							this.knownIconAssets.set(base, name);
							break;
						}
					} catch {
						// Ignore missing assets or adapter errors.
					}
				}
			}
		})().finally(() => {
			this.knownIconAssetsPromise = null;
		});
		return this.knownIconAssetsPromise;
	}

	async ensureFavicons(items: MediaItem[]) {
		const pending: Promise<string | null>[] = [];
		for (const item of items) {
			const links = [...(item.links ?? [])];
			if (item.anilistId) {
				links.push(getAnilistUrl(item.anilistId, item.type === "manga" ? "manga" : "anime"));
			}
			for (const link of links) {
				const base = getKnownIconAsset(link);
				const asset = base ? this.knownIconAssets.get(base) : null;
				if (asset) {
					continue;
				}
				const key = getFaviconCacheKey(link);
				if (!key) {
					continue;
				}
				if (this.deps.faviconCache.getMemoryCachedFavicon(link)) {
					continue;
				}
				pending.push(this.deps.faviconCache.ensureFavicon(link));
			}
		}

		if (!pending.length) {
			return;
		}

		const results = await Promise.all(pending);
		if (results.some((value) => value !== null)) {
			this.deps.onStateChange();
		}
	}

	private getAssetUrl(fileName: string): string {
		const assetsDir = getPluginAssetsDirectory(this.deps.app, this.deps.pluginId);
		return this.deps.app.vault.adapter.getResourcePath(`${assetsDir}/${fileName}`);
	}
}
