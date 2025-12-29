import {ItemView, WorkspaceLeaf, createDiv, openExternal} from "obsidian";
import MediaTrackerPlugin from "../main";
import {MediaItem, MediaStatus, MediaType} from "../types";
import {MEDIA_STATUS_LABELS, MEDIA_TYPE_LABELS, getMediaItems} from "../utils/media";
import {NewMediaModal} from "./newMediaModal";

export const MEDIA_TRACKER_VIEW = "media-tracker-view";

const TYPE_FILTERS: Array<MediaType | "all"> = ["all", "novel", "series", "movie"];
const STATUS_FILTERS: Array<MediaStatus | "all"> = ["all", "planned", "active", "completed", "on-hold", "dropped"];

export class MediaTrackerView extends ItemView {
	plugin: MediaTrackerPlugin;
	private typeFilter: MediaType | "all" = "all";
	private statusFilter: MediaStatus | "all" = "all";

	constructor(leaf: WorkspaceLeaf, plugin: MediaTrackerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return MEDIA_TRACKER_VIEW;
	}

	getDisplayText(): string {
		return "Media tracker";
	}

	getIcon(): string {
		return "film";
	}

	async onOpen() {
		this.render();
	}

	render() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass("media-tracker");

		const header = contentEl.createDiv({cls: "media-tracker__header"});
		header.createEl("h2", {text: "Media tracker"});

		const actions = header.createDiv({cls: "media-tracker__actions"});
		const addButton = actions.createEl("button", {cls: "media-tracker__button", text: "New entry"});
		addButton.addEventListener("click", () => new NewMediaModal(this.plugin).open());

		this.renderFilters(contentEl);

		const items = getMediaItems(this.app, this.plugin.settings);
		const filtered = items.filter((item) => this.matchesFilters(item));

		if (filtered.length === 0) {
			const empty = contentEl.createDiv({cls: "media-tracker__empty"});
			empty.setText("No media entries yet. Create one to get started.");
			return;
		}

		const list = contentEl.createDiv({cls: "media-tracker__list"});
		for (const item of filtered) {
			list.appendChild(this.renderCard(item));
		}
	}

	private renderFilters(container: HTMLElement) {
		const filters = container.createDiv({cls: "media-tracker__filters"});

		const typeSelect = filters.createEl("select");
		for (const option of TYPE_FILTERS) {
			typeSelect.createEl("option", {
				value: option,
				text: option === "all" ? "All types" : MEDIA_TYPE_LABELS[option],
			});
		}
		typeSelect.value = this.typeFilter;
		typeSelect.addEventListener("change", () => {
			this.typeFilter = typeSelect.value as MediaType | "all";
			this.render();
		});

		const statusSelect = filters.createEl("select");
		for (const option of STATUS_FILTERS) {
			statusSelect.createEl("option", {
				value: option,
				text: option === "all" ? "All statuses" : MEDIA_STATUS_LABELS[option],
			});
		}
		statusSelect.value = this.statusFilter;
		statusSelect.addEventListener("change", () => {
			this.statusFilter = statusSelect.value as MediaStatus | "all";
			this.render();
		});
	}

	private matchesFilters(item: MediaItem): boolean {
		if (this.typeFilter !== "all" && item.type !== this.typeFilter) {
			return false;
		}
		if (this.statusFilter !== "all" && item.status !== this.statusFilter) {
			return false;
		}
		return true;
	}

	private renderCard(item: MediaItem): HTMLElement {
		const card = createDiv({cls: "media-tracker__card"});
		const titleRow = card.createDiv({cls: "media-tracker__card-title"});
		titleRow.createEl("span", {text: item.title});
		titleRow.createEl("span", {text: MEDIA_TYPE_LABELS[item.type], cls: "media-tracker__pill"});

		const meta = card.createDiv({cls: "media-tracker__meta"});
		meta.createDiv({text: MEDIA_STATUS_LABELS[item.status], cls: "media-tracker__meta-item"});
		if (item.author) {
			meta.createDiv({text: item.author, cls: "media-tracker__meta-item"});
		}
		if (item.progress) {
			meta.createDiv({text: item.progress, cls: "media-tracker__meta-item"});
		}

		const actions = card.createDiv({cls: "media-tracker__links"});
		const openNoteButton = actions.createEl("button", {text: "Open note", cls: "media-tracker__button"});
		openNoteButton.addEventListener("click", async () => {
			await this.app.workspace.getLeaf("tab").openFile(item.file);
		});

		if (item.type === "novel") {
			this.renderLinkButton(actions, "Patreon", item.links.patreon);
			this.renderLinkButton(actions, "Kemono", item.links.kemono);
			this.renderLinkButton(actions, "RoyalRoad", item.links.royalroad);
		} else {
			this.renderLinkButton(actions, "IMDB", item.links.imdb);
		}

		const info = card.createDiv({cls: "media-tracker__path"});
		info.setText(item.file.path);

		return card;
	}

	private renderLinkButton(container: HTMLElement, label: string, url: string | null | undefined) {
		const button = container.createEl("button", {text: label, cls: "media-tracker__button"});
		if (!url) {
			button.addClass("is-disabled");
			button.setAttr("disabled", "true");
			button.setAttr("aria-disabled", "true");
			button.setAttr("title", `${label} link not set.`);
			return;
		}
		button.addEventListener("click", () => openExternal(url));
	}
}
