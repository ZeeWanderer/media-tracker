# Media Tracker (Obsidian plugin)

Vault-first tracker for novels, series, and movies with a dedicated GUI view.

## Features

- Dedicated **Media tracker** view with filters and quick actions.
- Notes stored as plain Markdown with YAML frontmatter.
- Buttons for Patreon, Kemono, RoyalRoad (novels) and IMDB (series/movies).
- Command to create new media notes with a guided modal.

## Storage format

Create notes inside the configured media folder (default: `Media/`). Each note uses YAML frontmatter.

### Novel

```markdown
---
type: novel
title: He Who Fights With Monsters
author: Shirtaloon
status: active
progress: 442
patreon:
kemono:
royalroad:
---
```

### Series

```markdown
---
type: series
title: Silo
status: active
season: 1
episode: 5
imdb: tt14688458
---
```

### Movie

```markdown
---
type: movie
title: Dune
status: planned
year: 2021
imdb: tt1160419
---
```

Notes with missing URLs still show buttons, but they are disabled until you add links.

## Commands

- **Open media tracker**: Opens the GUI view.
- **Create media note**: Opens a modal to create a new media note.

## Settings

- **Media folder**: Vault-relative folder where notes live (default `Media`).

## Local install & development

1. In this repo: `npm install`
2. Build in watch mode: `npm run dev`
3. Copy `manifest.json`, `main.js`, `styles.css` into your vault:
   `MediaTracker/.obsidian/plugins/media-tracker/`
4. Reload Obsidian and enable the plugin in **Settings → Community plugins**.

## Iteration workflow

- Keep `npm run dev` running.
- After each build, reload Obsidian to pick up changes.

## Legacy list migration

Your `Tmp/patreon_to_read.index` file can be manually converted into markdown notes.
Recommended approach:

1. Paste items into a new note in the vault (for reference).
2. Use **Create media note** to generate structured notes.
3. Copy over author/title/progress and fill in URLs later.

If you want automated import, we can add an import command that parses the list after you place the file inside the vault.
