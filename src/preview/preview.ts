import {getKnownIconAsset} from "../domain/media/links";
import {MEDIA_STATUS_LABELS} from "../ui/mediaStatusLabels";
import {MEDIA_TYPE_FIELDS, MEDIA_TYPE_LABELS, NEW_MEDIA_BASE_FIELDS} from "../ui/mediaTypeConfig";
import {renderCard, renderTableHeader, renderTableRow} from "../ui/trackerRenderer";
import type {MediaItemLike, RenderHandlers, SortDirection, SortKey} from "../ui/trackerRenderTypes";

type PreviewPayload = {
	items?: MediaItemLike[];
};

const sortKey: SortKey = "title";
const sortDirection: SortDirection = "asc";

const payload = (window as unknown as {MEDIA_TRACKER_PREVIEW_DATA?: PreviewPayload}).MEDIA_TRACKER_PREVIEW_DATA;
const items = payload?.items ?? [];

const params = new URLSearchParams(window.location.search);
const mode = params.get("mode") || "cards";
const theme = params.get("theme") || "light";
document.body.dataset.mode = mode;
document.documentElement.dataset.theme = theme;
document.body.classList.remove("theme-light", "theme-dark");
document.documentElement.classList.remove("theme-light", "theme-dark");
document.body.classList.add(`theme-${theme}`);
document.documentElement.classList.add(`theme-${theme}`);
document.body.classList.add("preview-scope");

const handlers: RenderHandlers = {
	onOpenNote: () => {},
	onCopyTitle: () => {},
	onContextMenu: (event) => event.preventDefault(),
	onStatusChange: () => {},
	onProgressEdit: () => {},
	onProgressAdvance: () => {},
	onLinkOpen: () => {},
	getLinkIconUrl: (value) => {
		const asset = getKnownIconAsset(value);
		return asset ? `../assets/${asset}` : null;
	},
};

const cardsContainer = document.getElementById("preview-cards");
if (cardsContainer) {
	cardsContainer.textContent = "";
	for (const item of items) {
		cardsContainer.appendChild(renderCard(item, handlers));
	}
}

const tableContainer = document.getElementById("preview-table");
if (tableContainer) {
	tableContainer.textContent = "";
	tableContainer.appendChild(renderTableHeader(sortKey, sortDirection));
	for (const item of items) {
		tableContainer.appendChild(renderTableRow(item, handlers));
	}
}

const newNoteContainer = document.getElementById("preview-new-note");
if (newNoteContainer) {
	newNoteContainer.textContent = "";
	const modal = document.createElement("div");
	modal.className = "media-tracker__modal";
	const title = document.createElement("h2");
	title.textContent = "Create media note";
	modal.appendChild(title);

	for (const field of NEW_MEDIA_BASE_FIELDS) {
		modal.appendChild(createSettingText(field.label, field.placeholder ?? "", field.description));
	}

	modal.appendChild(createSettingSelect("Type", Object.values(MEDIA_TYPE_LABELS), MEDIA_TYPE_LABELS.series));
	modal.appendChild(createSettingSelect("Status", Object.values(MEDIA_STATUS_LABELS), MEDIA_STATUS_LABELS.active));

	const section = document.createElement("h3");
	section.textContent = "Series details";
	modal.appendChild(section);
	for (const field of MEDIA_TYPE_FIELDS.series) {
		modal.appendChild(createSettingText(field.label, field.placeholder ?? "", field.description));
	}

	const linksTitle = document.createElement("h3");
	linksTitle.textContent = "Links";
	modal.appendChild(linksTitle);

	const imdbRow = document.createElement("div");
	imdbRow.className = "media-tracker__link-row";
	const imdbInput = document.createElement("input");
	imdbInput.type = "text";
	imdbInput.placeholder = "IMDB ID or URL";
	imdbRow.appendChild(imdbInput);
	const imdbHint = document.createElement("div");
	imdbHint.className = "media-tracker__link-hint";
	imdbHint.textContent = "IMDB";
	imdbRow.appendChild(imdbHint);
	modal.appendChild(imdbRow);

	const linksList = document.createElement("div");
	linksList.className = "media-tracker__links-list";
	modal.appendChild(linksList);

	const addLink = document.createElement("button");
	addLink.className = "media-tracker__button media-tracker__link-add";
	addLink.textContent = "Add link";
	modal.appendChild(addLink);

	const actions = document.createElement("div");
	actions.className = "media-tracker__modal-actions";
	actions.appendChild(createButton("Create note"));
	modal.appendChild(actions);
	const modalRoot = document.createElement("div");
	modalRoot.className = "modal";
	const modalContent = document.createElement("div");
	modalContent.className = "modal-content";
	modalContent.appendChild(modal);
	modalRoot.appendChild(modalContent);
	newNoteContainer.appendChild(modalRoot);
}

const editContainer = document.getElementById("preview-card-edit");
if (editContainer) {
	editContainer.textContent = "";
	const [first, second] = items;
	if (first) {
		editContainer.appendChild(renderCard(first, handlers));
	}
	if (second) {
		const editCard = renderCard(second, handlers);
		const progressLabel = editCard.querySelector(".media-tracker__progress-label");
		if (progressLabel && progressLabel.parentElement) {
			const input = document.createElement("input");
			input.type = "text";
			input.className = "media-tracker__progress-input";
			input.value = progressLabel.textContent ?? "";
			progressLabel.replaceWith(input);
		}
		editContainer.appendChild(editCard);
	}
}

const componentsContainer = document.getElementById("preview-components");
if (componentsContainer && mode === "components") {
	const componentsSection = componentsContainer.closest("section");
	componentsSection?.removeAttribute("hidden");
	componentsContainer.textContent = "";
	const wrapper = document.createElement("div");
	wrapper.className = "preview-components";

	const componentsBlock = renderComponentSection("Components", () => {
		const container = document.createElement("div");
		container.className = "preview-components__column";

		const searchRow = document.createElement("div");
		searchRow.className = "preview-components__row";
		const searchWrap = document.createElement("div");
		searchWrap.className = "media-tracker__search-wrap";
		const input = document.createElement("input");
		input.className = "media-tracker__search";
		input.type = "search";
		input.placeholder = "Search title, alias, author, or ID";
		searchWrap.appendChild(input);
		const clear = document.createElement("button");
		clear.className = "media-tracker__search-clear is-visible";
		searchWrap.appendChild(clear);
		searchRow.appendChild(searchWrap);
		searchRow.appendChild(createSelect(["All types", MEDIA_TYPE_LABELS.series, MEDIA_TYPE_LABELS.novel, MEDIA_TYPE_LABELS.manga, MEDIA_TYPE_LABELS.movie]));
		searchRow.appendChild(createSelect(["All statuses", "Active", "Completed", "On hold"]));
		searchRow.appendChild(createSelect(["Cards", "Details"]));
		container.appendChild(createLabeledBlock("Search + filters", searchRow));

		const buttonRow = document.createElement("div");
		buttonRow.className = "preview-components__row";
		buttonRow.appendChild(createButton("New entry"));
		buttonRow.appendChild(createButton("Note"));
		buttonRow.appendChild(createRefreshButton());
		buttonRow.appendChild(createCleanupButton());
		container.appendChild(createLabeledBlock("Buttons", buttonRow));

		const progressColumn = document.createElement("div");
		progressColumn.className = "preview-components__column";

		const normal = document.createElement("div");
		normal.className = "preview-components__surface";
		if (items[0]) {
			const progress = extractProgressElement(items[0]);
			if (progress) {
				normal.appendChild(progress);
			}
		}
		progressColumn.appendChild(normal);

		const editing = document.createElement("div");
		editing.className = "preview-components__surface";
		if (items[1]) {
			const progress = extractProgressElement(items[1]);
			if (progress) {
				const label = progress.querySelector(".media-tracker__progress-label");
				const editInput = document.createElement("input");
				editInput.type = "text";
				editInput.className = "media-tracker__progress-input";
				editInput.value = label?.textContent ?? "";
				label?.replaceWith(editInput);
				editing.appendChild(progress);
			}
		}
		progressColumn.appendChild(editing);
		container.appendChild(createLabeledBlock("Progress control", progressColumn));

		const badgeRow = document.createElement("div");
		badgeRow.className = "preview-components__row";
		const badge = document.createElement("span");
		badge.className = "media-tracker__badge";
		badge.textContent = "Latest S2E4";
		badgeRow.appendChild(badge);
		const newBadge = document.createElement("span");
		newBadge.className = "media-tracker__badge media-tracker__badge--new";
		newBadge.textContent = "New S2E6";
		badgeRow.appendChild(newBadge);
		const badgeGroup = document.createElement("span");
		badgeGroup.className = "media-tracker__badge-group";
		const latestBadge = document.createElement("span");
		latestBadge.className = "media-tracker__badge";
		latestBadge.textContent = "Latest S1E9";
		const announcedBadge = document.createElement("span");
		announcedBadge.className = "media-tracker__badge";
		announcedBadge.textContent = "S2 Ann.";
		badgeGroup.appendChild(latestBadge);
		badgeGroup.appendChild(announcedBadge);
		badgeRow.appendChild(badgeGroup);
		container.appendChild(createLabeledBlock("Badges", badgeRow));

		const statusRow = document.createElement("div");
		statusRow.className = "preview-components__row";
		if (items[0]) {
			const active = extractStatusElement({...items[0], status: "active"});
			if (active) {
				statusRow.appendChild(active);
			}
			const completed = extractStatusElement({...items[0], status: "completed"});
			if (completed) {
				statusRow.appendChild(completed);
			}
		}
		container.appendChild(createLabeledBlock("Status select", statusRow));

		const tableColumn = document.createElement("div");
		tableColumn.className = "preview-components__column";
		tableColumn.appendChild(renderTableHeader(sortKey, sortDirection));
		if (items[0]) {
			tableColumn.appendChild(renderTableRow(items[0], handlers));
		}
		container.appendChild(createLabeledBlock("Table row", tableColumn));

		const cardRow = document.createElement("div");
		cardRow.className = "preview-components__row";
		if (items[0]) {
			cardRow.appendChild(renderCard(items[0], handlers));
		}
		container.appendChild(createLabeledBlock("Card sample", cardRow));

		return container;
	});

	wrapper.appendChild(componentsBlock);

	componentsContainer.appendChild(wrapper);
} else if (componentsContainer) {
	componentsContainer.closest("section")?.remove();
}

function renderComponentSection(title: string, build: () => HTMLElement): HTMLElement {
	const section = document.createElement("div");
	section.className = "preview-components__section";
	const heading = document.createElement("div");
	heading.className = "preview-components__title";
	heading.textContent = title;
	section.appendChild(heading);
	section.appendChild(build());
	return section;
}

function createSelect(options: string[]): HTMLSelectElement {
	const select = document.createElement("select");
	for (const option of options) {
		const optionEl = document.createElement("option");
		optionEl.textContent = option;
		select.appendChild(optionEl);
	}
	return select;
}

function createLabeledBlock(label: string, content: HTMLElement): HTMLElement {
	const block = document.createElement("div");
	block.className = "preview-components__column";
	const heading = document.createElement("div");
	heading.className = "preview-components__label";
	heading.textContent = label;
	block.appendChild(heading);
	block.appendChild(content);
	return block;
}

function createRefreshButton(): HTMLButtonElement {
	const button = document.createElement("button");
	button.className = "media-tracker__button media-tracker__icon-button media-tracker__refresh-button";
	button.setAttribute("aria-label", "Refresh series updates");
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("media-tracker__refresh-icon");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute(
		"d",
		"M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 .34-.03.67-.08 1h2.02c.04-.33.06-.66.06-1 0-4.42-3.58-8-8-8zm-6 6c0-.34.03-.67.08-1H4.06c-.04.33-.06.66-.06 1 0 4.42 3.58 8 8 8v3l4-4-4-4v3c-3.31 0-6-2.69-6-6z",
	);
	path.setAttribute("fill", "currentColor");
	svg.appendChild(path);
	button.appendChild(svg);
	const label = document.createElement("span");
	label.className = "media-tracker__refresh-label";
	button.appendChild(label);
	return button;
}

function createCleanupButton(): HTMLButtonElement {
	const button = document.createElement("button");
	button.className = "media-tracker__button media-tracker__icon-button media-tracker__cleanup-button";
	button.setAttribute("aria-label", "Cleanup media frontmatter");
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.classList.add("media-tracker__cleanup-icon");
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute(
		"d",
		"m19.36 2.72l1.42 1.42l-5.72 5.71c1.07 1.54 1.22 3.39.32 4.59L9.06 8.12c1.2-.9 3.05-.75 4.59.32zM5.93 17.57c-2.01-2.01-3.24-4.41-3.58-6.65l4.88-2.09l7.44 7.44l-2.09 4.88c-2.24-.34-4.64-1.57-6.65-3.58",
	);
	path.setAttribute("fill", "currentColor");
	svg.appendChild(path);
	button.appendChild(svg);
	return button;
}

function extractProgressElement(item: MediaItemLike): HTMLElement | null {
	const card = renderCard(item, handlers);
	const progress = card.querySelector(".media-tracker__progress");
	if (!progress) {
		return null;
	}
	return progress.cloneNode(true) as HTMLElement;
}

function extractStatusElement(item: MediaItemLike): HTMLElement | null {
	const card = renderCard(item, handlers);
	const status = card.querySelector(".media-tracker__status");
	if (!status) {
		return null;
	}
	return status.cloneNode(true) as HTMLElement;
}

function createSettingText(label: string, placeholder: string, description?: string): HTMLElement {
	const wrapper = document.createElement("div");
	wrapper.className = "setting-item";

	const info = document.createElement("div");
	info.className = "setting-item-info";
	const nameEl = document.createElement("div");
	nameEl.className = "setting-item-name";
	nameEl.textContent = label;
	info.appendChild(nameEl);
	if (description) {
		const descEl = document.createElement("div");
		descEl.className = "setting-item-description";
		descEl.textContent = description;
		info.appendChild(descEl);
	}

	const control = document.createElement("div");
	control.className = "setting-item-control";
	const input = document.createElement("input");
	input.type = "text";
	input.placeholder = placeholder;
	control.appendChild(input);

	wrapper.appendChild(info);
	wrapper.appendChild(control);
	return wrapper;
}

function createSettingSelect(label: string, options: string[], selected: string): HTMLElement {
	const wrapper = document.createElement("div");
	wrapper.className = "setting-item";

	const info = document.createElement("div");
	info.className = "setting-item-info";
	const nameEl = document.createElement("div");
	nameEl.className = "setting-item-name";
	nameEl.textContent = label;
	info.appendChild(nameEl);

	const control = document.createElement("div");
	control.className = "setting-item-control";
	const select = document.createElement("select");
	for (const option of options) {
		const optionEl = document.createElement("option");
		optionEl.textContent = option;
		if (option === selected) {
			optionEl.selected = true;
		}
		select.appendChild(optionEl);
	}
	control.appendChild(select);

	wrapper.appendChild(info);
	wrapper.appendChild(control);
	return wrapper;
}

function createButton(text: string): HTMLButtonElement {
	const button = document.createElement("button");
	button.className = "media-tracker__button";
	button.textContent = text;
	return button;
}
