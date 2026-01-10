import {Modal, Setting} from "obsidian";

interface LinkModalOptions {
	title: string;
	url?: string;
	onSubmit: (url: string) => void;
}

export class LinkModal extends Modal {
	private options: LinkModalOptions;
	private urlValue: string;

	constructor(app: import("obsidian").App, options: LinkModalOptions) {
		super(app);
		this.options = options;
		this.urlValue = options.url ?? "";
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl("h2", {text: this.options.title});

		new Setting(contentEl)
			.setName("URL")
			.addText((text) => text
				.setPlaceholder("https://example.com or tt1234567")
				.setValue(this.urlValue)
				.onChange((value) => this.urlValue = value));

		const actions = contentEl.createDiv({cls: "media-tracker__modal-actions"});
		const saveButton = actions.createEl("button", {text: "Save", cls: "media-tracker__button"});
		saveButton.addEventListener("click", () => {
			this.options.onSubmit(this.urlValue);
			this.close();
		});
	}
}
