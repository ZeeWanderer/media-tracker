let requestUrlHandler = async () => {
	throw new Error("Unexpected requestUrl call in test.");
};

export function setRequestUrlHandler(handler) {
	requestUrlHandler = handler;
}

export async function requestUrl(options) {
	return requestUrlHandler(options);
}

export class TAbstractFile {
	constructor(path) {
		this.path = path;
		this.name = path.split("/").at(-1) ?? "";
		this.parent = null;
	}
}

export class TFile extends TAbstractFile {
	constructor(path) {
		super(path);
		const dotIndex = this.name.lastIndexOf(".");
		this.extension = dotIndex >= 0 ? this.name.slice(dotIndex + 1) : "";
		this.basename = dotIndex >= 0 ? this.name.slice(0, dotIndex) : this.name;
	}
}

export class TFolder extends TAbstractFile {
	constructor(path) {
		super(path);
		this.children = [];
	}
}

export class App {}
export class DataAdapter {}
export class Notice {
	constructor(message) {
		this.message = message;
	}
}
