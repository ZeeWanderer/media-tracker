import type {MediaStatus, MediaType} from "./domain/media/config";
import type {MediaItem, NewMediaDraft} from "./domain/media/models";

export type {MediaType, MediaStatus};
export type {MediaItem, NewMediaDraft};
export type PluginLogLevel = "debug" | "info" | "warn" | "error";
export type UpdateNotificationMode = "quiet" | "summary" | "verbose";
export type UpdateProvider = "anilist" | "tmdb" | "none";
export type UpdateEntryStatus = "updated" | "unchanged" | "failed" | "skipped";
export type UpdateRunState = "completed" | "in-progress" | "interrupted";

export interface UpdateLogEntry {
	title: string;
	filePath: string;
	type: MediaType;
	provider: UpdateProvider;
	status: UpdateEntryStatus;
	message: string;
	attempts?: UpdateLogAttempt[];
}

export interface UpdateLogAttempt {
	provider: UpdateProvider;
	status: UpdateEntryStatus;
	message: string;
}

export interface UpdateLogRun {
	startedAt: number;
	finishedAt: number;
	durationMs: number;
	total: number;
	updated: number;
	unchanged: number;
	failed: number;
	skipped: number;
	providerProgress?: {
		anilist: {total: number; completed: number};
		tmdb: {total: number; completed: number};
	};
	state?: UpdateRunState;
	entries: UpdateLogEntry[];
}

export type NewMediaFieldConfig = {
	key: keyof NewMediaDraft;
	label: string;
	placeholder?: string;
	description?: string;
	inputType?: "text" | "number";
};
