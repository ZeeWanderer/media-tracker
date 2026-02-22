import {PluginLogLevel, UpdateLogRun, UpdateNotificationMode} from "../types";

export type StartupUpdateThrottleMode = "day" | "week" | "hours";

export interface MediaTrackerSettings {
	mediaFolder: string;
	displayMode: "cards" | "details";
	tmdbApiKey: string;
	tmdbMinIntervalMs: number;
	tmdbLastSync?: number;
	updateNotificationMode: UpdateNotificationMode;
	autoOpenUpdateLogOnFailure: boolean;
	startupLibraryUpdateEnabled: boolean;
	startupLibraryUpdateThrottleMode: StartupUpdateThrottleMode;
	startupLibraryUpdateIntervalHours: number;
	startupLibraryUpdateLastRun?: number;
	updateLogRuns: UpdateLogRun[];
	loggingEnabled: boolean;
	loggingLevel: PluginLogLevel;
	loggingMaxFiles: number;
}

export const DEFAULT_SETTINGS: MediaTrackerSettings = {
	mediaFolder: "Media",
	displayMode: "cards",
	tmdbApiKey: "",
	tmdbMinIntervalMs: 300,
	updateNotificationMode: "summary",
	autoOpenUpdateLogOnFailure: true,
	startupLibraryUpdateEnabled: false,
	startupLibraryUpdateThrottleMode: "day",
	startupLibraryUpdateIntervalHours: 24,
	updateLogRuns: [],
	loggingEnabled: true,
	loggingLevel: "info",
	loggingMaxFiles: 14,
};
