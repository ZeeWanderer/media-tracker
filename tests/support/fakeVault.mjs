import {TFile, TFolder} from "obsidian";

function normalizePath(value) {
	return value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

export function createFakeVaultApp() {
	const filesByPath = new Map();
	const frontmatterByPath = new Map();
	const contentsByPath = new Map();
	const trashCalls = [];
	const root = new TFolder("");
	filesByPath.set("", root);

	function getParent(path) {
		const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		const parent = filesByPath.get(parentPath);
		if (!(parent instanceof TFolder)) {
			throw new Error(`Missing parent folder: ${parentPath}`);
		}
		return parent;
	}

	function attach(file) {
		const parent = getParent(file.path);
		file.parent = parent;
		parent.children.push(file);
		filesByPath.set(file.path, file);
		return file;
	}

	function detach(file) {
		if (file.parent) {
			file.parent.children = file.parent.children.filter((child) => child !== file);
		}
		filesByPath.delete(file.path);
		frontmatterByPath.delete(file.path);
		contentsByPath.delete(file.path);
	}

	const vault = {
		configDir: ".obsidian",
		getAbstractFileByPath(value) {
			return filesByPath.get(normalizePath(value)) ?? null;
		},
		async createFolder(value) {
			const path = normalizePath(value);
			if (filesByPath.has(path)) {
				throw new Error(`Path already exists: ${path}`);
			}
			return attach(new TFolder(path));
		},
		async create(value, contents) {
			const path = normalizePath(value);
			if (filesByPath.has(path)) {
				throw new Error(`Path already exists: ${path}`);
			}
			const file = attach(new TFile(path));
			frontmatterByPath.set(path, {});
			contentsByPath.set(path, contents);
			return file;
		},
	};

	const app = {
		vault,
		metadataCache: {
			getFileCache(file) {
				return {frontmatter: frontmatterByPath.get(file.path) ?? {}};
			},
		},
		fileManager: {
			async processFrontMatter(file, updater) {
				const frontmatter = frontmatterByPath.get(file.path);
				if (!frontmatter) {
					throw new Error(`Missing frontmatter for ${file.path}`);
				}
				updater(frontmatter);
			},
			async trashFile(file) {
				if (file instanceof TFolder && file.children.length) {
					throw new Error(`Cannot trash non-empty folder: ${file.path}`);
				}
				trashCalls.push(file.path);
				detach(file);
			},
		},
	};

	return {
		app,
		trashCalls,
		getFrontmatter(path) {
			return frontmatterByPath.get(normalizePath(path));
		},
		hasPath(path) {
			return filesByPath.has(normalizePath(path));
		},
	};
}
