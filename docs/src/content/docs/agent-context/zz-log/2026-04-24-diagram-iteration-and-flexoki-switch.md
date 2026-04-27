---
title: Diagram iteration + Flexoki migration
description: Session log for the polyhierarchy-diagram rewrites and the switch from Nova to Flexoki theme.
tags: [docs, diagram, theme]
sidebar:
  label: "04-24 · Diagram + Flexoki"
  order: -20260424000
date: 2026-04-24
---

## Diagram — iterating on the homepage polyhierarchy illustration

The homepage diagram went through several rewrites before landing on one that actually tells the plugin's story.

### v1 — single file, many tag parents (wrong frame)

First pass showed `notes.md` with one folder parent on the left and many tag parents on the right. It illustrated *what polyhierarchy is* but not *what the plugin does*. Rules and priorities were invisible.

### v2 — three-column layout with rule cards

Added a middle column of priority-ordered rule cards between the filesystem and tag columns. Rule cards show the folder regex, bidirectional sync indicator, and tag output. Arrows fan out from the traced branch to all matching rules, then out to the matching tag hierarchies.

### v3 — trace a specific file

Shifted the highlighted subject from "Q4-Roadmap/ folder branch" down one level to `kickoff.md` (a specific file). Each tag tree now ends in `kickoff.md ★` as a leaf — same file, three tag addresses.

### v4 — show priority winning folder placement

The missing piece: *what does priority DO?* Rewrote the three rules to map to three distinct filesystem roots (`Projects/`, `Time/`, `Topics/`). Now each rule would place the file in a different folder if it had priority. Rule 1 (priority 10) wins, so the file lives under `Projects/Q4-Roadmap/`. Added muted "alternate destination" folders on the left (`Time/2024/q4/roadmap/`, `Topics/roadmaps/q4/`) with ghost `kickoff.md` markers captioned "would live here if Rule 2/3 won." Rule 1 got an accent-colored "MOVES FILE" badge + soft glow; Rules 2 and 3 got outlined "TAG ONLY" badges.

### Rule card polish

Multiple passes on the rule card internals:

- Replaced broken compound-path triangle with a proper horizontal double-arrow in a rounded accent pill
- Consistent 22px vertical rhythm between header / divider / folder / bidi / tag / transforms rows
- Priority header rewritten from "PRIORITY / highest" to descriptive "matches first / priority 10"
- Connecting arrows went one-way → two-way after correctly noting that a bidirectional plugin deserves bidirectional arrows
- Tag box padding standardized (one box had content pressed against the bottom edge)

### Visual iteration loop

The workflow for each pass was:

1. Edit the SVG/CSS in `PolyhierarchyDiagram.astro`
2. `bun run build`
3. Run a headless-chromium screenshot script that captures the diagram at a specific viewport
4. Read the screenshot (Claude can read PNGs directly)
5. Identify visible issues
6. Repeat

Lesson: programmatic smoke tests passed consistently throughout all the visual breakage. Without actually looking at rendered output, bad padding and broken arrows would have shipped unnoticed.

## Theme switch — Nova → Flexoki

Migrated the docs theme from `starlight-theme-nova` (Tailwind-based, feature-dense) to `starlight-theme-flexoki` (standalone, reading-focused).

### Why

- Fewer moving parts (no Tailwind, no `@source` directives, no Nova overflow hacks)
- Aesthetic better fits a single-plugin utility docs site — warmer, calmer, reading-first
- Matches the pattern used in `portaconv` and `portagenty` (also lightweight Rust/CLI docs)
- Nova earlier introduced a silent regression where mobile sidebar classes were stripped by Tailwind because `global.css` was missing the `@source` directives that tell Tailwind to scan the Nova theme's sources

### What changed

| File | Change |
|---|---|
| `package.json` | Dropped `@tailwindcss/vite`, `tailwindcss`, `starlight-theme-nova`, `starlight-heading-badges`. Added `starlight-theme-flexoki`. |
| `astro.config.mjs` | Swapped theme plugin to `starlightThemeFlexoki()`. Removed the Tailwind Vite plugin. |
| `src/styles/global.css` | Deleted — Tailwind entry point no longer needed. |
| `src/styles/brand.css` | Trimmed from ~40 lines of Nova-specific hacks (content-width clamp, sidebar tuning, overflow fix) to ~15 lines of generic rules (SVG overflow cap, font-size scale on big monitors). |
| `tests/ux-regression.spec.ts` | Removed Nova-specific tests (Tailwind `@source`, sidebar bleed, content-width clamp, sidebar width). Kept generic tests (base path, console errors, meta tags, font scale) and added a new favicon-sizes guard. |
| `tests/smoke.spec.ts` | Sidebar test now targets standard `#starlight__sidebar` instead of Nova's `#nova-sidebar-nav`. Header nav test made more generic. |

### Logos + favicons

Added custom logos to `docs/src/assets/`:

- `logo-light.svg` — darker purple variant, used on light-theme backgrounds
- `logo-dark.svg` — lighter purple variant, used on dark-theme backgrounds
- `logo.svg` — default reference copy
- `logo.png` — 1024×1024 transparent, source for favicon generation

Configured via Starlight's `logo: { light, dark, alt }` property → the navbar now carries the crystal icon + "Folder Tag Sync" wordmark, theme-aware.

Homepage was switched to Starlight's `template: splash` layout with `hero.image.file: ../../assets/logo.svg` → big centered hero image + CTA buttons, reminiscent of other plugin docs sites in this workspace.

Favicons generated at multiple sizes via `jimp` (pure-JS, didn't need sharp's native libs which were broken in this environment):

- `favicon.svg` (primary, modern browsers)
- `favicon-16.png`, `favicon-32.png`, `favicon-48.png` (legacy browser tabs)
- `apple-touch-icon.png` (180×180, iOS home screen)
- `icon-192.png`, `icon-512.png` (Android / PWA)

Wired into `astro.config.mjs` via Starlight's `head:` array with appropriate `sizes=` attributes so browsers pick the right resolution.

### EXIF / PII cleanup

Verified the source PNGs had no text-metadata chunks (tEXt / iTXt / zTXt) or EXIF data via a small Python chunk inspector — they were clean on ingest. Source SVGs started with a plain `<?xml ... ?><svg ...>` header with no embedded metadata. The rename-and-copy script therefore just needed to move files with sensible names, no stripping required.

Original `assets/nano-banana-*` source files left in place for now (untracked) — can be deleted whenever.

## Final state at session end

- Flexoki theme live
- 33/33 Bun smoke checks passing
- 39/39 Playwright tests passing (smoke + ux-regression + deployment)
- 31 pages building cleanly
- Homepage: splash layout with logo hero + CTA buttons + polyhierarchy diagram + feature cards
- Nav: logo + site title, theme-aware
- Favicons: SVG primary + PNGs at 16/32/48/180/192/512

## Next priorities

- Commit + push + verify live deploy picks everything up
- Optional: simplify the README intro section now that the splash page exists
- Optional: add more screenshots of the actual plugin UI to the docs
