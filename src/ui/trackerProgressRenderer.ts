import {NOVEL_PROGRESS_TYPES, SEASON_EPISODE_TYPES} from "../domain/media/config";
import {hasRepeatProgress} from "../domain/media/progress";
import {buildLatestBadges, getNextProgressValue, type TrackerBadgeDescriptor} from "../domain/media/tracker";
import {setAttrSafe} from "./domAttrs";
import type {MediaItemLike, RenderHandlers} from "./trackerRenderTypes";

export function renderProgressMeta(item: MediaItemLike, handlers: RenderHandlers, compact = false): HTMLElement {
	return renderProgressControl(item, handlers, compact, false);
}

export function renderRepeatProgressMeta(item: MediaItemLike, handlers: RenderHandlers, compact = false): HTMLElement {
	return renderProgressControl(item, handlers, compact, true);
}

function renderProgressControl(
	item: MediaItemLike,
	handlers: RenderHandlers,
	compact: boolean,
	repeat: boolean,
): HTMLElement {
	const wrapper = document.createElement("div");
	wrapper.classList.add("media-tracker__progress");
	if (repeat) {
		wrapper.classList.add("media-tracker__progress--repeat");
	}
	if (compact) {
		wrapper.classList.add("media-tracker__progress--compact");
	}
	const progress = repeat ? item.repeatProgress : item.progress;
	const hasProgress = Boolean(progress?.trim());

	const label = document.createElement("button");
	label.type = "button";
	label.classList.add("media-tracker__progress-label");
	if (hasProgress) {
		label.textContent = progress ?? "";
	} else {
		label.classList.add("media-tracker__progress-label--empty");
		label.textContent = " ";
		setAttrSafe(label, "aria-label", repeat ? "Set repeat progress" : "Set progress");
	}
	label.addEventListener("click", (event) => {
		event.preventDefault();
		if (repeat) {
			handlers.onRepeatProgressEdit?.(label, item);
		} else {
			handlers.onProgressEdit?.(label, item);
		}
	});
	const control = document.createElement("div");
	control.classList.add("media-tracker__progress-control");
	control.appendChild(label);

	// Keep auto-increment gated on explicit progress, but always render latest badges.
	const progressItem = repeat ? {
		...item,
		progress: item.repeatProgress,
		progressRaw: item.repeatProgressRaw,
		progressLabel: item.repeatProgressLabel,
		progressUnit: item.repeatProgressUnit,
		season: item.repeatSeason,
		episode: item.repeatEpisode,
	} : item;
	const nextValue = hasProgress ? getNextProgressValue(progressItem) : null;
	if (nextValue) {
		const increment = document.createElement("button");
		increment.type = "button";
		increment.classList.add("media-tracker__progress-add");
		increment.appendChild(createPlusIcon());
		setAttrSafe(increment, "title", repeat ? "Advance repeat progress" : "Advance progress");
		increment.addEventListener("click", (event) => {
			event.preventDefault();
			if (repeat) {
				handlers.onRepeatProgressAdvance?.(increment, item, nextValue);
			} else {
				handlers.onProgressAdvance?.(increment, item, nextValue);
			}
		});
		control.appendChild(increment);
	}

	wrapper.appendChild(control);
	const badge = repeat ? null : renderLatestBadge(item);
	if (badge) {
		wrapper.appendChild(badge);
	}
	return wrapper;
}

export function renderProgressLanes(item: MediaItemLike, handlers: RenderHandlers, compact = false): HTMLElement {
	if (!hasRepeatProgress(item)) {
		return renderProgressMeta(item, handlers, compact);
	}
	const lanes = document.createElement("div");
	lanes.classList.add("media-tracker__progress-lanes");
	lanes.appendChild(renderProgressLane("Progress", renderProgressMeta(item, handlers, compact)));
	lanes.appendChild(renderProgressLane("Repeating", renderRepeatProgressMeta(item, handlers, compact)));
	return lanes;
}

function renderProgressLane(label: string, progress: HTMLElement): HTMLElement {
	const lane = document.createElement("div");
	lane.classList.add("media-tracker__progress-lane");
	const laneLabel = document.createElement("span");
	laneLabel.classList.add("media-tracker__progress-lane-label");
	laneLabel.textContent = label;
	lane.appendChild(laneLabel);
	lane.appendChild(progress);
	return lane;
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
