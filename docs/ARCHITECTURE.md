# MediaTracker architecture

## Layers

- `src/main.ts` is the composition root. It owns plugin lifecycle, shared services, commands, views, settings, and Obsidian event registration.
- `src/domain/` contains pure media rules. It must not depend on Obsidian, vault files, HTTP, or DOM APIs.
- `src/flows/` coordinates use cases such as create, mutate, refresh, and delete. Provider selection and queue execution remain injectable where deterministic testing is useful.
- `src/infra/` adapts Obsidian storage, third-party APIs, Git, logging, and persistent caches.
- `src/ui/` owns Obsidian views, interaction controllers, filters, and DOM renderers. Views consume shared plugin services instead of creating competing global state.
- `src/preview/` uses the same record and renderer contracts as the plugin. `scripts/preview-data.mjs` uses the production frontmatter codec and record mapper.

## Data invariants

- Markdown/YAML frontmatter is the source of truth. There is no second media database.
- `src/domain/media/frontmatter.ts` is the only codec for decode, sanitize, validate, encode, and stable normalization.
- Schema migrations run sequentially through `src/domain/media/migrations.ts`.
- Unsupported future schema versions may be read, but cleanup does not rewrite them and mutations fail explicitly.
- Obsidian `App`, `TFile`, and folder traversal belong in `src/infra/storage/`; pure records use `MediaRecord` and optional structural file references.
- Title search indexes the primary title and all alternate titles. Identity search recognizes stored IMDb, AniList, and TMDb identities.
- Create rejects duplicate IMDb IDs and any duplicate ID in an AniList season chain.
- Delete removes empty media-folder ancestors but never removes the configured media root.

## Operation ownership

- `LibraryRefreshCoordinator` serializes startup, bulk, and single-item refreshes and publishes one shared progress snapshot.
- `executeTrackedMediaRefresh` owns queue ordering, provider accounting, progress snapshots, and per-item failure isolation. The public wrapper supplies live AniList/TMDb operations.
- `TrackerGitService` owns repository state, scoped-change checks, commit execution, and subscriptions for every tracker view.
- `ViewRefreshManager` immediately invalidates affected media caches and collapses bursty vault events into one delayed render.
- Each tracker view caches its mapped media list until an affected vault event or settings change invalidates it.

## Favicon cache

- Memory URLs are checked first during rendering.
- On tracker open, the current in-memory state renders first. Indexed disk entries are then validated and promoted in the background before requesting another render.
- Startup warming is disk-only. Network discovery remains deferred and runs only for cache misses.
- One in-flight request is shared per origin, and the memory store is bounded by entry count and bytes.
- Cache and log paths are excluded from plugin Git commit scope.

## Lifecycle

- Plugin `onload()` creates shared services and registers views, commands, and settings without scanning the vault.
- Vault listeners, interrupted-run restoration, and startup refresh begin only after `workspace.onLayoutReady()`; loaded views are invalidated and rerendered once at that boundary in case they opened during workspace restoration.
- View constructors only assemble dependencies. Rendering and subscriptions begin in `onOpen()` when Obsidian has made the deferred view visible.
- Workspace iteration uses concrete `instanceof` checks so deferred views are never treated as loaded plugin views.
- Obsidian events are registered through plugin registration helpers.
- View search/icon timers and service subscriptions are released in `onClose()`.
- Plugin-scoped view refresh and Git timers are released in `onunload()`.
- Logger disposal drains an active flush and refuses new entries after disposal.
- Favicon disposal clears memory and prevents late operations from repopulating it.
- The manifest is intentionally desktop-only because Git execution and local adapter behavior rely on desktop capabilities.

## Performance baseline

Phase 3 baseline on 2026-08-09:

- Main vault media tree: 849 Markdown files.
- Preview full disk scan: about 392 ms, including about 291 ms for file reads/YAML and 62 ms for decode/map.
- Persistent favicon index: 14 entries; parallel local existence checks took about 0.3 ms.
- Relevant vault-event bursts invalidate immediately but produce one tracker render per 150 ms debounce window.

The plugin reads frontmatter from Obsidian's metadata cache, not from disk/YAML like the preview benchmark. A plugin-scoped incremental media index is therefore not justified at this scale; add one only after in-app measurements show the per-view cache is a bottleneck.

## Validation

Run these gates after architecture or behavior changes:

```bash
npm run build
npm run preview:data
npm run preview:build
npm run preview:screenshot
git diff --check
```

`npm run build` runs bundled Node tests, ESLint, TypeScript checking, and the production esbuild bundle. UI changes require reviewing generated light and dark previews before deployment.
