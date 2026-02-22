import {MEDIA_TYPES} from "../domain/media/config";
import type {
	UpdateEntryStatus,
	UpdateLogAttempt,
	UpdateLogEntry,
	UpdateLogRun,
	UpdateProvider,
	UpdateRunState,
} from "./updateTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isUpdateProvider(value: unknown): value is UpdateProvider {
	return value === "anilist" || value === "tmdb" || value === "none";
}

function isUpdateEntryStatus(value: unknown): value is UpdateEntryStatus {
	return value === "updated" || value === "unchanged" || value === "failed" || value === "skipped";
}

function isUpdateRunState(value: unknown): value is UpdateRunState {
	return value === "completed" || value === "in-progress" || value === "interrupted";
}

function isUpdateLogAttempt(value: unknown): value is UpdateLogAttempt {
	if (!isRecord(value)) {
		return false;
	}
	return isUpdateProvider(value.provider)
		&& isUpdateEntryStatus(value.status)
		&& typeof value.message === "string";
}

function isUpdateLogEntry(value: unknown): value is UpdateLogEntry {
	if (!isRecord(value)) {
		return false;
	}
	if (typeof value.title !== "string"
		|| typeof value.filePath !== "string"
		|| typeof value.message !== "string") {
		return false;
	}
	if (!MEDIA_TYPES.includes(value.type as (typeof MEDIA_TYPES)[number])) {
		return false;
	}
	if (!isUpdateProvider(value.provider) || !isUpdateEntryStatus(value.status)) {
		return false;
	}
	if (value.attempts === undefined) {
		return true;
	}
	return Array.isArray(value.attempts) && value.attempts.every((attempt) => isUpdateLogAttempt(attempt));
}

function isProviderProgress(
	value: unknown,
): value is NonNullable<UpdateLogRun["providerProgress"]> {
	if (!isRecord(value)) {
		return false;
	}
	const anilist = value.anilist;
	const tmdb = value.tmdb;
	if (!isRecord(anilist) || !isRecord(tmdb)) {
		return false;
	}
	return isNonNegativeNumber(anilist.total)
		&& isNonNegativeNumber(anilist.completed)
		&& isNonNegativeNumber(tmdb.total)
		&& isNonNegativeNumber(tmdb.completed);
}

export function isValidUpdateLogRun(run: unknown): run is UpdateLogRun {
	if (!isRecord(run)) {
		return false;
	}
	const value = run as Partial<UpdateLogRun>;
	if (!isNonNegativeNumber(value.startedAt)
		|| !isNonNegativeNumber(value.finishedAt)
		|| !isNonNegativeNumber(value.durationMs)
		|| !isNonNegativeNumber(value.total)
		|| !isNonNegativeNumber(value.updated)
		|| !isNonNegativeNumber(value.unchanged)
		|| !isNonNegativeNumber(value.failed)
		|| !isNonNegativeNumber(value.skipped)) {
		return false;
	}
	if (value.finishedAt < value.startedAt) {
		return false;
	}
	const processed = value.updated + value.unchanged + value.failed + value.skipped;
	if (processed > value.total) {
		return false;
	}
	if (!Array.isArray(value.entries) || !value.entries.every((entry) => isUpdateLogEntry(entry))) {
		return false;
	}
	if (value.providerProgress !== undefined && !isProviderProgress(value.providerProgress)) {
		return false;
	}
	if (value.state !== undefined && !isUpdateRunState(value.state)) {
		return false;
	}
	return true;
}
