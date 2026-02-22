import {MediaItem} from "../types";
import type MediaTrackerPlugin from "../main";
import {createVaultUpdateCommit, isVaultGitRepository, type VaultCommitResult} from "../flows/gitFlow";
import {getAnilistUrl, getFaviconCacheKey, getKnownIconAsset, KNOWN_ICON_BASES} from "../domain/media/links";

export class TrackerGitService {
	private repository: boolean | null = null;
	private repositoryPromise: Promise<void> | null = null;
	private creatingCommit = false;

	constructor(
		private readonly plugin: MediaTrackerPlugin,
		private readonly onStateChange: () => void,
	) {}

	get hasRepository(): boolean {
		return this.repository === true;
	}

	get isCreatingCommit(): boolean {
		return this.creatingCommit;
	}

	markNotRepository() {
		this.repository = false;
		this.onStateChange();
	}

	ensureRepositoryState() {
		if (this.repository !== null || this.repositoryPromise) {
			return;
		}
			this.repositoryPromise = (async () => {
				this.repository = await isVaultGitRepository(this.plugin.app);
			})()
				.catch((error: unknown) => {
					this.plugin.logger.error("git", "repo_check_failed", "Failed to check git repository state.", {
						error: error instanceof Error ? error.message : String(error),
					});
				this.repository = false;
			})
			.finally(() => {
				this.repositoryPromise = null;
				this.onStateChange();
			});
	}

	async createCommit(): Promise<VaultCommitResult | null> {
		if (this.creatingCommit) {
			return null;
		}
		this.creatingCommit = true;
		this.onStateChange();
		try {
			return await createVaultUpdateCommit(this.plugin.app, {
				mediaFolder: this.plugin.settings.mediaFolder,
				pluginId: this.plugin.manifest.id,
			});
		} finally {
			this.creatingCommit = false;
			this.onStateChange();
		}
	}
}

export class TrackerIconService {
	private knownIconAssets = new Map<string, string>();
	private knownIconAssetsPromise: Promise<void> | null = null;

	constructor(
		private readonly plugin: MediaTrackerPlugin,
		private readonly onStateChange: () => void,
	) {}

	getLinkIconUrl(value: string): string | null {
		const base = getKnownIconAsset(value);
		const asset = base ? this.knownIconAssets.get(base) : null;
		if (asset) {
			return this.getAssetUrl(asset);
		}
		const cached = this.plugin.faviconCache.getMemoryCachedFavicon(value);
		return cached ?? null;
	}

	async ensureKnownIconAssets() {
		if (this.knownIconAssetsPromise) {
			return this.knownIconAssetsPromise;
		}
		const pluginDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		this.knownIconAssetsPromise = (async () => {
			for (const base of KNOWN_ICON_BASES) {
				const extensions = ["svg", "png", "ico"];
				for (const ext of extensions) {
					try {
						const name = `${base}.${ext}`;
						const exists = await this.plugin.app.vault.adapter.exists(`${pluginDir}/assets/${name}`);
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
				if (this.plugin.faviconCache.getMemoryCachedFavicon(link)) {
					continue;
				}
				pending.push(this.plugin.faviconCache.ensureFavicon(link));
			}
		}

		if (!pending.length) {
			return;
		}

		const results = await Promise.all(pending);
		if (results.some((value) => value !== null)) {
			this.onStateChange();
		}
	}

	private getAssetUrl(fileName: string): string {
		const pluginDir = `${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		return this.plugin.app.vault.adapter.getResourcePath(`${pluginDir}/assets/${fileName}`);
	}
}
