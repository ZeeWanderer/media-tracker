import {Modal, Notice, Setting} from "obsidian";
import MediaTrackerPlugin from "../main";
import {MediaStatus, MediaType, NewMediaDraft, NewMediaFieldConfig} from "../types";
import {MEDIA_STATUS_LABELS} from "./mediaStatusLabels";
import {MEDIA_TYPE_LABELS} from "./mediaTypeConfig";
import {ANILIST_TYPES, IMDB_TYPES, MEDIA_STATUSES, MEDIA_TYPES} from "../domain/media/config";
import {createMediaNoteFromDraft, updateMediaDraftType} from "../flows/media";
import {NEW_MEDIA_BASE_FIELDS, NEW_MEDIA_TYPE_FIELDS} from "./newMediaForm";
import {extractImdbId} from "../domain/media/links";

type TaskLogContext = {
	scope?: string;
	event: string;
	startMessage?: string;
	successMessage?: string;
	meta?: Record<string, unknown>;
	logStart?: boolean;
	logSuccess?: boolean;
};

export class NewMediaModal extends Modal {
	plugin: MediaTrackerPlugin;
	private draft: NewMediaDraft = {
		title: "",
		type: "novel",
		status: "active",
		links: [],
	};

	constructor(plugin: MediaTrackerPlugin) {
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

	private runTask(task: () => Promise<void>, errorMessage: string, logContext?: TaskLogContext) {
		const scope = logContext?.scope ?? "ui.new_media";
		if (logContext?.logStart) {
			this.plugin.logger.info(
				scope,
				`${logContext.event}_started`,
				logContext.startMessage ?? "Started action.",
				logContext.meta,
			);
		}
		void task()
			.then(() => {
				if (!logContext || logContext.logSuccess === false) {
					return;
				}
				this.plugin.logger.info(
					scope,
					`${logContext.event}_succeeded`,
					logContext.successMessage ?? "Completed action.",
					logContext.meta,
				);
			})
			.catch((error) => {
				console.error(error);
				this.plugin.logger.error(scope, logContext ? `${logContext.event}_failed` : "task_failed", errorMessage, {
					...(logContext?.meta ?? {}),
					error: error instanceof Error ? error.message : String(error),
				});
				new Notice(errorMessage);
			});
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
		this.renderFields(contentEl, NEW_MEDIA_TYPE_FIELDS[this.draft.type]);

		this.renderLinks(contentEl);

		const actions = contentEl.createDiv({cls: "media-tracker__modal-actions"});
		const createButton = actions.createEl("button", {text: "Create note", cls: "media-tracker__button"});
		createButton.addEventListener("click", () => {
			const draftMeta = this.getDraftLogMeta(this.draft);
			this.runTask(async () => {
				const created = await createMediaNoteFromDraft(this.app, this.plugin.settings, this.draft);
				if (created) {
					this.plugin.logger.info("ui.new_media", "create_note_result", "Created media note.", draftMeta);
					this.close();
					return;
				}
				this.plugin.logger.warn("ui.new_media", "create_note_result", "Create media note was rejected by validation.", draftMeta);
			}, "Failed to create media note.", {
				event: "create_note",
				logStart: true,
				logSuccess: false,
				startMessage: "Creating media note from modal draft.",
				meta: draftMeta,
			});
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
