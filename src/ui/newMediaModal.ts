import {App, Modal, Notice, Setting} from "obsidian";
import {
	MEDIA_STATUS_LABELS,
	MEDIA_TYPE_FIELDS,
	MEDIA_TYPE_LABELS,
	NEW_MEDIA_BASE_FIELDS,
	type NewMediaFieldConfig,
} from "./mediaUiConfig";
import {ANILIST_TYPES, IMDB_TYPES, MEDIA_STATUSES, MEDIA_TYPES} from "../domain/media/config";
import {createMediaNoteFromDraft, updateMediaDraftType} from "../flows/media";
import {extractImdbId} from "../domain/media/links";
import {runLoggedTask, type TaskLogContext} from "./taskRunner";
import type {MediaTrackerSettings} from "../core/pluginSettingsModel";
import type {PluginLogger} from "../infra/logging/pluginLogger";
import type {MediaStatus, MediaType} from "../domain/media/config";
import type {NewMediaDraft} from "../domain/media/models";

type NewMediaModalPluginDeps = {
	app: App;
	settings: MediaTrackerSettings;
	logger: PluginLogger;
};

export class NewMediaModal extends Modal {
	plugin: NewMediaModalPluginDeps;
	private createInProgress = false;
	private draft: NewMediaDraft = {
		title: "",
		type: "novel",
		status: "active",
		links: [],
	};

	constructor(plugin: NewMediaModalPluginDeps) {
		super(plugin.app);
		this.plugin = plugin;
	}

	onOpen() {
		this.render();
	}

	private getDraftLogMeta(draft: NewMediaDraft): Record<string, unknown> {
		return {
			title: draft.title.trim(),
			type: draft.type,
			status: draft.status,
			links: (draft.links ?? []).map((value) => value.trim()).filter((value) => value.length > 0).length,
			hasAuthor: Boolean(draft.author?.trim()),
			hasProgress: Boolean(draft.progress?.trim()),
			hasImdbId: Boolean(draft.imdbId?.trim()),
			hasAnilistId: Boolean(draft.anilistId?.trim()),
		};
	}

	private runTask(task: () => Promise<void>, errorMessage: string, logContext?: TaskLogContext): Promise<boolean> {
		return runLoggedTask(task, errorMessage, {
			logger: this.plugin.logger,
			defaultScope: "ui.new_media",
		}, logContext);
	}

	private async handleCreateNote(createButton: HTMLButtonElement) {
		if (this.createInProgress) {
			return;
		}
		this.createInProgress = true;
		createButton.disabled = true;
		createButton.classList.add("is-disabled");
		const draftMeta = this.getDraftLogMeta(this.draft);
		try {
			await this.runTask(async () => {
				const result = await createMediaNoteFromDraft(this.app, this.plugin.settings, this.draft);
				if (result.status === "created") {
					if (result.disambiguated) {
						new Notice(`Created as "${result.workFolder}/${result.fileName}" because this title/type already existed.`);
					}
					const leaf = this.app.workspace.getLeaf("tab");
					await leaf.openFile(result.file);
					this.plugin.logger.info("ui.new_media", "create_note_result", "Created media note.", {
						...draftMeta,
						filePath: result.file.path,
						disambiguated: result.disambiguated,
					});
					this.close();
					return;
				}
				if (result.reason === "id_conflict") {
					const idLabel = result.conflict.kind === "imdb" ? "IMDb ID" : "AniList ID";
					new Notice(`${idLabel} ${result.conflict.value} already exists in "${result.conflict.item.title}" (${result.conflict.item.file.path}).`);
					this.plugin.logger.warn("ui.new_media", "create_note_result", "Create media note rejected due to ID conflict.", {
						...draftMeta,
						reason: result.reason,
						conflictKind: result.conflict.kind,
						conflictValue: result.conflict.value,
						conflictPath: result.conflict.item.file.path,
					});
					return;
				}
				new Notice("Please enter a title.");
				this.plugin.logger.warn("ui.new_media", "create_note_result", "Create media note rejected due to missing title.", {
					...draftMeta,
					reason: result.reason,
				});
			}, "Failed to create media note.", {
				event: "create_note",
				logStart: true,
				logSuccess: false,
				startMessage: "Creating media note from modal draft.",
				meta: draftMeta,
			});
		} finally {
			this.createInProgress = false;
			if (createButton.isConnected) {
				createButton.disabled = false;
				createButton.classList.remove("is-disabled");
			}
		}
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
					this.draft = updateMediaDraftType(this.draft, nextType);
					this.render();
				});
			});

		new Setting(contentEl)
			.setName("Status")
			.addDropdown((dropdown) => {
				const statuses: MediaStatus[] = [...MEDIA_STATUSES];
				for (const status of statuses) {
					dropdown.addOption(status, MEDIA_STATUS_LABELS[status]);
				}
				dropdown.setValue(this.draft.status);
				dropdown.onChange((value) => this.draft.status = value as MediaStatus);
			});

		contentEl.createEl("h3", {text: `${MEDIA_TYPE_LABELS[this.draft.type]} details`});
		this.renderFields(contentEl, MEDIA_TYPE_FIELDS[this.draft.type]);

		this.renderLinks(contentEl);

		const actions = contentEl.createDiv({cls: "media-tracker__modal-actions"});
		const createButton = actions.createEl("button", {text: "Create note", cls: "media-tracker__button"});
		createButton.addEventListener("click", () => {
			void this.handleCreateNote(createButton);
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
