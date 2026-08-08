import {TMDB_TYPES} from "../../domain/media/config";
import {getImdbIdFromLinks} from "../../domain/media/links";
import type {MediaRecord} from "../../domain/media/models";

export type RefreshQueue = "anilist" | "tmdb";

export type RefreshProviderPlan = {
	primary: RefreshQueue | null;
	fallbackOnFailure?: RefreshQueue;
};

export type RefreshProviderResult = {
	provider: RefreshQueue;
	status: "updated" | "unchanged" | "failed" | "skipped";
	message: string;
};

export type RefreshProviderExecution = {
	result: RefreshProviderResult;
	providersChecked: RefreshQueue[];
	attempts: RefreshProviderResult[];
};

export type RefreshProviderOperations = Record<
	RefreshQueue,
	() => Promise<RefreshProviderResult>
>;

export function getRefreshProviderPlan(item: MediaRecord): RefreshProviderPlan {
	if (item.type === "manga") {
		return {primary: "anilist"};
	}
	if (item.type === "anime") {
		const hasTmdbIdentity = Boolean(item.tmdbId || item.imdbId || getImdbIdFromLinks(item.links));
		return {
			primary: "anilist",
			fallbackOnFailure: hasTmdbIdentity ? "tmdb" : undefined,
		};
	}
	return {primary: TMDB_TYPES.has(item.type) ? "tmdb" : null};
}

export async function executeRefreshProviderPlan(
	plan: RefreshProviderPlan,
	operations: RefreshProviderOperations,
): Promise<RefreshProviderExecution | null> {
	if (!plan.primary) {
		return null;
	}
	const primary = await operations[plan.primary]();
	if (primary.status !== "failed" || !plan.fallbackOnFailure) {
		return {
			result: primary,
			providersChecked: [plan.primary],
			attempts: [primary],
		};
	}
	const fallback = await operations[plan.fallbackOnFailure]();
	return {
		result: fallback,
		providersChecked: [plan.primary, plan.fallbackOnFailure],
		attempts: [primary, fallback],
	};
}
