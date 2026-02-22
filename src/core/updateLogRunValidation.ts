import {UpdateLogRun} from "../types";

export function isValidUpdateLogRun(run: unknown): run is UpdateLogRun {
	if (!run || typeof run !== "object") {
		return false;
	}
	const value = run as Partial<UpdateLogRun>;
	return Number.isFinite(value.startedAt)
		&& Number.isFinite(value.finishedAt)
		&& Number.isFinite(value.durationMs)
		&& Number.isFinite(value.total)
		&& Number.isFinite(value.updated)
		&& Number.isFinite(value.unchanged)
		&& Number.isFinite(value.failed)
		&& Number.isFinite(value.skipped)
		&& Array.isArray(value.entries);
}
