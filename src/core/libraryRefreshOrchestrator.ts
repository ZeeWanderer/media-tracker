import type {TFile} from "obsidian";
import type {MediaItem} from "../domain/media/models";
import {MediaTrackerSettings} from "./pluginSettingsModel";
import type {UpdateLogRun} from "./updateTypes";

export type RunLibraryRefresh = (
	items: MediaItem<TFile>[],
	onProgress?: (current: number, total: number) => void,
	onRunUpdate?: (run: UpdateLogRun) => void,
) => Promise<UpdateLogRun>;

type LibraryRefreshOrchestratorDeps = {
	getSettings: () => MediaTrackerSettings;
	runRefresh: RunLibraryRefresh;
	setActiveUpdateRun: (run: UpdateLogRun | null) => void;
	recordCompletedUpdateRun: (run: UpdateLogRun) => Promise<void>;
	openUpdateLog: () => Promise<void>;
};

export type ExecuteLibraryRefreshOptions = {
	items: MediaItem<TFile>[];
	onProgress?: (current: number, total: number) => void;
	onCompleted?: (run: UpdateLogRun, settings: MediaTrackerSettings) => void | Promise<void>;
	onFailed?: (error: unknown, settings: MediaTrackerSettings) => void | Promise<void>;
	onFinally?: () => void;
};

export type LibraryRefreshExecutionResult =
	| {status: "completed"; run: UpdateLogRun}
	| {status: "failed"; error: unknown};

export type CoordinatedLibraryRefreshResult =
	| LibraryRefreshExecutionResult
	| {status: "busy"};

export type CoordinatedRefreshTaskResult<T> =
	| {status: "completed"; value: T}
	| {status: "busy"};

export async function executeLibraryRefresh(
	deps: LibraryRefreshOrchestratorDeps,
	options: ExecuteLibraryRefreshOptions,
): Promise<LibraryRefreshExecutionResult> {
	const settings = deps.getSettings();
	try {
		const run = await deps.runRefresh(
			options.items,
			options.onProgress,
			(activeRun) => deps.setActiveUpdateRun(activeRun),
		);
		await deps.recordCompletedUpdateRun(run);
		await options.onCompleted?.(run, settings);
		if (run.failed > 0 && settings.autoOpenUpdateLogOnFailure) {
			await deps.openUpdateLog();
		}
		return {status: "completed", run};
	} catch (error) {
		await options.onFailed?.(error, settings);
		return {status: "failed", error};
	} finally {
		deps.setActiveUpdateRun(null);
		options.onFinally?.();
	}
}

export class LibraryRefreshCoordinator {
	private refreshing = false;
	private progressCurrent = 0;
	private progressTotal = 0;
	private readonly listeners = new Set<() => void>();

	constructor(private readonly deps: LibraryRefreshOrchestratorDeps) {}

	get isRefreshing(): boolean {
		return this.refreshing;
	}

	get current(): number {
		return this.progressCurrent;
	}

	get total(): number {
		return this.progressTotal;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async run(options: ExecuteLibraryRefreshOptions): Promise<CoordinatedLibraryRefreshResult> {
		if (this.refreshing) {
			return {status: "busy"};
		}
		this.refreshing = true;
		this.setProgress(0, 0);

		try {
			return await executeLibraryRefresh(this.deps, {
				...options,
				onProgress: (current, total) => {
					this.setProgress(current, total);
					options.onProgress?.(current, total);
				},
			});
		} finally {
			this.refreshing = false;
			this.setProgress(0, 0);
		}
	}

	async runExclusive<T>(task: () => Promise<T>): Promise<CoordinatedRefreshTaskResult<T>> {
		if (this.refreshing) {
			return {status: "busy"};
		}
		this.refreshing = true;
		this.setProgress(0, 1);

		try {
			const value = await task();
			this.setProgress(1, 1);
			return {status: "completed", value};
		} finally {
			this.refreshing = false;
			this.setProgress(0, 0);
		}
	}

	private setProgress(current: number, total: number) {
		this.progressCurrent = Math.max(0, Math.floor(current));
		this.progressTotal = Math.max(0, Math.floor(total));
		this.notifyListeners();
	}

	private notifyListeners() {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
