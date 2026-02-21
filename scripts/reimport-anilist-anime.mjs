#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

const ALLOWED_ANIME_FORMATS = new Set(["TV", "TV_SHORT", "ONA"]);
function usage() {
	console.log("Usage: node scripts/reimport-anilist-anime.mjs --username <AniListUser> --media-root <MediaDir> [--apply]");
}

function parseArgs(argv) {
	const out = {
		username: "",
		mediaRoot: "",
		apply: false,
	};
	for (let i = 2; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--username") {
			out.username = argv[i + 1] ?? "";
			i += 1;
			continue;
		}
		if (arg === "--media-root") {
			out.mediaRoot = argv[i + 1] ?? "";
			i += 1;
			continue;
		}
		if (arg === "--apply") {
			out.apply = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			usage();
			process.exit(0);
		}
	}
	if (!out.username || !out.mediaRoot) {
		usage();
		process.exit(1);
	}
	return out;
}

function listAnimeFiles(root) {
	const files = [];
	const walk = (current) => {
		const entries = fs.readdirSync(current, {withFileTypes: true});
		for (const entry of entries) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
				continue;
			}
			if (entry.isFile() && /^anime(?:-\d+)?\.md$/i.test(entry.name)) {
				files.push(fullPath);
			}
		}
	};
	walk(root);
	return files;
}

function splitFrontmatter(content) {
	const lines = content.split(/\r?\n/);
	if (!lines.length || lines[0].trim() !== "---") {
		return null;
	}
	let endIndex = -1;
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i].trim() === "---") {
			endIndex = i;
			break;
		}
	}
	if (endIndex === -1) {
		return null;
	}
	return {
		frontmatterLines: lines.slice(1, endIndex),
		bodyLines: lines.slice(endIndex + 1),
		newline: content.includes("\r\n") ? "\r\n" : "\n",
	};
}

function findKeyRange(lines, key) {
	const keyPattern = new RegExp(`^${key}:(?:\\s*(.*))?$`);
	for (let i = 0; i < lines.length; i += 1) {
		const match = lines[i].match(keyPattern);
		if (!match) {
			continue;
		}
		let end = i + 1;
		const rawValue = match[1] ?? "";
		if (!rawValue.length) {
			while (end < lines.length && /^\s*-\s+/.test(lines[end])) {
				end += 1;
			}
		}
		return {start: i, end, rawValue};
	}
	return null;
}

function getNumber(lines, key) {
	const range = findKeyRange(lines, key);
	if (!range) {
		return undefined;
	}
	const value = Number.parseInt((range.rawValue ?? "").trim(), 10);
	if (!Number.isFinite(value)) {
		return undefined;
	}
	return value;
}

function getNumberArray(lines, key) {
	const range = findKeyRange(lines, key);
	if (!range) {
		return [];
	}
	const values = [];
	if ((range.rawValue ?? "").trim().length > 0) {
		const inline = Number.parseInt(range.rawValue.trim(), 10);
		if (Number.isFinite(inline)) {
			values.push(inline);
		}
		return values;
	}
	for (let i = range.start + 1; i < range.end; i += 1) {
		const match = lines[i].match(/^\s*-\s*(.+)$/);
		if (!match) {
			continue;
		}
		const parsed = Number.parseInt(match[1].trim(), 10);
		if (Number.isFinite(parsed)) {
			values.push(parsed);
		}
	}
	return values;
}

function getString(lines, key) {
	const range = findKeyRange(lines, key);
	if (!range) {
		return undefined;
	}
	return (range.rawValue ?? "").trim();
}

function setScalar(lines, key, value) {
	const range = findKeyRange(lines, key);
	const nextLine = `${key}: ${String(value)}`;
	if (range) {
		lines.splice(range.start, range.end - range.start, nextLine);
		return;
	}
	lines.push(nextLine);
}

function setArray(lines, key, values) {
	const range = findKeyRange(lines, key);
	const nextLines = [
		`${key}:`,
		...values.map((value) => `  - ${value}`),
	];
	if (range) {
		lines.splice(range.start, range.end - range.start, ...nextLines);
		return;
	}
	lines.push(...nextLines);
}

function joinFrontmatter(frontmatterLines, bodyLines, newline) {
	return [
		"---",
		...frontmatterLines,
		"---",
		...bodyLines,
	].join(newline);
}

function isSeasonCandidate(node) {
	if (!node || node.type !== "ANIME") {
		return false;
	}
	if (!node.format) {
		return true;
	}
	return ALLOWED_ANIME_FORMATS.has(node.format);
}

function getRelationId(media, relationType) {
	const edges = media?.relations?.edges ?? [];
	for (const edge of edges) {
		if (edge?.relationType !== relationType) {
			continue;
		}
		const node = edge?.node;
		if (node && isSeasonCandidate(node) && Number.isFinite(node.id)) {
			return Number(node.id);
		}
	}
	return null;
}

function buildSeasonChain(anchorId, mediaById) {
	if (!anchorId) {
		return [];
	}
	const backwards = [anchorId];
	let currentId = anchorId;
	while (true) {
		const media = mediaById.get(currentId);
		if (!media) {
			break;
		}
		const prequelId = getRelationId(media, "PREQUEL");
		if (!prequelId || backwards.includes(prequelId)) {
			break;
		}
		backwards.push(prequelId);
		currentId = prequelId;
	}
	const chain = backwards.reverse();
	currentId = anchorId;
	while (true) {
		const media = mediaById.get(currentId);
		if (!media) {
			break;
		}
		const sequelId = getRelationId(media, "SEQUEL");
		if (!sequelId || chain.includes(sequelId)) {
			break;
		}
		chain.push(sequelId);
		currentId = sequelId;
	}
	return chain;
}

function mergeSeasonIds(preferred, existing, fallback) {
	const merged = [];
	for (const source of [preferred, existing, fallback]) {
		for (const value of source) {
			if (!Number.isFinite(value) || value <= 0 || merged.includes(value)) {
				continue;
			}
			merged.push(value);
		}
	}
	return merged;
}

function chooseHigherProgress(existing, incoming) {
	if (!incoming) {
		return existing;
	}
	if (!existing) {
		return incoming;
	}
	if (existing.season > incoming.season) {
		return existing;
	}
	if (existing.season < incoming.season) {
		return incoming;
	}
	return existing.episode >= incoming.episode ? existing : incoming;
}

function fetchAniListCollection(username) {
	const query = `query($name:String){MediaListCollection(userName:$name,type:ANIME){lists{name entries{status progress mediaId media{id episodes format relations{edges{relationType node{id type format}}}}}}}}`;
	const payload = JSON.stringify({query, variables: {name: username}});
	const stdout = execFileSync(
		"curl",
		[
			"-sS",
			"--retry",
			"6",
			"--retry-delay",
			"2",
			"https://graphql.anilist.co",
			"-H",
			"Content-Type: application/json",
			"--data",
			payload,
		],
		{encoding: "utf8"},
	);
	const json = JSON.parse(stdout);
	if (!json?.data?.MediaListCollection?.lists) {
		throw new Error("Failed to fetch AniList collection.");
	}
	return json.data.MediaListCollection.lists;
}

function buildAniListIndexes(lists) {
	const mediaById = new Map();
	const entryById = new Map();
	for (const list of lists) {
		for (const entry of list.entries ?? []) {
			const mediaId = Number(entry.mediaId);
			if (!Number.isFinite(mediaId) || mediaId <= 0) {
				continue;
			}
			const progress = Math.max(0, Math.floor(Number(entry.progress) || 0));
			const status = String(entry.status ?? "");
			const totalEpisodes = Math.max(0, Math.floor(Number(entry.media?.episodes) || 0));
			const effectiveProgress = progress > 0
				? progress
				: status === "COMPLETED" && totalEpisodes > 0
					? totalEpisodes
					: 0;
			const existing = entryById.get(mediaId);
			if (!existing || effectiveProgress > existing.progress) {
				entryById.set(mediaId, {progress: effectiveProgress, status});
			}
			if (entry.media) {
				mediaById.set(mediaId, entry.media);
			}
		}
	}
	return {entryById, mediaById};
}

function run() {
	const args = parseArgs(process.argv);
	const animeFiles = listAnimeFiles(args.mediaRoot);
	const lists = fetchAniListCollection(args.username);
	const {entryById, mediaById} = buildAniListIndexes(lists);

	let changed = 0;
	let progressFilled = 0;
	let idsExpanded = 0;
	let noAnilistId = 0;

	for (const filePath of animeFiles) {
		const original = fs.readFileSync(filePath, "utf8");
		const parsed = splitFrontmatter(original);
		if (!parsed) {
			continue;
		}
		const lines = [...parsed.frontmatterLines];

		const existingAnilistId = getNumber(lines, "anilistId");
		const existingAnilistIds = getNumberArray(lines, "anilistIds");
		const anchorId = existingAnilistId ?? existingAnilistIds[0];
		if (!anchorId) {
			noAnilistId += 1;
			continue;
		}

		const derivedSeasonIds = buildSeasonChain(anchorId, mediaById);
		const mergedSeasonIds = mergeSeasonIds(derivedSeasonIds, existingAnilistIds, [anchorId]);
		if (!mergedSeasonIds.length) {
			continue;
		}

		const beforeIds = JSON.stringify(existingAnilistIds);
		const afterIds = JSON.stringify(mergedSeasonIds);
		if (beforeIds !== afterIds) {
			idsExpanded += 1;
		}

		const existingProgress = (() => {
			const season = getNumber(lines, "season");
			const episode = getNumber(lines, "episode");
			if (!season || !episode) {
				return undefined;
			}
			return {season, episode};
		})();

		let importedProgress;
		for (const [index, seasonId] of mergedSeasonIds.entries()) {
			const entry = entryById.get(seasonId);
			const progress = entry?.progress ?? 0;
			if (!progress) {
				continue;
			}
			const candidate = {season: index + 1, episode: progress};
			importedProgress = chooseHigherProgress(importedProgress, candidate);
		}

		const resolvedProgress = chooseHigherProgress(existingProgress, importedProgress);
		if (!existingProgress && resolvedProgress) {
			progressFilled += 1;
		}

		setScalar(lines, "anilistId", mergedSeasonIds[0]);
		setArray(lines, "anilistIds", mergedSeasonIds);
		if (resolvedProgress) {
			setScalar(lines, "season", resolvedProgress.season);
			setScalar(lines, "episode", resolvedProgress.episode);
		}

		const next = joinFrontmatter(lines, parsed.bodyLines, parsed.newline);
		if (next !== original) {
			changed += 1;
			if (args.apply) {
				fs.writeFileSync(filePath, next, "utf8");
			}
		}
	}

	console.log(JSON.stringify({
		mode: args.apply ? "apply" : "dry-run",
		animeFiles: animeFiles.length,
		changed,
		progressFilled,
		idsExpanded,
		noAnilistId,
	}, null, 2));
}

run();
