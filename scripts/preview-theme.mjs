import {fileURLToPath} from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import {listPackage, extractFile} from "@electron/asar";

function uniqueLines(content) {
	return content.replace(/\r\n/g, "\n");
}

function extractThemeVariables(css) {
	const blocks = [];
	const regex = /([^{}]+)\{([^}]*)\}/g;
	let match;
	while ((match = regex.exec(css)) !== null) {
		const selector = match[1].trim();
		const body = match[2];
		if (!body.includes("--")) {
			continue;
		}
		if (!/(^:root\b|theme-dark|theme-light|body\b)/i.test(selector)) {
			continue;
		}
		const lines = body
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.startsWith("--"));
		if (!lines.length) {
			continue;
		}
		blocks.push(`${selector} {\n\t${lines.join("\n\t")}\n}`);
	}
	return blocks.join("\n\n");
}

async function readFileIfExists(filePath) {
	try {
		return await fs.readFile(filePath, "utf8");
	} catch (error) {
		return "";
	}
}

function extractAppCssFromAsar() {
	const flatpakResources = "/var/lib/flatpak/app/md.obsidian.Obsidian/current/active/files/resources";
	const asarCandidates = [
		path.join(flatpakResources, "obsidian.asar"),
		path.join(flatpakResources, "app.asar"),
	];
	for (const asarPath of asarCandidates) {
		try {
			const entries = listPackage(asarPath);
			const cssEntries = entries.filter((entry) => entry.endsWith(".css"));
			const preferred = cssEntries.find((entry) => /obsidian\.css$|app\.css$/i.test(entry));
			const ordered = preferred ? [preferred, ...cssEntries.filter((entry) => entry !== preferred)] : cssEntries;
			for (const entry of ordered) {
				const normalizedEntry = entry.replace(/^\//, "");
				const content = extractFile(asarPath, normalizedEntry).toString("utf8");
				if (content.includes("--background-primary") && content.includes("--text-normal")) {
					return {asarPath, entry, content};
				}
			}
			if (ordered.length) {
				const fallbackEntry = ordered[0].replace(/^\//, "");
				const content = extractFile(asarPath, fallbackEntry).toString("utf8");
				if (content) {
					return {asarPath, entry: ordered[0], content};
				}
			}
		} catch (error) {
			// Ignore missing asar paths.
		}
	}
	return null;
}

export async function generatePreviewTheme() {
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
	const defaultVault = path.resolve(root, "..", "MediaTracker");
	const vaultPath = process.env.MEDIA_TRACKER_VAULT ?? defaultVault;
	const explicitTheme = process.env.MEDIA_TRACKER_THEME_CSS;
	const outputPath = path.join(root, "preview", "theme.css");
	const appCssPath = path.join(root, "preview", "obsidian-app.css");

	let themeCss = "";
	let themeSource = "";
	const appCss = extractAppCssFromAsar();

	if (explicitTheme) {
		themeCss = await readFileIfExists(explicitTheme);
		themeSource = explicitTheme;
	} else {
		const appearancePath = path.join(vaultPath, ".obsidian", "appearance.json");
		let appearance = {};
		try {
			const raw = await fs.readFile(appearancePath, "utf8");
			appearance = JSON.parse(raw);
		} catch (error) {
			appearance = {};
		}
		const themeName = appearance.theme || appearance.baseTheme || "";
		if (themeName && themeName !== "obsidian") {
			const themePath = path.join(vaultPath, ".obsidian", "themes", themeName, "theme.css");
			themeCss = await readFileIfExists(themePath);
			themeSource = themePath;
		}

		const snippetsDir = path.join(vaultPath, ".obsidian", "snippets");
		const snippetList = Array.isArray(appearance.cssSnippets) ? appearance.cssSnippets : [];
		for (const snippet of snippetList) {
			const snippetPath = path.join(snippetsDir, `${snippet}.css`);
			const snippetCss = await readFileIfExists(snippetPath);
			if (snippetCss) {
				themeCss += `\n\n/* snippet: ${snippet} */\n${snippetCss}`;
			}
		}

		if (!themeCss) {
			if (appCss?.content) {
				themeCss = appCss.content;
				themeSource = `${appCss.asarPath}:${appCss.entry}`;
			}
		}
	}

	const filteredThemeCss = extractThemeVariables(themeCss);
	await fs.writeFile(outputPath, uniqueLines(filteredThemeCss), "utf8");
	if (appCss?.content) {
		await fs.writeFile(appCssPath, uniqueLines(appCss.content), "utf8");
	}
	return {outputPath, themeSource};
}

if (process.argv[1] && process.argv[1].endsWith("preview-theme.mjs")) {
	const {outputPath, themeSource} = await generatePreviewTheme();
	const sourceLabel = themeSource ? ` from ${themeSource}` : " (no theme found)";
	console.log(`Preview theme written to ${outputPath}${sourceLabel}.`);
}
