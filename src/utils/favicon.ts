import {requestUrl} from "obsidian";
import {MediaTrackerSettings} from "../settings";
import {toLinkUrl} from "./links";

export function getFaviconCacheKey(link: string): string | null {
	const url = toLinkUrl(link);
	if (!url) {
		return null;
	}
	try {
		return new URL(url).origin.toLowerCase();
	} catch {
		return null;
	}
}

export function getCachedFavicon(settings: MediaTrackerSettings, link: string): string | null {
	const key = getFaviconCacheKey(link);
	if (!key) {
		return null;
	}
	const entry = settings.faviconCache?.[key];
	return entry?.dataUrl ?? null;
}

export async function fetchFaviconDataUrl(link: string): Promise<{key: string; dataUrl: string} | null> {
	const key = getFaviconCacheKey(link);
	if (!key) {
		return null;
	}
	const faviconUrl = `${key}/favicon.ico`;
	try {
		const response = await requestUrl({url: faviconUrl});
		const bytes = response.arrayBuffer ? new Uint8Array(response.arrayBuffer) : null;
		if (!bytes || bytes.length === 0) {
			return null;
		}
		const base64 = Buffer.from(bytes).toString("base64");
		const contentType = response.headers?.["content-type"] ?? "image/x-icon";
		return {key, dataUrl: `data:${contentType};base64,${base64}`};
	} catch {
		return null;
	}
}
