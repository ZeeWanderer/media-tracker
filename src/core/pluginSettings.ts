import {DEFAULT_SETTINGS, MediaTrackerSettings} from "./pluginSettingsModel";
import {isValidUpdateLogRun} from "./updateLogRunValidation";

export type MediaQuerySettingsSnapshot = {
	mediaFolder: string;
};

export type LoadedSettingsResult = {
	settings: MediaTrackerSettings;
	hadLegacyFaviconCache: boolean;
	hadLegacyPendingUpdateRun: boolean;
};

export function normalizeMediaFolder(value: string | undefined): string {
	const normalized = (value ?? "").trim();
	return normalized.length ? normalized : DEFAULT_SETTINGS.mediaFolder;
}

export function normalizeLoadedSettings(
	loaded: (Partial<MediaTrackerSettings> & {faviconCache?: unknown}) | null,
): LoadedSettingsResult {
	const loadedRecord = loaded && typeof loaded === "object" ? {...loaded} : null;
	let hadLegacyFaviconCache = false;
	let hadLegacyPendingUpdateRun = false;
	if (loadedRecord && "faviconCache" in loadedRecord) {
		delete loadedRecord.faviconCache;
		hadLegacyFaviconCache = true;
	}
	if (loadedRecord && "pendingUpdateRun" in (loadedRecord as Record<string, unknown>)) {
		delete (loadedRecord as Record<string, unknown>).pendingUpdateRun;
		hadLegacyPendingUpdateRun = true;
	}

	const settings = Object.assign({}, DEFAULT_SETTINGS, loadedRecord ?? {});

	if (settings.updateNotificationMode !== "quiet"
		&& settings.updateNotificationMode !== "summary"
		&& settings.updateNotificationMode !== "verbose") {
		settings.updateNotificationMode = DEFAULT_SETTINGS.updateNotificationMode;
	}
	if (typeof settings.autoOpenUpdateLogOnFailure !== "boolean") {
		settings.autoOpenUpdateLogOnFailure = DEFAULT_SETTINGS.autoOpenUpdateLogOnFailure;
	}
	if (typeof settings.startupLibraryUpdateEnabled !== "boolean") {
		settings.startupLibraryUpdateEnabled = DEFAULT_SETTINGS.startupLibraryUpdateEnabled;
	}
	if (settings.startupLibraryUpdateThrottleMode !== "day"
		&& settings.startupLibraryUpdateThrottleMode !== "week"
		&& settings.startupLibraryUpdateThrottleMode !== "hours") {
		settings.startupLibraryUpdateThrottleMode = DEFAULT_SETTINGS.startupLibraryUpdateThrottleMode;
	}
	if (!Number.isFinite(settings.startupLibraryUpdateIntervalHours)
		|| settings.startupLibraryUpdateIntervalHours <= 0) {
		settings.startupLibraryUpdateIntervalHours = DEFAULT_SETTINGS.startupLibraryUpdateIntervalHours;
	}
	if (!Number.isFinite(settings.startupLibraryUpdateLastRun ?? Number.NaN)
		|| (settings.startupLibraryUpdateLastRun ?? 0) <= 0) {
		delete settings.startupLibraryUpdateLastRun;
	}
	if (!Array.isArray(settings.updateLogRuns)) {
		settings.updateLogRuns = [];
	} else {
		settings.updateLogRuns = settings.updateLogRuns.filter((run) => isValidUpdateLogRun(run));
	}
	if (typeof settings.loggingEnabled !== "boolean") {
		settings.loggingEnabled = DEFAULT_SETTINGS.loggingEnabled;
	}
	if (settings.loggingLevel !== "debug"
		&& settings.loggingLevel !== "info"
		&& settings.loggingLevel !== "warn"
		&& settings.loggingLevel !== "error") {
		settings.loggingLevel = DEFAULT_SETTINGS.loggingLevel;
	}
	if (!Number.isFinite(settings.loggingMaxFiles) || settings.loggingMaxFiles <= 0) {
		settings.loggingMaxFiles = DEFAULT_SETTINGS.loggingMaxFiles;
	}
	settings.mediaFolder = normalizeMediaFolder(settings.mediaFolder);

	return {
		settings,
		hadLegacyFaviconCache,
		hadLegacyPendingUpdateRun,
	};
}

export function getMediaQuerySettingsSnapshot(settings: MediaTrackerSettings): MediaQuerySettingsSnapshot {
	return {
		mediaFolder: normalizeMediaFolder(settings.mediaFolder),
	};
}

export function didMediaQuerySettingsChange(
	previous: MediaQuerySettingsSnapshot,
	next: MediaQuerySettingsSnapshot,
): boolean {
	return previous.mediaFolder !== next.mediaFolder;
}
