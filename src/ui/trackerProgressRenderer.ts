import {NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES} from "../domain/media/config";
import {buildLatestBadges, getNextProgressValue, type TrackerBadgeDescriptor} from "../domain/media/tracker";
import {setAttrSafe} from "./domAttrs";
import type {MediaItemLike, RenderHandlers} from "./trackerRenderTypes";

export function renderProgressMeta(item: MediaItemLike, handlers: RenderHandlers, compact = false): HTMLElement {
	const wrapper = document.createElement("div");
	wrapper.classList.add("media-tracker__progress");
	if (compact) {
		wrapper.classList.add("media-tracker__progress--compact");
	}
	const hasProgress = Boolean(item.progress?.trim());

	const label = document.createElement("button");
	label.type = "button";
	label.classList.add("media-tracker__progress-label");
	if (hasProgress) {
		label.textContent = item.progress ?? "";
	} else {
		label.classList.add("media-tracker__progress-label--empty");
		label.textContent = " ";
		setAttrSafe(label, "aria-label", "Set progress");
	}
	label.addEventListener("click", (event) => {
		event.preventDefault();
		handlers.onProgressEdit?.(label, item);
	});
	const control = document.createElement("div");
	control.classList.add("media-tracker__progress-control");
	control.appendChild(label);

	// Keep auto-increment gated on explicit progress, but always render latest badges.
	const nextValue = hasProgress ? getNextProgressValue(item) : null;
	if (nextValue) {
		const increment = document.createElement("button");
		increment.type = "button";
		increment.classList.add("media-tracker__progress-add");
		increment.appendChild(createPlusIcon());
		setAttrSafe(increment, "title", "Advance chapter");
		increment.addEventListener("click", (event) => {
			event.preventDefault();
			handlers.onProgressAdvance?.(increment, item, nextValue);
		});
		control.appendChild(increment);
	}

	wrapper.appendChild(control);
	const badge = renderLatestBadge(item);
	if (badge) {
		wrapper.appendChild(badge);
	}
	return wrapper;
}

export function supportsInteractiveProgress(item: MediaItemLike): boolean {
	return NOVEL_PROGRESS_TYPES.has(item.type) || SEASON_EPISODE_TYPES.has(item.type);
}

function createPlusIcon(): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("media-tracker__plus-icon");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("fill", "currentColor");
	path.setAttribute("d", "M11 5h2v14h-2zM5 11h14v2H5z");
	svg.appendChild(path);
	return svg;
}

function renderLatestBadge(item: MediaItemLike): HTMLElement | null {
	const descriptors = buildLatestBadges(item);
	if (!descriptors.length) {
		return null;
	}
	if (descriptors.length > 1) {
		const group = document.createElement("span");
		group.classList.add("media-tracker__badge-group");
		for (const descriptor of descriptors) {
			group.appendChild(renderBadgeDescriptor(descriptor));
		}
		return group;
	}
	const [first] = descriptors;
	return first ? renderBadgeDescriptor(first) : null;
}

function createBadge(text: string, isNew = false): HTMLElement {
	const badge = document.createElement("span");
	badge.classList.add("media-tracker__badge");
	if (isNew) {
		badge.classList.add("media-tracker__badge--new");
	}
	badge.textContent = text;
	return badge;
}

function renderBadgeDescriptor(descriptor: TrackerBadgeDescriptor): HTMLElement {
	const badge = createBadge(descriptor.text, descriptor.isNew);
	if (descriptor.title) {
		setAttrSafe(badge, "title", descriptor.title);
	}
	return badge;
}
