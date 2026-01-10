# Media Tracker (Obsidian plugin)

Track novels, series, and movies in your Obsidian vault with a dedicated dashboard.

## What it does

- Dashboard view with Cards and Details modes (sorting + sticky header in Details).
- Search by title or author.
- One‑click actions: open note, external links, inline status and progress edits.
- Optional link buttons: Patreon, Kemono, RoyalRoad, IMDB, HDRezka.
- Stores everything as plain Markdown notes with YAML frontmatter.

## Quick start

1. Install dependencies: `npm install`
2. Build + deploy into your vault: `npm run deploy`
   - Set a custom vault path:  
     `MEDIA_TRACKER_VAULT=/path/to/Vault npm run deploy`
3. In Obsidian: **Settings → Community plugins** → enable **Media Tracker**.
4. Open **Command Palette → Open media tracker** (or click the film ribbon icon).

## How to use

- Click **New entry** to create a note.
- Click a progress label to edit it inline (novels).
- Use the **+** button to advance numeric progress (when recognized).
- Right‑click a card or row for the context menu:
  - Open note
  - Links → add Patreon/Kemono/RoyalRoad/IMDB/HDRezka/custom
  - Delete note

## Storage format

Notes live in a single folder inside your vault (default: `Media/`).
Each note is just Markdown with frontmatter.

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
hdrezka:
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
hdrezka:
---
```

### Custom links

You can add arbitrary links via frontmatter:

```markdown
links:
  FictionPress: https://www.fictionpress.com/...
  Forum: https://forums.example.com/...
```

## Settings

- **Media folder**: where notes live (default `Media`).
- The view mode (Cards/Details) is remembered.

## Iteration workflow

- Always run `npm run build` after edits.
- Run `npm run deploy` when you want feedback in Obsidian.
- If you touch UI, iterate with the preview pipeline first so you can see changes before deploying.
- If a UI change isn't visible in previews, update the preview markup/components so it is.

## UI preview workflow (no Obsidian)

Use the HTML preview to iterate on `styles.css` with consistent screenshots.

1) Open `preview/index.html` in a browser:
   - Cards light: `preview/index.html?mode=cards&theme=light`
   - Details light: `preview/index.html?mode=details&theme=light`
   - Cards dark: `preview/index.html?mode=cards&theme=dark`
2) Generate preview data from your vault (uses MediaTracker/Media by default):
   - `npm run preview:data`
   - Optional overrides: `MEDIA_TRACKER_VAULT=/path/to/Vault MEDIA_TRACKER_MEDIA_FOLDER=Media npm run preview:data`
   - Optional limit: `MEDIA_TRACKER_PREVIEW_LIMIT=48 npm run preview:data`
3) Sync Obsidian theme + snippets into the preview (matches your vault look):
   - `npm run preview:theme`
   - Optional override: `MEDIA_TRACKER_THEME_CSS=/path/to/theme.css npm run preview:theme`
   - Note: full Obsidian `app.css` is copied alongside variable overrides for fidelity.
4) Build the preview bundle (uses shared UI renderer):
   - `npm run preview:build`
5) Generate screenshots (requires Playwright):
   - Install once: `npm install -D playwright` then `npx playwright install`
   - Capture: `npm run preview:screenshot`
   - Outputs: `preview/out/cards.png`, `preview/out/details.png`, `preview/out/card-edit.png`, `preview/out/components.png`, `preview/out/new-note.png`, `preview/out/cards-dark.png`, `preview/out/details-dark.png`, `preview/out/card-edit-dark.png`, `preview/out/components-dark.png`, `preview/out/new-note-dark.png`
6) When ready, build and deploy to your vault:
   - `npm run build`
   - `npm run deploy`
