import {fileURLToPath, pathToFileURL} from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import {generatePreviewData} from "./preview-data.mjs";
import {buildPreview} from "./preview-build.mjs";
import {generatePreviewTheme} from "./preview-theme.mjs";

let chromium;
try {
	({chromium} = await import("playwright"));
} catch (error) {
	console.error("Playwright is not installed. Run: npm install -D playwright");
	process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const previewFile = path.join(root, "preview", "index.html");
const outputDir = path.join(root, "preview", "out");
const debugPath = path.join(outputDir, "debug.json");
const baseUrl = pathToFileURL(previewFile).toString();

await fs.rm(outputDir, {recursive: true, force: true});
await fs.mkdir(outputDir, {recursive: true});

await generatePreviewData();
await buildPreview();
await generatePreviewTheme();

const browser = await chromium.launch({
	args: ["--no-sandbox", "--disable-setuid-sandbox"],
	chromiumSandbox: false,
});
const page = await browser.newPage({viewport: {width: 1200, height: 800}});

const debugSnapshots = [];
async function captureDebug(label) {
	const info = await page.evaluate(() => {
		const html = document.documentElement;
		const toolbar = document.querySelector(".preview-toolbar");
		const tracker = document.querySelector(".media-tracker");
		const components = document.querySelector(".preview-section--components");
		const card = document.querySelector(".media-tracker__card");
		const table = document.querySelector(".media-tracker__table");
		const cards = document.querySelectorAll(".media-tracker__card").length;
		const rows = document.querySelectorAll(".media-tracker__table-row").length;
		const computed = (el) => el ? {
			display: getComputedStyle(el).display,
			visibility: getComputedStyle(el).visibility,
			opacity: getComputedStyle(el).opacity,
			color: getComputedStyle(el).color,
			background: getComputedStyle(el).backgroundColor,
			border: getComputedStyle(el).borderColor,
			height: getComputedStyle(el).height,
		} : null;
		return {
			bodyClass: document.body.className,
			htmlClass: document.documentElement.className,
			bodyChildren: document.body.children.length,
			html: computed(html),
			body: computed(document.body),
			toolbar: computed(toolbar),
			tracker: computed(tracker),
			components: {
				hidden: components?.hasAttribute("hidden") ?? null,
				styles: computed(components),
			},
			card: computed(card),
			table: computed(table),
			cards,
			rows,
		};
	});
	debugSnapshots.push({label, info});
}

await page.goto(`${baseUrl}?mode=cards&theme=light`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("cards-light");
await page.screenshot({path: path.join(outputDir, "cards.png"), fullPage: true});

await page.goto(`${baseUrl}?mode=details&theme=light`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("details-light");
await page.screenshot({path: path.join(outputDir, "details.png"), fullPage: true});

await page.setViewportSize({width: 1200, height: 800});
await page.goto(`${baseUrl}?mode=cards&theme=dark`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("cards-dark");
await page.screenshot({path: path.join(outputDir, "cards-dark.png"), fullPage: true});

await page.goto(`${baseUrl}?mode=details&theme=dark`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("details-dark");
await page.screenshot({path: path.join(outputDir, "details-dark.png"), fullPage: true});

await page.goto(`${baseUrl}?mode=new-note&theme=light`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("new-note-light");
await page.screenshot({path: path.join(outputDir, "new-note.png"), fullPage: true});

await page.goto(`${baseUrl}?mode=card-edit&theme=light`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("card-edit-light");
await page.screenshot({path: path.join(outputDir, "card-edit.png"), fullPage: true});

await page.goto(`${baseUrl}?mode=components&theme=light`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("components-light");
await page.screenshot({path: path.join(outputDir, "components.png"), fullPage: true});

await page.goto(`${baseUrl}?mode=new-note&theme=dark`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("new-note-dark");
await page.screenshot({path: path.join(outputDir, "new-note-dark.png"), fullPage: true});

await page.goto(`${baseUrl}?mode=card-edit&theme=dark`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("card-edit-dark");
await page.screenshot({path: path.join(outputDir, "card-edit-dark.png"), fullPage: true});

await page.goto(`${baseUrl}?mode=components&theme=dark`, {waitUntil: "load"});
await page.waitForTimeout(150);
await captureDebug("components-dark");
await page.screenshot({path: path.join(outputDir, "components-dark.png"), fullPage: true});

await fs.writeFile(debugPath, JSON.stringify(debugSnapshots, null, 2), "utf8");

await browser.close();
