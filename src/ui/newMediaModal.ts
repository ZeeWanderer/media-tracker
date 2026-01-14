import {Modal, Setting} from "obsidian";
import MediaTrackerPlugin from "../main";
import {MediaStatus, MediaType, NewMediaDraft, NewMediaFieldConfig} from "../types";
import {MEDIA_STATUS_LABELS} from "../utils/media";
import {ANILIST_TYPES, IMDB_TYPES, MEDIA_TYPE_LABELS, MEDIA_TYPES} from "../utils/mediaConfig";
import {createMediaNote} from "../utils/notes";
import {NEW_MEDIA_BASE_FIELDS, NEW_MEDIA_TYPE_FIELDS} from "./newMediaForm";
import {extractImdbId} from "../utils/links";

export class NewMediaModal extends Modal {
	plugin: MediaTrackerPlugin;
	private draft: NewMediaDraft = {
		title: "",
		type: "novel",
		status: "planned",
		links: [],
	};

	constructor(plugin: MediaTrackerPlugin) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen() {
		this.render();
	}

	private render() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.addClass("media-tracker__modal");
		contentEl.createEl("h2", {text: "Create media note"});
		this.renderFields(contentEl, NEW_MEDIA_BASE_FIELDS);

		new Setting(contentEl)
			.setName("Type")
			.addDropdown((dropdown) => {
				for (const type of MEDIA_TYPES) {
					dropdown.addOption(type, MEDIA_TYPE_LABELS[type]);
				}
				dropdown.setValue(this.draft.type);
				dropdown.onChange((value) => {
					const nextType = value as MediaType;
					this.draft = {
						...this.draft,
						type: nextType,
						imdbId: nextType === "series" || nextType === "anime" || nextType === "movie"
							? this.draft.imdbId
							: undefined,
						anilistId: nextType === "anime" || nextType === "manga"
							? this.draft.anilistId
							: undefined,
					};
					this.render();
				});
			});

		new Setting(contentEl)
			.setName("Status")
			.addDropdown((dropdown) => {
				const statuses: MediaStatus[] = ["planned", "active", "completed", "on-hold", "dropped"];
				for (const status of statuses) {
					dropdown.addOption(status, MEDIA_STATUS_LABELS[status]);
				}
				dropdown.setValue(this.draft.status);
				dropdown.onChange((value) => this.draft.status = value as MediaStatus);
			});

		contentEl.createEl("h3", {text: `${MEDIA_TYPE_LABELS[this.draft.type]} details`});
		this.renderFields(contentEl, NEW_MEDIA_TYPE_FIELDS[this.draft.type]);

		this.renderLinks(contentEl);

		const actions = contentEl.createDiv({cls: "media-tracker__modal-actions"});
		const createButton = actions.createEl("button", {text: "Create note", cls: "media-tracker__button"});
		createButton.addEventListener("click", async () => {
			await createMediaNote(this.app, this.plugin.settings, this.draft);
			this.close();
		});
	}

	private renderFields(container: HTMLElement, fields: NewMediaFieldConfig[]) {
		for (const field of fields) {
			const setting = new Setting(container).setName(field.label);
			if (field.description) {
				setting.setDesc(field.description);
			}
			setting.addText((text) => {
				if (field.placeholder) {
					text.setPlaceholder(field.placeholder);
				}
				if (field.inputType) {
					text.inputEl.type = field.inputType;
				}
				text.setValue((this.draft[field.key] ?? "") as string);
				text.onChange((value) => this.updateDraftField(field.key, value));
			});
		}
	}

	private renderLinks(container: HTMLElement) {
		const section = container.createDiv({cls: "media-tracker__links-section"});
		section.createEl("h3", {text: "Links"});

		if (this.shouldShowAnilistField()) {
			const anilistRow = section.createDiv({cls: "media-tracker__link-row"});
			const anilistInput = anilistRow.createEl("input");
			anilistInput.type = "text";
			anilistInput.placeholder = "AniList ID or URL";
			anilistInput.value = this.draft.anilistId ?? "";
			anilistInput.addEventListener("input", () => {
				this.updateAnilistId(anilistInput.value);
			});
			const anilistHint = anilistRow.createDiv({cls: "media-tracker__link-hint", text: "AniList"});
			anilistHint.setAttribute("aria-hidden", "true");
		}

		if (this.shouldShowImdbField()) {
			const imdbRow = section.createDiv({cls: "media-tracker__link-row"});
			const imdbInput = imdbRow.createEl("input");
			imdbInput.type = "text";
			imdbInput.placeholder = "IMDB ID or URL";
			imdbInput.value = this.draft.imdbId ?? "";
			imdbInput.addEventListener("input", () => {
				this.updateImdbId(imdbInput.value);
			});
			const imdbHint = imdbRow.createDiv({cls: "media-tracker__link-hint", text: "IMDB"});
			imdbHint.setAttribute("aria-hidden", "true");
		}

		const list = section.createDiv({cls: "media-tracker__links-list"});
		const links = [...(this.draft.links ?? [])];

		links.forEach((value, index) => {
			const row = list.createDiv({cls: "media-tracker__link-row"});
			const input = row.createEl("input");
			input.type = "text";
			input.placeholder = "https://example.com";
			input.value = value;
			input.addEventListener("input", () => {
				this.updateLink(index, input.value);
			});

			const remove = row.createEl("button", {cls: "media-tracker__link-remove", text: "Remove"});
			remove.type = "button";
			remove.setAttr("aria-label", "Remove link");
			remove.addEventListener("click", () => {
				this.removeLink(index);
			});
		});

		const addButton = section.createEl("button", {cls: "media-tracker__button media-tracker__link-add", text: "Add link"});
		addButton.addEventListener("click", () => {
			this.addLink();
		});
	}

	private shouldShowImdbField(): boolean {
		return IMDB_TYPES.has(this.draft.type) && this.draft.type !== "anime";
	}

	private shouldShowAnilistField(): boolean {
		return ANILIST_TYPES.has(this.draft.type);
	}

	private updateImdbId(value: string) {
		const trimmed = value.trim();
		const imdbId = trimmed.length ? (extractImdbId(trimmed) ?? trimmed) : "";
		this.draft = {
			...this.draft,
			imdbId: imdbId || undefined,
		};
	}

	private updateAnilistId(value: string) {
		const trimmed = value.trim();
		this.draft = {
			...this.draft,
			anilistId: trimmed.length ? trimmed : undefined,
		};
	}

	private updateLink(index: number, value: string) {
		const links = [...(this.draft.links ?? [])];
		links[index] = value;
		this.draft = {
			...this.draft,
			links,
		};
	}

	private addLink() {
		const links = [...(this.draft.links ?? [])];
		links.push("");
		this.draft = {
			...this.draft,
			links,
		};
		this.render();
	}

	private removeLink(index: number) {
		const links = [...(this.draft.links ?? [])];
		links.splice(index, 1);
		this.draft = {
			...this.draft,
			links,
		};
		this.render();
	}

	private updateDraftField(key: keyof NewMediaDraft, value: string) {
		this.draft = {
			...this.draft,
			[key]: value,
		};
	}
}
