import {MediaStatus, NewMediaDraft} from "../../types";
import {ANILIST_TYPES, IMDB_TYPES, NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES} from "./config";
import {extractAnilistId, extractImdbId, filterAnilistLinks, filterImdbLinks, getImdbIdFromLinks, normalizeLinks} from "./links";
import {CURRENT_MEDIA_SCHEMA_VERSION} from "./schema";

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
	// Keep free-form progress text, but canonicalize pure integers (including 0).
	if (/^\d+$/.test(trimmed)) {
		const parsed = Number.parseInt(trimmed, 10);
		if (!Number.isFinite(parsed) || parsed < 0) {
			return undefined;
		}
		return String(parsed);
	}
	return trimmed;
}

function formatYamlString(value: string): string {
	const trimmed = value.trim();
	if (!trimmed.length) {
		return "";
	}
	if (/[:#\n]/.test(trimmed)) {
		return JSON.stringify(trimmed);
	}
	return trimmed;
}

function pushLine(lines: string[], key: string, value: string | undefined) {
	if (!value) {
		return;
	}
	const formatted = formatYamlString(value);
	if (!formatted.length) {
		return;
	}
	lines.push(`${key}: ${formatted}`);
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

export function buildMediaFrontmatter(draft: NewMediaDraft): string {
	const normalizedDraft = sanitizeNewMediaDraft(draft);
	const lines: string[] = [];
	lines.push("---");
	lines.push(`type: ${normalizedDraft.type}`);
	lines.push(`mediaTrackerVersion: ${CURRENT_MEDIA_SCHEMA_VERSION}`);
	pushLine(lines, "title", normalizedDraft.title);
	pushLine(lines, "status", normalizedDraft.status);
	pushLine(lines, "author", normalizedDraft.author);
	pushLine(lines, "progress", normalizedDraft.progress);
	pushLine(lines, "season", normalizedDraft.season);
	pushLine(lines, "episode", normalizedDraft.episode);
	pushLine(lines, "year", normalizedDraft.year);

	const normalizedLinks = normalizedDraft.links;
	const imdbId = normalizedDraft.imdbId ?? getImdbIdFromLinks(normalizedLinks);
	pushLine(lines, "imdbId", imdbId);
	const anilistId = normalizedDraft.anilistId ? extractAnilistId(normalizedDraft.anilistId) : undefined;
	if (anilistId) {
		pushLine(lines, "anilistId", String(anilistId));
	}
	const storedLinks = filterImdbLinks(filterAnilistLinks(normalizedLinks));

	if (storedLinks.length) {
		lines.push("links:");
		for (const link of storedLinks) {
			lines.push(`  - ${formatYamlString(link)}`);
		}
	}

	lines.push("---");
	lines.push("");
	return lines.join("\n");
}
