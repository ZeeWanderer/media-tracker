import {NewMediaDraft} from "../../types";
import {ANILIST_TYPES, IMDB_TYPES, NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES, type MediaStatus} from "./config";
import {extractImdbId, normalizeLinks} from "./links";
import {parseChapterProgressValue} from "./progress";

const MEDIA_STATUSES: MediaStatus[] = ["planned", "active", "completed", "on-hold", "dropped"];

function normalizeText(value?: string): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length ? trimmed : undefined;
}

function normalizeNonNegativeInteger(value?: string): string | undefined {
	const trimmed = normalizeText(value);
	if (!trimmed || !/^\d+$/.test(trimmed)) {
		return undefined;
	}
	const parsed = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return undefined;
	}
	return String(parsed);
}

function normalizePositiveInteger(value?: string): string | undefined {
	const parsed = normalizeNonNegativeInteger(value);
	if (!parsed) {
		return undefined;
	}
	if (Number.parseInt(parsed, 10) <= 0) {
		return undefined;
	}
	return parsed;
}

function normalizeProgressValue(value?: string): string | undefined {
	const trimmed = normalizeText(value);
	if (!trimmed) {
		return undefined;
	}
	const numericChapter = parseChapterProgressValue(trimmed);
	return numericChapter ?? trimmed;
}

export function sanitizeMediaFileName(name: string): string {
	const normalized = normalizeText(name);
	if (!normalized) {
		return "";
	}
	return normalized
		.replace(/[\\/:*?"<>|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function sanitizeNewMediaDraft(draft: NewMediaDraft): NewMediaDraft {
	const type = draft.type;
	const status = MEDIA_STATUSES.includes(draft.status) ? draft.status : "active";
	const normalized: NewMediaDraft = {
		title: normalizeText(draft.title) ?? "",
		type,
		status,
		links: normalizeLinks(draft.links ?? []),
	};

	if (IMDB_TYPES.has(type)) {
		const imdbId = normalizeText(draft.imdbId);
		if (imdbId) {
			normalized.imdbId = extractImdbId(imdbId) ?? imdbId;
		}
	}

	if (ANILIST_TYPES.has(type)) {
		const anilistId = normalizeText(draft.anilistId);
		if (anilistId) {
			normalized.anilistId = anilistId;
		}
	}

	if (NOVEL_PROGRESS_TYPES.has(type)) {
		const author = normalizeText(draft.author);
		const progress = normalizeProgressValue(draft.progress);
		if (author) {
			normalized.author = author;
		}
		if (progress !== undefined) {
			normalized.progress = progress;
		}
	}

	if (SEASON_EPISODE_TYPES.has(type)) {
		const season = normalizeNonNegativeInteger(draft.season);
		const episode = normalizeNonNegativeInteger(draft.episode);
		if (season && episode) {
			normalized.season = season;
			normalized.episode = episode;
		}
	}

	if (type === "movie") {
		const year = normalizePositiveInteger(draft.year);
		if (year) {
			normalized.year = year;
		}
	}

	return normalized;
}
