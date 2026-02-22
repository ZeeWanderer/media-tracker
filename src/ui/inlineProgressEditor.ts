type InlineProgressEditorOptions = {
	target: HTMLElement;
	value: string;
	onCommit: (nextValue: string, input: HTMLInputElement) => void;
};

export function openInlineProgressEditor(options: InlineProgressEditorOptions) {
	const {target, value, onCommit} = options;
	const input = document.createElement("input");
	input.type = "text";
	input.classList.add("media-tracker__progress-input");
	input.value = value;
	input.size = Math.max(4, input.value.length);

	const originalValue = value;
	let finished = false;
	const restoreOriginalDisplay = () => {
		target.textContent = originalValue || " ";
		if (input.isConnected) {
			input.replaceWith(target);
		}
	};

	const finish = (save: boolean) => {
		if (finished) {
			return;
		}
		finished = true;
		if (!save) {
			restoreOriginalDisplay();
			return;
		}
		const nextValue = input.value;
		if (nextValue.trim() === originalValue.trim()) {
			restoreOriginalDisplay();
			return;
		}
		onCommit(nextValue, input);
	};

	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			finish(true);
		}
		if (event.key === "Escape") {
			event.preventDefault();
			finish(false);
		}
	});
	input.addEventListener("blur", () => {
		finish(true);
	});

	target.replaceWith(input);
	input.focus();
	input.select();
}
