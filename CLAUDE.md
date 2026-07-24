# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Folder Tag Sync** is an Obsidian plugin that provides bidirectional synchronization between folder paths and tags using regex patterns and transformation pipelines.

**Key Concept**: Folders are rigid hierarchies for file storage; tags are flexible overlapping hierarchies for knowledge. This plugin bridges them with deterministic rule-based transformations (no AI inference).

## Commands

```bash
# Install dependencies (uses Bun)
bun install

# Development (watch mode)
bun run dev

# Build for production
bun run build

# Run tests (156+ tests)
bun test

# Run tests in watch mode
bun test --watch

# Lint (Obsidian plugin rules)
npm run lint
```

### Docs site (Astro + Starlight)

Located in `docs/`. Published to https://cybersader.github.io/obsidian-folder-tag-sync via GitHub Actions on push to `main` when files under `docs/**` change.

```bash
cd docs

# Core dev loop (every astro command is preflight-gated for WSL↔Windows switching)
bun run dev                  # Astro dev server with HMR
bun run dev:host             # Same, bound to 0.0.0.0 (LAN-accessible)
bun run build                # Static build → docs/dist/
bun run preview              # Preview production build
bun run preflight            # Manual preflight (auto-runs before astro commands)

# Interactive serve with sharing modes
bun run serve                # Menu: dev / preview / build / tailscale / cloudflare
bun run serve:dev            # Direct: Astro dev
bun run serve:preview        # Direct: build + preview
bun run serve:tailscale      # Build + share via Tailscale (tailnet-only, mobile-friendly)
bun run serve:cloudflare     # Build + share via public Cloudflare Tunnel

# Fast local testing
bun run smoke                # Build + route-and-content smoke (no browser)
bun run smoke:no-build       # Skip rebuild, hit existing dist/
bun run visual               # Screenshot every page × 4 viewports; writes report.md
bun run visual:no-build      # Skip rebuild

# Browser testing (Playwright)
bun run test                 # Full suite (smoke + ux-regression)
bun run test:smoke           # Just tests/smoke.spec.ts
bun run test:ux              # Just tests/ux-regression.spec.ts
bun run test:e2e:ui          # Interactive Playwright UI mode
TEST_URL=https://cybersader.github.io bun run test:deploy    # Against live deployment
```

Content lives in `docs/src/content/docs/`, organized by sidebar section (getting-started, concepts, features, reference, development, about). Source-of-truth `.md` files at the repo root (`PROJECT_BRIEF.md`, `FEATURE_ROADMAP.md`, etc.) are kept as references for agents; the docs site has its own seeded copies with Starlight frontmatter.

**UX fixes baked in via `docs/src/styles/brand.css`** (lessons from crosswalker):
- Nova theme overflow bug (border-box on markdown divs, max-width on SVG)
- Elastic content width clamp on wide viewports
- Tuned sidebar width (15rem) on desktop
- Root font-size scale at 1400px+ / 1700px+
- Sidebar hide at 768-1151px where there's not enough room for both sidebar and content

**Regression tests** (`docs/tests/ux-regression.spec.ts`) guard each of these — if someone breaks `brand.css` or swaps the theme, the tests fail loudly.

## Architecture

### Data Flow

```
File Event → Rule Matcher → Transformation Pipeline → Sync Executor
```

1. **Rule Matcher** (`src/engine/ruleMatcher.ts`) - Finds matching rules by priority using regex patterns
2. **Transformation Pipeline** (`src/transformers/pipeline.ts`) - Converts between folder/tag naming conventions
3. **Sync Executors** (`src/sync/`) - Updates frontmatter tags or moves files

### Source Structure

```
src/
├── main.ts                    # Plugin entry point, commands
├── types/settings.ts          # MappingRule, TransformConfig interfaces
├── engine/
│   └── ruleMatcher.ts         # Rule matching with priority
├── transformers/
│   ├── pipeline.ts            # Orchestrates transformation steps
│   ├── caseTransformers.ts    # snake_case, kebab-case, etc.
│   ├── emojiTransformers.ts   # Strip/keep emojis
│   ├── numberTransformers.ts  # Handle Johnny Decimal prefixes
│   └── regexTransformers.ts   # Custom regex transforms
├── sync/
│   ├── FolderToTagSync.ts     # Folder path → tag frontmatter
│   └── TagToFolderSync.ts     # Tags → file movement
├── ui/
│   ├── SettingsTab.ts         # Main settings page
│   └── RuleEditorModal.ts     # Rule creation/editing modal
└── utils/
    └── debug.ts               # Debug logging to vault file
```

### Key Interfaces

**MappingRule** (`src/types/settings.ts:28`):
- `folderPattern` / `tagPattern` - Regex patterns for matching
- `folderEntryPoint` / `tagEntryPoint` - Base paths for creating new items
- `direction` - `'folder-to-tag' | 'tag-to-folder' | 'bidirectional'`
- `folderTransforms` / `tagTransforms` - Pipeline configuration

**TransformConfig**: Case conversion, emoji handling, number prefix handling, custom regex transforms.

## Testing

Tests are colocated with source files (`*.test.ts`). The plugin uses Bun's test runner.

```bash
# Run a single test file
bun test src/transformers/caseTransformers.test.ts

# Run tests matching a pattern
bun test --test-name-pattern "snake"
```

**Important**: Settings, modals, context menus, clipboard behavior, and visual rendering are automated in real Obsidian with WebdriverIO + `wdio-obsidian-service`. Run focused specs with `DISPLAY=:0 bun run test:e2e --spec ./test/specs/<name>.e2e.ts`, then run the full serial suite before release. Use screenshots for visual verification; reserve manual testing for mobile-only behavior or interactions the harness cannot reproduce.

## Linting for Community Plugin Submission

ESLint with `eslint-plugin-obsidianmd` enforces Obsidian's plugin guidelines:

- **Sentence case** for all UI text (not Title Case)
- No plugin name in settings headings
- Use `Setting().setHeading()` not `createEl('h3')`

```bash
npm run lint
```

## Build Output

- `main.js` - Bundled plugin (esbuild)
- `manifest.json` - Plugin metadata
- `styles.css` - Plugin styles (if any)

For testing, copy build output to `.obsidian/plugins/folder-tag-sync/` in a test vault.

## Key Design Principles

1. **Deterministic** - All transformations use regex, no AI/ML inference
2. **User Control** - Rules are explicit, previewable, and ordered by priority
3. **Safe** - Preview changes, no destructive operations without confirmation
4. **Performance** - Must handle vaults with 10,000+ files (debounce events, use metadataCache)

## Transformation Examples

```
Input Folder: "📁 01 - Projects/My Cool Thing"
  ↓ Strip emoji
"01 - Projects/My Cool Thing"
  ↓ Strip number prefix
"Projects/My Cool Thing"
  ↓ snake_case
"projects/my_cool_thing"
  ↓ Add tag prefix
"#projects/my_cool_thing"
```

## Current Status

**v0.1.36** is the current BRAT release; the plugin is not yet in the Obsidian community catalog. The engine is mature — both sync directions, the typed model, Path Lens templates, specificity-aware matching, frontmatter witness, bulk sync, detection of known systems, `.orgsys` preview/composition, the Taxonomy Workbench Map, and preview-first production support bundles all ship.

Support bundles include complete configuration, derived rule diagnostics, a full folder-only tree, bounded structured logs, and optional deterministic anonymization. The centre of gravity now returns to **rule authoring at scale** — snap-a-system gestures on the Map and installable composition.

### Knowledge base — read this first

The living project knowledge base is at `docs/src/content/docs/agent-context/`. For a fresh session, start with:

1. `agent-context/current-state.md` — where things are now + the live direction.
2. `agent-context/glossary.md` — plain-language definitions of every term.

Then `decisions.md`, `open-questions.md`, and the dated `zz-log/` entries. Keep these current as you work.
