import {Modal, Setting} from "obsidian";

interface LinkModalOptions {
	title: string;
	label?: string;
	showLabel?: boolean;
	url?: string;
	onSubmit: (label: string, url: string) => void;
}

export class LinkModal extends Modal {
	private options: LinkModalOptions;
	private labelValue: string;
	private urlValue: string;

	constructor(app: import("obsidian").App, options: LinkModalOptions) {
		super(app);
		this.options = options;
		this.labelValue = options.label ?? "";
		this.urlValue = options.url ?? "";
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl("h2", {text: this.options.title});

		if (this.options.showLabel) {
			new Setting(contentEl)
				.setName("Label")
				.addText((text) => text
					.setPlaceholder("FictionPress")
					.setValue(this.labelValue)
					.onChange((value) => this.labelValue = value));
		}

		new Setting(contentEl)
			.setName("URL")
			.addText((text) => text
				.setPlaceholder("https://example.com")
				.setValue(this.urlValue)
				.onChange((value) => this.urlValue = value));

		const actions = contentEl.createDiv({cls: "media-tracker__modal-actions"});
		const saveButton = actions.createEl("button", {text: "Save", cls: "media-tracker__button"});
		saveButton.addEventListener("click", () => {
			this.options.onSubmit(this.labelValue, this.urlValue);
			this.close();
		});
	}
}
