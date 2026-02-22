import {App} from "obsidian";
import {UpdateLogRun} from "../types";
import {ensureAdapterDirectory} from "../infra/storage/adapterPath";

type PendingUpdateRunCheckpointStoreDeps = {
	app: App;
	pluginId: string;
	isValidUpdateLogRun: (run: unknown) => run is UpdateLogRun;
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
			return this.deps.isValidUpdateLogRun(parsed) ? parsed : null;
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
		return `${this.deps.app.vault.configDir}/plugins/${this.deps.pluginId}/cache/pending-update-run.json`;
	}
}
