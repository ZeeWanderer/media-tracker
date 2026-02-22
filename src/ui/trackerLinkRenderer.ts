import {extractImdbId, formatLinkLabel, getAnilistUrl, getFaviconUrl, toLinkUrl} from "../domain/media/links";
import {setAttrSafe} from "./domAttrs";
import type {MediaItemLike, RenderHandlers} from "./trackerRenderTypes";

export function renderLinks(container: HTMLElement, item: MediaItemLike, handlers: RenderHandlers): number {
	let count = 0;
	const links = item.links ?? [];
	for (const link of links) {
		count += renderLinkButton(container, link, handlers) ? 1 : 0;
	}
	const imdbId = item.imdbId;
	if (imdbId) {
		const normalized = extractImdbId(imdbId) ?? imdbId;
		const hasImdb = links.some((link) => extractImdbId(link) === normalized);
		if (!hasImdb) {
			count += renderLinkButton(container, normalized, handlers) ? 1 : 0;
		}
	}
	const anilistId = item.anilistId;
	if (anilistId) {
		const url = getAnilistUrl(anilistId, item.type === "manga" ? "manga" : "anime");
		count += renderLinkButton(container, url, handlers) ? 1 : 0;
	}
	return count;
}

function renderLinkButton(
	container: HTMLElement,
	value: string,
	handlers: RenderHandlers,
): boolean {
	const url = toLinkUrl(value);
	if (!url) {
		return false;
	}
	const button = document.createElement("button");
	button.classList.add("media-tracker__button", "media-tracker__link-button");
	const text = document.createElement("span");
	text.textContent = formatLinkLabel(value);
	text.classList.add("media-tracker__link-label");
	button.appendChild(text);

	const iconUrl = handlers.getLinkIconUrl ? handlers.getLinkIconUrl(value) : getFaviconUrl(value);
	if (iconUrl) {
		const icon = document.createElement("img");
		icon.classList.add("media-tracker__link-icon");
		icon.alt = "";
		icon.src = iconUrl;
		button.prepend(icon);
		button.classList.add("media-tracker__link-button--icon");
		setAttrSafe(button, "aria-label", text.textContent ?? "Link");
		setAttrSafe(button, "title", text.textContent ?? "Link");
		icon.addEventListener("error", () => {
			icon.remove();
			button.classList.remove("media-tracker__link-button--icon");
		});
	}

	container.appendChild(button);
	button.addEventListener("click", () => {
		if (handlers.onLinkOpen) {
			handlers.onLinkOpen(url);
		} else {
			window.open(url, "_blank", "noopener");
		}
	});
	return true;
}
