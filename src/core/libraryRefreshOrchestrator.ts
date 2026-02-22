import {MediaItem, UpdateLogRun} from "../types";
import {MediaTrackerSettings} from "./pluginSettingsModel";

export type RunLibraryRefresh = (
	settings: Readonly<MediaTrackerSettings>,
	items: MediaItem[],
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
	items: MediaItem[];
	onProgress?: (current: number, total: number) => void;
	onCompleted?: (run: UpdateLogRun, settings: MediaTrackerSettings) => void | Promise<void>;
	onFailed?: (error: unknown, settings: MediaTrackerSettings) => void | Promise<void>;
	onFinally?: () => void;
};

export type LibraryRefreshExecutionResult =
	| {status: "completed"; run: UpdateLogRun}
	| {status: "failed"; error: unknown};

export async function executeLibraryRefresh(
	deps: LibraryRefreshOrchestratorDeps,
	options: ExecuteLibraryRefreshOptions,
): Promise<LibraryRefreshExecutionResult> {
	const settings = deps.getSettings();
	try {
		const run = await deps.runRefresh(
			settings,
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
