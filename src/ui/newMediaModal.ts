import {Modal, Setting} from "obsidian";
import MediaTrackerPlugin from "../main";
import {MediaStatus, MediaType, NewMediaDraft} from "../types";
import {MEDIA_STATUS_LABELS, MEDIA_TYPE_LABELS} from "../utils/media";
import {createMediaNote} from "../utils/notes";
import {NEW_MEDIA_BASE_FIELDS, NEW_MEDIA_TYPE_FIELDS, type NewMediaFieldConfig} from "./newMediaForm";

export class NewMediaModal extends Modal {
	plugin: MediaTrackerPlugin;
	private draft: NewMediaDraft = {
		title: "",
		type: "novel",
		status: "planned",
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
				const types: MediaType[] = ["novel", "series", "movie"];
				for (const type of types) {
					dropdown.addOption(type, MEDIA_TYPE_LABELS[type]);
				}
				dropdown.setValue(this.draft.type);
				dropdown.onChange((value) => {
					this.draft.type = value as MediaType;
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

		const sectionLabels: Record<MediaType, string> = {
			novel: "Novel details",
			series: "Series details",
			movie: "Movie details",
		};
		contentEl.createEl("h3", {text: sectionLabels[this.draft.type]});
		this.renderFields(contentEl, NEW_MEDIA_TYPE_FIELDS[this.draft.type]);

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

	private updateDraftField(key: keyof NewMediaDraft, value: string) {
		this.draft = {
			...this.draft,
			[key]: value,
		};
	}
}
