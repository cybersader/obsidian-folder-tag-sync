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

# Run source tests (1,305 tests)
bun test src

# Run the release-gate tests (38 tests)
bun test scripts

# Validate a release tag against manifest.json + the two-channel gate
bun scripts/validate-release-tag.mjs <tag>

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

**v0.1.41** is the current stable release and GitHub's "Latest"; the plugin is not yet in the Obsidian community catalog. Releases run in exactly two channels, enforced by `scripts/validate-release-tag.mjs`: stable `X.Y.Z` (latest) and test `X.Y.Z-workbench-outline.N` (pre-release, never latest, must hang off an already-published stable base). `0.1.41-workbench-outline.1` is the published test build of the split-UX work and the preview-only annotated-outline prototype. The engine is mature — both sync directions, the typed model, Path Lens templates, specificity-aware matching, frontmatter witness, bulk sync, known-system detection, `.orgsys` preview/composition, preview-first production support bundles, and the self-explaining semantic Workbench grammar ship in this baseline.

The release consolidates known-system detection and rule drafting into one persistent **Taxonomy Workbench** with Map, Scope, and Candidates surfaces, then makes anchored organizational-system occurrences the persistent group-level object. The responsive Workbench keeps a compact **Organizational systems** summary visible while moving content-sized occurrence cards into a collapsible wide side browser or temporary narrow drawer; **Rule layers** remain separate, inferred, and collapsed by default. Map rows are neutral and use explicit Identifies/Supports and Conflict text instead of pack-colour rails, tints, or decorative connectors. Candidate rows remain grouped by exact occurrence, and folder/settings source revisions prevent stale installs. Legacy detect/draft/map command IDs remain routes into the same leaf. Workbench-installed drafts are always added disabled for review and do not modify folders, notes, tags, frontmatter, or active sync behavior. Built-in packs are embedded into `main.js`, so the standard `main.js` + `manifest.json` + `styles.css` BRAT layout is sufficient. `.orgsys` composition remains preview-only until composed group precedence and durable deployment provenance can be persisted safely.

**Published test build `0.1.41-workbench-outline.1`** (branch `feature/workbench-split-ux`) combines the completed tree-first split repair with a task-oriented journey and same-day evidence/Scope/candidate clarification. Visible jobs are **Explore your vault → Choose where rules apply → Review proposed rules** while internal `map | scope | candidates` values remain stable. **Organizational systems in this vault** is a global overview across all jobs; selected evidence expands under its card and scrolls with the list rather than becoming sticky. Exact occurrence markers are deterministic secondary cues, while names, states, relations, paths, and keys remain authoritative. Scope focus is context only: checked folders are the sole deployment filter. A keyboard-accessible, view-local divider separates chooser and plan scrollers, and stable rail/checkbox/disclosure slots prevent row-control shifts. Proposed rules report folder→tag and tag→folder status independently, name exact conflict targets, focus exact proposed rows, and open exact installed Settings rows. Saving still uses a count-bearing disabled-draft CTA. `workbenchLayout.ts` continues to classify density and side/overlay presentation from measured width and height; the hierarchy remains the primary Explore scroller; detail never reduces tree height; and view-local place survives rerenders and surface navigation. The companion fixture plugin's `feature/workbench-ux-lab` branch owns an invented marker-owned, tag-free, topology-only `UX Lab/` evaluation tree and in-app guide covering these checks.

**Milestone 1 — verified locally, staged, not yet released.** `feature/workbench-split-ux` now carries milestone 1 of the "complete organization journeys" plan: *review and save existing systems*. The annotated outline gains one canonical reviewed selection — shared by comparison, counts, confirmation, and Save — in the new pure module `src/ui/workbench/outlineReviewPlan.ts`. Explicit occurrence choices filter `buildScopePackPlan` deployments by exact `occurrenceKey` before deriving reviewed rules, so an occurrence that produces several rules keeps truthful occurrence-to-rule-ID membership and separate system/rule counts. The panel shows **Current behavior** beside **If these drafts were enabled** using enabled installed rules plus exactly the chosen proposals through the production matcher and transformer; installed disabled rules are identifiable but do not compete. `no-match`, `empty`, `invalid`, `valid`, `unchanged`, and `changed` stay distinct states, an invalid winner is never hidden behind a valid loser, and an invalid *installed* rule is attributed separately rather than blamed on a draft. Save is blocked while a chosen draft has a known invalid forward output, is count-bearing, revalidates immediately before mutation, and persists through the existing guarded `installWorkbenchRules` seam — always disabled, ID-deduplicated, never touching notes, folders, tags, frontmatter, or enabled-rule flags. Refresh invalidates review approval instead of silently approving regenerated rules; reopening derives saved/active status from persisted rules and reports enabled, disabled, and edited same-ID rules truthfully rather than reinstalling.

The staged test build for this milestone is `0.1.41-workbench-outline.2`. It completes safe *drafting* only. Forward comparison does not certify reverse safety; there is no activation, no apply-to-existing-notes, no bulk recovery, and no integrated no-regex custom journey (plan milestones 2–3). Not certified on mobile, across community themes, or on large vaults.

### Knowledge base — read this first

The living project knowledge base is at `docs/src/content/docs/agent-context/`. For a fresh session, start with:

1. `agent-context/current-state.md` — where things are now + the live direction.
2. `agent-context/glossary.md` — plain-language definitions of every term.

Then `decisions.md`, `open-questions.md`, and the dated `zz-log/` entries. Keep these current as you work.
