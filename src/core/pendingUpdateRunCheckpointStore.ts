import {App} from "obsidian";
import {UpdateLogRun} from "../types";
import {ensureAdapterDirectory} from "../infra/storage/adapterPath";
import {getPluginCachePath} from "../infra/storage/pluginPaths";
import {isValidUpdateLogRun} from "./updateLogRunValidation";

type PendingUpdateRunCheckpointStoreDeps = {
	app: App;
	pluginId: string;
};

export class PendingUpdateRunCheckpointStore {
	constructor(private readonly deps: PendingUpdateRunCheckpointStoreDeps) {}

	async load(): Promise<UpdateLogRun | null> {
		const adapter = this.deps.app.vault.adapter;
		const checkpointPath = this.getCheckpointPath();
		try {
			const exists = await adapter.exists(checkpointPath);
			if (!exists) {
				return null;
			}
			const raw = await adapter.read(checkpointPath);
			const parsed = JSON.parse(raw) as unknown;
			return isValidUpdateLogRun(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}

	async save(run: UpdateLogRun | null): Promise<void> {
		const adapter = this.deps.app.vault.adapter;
		const checkpointPath = this.getCheckpointPath();
		if (!run) {
			try {
				const exists = await adapter.exists(checkpointPath);
				if (exists) {
					await adapter.remove(checkpointPath);
				}
			} catch {
				// Ignore checkpoint cleanup failures.
			}
			return;
		}
		const splitIndex = checkpointPath.lastIndexOf("/");
		const directory = splitIndex === -1 ? "" : checkpointPath.slice(0, splitIndex);
		await ensureAdapterDirectory(adapter, directory);
		await adapter.write(checkpointPath, JSON.stringify(run));
	}

	private getCheckpointPath(): string {
		return getPluginCachePath(this.deps.app, this.deps.pluginId, "pending-update-run.json");
	}
}
