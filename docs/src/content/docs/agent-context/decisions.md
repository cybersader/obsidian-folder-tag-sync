---
title: Decisions
description: Key technical decisions, with context and reasoning.
sidebar:
  order: 2
---

This is a running log of technical decisions. Each entry states **what** was decided, **why**, and **what was rejected**.

## Architecture

### Deterministic rule engine, not AI

**Decided:** Use regex patterns + transformation pipelines. Never use LLMs or embeddings for categorization.

**Why:**
- Output is predictable. Same input → same output, every time.
- Users can test rules without running a model.
- No network calls, no tokens, no cost.
- Works fully offline.

**Rejected:** AI-assisted "suggest a tag for this note" feature. Smart Connections and other plugins already do this well; mixing it in would blur the plugin's purpose.

---

### Four-stage transformation pipeline with fixed order

**Decided:** emoji handling → number prefix → case conversion → custom regex. Each step is optional.

**Why:**
- Most real-world naming has these four concerns in that order (`📁 01 - My Project` → strip emoji → strip number → snake_case).
- Fixed order keeps rules predictable.
- Custom regex at the end lets users add project-specific cleanup without affecting the pipeline shape.

**Rejected:** Arbitrary user-ordered pipeline. Too many ways to write subtly-broken rules.

---

### Specificity-aware matching is primary; priority is the manual override (F1)

**Decided:** When several rules match, a deterministic **specificity score** (`calculateMatchConfidence`) is the primary sort key — literal-character count, path-depth slashes, and an anchor-aware bonus, with greedy wildcards penalized heaviest. The user-set `priority: number` is demoted to a within-group tiebreak (the manual "override"). Across packs, [group precedence](/obsidian-folder-tag-sync/agent-context/glossary/) partitions rules first (CSS `@layer`-style).

**Why:**
- A more literal/anchored pattern is *genuinely* more specific; a raw priority number couldn't express that and forced users to hand-tune numbers.
- Still fully deterministic — same input → same winner, every time — so it satisfies the "no non-determinism" constraint that originally argued against score-based matching.
- Group precedence lets independently-authored packs coexist predictably.

**History:** This supersedes the original "rule priority is a number, first-match wins" decision. The earlier rejection of "score-based best-match" was about *non-deterministic* scoring; a deterministic specificity score is a different thing and is now the primary resolver. Shipped in F1 (`src/engine/ruleMatcher.ts`).

---

### Tags stored in frontmatter `tags:` array

**Decided:** Always use YAML frontmatter `tags:` array for folder→tag sync.

**Why:**
- Matches Obsidian's canonical tag storage.
- Interoperates with other plugins (Dataview, Templater).
- Preserves inline tags — folder sync never strips them.

**Rejected:** Inline tag writing (`#tag` in body). Too invasive; would conflict with user's own inline tags.

---

### Both sync directions share the same transformation pipeline

**Decided:** `folderTransforms` and `tagTransforms` are separate fields on a rule, but the transformation pipeline code is shared.

**Why:**
- Composability. A user can define one rule with both directions and different transforms for each side.
- Same pipeline code path = fewer bugs.

**Tradeoff:** The type system has to allow both fields even when only one direction is used. Worth it.

---

### Auto-sync is forward-only; the inverse direction stays manual

**Decided:** Folder→tag sync auto-fires on vault `create`/`rename` events (per each rule's `syncOnFileCreate`/`syncOnFileRename`/`syncOnFileMove` flags). Tag→folder sync — which *moves files* — never auto-fires; it requires explicit command invocation.

**Why:**
- Forward sync is purely additive: worst case is extra frontmatter tags the user can delete. Safe to automate.
- The inverse direction moves files and is potentially destructive — [lossy](/obsidian-folder-tag-sync/agent-context/glossary/) rules can't recover original folder names, so auto-firing moves on every file event is unsafe.
- Keeps the dangerous direction behind a deliberate, previewable action.

**History:** Supersedes the original "no automatic sync on file events (yet)" decision. Auto-sync shipped in 0.1.18 (`src/main.ts` registers `vault.on('create'/'rename')` → `autoSyncOnEvent`), but deliberately forward-only.

## Detection & application UX (the 0.1.22–0.1.27 arc)

These decisions came out of making the plugin usable on real, large vaults. Full narrative in the [2026-04-30 log](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-detection-ux-and-auto-scope/); terms in the [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/).

### Packs are invisible plumbing — the detect modal is hierarchy-first

**Decided:** The detect-vault modal renders the user's own folder tree with per-folder detection chips, not a list of "packs found." Pack identity surfaces only as a chip tooltip / secondary notice.

**Why:** Users think in terms of their vault's folder tree, not which pack (PARA/JD/SEACOW) detected what. Surfacing packs as the primary level forced users to reverse-map pack names onto their own structure. Hierarchy-first makes the user's structure the navigation surface and lets the plugin handle pack plumbing underneath.

**Rejected:** Both per-pack cards and per-anchor cards — they still organize around packs. Shipped 0.1.25 (`src/ui/DetectVaultModal.ts`).

---

### Detection is anchored to instances, not just pack-presence

**Decided:** A vault scan groups a pack's hits into [anchored instances](/obsidian-folder-tag-sync/agent-context/glossary/) (clusters sharing a common parent), so the UI shows "JD at root AND at `Projects/Cybersader/`" rather than one ambiguous "JD detected."

**Why:** The same pattern recurs at multiple nesting points in real vaults (e.g. entity-scoped JD sub-hierarchies). Reporting only "pattern X detected" loses the *where*, which is exactly what the user needs to decide where to scope rules. Shipped 0.1.24 (`extractInstances`).

---

### Auto-scope rewrites rule entry-points instead of installing vault-wide

**Decided:** Selecting a branch in the detection tree rewrites the applied rules so they only fire inside that branch — `folderPattern`/`folderTemplate`/`folderEntryPoint` get the scope path anchored in, and the rule `id` gets a scope-slug suffix so multiple scoped instances of the same pack don't collide. `minimalScopeCover` drops descendant selections so overlapping scopes don't double-fire.

**Why:** The hierarchy-first view *promises* that selecting a folder makes rules local to it. Without rewriting entry-points, a pack's rules would fire wherever their original pattern matched anywhere in the vault, defeating the selection. Shipped 0.1.27 (`src/engine/scopeRules.ts`).

---

### Vault-wide sync ships as an interactive hierarchical preview, not a flat dry-run list

**Decided:** Pending folder→tag changes render as a collapsible folder tree with a per-rule colour legend that doubles as a filter; the user checks/unchecks subtrees ([tri-state](/obsidian-folder-tag-sync/agent-context/glossary/)) and commits only the selected paths.

**Why:** A flat list of thousands of pending changes is unreviewable. A folder tree mirrors how users think about their vault and lets them approve/reject by branch; the legend makes "which rule is doing this" visible at a glance. Shipped 0.1.23 (`VaultSyncPreviewModal`).

---

### `removeOrphanedTags` (A6) is implemented using the F3 witness as the ownership discriminator

**Decided:** On forward sync, FTS-owned tags recorded in a file's `fts:` witness that are no longer emitted get removed; tags FTS never wrote are left alone.

**Why:** Naive orphan cleanup risks deleting user-authored tags that happen to match a rule's shape. The [frontmatter witness](/obsidian-folder-tag-sync/agent-context/glossary/) records exactly which tags FTS wrote, so cleanup removes only previously-FTS-written tags no rule still emits. This resolved the "A6 depends on F3" gap by shipping both together (0.1.18, `src/sync/FolderToTagSync.ts`).

---

### Normalize emoji/JD prefixes before matching, rather than forcing pack authors to enumerate variants

**Decided:** The detection scan and rule preview apply the same emoji-strip + whitespace + JD-prefix normalization the runtime pipeline does, *before* matching folder names against detection regexes / rule patterns.

**Why:** Real vaults use decorated folders (`📁 10 - Projects`). Pack regexes like `^\d{2} - ` failed to match these even though the runtime would strip the emoji. Per the principle "detect things without creating yet more schemas on the import side," the engine normalizes input before matching rather than making pack authors enumerate emoji variants. (`src/engine/detectPacks.ts` `matchesNormalized`.)

## Support and diagnostics

### Support bundles are preview-first, folders-only, and local

**Decided:** Production troubleshooting uses an explicit in-app preview that copies one local support bundle only after the user selects **Copy**. The default inventory includes the complete relative folder hierarchy but no note filenames, note contents, frontmatter values, vault name, absolute paths, or note-derived tag inventory.

**Why:** Folder Tag Sync behavior depends heavily on hierarchy and rule configuration, so a folder tree is useful evidence. Note-level data is rarely needed to diagnose the mapping engine and would create substantially more privacy risk. The user can test from a BRAT-installed production vault without granting filesystem access or uploading anything automatically.

**Scale boundary:** Aggregate detection/rule counts are computed across the complete folder inventory, but retained per-folder diagnostic rows are capped at 2,000. The complete folder tree is not capped. The modal's rule scan yields between chunks and cancels superseded/closed collection generations so a large production vault does not monopolize the UI or publish stale results.

**Rejected:** Automatic telemetry/upload, note-content sampling, a zip of the vault or plugin directory, and retaining unbounded per-folder rule-match arrays in memory.

---

### Readable names by default, deterministic anonymization on demand

**Decided:** The support modal opens in readable mode so relative folders and configuration can reproduce real behavior, but it displays the exact payload before copy and offers an **Anonymize names** toggle. Anonymization uses stable category aliases for folders, rules, groups, tags, patterns, templates, and custom literals while preserving hierarchy, repeated identity, enabled states, transforms, coverage, and conflicts.

**Why:** Always-raw output is easy to overshare; always-anonymized output can make concrete support examples harder to understand. Preview plus an optional structural anonymizer lets the user choose based on the sensitivity of the vault without rescanning or changing the underlying snapshot.

**Rejected:** Reversible alias maps and persistent cross-bundle aliases. Both would create a new sensitive artifact.

---

### Debug logs are structured, bounded, retained, and sanitized at export

**Decided:** Debug logging writes versioned JSONL under `.obsidian/plugins/folder-tag-sync/debug.log`, appends through a serialized queue, rotates at a fixed size with one backup, and is no longer cleared at startup. Support bundles include only a bounded recent tail and sanitize it again at the final serialization boundary.

**Why:** A persistent bounded timeline is much more useful for reproducing production failures than a log erased on every reload. Final-boundary sanitization prevents a new or overlooked log field from bypassing the bundle's privacy policy.

**Rejected:** Unbounded logs, read-and-rewrite appends, and copying the raw log file directly.

## Tooling

### Bun over npm

**Decided:** Bun is the primary package manager and test runner.

**Why:**
- ~10× faster install than npm on a cold start.
- Bun's test runner is drop-in compatible with Jest-style tests.
- Matches the workspace pattern (portaconv, portagenty, cyberbaser all use Bun).

### esbuild, not tsup or webpack

**Decided:** Stick with Obsidian's sample-plugin esbuild setup.

**Why:**
- Fast enough.
- Obsidian-sample-plugin convention; reviewers recognize it.
- Zero config needed for our needs.

### Astro + Starlight + Nova for docs

**Decided:** Match crosswalker's docs stack.

**Why:**
- Nova theme has the right density for a plugin reference site.
- Starlight has pagefind search, sidebar auto-generation, and a healthy plugin ecosystem.
- Astro 6 is stable and fast.

**Caveat:** Nova's Tailwind usage requires `@source` directives in `global.css` — see [zz-log 2026-04-23](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-23-docs-site-setup/) for the regression.
