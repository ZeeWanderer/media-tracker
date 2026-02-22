import {NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES, type MediaType} from "./config";

export type SeasonEpisodeProgress = {
	season: number;
	episode: number;
};

export type MangaProgress =
	| {kind: "chapter"; chapter: number}
	| {kind: "volumeChapter"; volume: number; chapter: number};

export type ProgressDisplaySnapshot = {
	progress?: string;
	progressLabel?: string;
	progressUnit?: string;
	season?: number;
	episode?: number;
	year?: number;
};

export type ProgressMutableFields = {
	progress?: string;
	progressLabel?: string;
	progressUnit?: string;
	season?: number;
	episode?: number;
	year?: number;
};

export type ParsedProgressInput =
	| {kind: "clear"}
	| {kind: "season-episode"; value: SeasonEpisodeProgress}
	| {kind: "novel-numeric"; numeric: string}
	| {kind: "novel-label"; label: string}
	| {kind: "invalid"; raw: string}
	| {kind: "raw"; raw: string};

export type ProgressApplyResult = {
	parsed: ParsedProgressInput;
	next: ProgressMutableFields;
	accepted: boolean;
};

function normalizeString(value: unknown): string | undefined {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length ? trimmed : undefined;
	}
	if (typeof value === "number") {
		return `${value}`;
	}
	return undefined;
}

export function parseSeasonEpisodeProgress(value: string): SeasonEpisodeProgress | null {
	const trimmed = value.trim();
	if (!trimmed.length) {
		return null;
	}
	const seMatch = trimmed.match(/^S\s*(\d+)\s*E\s*(\d+)$/i);
	const altMatch = trimmed.match(/^(\d+)\s*x\s*(\d+)$/i);
	const match = seMatch ?? altMatch;
	if (!match?.[1] || !match[2]) {
		return null;
	}
	const season = Number.parseInt(match[1], 10);
	const episode = Number.parseInt(match[2], 10);
	if (!Number.isFinite(season) || !Number.isFinite(episode)) {
		return null;
	}
	return {season, episode};
}

export function formatSeasonEpisodeProgress(value: SeasonEpisodeProgress): string {
	return `S${value.season}E${value.episode}`;
}

export function parseChapterProgressValue(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed.length) {
		return null;
	}
	if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
		return trimmed;
	}
	const prefixed = trimmed.match(/^(?:ch|chapter)\s*(\d+(?:\.\d+)?)$/i);
	if (prefixed?.[1]) {
		return prefixed[1];
	}
	const volumeChapter = trimmed.match(/^(?:vol|volume|v)\s*\d+\s*(?:ch|chapter|c)\s*(\d+(?:\.\d+)?)$/i);
	if (volumeChapter?.[1]) {
		return volumeChapter[1];
	}
	return null;
}

export function incrementProgressNumericString(value: string): string {
	const decimalMatch = value.match(/^(\d+)\.(\d+)$/);
	if (decimalMatch?.[1] && decimalMatch[2]) {
		const whole = Number.parseInt(decimalMatch[1], 10);
		const fractional = decimalMatch[2];
		if (Number.isNaN(whole)) {
			return value;
		}
		// Manga special chapters are usually ".5", and the next canonical chapter is the next integer.
		if (fractional === "5") {
			return String(whole + 1);
		}
		const next = Number.parseInt(fractional, 10);
		if (Number.isNaN(next)) {
			return value;
		}
		return `${whole}.${next + 1}`;
	}
	const next = Number.parseInt(value, 10);
	if (Number.isNaN(next)) {
		return value;
	}
	return String(next + 1);
}

export function parseMangaProgress(value: string): MangaProgress | null {
	const trimmed = value.trim();
	if (!trimmed.length) {
		return null;
	}
	const volumeChapterMatch = trimmed.match(/^(?:vol|volume|v)\s*(\d+)\s*(?:ch|chapter|c)\s*(\d+(?:\.\d+)?)$/i);
	if (volumeChapterMatch?.[1] && volumeChapterMatch?.[2]) {
		const volume = Number.parseInt(volumeChapterMatch[1], 10);
		const chapter = Number.parseFloat(volumeChapterMatch[2]);
		if (Number.isFinite(volume) && Number.isFinite(chapter)) {
			return {kind: "volumeChapter", volume, chapter};
		}
	}
	const prefixedChapter = trimmed.match(/^(?:ch|chapter)\s*(\d+(?:\.\d+)?)$/i);
	if (prefixedChapter?.[1]) {
		const chapter = Number.parseFloat(prefixedChapter[1]);
		if (Number.isFinite(chapter)) {
			return {kind: "chapter", chapter};
		}
	}
	if (/^\d+$/.test(trimmed)) {
		const chapter = Number.parseInt(trimmed, 10);
		if (Number.isFinite(chapter)) {
			return {kind: "chapter", chapter};
		}
	}
	const dotMatch = trimmed.match(/^(\d+)\.(\d+)$/);
	if (dotMatch?.[1] && dotMatch?.[2]) {
		// Treat values like "8.33" as volume/chapter shorthand to avoid false
		// "New" badges when AniList only provides total chapters.
		if (dotMatch[2].length >= 2) {
			const volume = Number.parseInt(dotMatch[1], 10);
			const chapter = Number.parseInt(dotMatch[2], 10);
			if (Number.isFinite(volume) && Number.isFinite(chapter)) {
				return {kind: "volumeChapter", volume, chapter};
			}
		}
		const chapter = Number.parseFloat(trimmed);
		if (Number.isFinite(chapter)) {
			return {kind: "chapter", chapter};
		}
	}
	return null;
}

export function normalizeProgressInput(type: MediaType, value: string): ParsedProgressInput {
	const trimmed = value.trim();
	if (SEASON_EPISODE_TYPES.has(type)) {
		if (!trimmed.length) {
			return {kind: "clear"};
		}
		const parsed = parseSeasonEpisodeProgress(trimmed);
		if (parsed) {
			return {kind: "season-episode", value: parsed};
		}
		return {kind: "invalid", raw: trimmed};
	}
	if (NOVEL_PROGRESS_TYPES.has(type)) {
		if (!trimmed.length) {
			return {kind: "clear"};
		}
		const numeric = parseChapterProgressValue(trimmed);
		if (numeric) {
			return {kind: "novel-numeric", numeric};
		}
		return {kind: "novel-label", label: trimmed};
	}
	if (!trimmed.length) {
		return {kind: "clear"};
	}
	return {kind: "raw", raw: trimmed};
}

export function applyProgressInputToFields(
	type: MediaType,
	value: string,
	current: ProgressMutableFields,
): ProgressApplyResult {
	const parsed = normalizeProgressInput(type, value);
	const next: ProgressMutableFields = {...current};

	if (SEASON_EPISODE_TYPES.has(type)) {
		if (parsed.kind === "clear") {
			next.season = undefined;
			next.episode = undefined;
			return {parsed, next, accepted: true};
		}
		if (parsed.kind === "season-episode") {
			next.season = parsed.value.season;
			next.episode = parsed.value.episode;
			return {parsed, next, accepted: true};
		}
		return {parsed, next: current, accepted: false};
	}

	if (NOVEL_PROGRESS_TYPES.has(type)) {
		if (parsed.kind === "clear") {
			next.progress = undefined;
			next.progressLabel = undefined;
			next.progressUnit = undefined;
			return {parsed, next, accepted: true};
		}
		if (parsed.kind === "novel-numeric") {
			next.progress = parsed.numeric;
			next.progressUnit = "ch";
			next.progressLabel = undefined;
			return {parsed, next, accepted: true};
		}
		if (parsed.kind === "novel-label") {
			next.progressLabel = parsed.label;
			next.progress = undefined;
			next.progressUnit = undefined;
			return {parsed, next, accepted: true};
		}
		return {parsed, next: current, accepted: false};
	}

	if (parsed.kind === "clear") {
		next.progress = undefined;
		next.progressLabel = undefined;
		next.progressUnit = undefined;
		return {parsed, next, accepted: true};
	}
	if (parsed.kind === "raw") {
		next.progress = parsed.raw;
		return {parsed, next, accepted: true};
	}
	return {parsed, next: current, accepted: false};
}

export function buildProgressDisplay(
	type: MediaType,
	snapshot: ProgressDisplaySnapshot,
): string | undefined {
	if (NOVEL_PROGRESS_TYPES.has(type)) {
		const label = normalizeString(snapshot.progressLabel);
		if (label) {
			return label;
		}
		const progress = normalizeString(snapshot.progress);
		if (!progress) {
			return undefined;
		}
		if (!/^\d+(?:\.\d+)?$/.test(progress)) {
			return progress;
		}
		const unit = normalizeString(snapshot.progressUnit) ?? "ch";
		return `${unit} ${progress}`;
	}
	if (SEASON_EPISODE_TYPES.has(type)) {
		const season = snapshot.season;
		const episode = snapshot.episode;
		if (season !== undefined || episode !== undefined) {
			return `S${season ?? "?"}E${episode ?? "?"}`;
		}
		return undefined;
	}
	if (type === "movie") {
		return snapshot.year !== undefined ? `Year ${snapshot.year}` : undefined;
	}
	return undefined;
}
