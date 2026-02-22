import {requestUrl} from "obsidian";
import type {AniListMedia} from "./types";

const ANILIST_URL = "https://graphql.anilist.co";
// AniList official docs currently note a temporary degraded limit of 30 requests/minute.
const ANILIST_FALLBACK_RATE_PER_MINUTE = 30;
const ANILIST_FALLBACK_MIN_DELAY_MS = Math.ceil(60_000 / ANILIST_FALLBACK_RATE_PER_MINUTE);
const ANILIST_MAX_RETRIES = 5;
const ANILIST_MAX_BACKOFF_MS = 30_000;
const ANILIST_RETRY_JITTER_MS = 250;
let anilistNextAllowedRequestAt = 0;
let anilistComputedMinDelayMs = ANILIST_FALLBACK_MIN_DELAY_MS;

type AniListResponse = {
	data?: {Media?: AniListMedia};
	errors?: unknown;
};

const MEDIA_QUERY = `
	query ($id: Int) {
		Media(id: $id) {
			id
			type
			format
			episodes
			chapters
			volumes
			nextAiringEpisode {
				episode
				airingAt
			}
			relations {
				edges {
					relationType
					node {
						id
						type
						format
						episodes
						chapters
						volumes
						nextAiringEpisode {
							episode
							airingAt
						}
					}
				}
			}
		}
	}
`;

function wait(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function toDelayMs(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		return 0;
	}
	return Math.floor(value);
}

function getAniListBaseDelayMs(requestedMinDelayMs: number): number {
	return Math.max(anilistComputedMinDelayMs, requestedMinDelayMs);
}

async function waitForAniListRateWindow(): Promise<void> {
	const now = Date.now();
	if (anilistNextAllowedRequestAt > now) {
		await wait(anilistNextAllowedRequestAt - now);
	}
}

function getHeaderValue(headers: Record<string, string> | undefined, key: string): string | undefined {
	if (!headers) {
		return undefined;
	}
	const direct = headers[key] ?? headers[key.toLowerCase()];
	if (direct !== undefined) {
		return direct;
	}
	const match = Object.entries(headers)
		.find(([headerKey]) => headerKey.toLowerCase() === key.toLowerCase());
	return match?.[1];
}

function parseRetryAfterDelayMs(headers: Record<string, string> | undefined): number | undefined {
	const raw = getHeaderValue(headers, "Retry-After");
	if (!raw) {
		return undefined;
	}
	const seconds = Number.parseFloat(raw);
	if (Number.isFinite(seconds) && seconds > 0) {
		return Math.floor(seconds * 1000);
	}
	const parsedDateMs = Date.parse(raw);
	if (!Number.isFinite(parsedDateMs)) {
		return undefined;
	}
	const delta = parsedDateMs - Date.now();
	return delta > 0 ? delta : undefined;
}

function parseRateLimitResetDelayMs(headers: Record<string, string> | undefined): number | undefined {
	const raw = getHeaderValue(headers, "X-RateLimit-Reset");
	if (!raw) {
		return undefined;
	}
	const resetSeconds = Number.parseInt(raw, 10);
	if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) {
		return undefined;
	}
	const delta = resetSeconds * 1000 - Date.now();
	return delta > 0 ? delta : undefined;
}

function parseRateLimitLimit(headers: Record<string, string> | undefined): number | undefined {
	const raw = getHeaderValue(headers, "X-RateLimit-Limit");
	if (!raw) {
		return undefined;
	}
	const limit = Number.parseInt(raw, 10);
	if (!Number.isFinite(limit) || limit <= 0) {
		return undefined;
	}
	return limit;
}

function parseRateLimitRemaining(headers: Record<string, string> | undefined): number | undefined {
	const raw = getHeaderValue(headers, "X-RateLimit-Remaining");
	if (!raw) {
		return undefined;
	}
	const remaining = Number.parseInt(raw, 10);
	if (!Number.isFinite(remaining) || remaining < 0) {
		return undefined;
	}
	return remaining;
}

function scheduleNextAniListRequest(
	requestedMinDelayMs: number,
	headers?: Record<string, string>,
	minimumDelayMs?: number,
) {
	const reportedLimitPerMinute = parseRateLimitLimit(headers);
	if (reportedLimitPerMinute !== undefined) {
		anilistComputedMinDelayMs = Math.max(1, Math.ceil(60_000 / reportedLimitPerMinute));
	}

	const resetDelayMs = parseRateLimitResetDelayMs(headers);
	const remaining = parseRateLimitRemaining(headers);
	const dynamicWindowDelayMs = resetDelayMs !== undefined && remaining !== undefined
		? remaining <= 0
			? resetDelayMs + 100
			: Math.ceil(resetDelayMs / remaining)
		: undefined;

	let delayMs = getAniListBaseDelayMs(requestedMinDelayMs);
	if (dynamicWindowDelayMs !== undefined) {
		// Prefer live window budgeting when the server exposes remaining quota and reset timestamp.
		delayMs = Math.max(requestedMinDelayMs, dynamicWindowDelayMs);
	}
	if (minimumDelayMs !== undefined) {
		delayMs = Math.max(delayMs, minimumDelayMs);
	}
	anilistNextAllowedRequestAt = Date.now() + Math.max(0, delayMs);
}

function computeAniListRetryDelayMs(
	attempt: number,
	baseDelayMs: number,
	headers?: Record<string, string>,
): number {
	const retryAfterMs = parseRetryAfterDelayMs(headers);
	if (retryAfterMs !== undefined) {
		return Math.max(baseDelayMs, retryAfterMs + 100);
	}
	const resetDelayMs = parseRateLimitResetDelayMs(headers);
	if (resetDelayMs !== undefined) {
		return Math.max(baseDelayMs, resetDelayMs + 100);
	}
	const exponentialBackoffMs = Math.min(ANILIST_MAX_BACKOFF_MS, baseDelayMs * (2 ** attempt));
	const jitterMs = Math.floor(Math.random() * ANILIST_RETRY_JITTER_MS);
	return exponentialBackoffMs + jitterMs;
}

function hasTooManyRequestsError(errors: unknown): boolean {
	if (!errors) {
		return false;
	}
	const text = typeof errors === "string" ? errors : JSON.stringify(errors);
	return text.toLowerCase().includes("too many requests");
}

export async function fetchAniListMedia(
	id: number,
	minDelayMs = 0,
): Promise<AniListMedia | null> {
	const requestedMinDelayMs = toDelayMs(minDelayMs);
	const body = JSON.stringify({query: MEDIA_QUERY, variables: {id}});
	for (let attempt = 0; attempt <= ANILIST_MAX_RETRIES; attempt += 1) {
		await waitForAniListRateWindow();
		const baseDelayMs = getAniListBaseDelayMs(requestedMinDelayMs);
		try {
				const response = await requestUrl({
					url: ANILIST_URL,
					method: "POST",
					contentType: "application/json",
					body,
				throw: false,
			});
			const parsed = response.json as AniListResponse;
			const rateLimited = response.status === 429 || hasTooManyRequestsError(parsed.errors);
			if (response.status >= 200 && response.status < 300 && !rateLimited) {
				scheduleNextAniListRequest(requestedMinDelayMs, response.headers);
				if (parsed.errors) {
					return null;
				}
				return parsed.data?.Media ?? null;
			}

			const shouldRetry = rateLimited || response.status >= 500;
			if (!shouldRetry || attempt >= ANILIST_MAX_RETRIES) {
				scheduleNextAniListRequest(requestedMinDelayMs, response.headers);
				return null;
			}
			scheduleNextAniListRequest(
				requestedMinDelayMs,
				response.headers,
				computeAniListRetryDelayMs(attempt, baseDelayMs, response.headers),
			);
		} catch {
			if (attempt >= ANILIST_MAX_RETRIES) {
				scheduleNextAniListRequest(requestedMinDelayMs, undefined, baseDelayMs);
				return null;
			}
			scheduleNextAniListRequest(
				requestedMinDelayMs,
				undefined,
				computeAniListRetryDelayMs(attempt, baseDelayMs),
			);
		}
	}
	return null;
}
