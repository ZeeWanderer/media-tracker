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

