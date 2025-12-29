import {Modal, Setting} from "obsidian";
import MediaTrackerPlugin from "../main";
import {MediaStatus, MediaType, NewMediaDraft} from "../types";
import {MEDIA_STATUS_LABELS, MEDIA_TYPE_LABELS} from "../utils/media";
import {createMediaNote} from "../utils/notes";

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

		new Setting(contentEl)
			.setName("Title")
			.addText((text) => text
				.setPlaceholder("Title")
				.setValue(this.draft.title)
				.onChange((value) => this.draft.title = value));

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

		if (this.draft.type === "novel") {
			this.renderNovelFields(contentEl);
		}
		if (this.draft.type === "series") {
			this.renderSeriesFields(contentEl);
		}
		if (this.draft.type === "movie") {
			this.renderMovieFields(contentEl);
		}

		const actions = contentEl.createDiv({cls: "media-tracker__modal-actions"});
		const createButton = actions.createEl("button", {text: "Create note", cls: "media-tracker__button"});
		createButton.addEventListener("click", async () => {
			await createMediaNote(this.app, this.plugin.settings, this.draft);
			this.close();
		});
	}

	private renderNovelFields(container: HTMLElement) {
		container.createEl("h3", {text: "Novel details"});
		new Setting(container)
			.setName("Author")
			.addText((text) => text
				.setValue(this.draft.author ?? "")
				.onChange((value) => this.draft.author = value));

		new Setting(container)
			.setName("Progress")
			.setDesc("Chapter, volume, or other progress note.")
			.addText((text) => text
				.setValue(this.draft.progress ?? "")
				.onChange((value) => this.draft.progress = value));

		new Setting(container)
			.setName("Patreon URL")
			.addText((text) => text
				.setPlaceholder("https://www.patreon.com/creator")
				.setValue(this.draft.patreon ?? "")
				.onChange((value) => this.draft.patreon = value));

		new Setting(container)
			.setName("Kemono URL")
			.addText((text) => text
				.setPlaceholder("https://kemono.su/creator")
				.setValue(this.draft.kemono ?? "")
				.onChange((value) => this.draft.kemono = value));

		new Setting(container)
			.setName("RoyalRoad URL")
			.addText((text) => text
				.setPlaceholder("https://www.royalroad.com/fiction/12345")
				.setValue(this.draft.royalroad ?? "")
				.onChange((value) => this.draft.royalroad = value));
	}

	private renderSeriesFields(container: HTMLElement) {
		container.createEl("h3", {text: "Series details"});
		new Setting(container)
			.setName("Season")
			.addText((text) => text
				.setPlaceholder("2")
				.setValue(this.draft.season ?? "")
				.onChange((value) => this.draft.season = value));

		new Setting(container)
			.setName("Episode")
			.addText((text) => text
				.setPlaceholder("5")
				.setValue(this.draft.episode ?? "")
				.onChange((value) => this.draft.episode = value));

		new Setting(container)
			.setName("IMDB ID or URL")
			.addText((text) => text
				.setPlaceholder("tt1234567")
				.setValue(this.draft.imdb ?? "")
				.onChange((value) => this.draft.imdb = value));
	}

	private renderMovieFields(container: HTMLElement) {
		container.createEl("h3", {text: "Movie details"});
		new Setting(container)
			.setName("Year")
			.addText((text) => text
				.setPlaceholder("2024")
				.setValue(this.draft.year ?? "")
				.onChange((value) => this.draft.year = value));

		new Setting(container)
			.setName("IMDB ID or URL")
			.addText((text) => text
				.setPlaceholder("tt1234567")
				.setValue(this.draft.imdb ?? "")
				.onChange((value) => this.draft.imdb = value));
	}
}
