---
title: Frontmatter as bijection memory — making lossy ops recoverable per-file
description: Research on whether per-file frontmatter properties can make lossy transfer ops bijective on a per-file basis. The philosophy shift from stateless rules to per-file stateful memory; what each transfer op gains; prior art for in-band round-trip metadata (Hugo aliases, Pandoc, Boomerang lens complement, Git LFS); UX tradeoffs (frontmatter pollution, git churn, shareability); recommended opt-in design.
tags: [research, architecture, abstraction, frontmatter, bijection, phase-3]
sidebar:
  label: "04-27 · Frontmatter as memory"
  order: -20260427004
date: 2026-04-27
---

## What this entry asks

A theory worth taking seriously: **today all the transformation logic lives in `data.json`**. The engine is *stateless* per-file. It computes tags from rules + folder paths; it computes folders from rules + tag names. Every file is processed independently, and nothing is remembered about how a given file got into its current state.

The proposal: when a forward sync fires (folder → tag), write origin information to the file's frontmatter. When the inverse sync fires later (tag → folder), read the frontmatter to reconstruct exactly what the forward direction discarded. Concretely, instead of:

```yaml
# Today
---
tags:
  - "-inbox"
---
```

Add a structured marker:

```yaml
# Proposed
---
tags:
  - "-inbox"
ftsync:
  origin: "Capture/Inbox/2026/Q2/notes.md"
  rule: "inbox-marker"
  schema: 1
---
```

The inverse direction can then move `#-inbox`-tagged files back to their *exact* origin folders rather than falling back to "the rule's entry folder + best guess." Lossy ops become *recoverable per file* even though they're lossy *per rule*.

This entry examines whether that philosophy shift is worth making. Three Explore agents researched it in parallel: prior art for in-band round-trip metadata (9 system categories), codebase mapping for current frontmatter handling (read/write sites, settings UI surface, change set), and an information-theoretic analysis per transfer-op (what's recoverable, at what storage cost, with what edge cases). The recommendation, the per-op breakdown, and the setup-process design are downstream of those findings.

## The philosophy shift — stateless → per-file stateful

Today the engine is a deterministic *function*: given a `MappingRule` and a folder structure, you derive the tag for any file. Given the rule and the tag, you derive the folder. The rule is the law; folders are the facts. There's no third input.

Adding frontmatter memory makes the engine a *relation* over three inputs: rule, folder structure, and per-file frontmatter. Most of the time these three agree. When they disagree, the disagreement is a *sync conflict* the engine has to resolve.

Concrete consequences of this shift:

- **Vault portability**: a vault shared without its FTSync plugin loses the meaning of `_ftsync_origin` fields. The data is still there as opaque YAML, but no other tool reads it. Users who export to other note systems will see structural folder paths leak into their YAML headers.
- **Cross-vault sync**: two FTSync installs on the same vault (e.g., desktop + mobile, or two collaborators) will agree if rules and folder structure agree. But if frontmatter is written by one and read by the other across a sync delay, version mismatches can occur. There's no built-in mechanism to detect "this frontmatter is stale relative to the current rule."
- **Git diff churn**: every file move/rename that touches a folder matched by a rule writes frontmatter. A vault-wide re-sync touches thousands of files and produces thousands of "frontmatter modified" entries in `git diff`. Mitigated by batching writes, smudge filters, or `.gitattributes` rules — but the default behavior is noisy.
- **Undo/redo semantics**: Obsidian's undo operates on file changes, not on rule changes. If a user undoes a file move but the frontmatter origin field isn't undone in lockstep, the vault is internally inconsistent. FTSync would need to wire undo/redo hooks to keep frontmatter in sync.

None of these consequences are deal-breakers, but they're real. The plugin's existing claim of "stateless deterministic" becomes "conditionally stateless, with opt-in per-file memory" — a more nuanced contract.

## What the engine touches today (the frontmatter map)

To know what a frontmatter-memory feature would change, it helps to know what the engine touches in frontmatter today. The codebase mapping:

**Reads** — exactly one site. `src/sync/TagToFolderSync.ts:110` calls `app.metadataCache.getFileCache(file)` and reads `cache.frontmatter?.tags` plus `cache.tags`. The engine consumes **only the `tags` field**; no other frontmatter properties are touched on read.

**Writes** — two paths, both in `FolderToTagSync.ts`. `parseFrontmatter` (lines 183–198) and `extractTags` (lines 206–231) use raw string regex, *not* the Obsidian API. `updateTags` (lines 236–257) merges new tags into existing YAML and preserves all non-tag fields. The actual write happens at line 117 via `app.vault.modify(file, newContent)`. Notably, `TagToFolderSync` does *not* modify frontmatter at all — the inverse direction only moves files via `app.fileManager.renameFile`.

**Two declared-but-not-implemented fields** worth flagging:

- `removeOrphanedTags` (`src/types/settings.ts:114`) — exposed in settings, declared in the type, but no consuming code anywhere
- `keepRelationTags` — same status

These are vestigial. The frontmatter-memory feature should not assume they work; if implementing alongside, they should be either implemented or removed.

**The inverse-direction injection point**: `TagToFolderSync.determineTargetFolder` at lines 154–195 calls `findMatchingRules`, then `applyRuleInverse` at line 206 to compute the destination folder. Frontmatter-as-memory plug-in lands *before* line 206: read `cache.frontmatter._ftsync_origin` (or whichever field name we pick); if present and the rule has `bijective: false`, return the stored folder path; otherwise fall through to current logic.

**Tests** — `src/engine/applyTransfer.test.ts` covers all 8 ops and the `lossy: boolean` flag, but **no frontmatter round-trip tests exist anywhere in the suite**. A new feature would need its own scaffolding.

**Privacy** — no current handling for "don't write structural information that could leak private folder paths." Storing origin in frontmatter exposes folder structure to anyone who reads the YAML. Mitigation strategies must be designed (opt-in default, hash option, strip-on-export filter); none exist today.

## Per-op information-theoretic analysis

The core question per op: *what info is dropped going forward, what would frontmatter store to recover it, is per-file bijection achievable, what's the storage cost, and what edge cases break it.*

Summary table:

| Op | Lossy today? | FM recovers? | Bytes/file | Worth it? |
|---|---|---|---|---|
| `identity` | No | N/A (already bijective) | ~50 (defensive) | Defensive only |
| `truncation/drop` | No (rejects deeper) | N/A (already bijective in domain) | ~40 (defensive) | Defensive only |
| `truncation/aggregate` | Yes (separator ambiguity) | **Fully** | ~100 | **Yes** |
| `truncation/flatten` | Yes (middle ancestry) | **Fully** | ~90 | **Yes** |
| `marker-only` | Yes (everything beneath collapses) | **Partially** (FTSync-tagged: yes; manually-tagged: only entry) | ~60 | **Yes for bidirectional** |
| `promotion-to-root` | Yes (deeper ancestry) | **Fully** | ~85 | **Yes** |
| `flattening-to-leaf` | Yes (ancestry) | **Fully** | ~90 | **Yes** |
| `post-coordination` | Yes (hierarchy between facets) | **Partially** (asymmetric inverse) | ~110 | Conditional |
| `aggregation` | Yes (separator ambiguity) | **Fully** | ~100 | **Yes** |
| `opaque` | N/A | N/A | 0 | N/A |

The ops cluster into three groups:

### Already bijective (frontmatter is defensive only)

- **`identity`**: full path round-trips natively. Storing `_ftsync_origin` is *defensive insurance* against transform-pipeline irreversibility (e.g., kebab→Title-Case can lose information for inputs like "web auth" → "Web Auth"), not a correctness fix.
- **`truncation/drop`**: paths beyond the depth cap don't match the rule at all (the rule's pattern rejects them). Within the matched domain, the round-trip is bijective. Same defensive use case.

For these two, frontmatter memory is a *belt-and-suspenders* feature, useful in vaults where the user doesn't trust the transform pipeline to be reversible end-to-end. Not the load-bearing case for the feature.

### Fully recoverable with frontmatter memory

- **`truncation/aggregate`**: today the join separator collides with literal hyphens in folder names (`Web/Tutorials/React-Hooks` and `Web/Tutorials/React/Hooks` both produce `react-hooks`; the inverse can't tell them apart). With frontmatter storing the original folder path, the inverse reads it directly and moves the file back exactly.
- **`truncation/flatten`**: middle ancestry between depth N and the leaf is dropped by design. With frontmatter, the full path is recoverable.
- **`promotion-to-root`**: only the first segment after the entry survives forward; deeper structure is dropped. With frontmatter, deeper structure is restored on inverse.
- **`flattening-to-leaf`**: only the leaf folder name survives. Three files in different `Knuth/` subfolders would otherwise be indistinguishable on inverse; frontmatter disambiguates each.
- **`aggregation`**: same separator-ambiguity story as `truncation/aggregate`.

For these five ops, frontmatter memory transforms the inverse direction from "best guess" to "exact reconstruction" — for *files that have frontmatter*. This is the load-bearing use case.

### Partially recoverable — the two-class problem

Two ops produce a notable cognitive load: `marker-only` and `post-coordination`.

**`marker-only`** collapses every folder under the entry to a single tag. With frontmatter, files that FTSync forward-synced have origin metadata and are bijective on inverse. But files where the user *manually* added the tag (e.g., user types `#-inbox` on a file in `Drafts/`) have no frontmatter origin to read. The inverse direction has to handle these two classes differently:

- **FTSync-class** (origin field present): move file back to recorded origin
- **Manual-class** (no origin field): fall back to the rule's entry folder, as today

The inverse direction's behavior depends on whether the file was synced by FTSync or tagged manually. That's a real cognitive load — users have to understand that some `#-inbox`-tagged files have a "memory" of where they came from, others don't.

**`post-coordination`** has the same two-class problem, plus an additional asymmetry: removing one of the N independent tags creates an inconsistent state. If a file has `#attention + #2024-q4` plus origin `Research/Attention/2024-Q4`, and the user removes `#attention`, what should the inverse do? Move to `Research/Attention/`? `Research/2024-Q4/`? `Research/`? The frontmatter origin doesn't disambiguate because the *current tags* don't agree with the recorded origin. This is genuinely a sync conflict.

For these two ops, frontmatter memory *helps* but doesn't fully resolve inverse-direction ambiguity. The recommendation defers `post-coordination` until a real use case emerges; `marker-only` is the most common bidirectional-sync case in practice and the two-class load is acceptable.

### Edge cases (apply to all ops)

The information-theoretic analysis surfaces several failure modes worth naming explicitly:

- **Manual file move (without FTSync firing)**: frontmatter still points to the original location. Two reasonable behaviors: the engine flags "this file's folder no longer matches its stored origin" on next sync (preferred, honest), or silently re-sources from the new location (would lose the recovery anchor).
- **Rule changes after files were tagged**: existing frontmatter survives the rule change; the next sync may produce different tags than the stored origin would imply. Schema versioning helps detect stale frontmatter.
- **Folder deletion** with files still tagged: frontmatter origin points to a folder that doesn't exist. Inverse can offer to re-create the folder, or warn "original location is gone."
- **Collaborative vaults**: User A moves a file (FTSync writes frontmatter), User B (without FTSync) manually tags a sibling. Different files have inconsistent metadata coverage. The engine has to decide whether to backfill on B's next sync.
- **Frontmatter drift** (user manually edits the YAML): the engine has no way to verify integrity. Mitigations: schema version field, optional checksum, or simply accept that user-edited frontmatter is the user's call.

## Prior art for in-band round-trip metadata

The pattern of "store origin/inverse-hint in the artifact itself" has substantial precedent. A condensed survey, with the strongest analogues called out:

**Hugo's `aliases:`** is the strongest direct precedent. When a page URL changes (e.g., `/old-article/` → `/new-article/`), the new page declares the old URL in frontmatter:

```yaml
---
title: My Post
aliases:
  - /old-article/
  - /legacy/my-article/
---
```

Hugo generates 301-redirect HTML files at build time. Pattern: in-band YAML metadata for round-trip information. Failure mode: aliases are static at build time; if folder structure changes post-publish, aliases become stale. Same pattern, same failure mode the FTSync proposal would inherit.

**Jekyll's `redirect_from:`** (via `jekyll-redirect-from` plugin) is functionally identical. Astro Content Collections, Eleventy, Zola, and Hexo all converge on similar conventions.

**Pandoc YAML metadata blocks** preserve frontmatter through document conversions (DOCX→Markdown→PDF). Custom fields like `original-source: ...` travel with the doc. Failure mode: YAML syntax errors silently corrupt metadata; custom fields have no schema.

**Boomerang's lens complement** is the formal foundation. Boomerang uses *resource-aware keys* to track which parts of input align with output, plus retains the original input as the lens "complement." Storing origin in frontmatter is structurally equivalent to externalizing the complement in-document. The lens-theory framing lets us reason precisely: frontmatter is the *complement* the inverse direction needs when the forward direction is lossy.

**Git LFS** offers an alternative pattern: a small in-band marker (the LFS pointer file) that references out-of-band state. If frontmatter pollution becomes a real problem for FTSync, this pattern would let us store just a content-addressable hash in frontmatter and keep the actual origin path in plugin storage. Failure mode (relevant for FTSync): if the out-of-band store is missing or corrupted, the marker becomes useless.

**WordPress's `_wp_old_slug`** (postmeta — out-of-band) deliberately avoids in-band storage. The tradeoff: orphaned metadata when the underlying post is deleted; complex sync between content and metadata. FTSync's content artifacts (note files) can move and rename; out-of-band metadata storage would have its own consistency burden.

**The Obsidian community gap**: backlink-metadata-updater plugins write frontmatter from inferred backlinks; frontmatter-generator plugins write at note-creation time; metadata-menu provides editing UI. **No existing plugin standardizes "which rule produced this tag" or "original folder before sync."** FTSync would be establishing convention here, not inheriting one.

| System | In-band? | Pattern | Failure mode |
|---|---|---|---|
| Hugo aliases | Yes (frontmatter) | Build-time round-trip metadata | Stale at build; no auto-sync |
| Jekyll redirect_from | Yes (frontmatter) | Plugin-generated 301s | Same as Hugo |
| Pandoc YAML blocks | Yes (frontmatter) | Document round-trip | Syntax errors silently corrupt |
| Boomerang lenses | Yes (delimiters) + memory | Resource-aware keys | Lost original = broken inverse |
| Git LFS | Marker (in-band) + storage (out-of-band) | Pointer + lookup | Cache miss returns pointer text |
| WordPress _wp_old_slug | No (postmeta DB) | Out-of-band metadata | Orphaned on content delete |
| Obsidian frontmatter (generic) | Yes | Declarative user input | No standard convention |

The strongest precedent is Hugo's `aliases:` for the *pattern* and Boomerang lens complement for the *theory*. FTSync's frontmatter-memory proposal sits comfortably in this lineage.

## The two-class problem (manual tag vs. forward-synced tag)

This is the single most important UX consequence to name explicitly: under frontmatter memory, files fall into two classes that have *different inverse-direction behaviors*.

**FTSync-class**: the file got its tag because FTSync forward-synced it (folder → tag). Origin is stored. Inverse direction returns the recorded origin folder exactly. **Bijective per file.**

**Manual-class**: the file got its tag because the user typed it manually in frontmatter (or another plugin added it). No origin is stored. Inverse direction falls back to the rule's entry folder + transfer-op semantics. **Lossy as today.**

These two classes can coexist within the same vault, the same rule, even the same tag. A user who mostly forward-syncs but occasionally manually tags a file lives in a mixed regime. The plugin should make this honest and visible:

- The rule editor should explain what frontmatter memory does and what its inverse-direction behavior is for each class
- The conflict resolution UI (when it lands) should display origin metadata when available
- Documentation should explain the two-class model in plain terms

The cognitive load is real but bounded. Users who never manually tag (pure FTSync workflows) don't see it. Users who only manually tag (no forward sync) get the same behavior as today (no frontmatter, fall-back-to-entry inverse). Mixed-mode users carry the complexity.

## Composition with the typed model

The proposal creates an apparent conflict with the typed model's `cardinality` field. A rule says `cardinality: 'many:1'` (lossy by design); frontmatter memory says "actually I remember the unique inverse for this file." Who wins?

The resolution is to recognize that `cardinality` and `bijective` are *prospective* claims about the rule's *forward intent*, while frontmatter memory is *realized* state about a *specific file*. Both can coexist in the typed model:

```typescript
// Typed rule spec, conceptual
{
  transfer: { op: 'marker-only', marker: '-inbox' },
  cardinality: 'many:1',         // forward direction is many-to-one (true)
  bijective: false,              // generic inverse is not bijective (true)
  frontmatterMemory: {
    enabled: true,                // but for forward-synced files, frontmatter records origin...
    fields: ['origin'],           // ...so the realized inverse can be bijective per file
  }
}
```

The rule's typed claims describe what's true *in the absence of frontmatter*. The `frontmatterMemory` config opts into per-file recovery for files that pass through this rule's forward direction. The typed model gains a fourth concept — *realized invertibility per file* — but doesn't have to abandon any of the existing three.

Naming this clearly in the docs is the work. The `bijective: boolean` field on rules currently means one thing; under frontmatter memory it has to mean "bijective for files without frontmatter; conditionally bijective for files with." The bridge page on bijection-and-loss would eventually gain a section on "conditional bijection via per-file memory" — deferred per the scope of this entry, but flagged as a follow-on doc.

## Composition with path templates (Phase H)

Path templates (the Phase H proposal from the [regex-vs-templates research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/)) make bijection *visible at authoring time* — slots that appear on both sides round-trip; slots only on one side document a lossy direction. The author can see, when writing a rule, whether it's lossy.

Frontmatter memory makes outcomes *recoverable per-file at sync time* — even when the rule is lossy, the realized result for any specific file is stored.

These are not redundant. They sit at different layers:

| Layer | Mechanism | What it surfaces |
|---|---|---|
| **Rule design** | Path templates (slot overlap) | "Is this rule lossy in principle?" — visible at authoring |
| **Per-file recovery** | Frontmatter memory | "Can I reconstruct this specific file's origin?" — readable at sync |
| **New-file behavior** | Inverse-direction rule | "Where do manually-tagged files go?" — fallback for the manual class |

A rule pack with all three layers populated would say: this rule is lossy by design (template view), but forward-synced files preserve origin (frontmatter memory), and manually-tagged files fall back to the entry folder (inverse-direction rule). All three are independent and complementary.

The implementation order matters. Templates land first (they're a primitive change to rule shape). Frontmatter memory lands second (additive, optional, doesn't change rule shape). Manual-class fallback already exists (it's the current behavior).

## UX tradeoffs honestly named

The agents named several tradeoffs that the recommendation has to acknowledge:

**Frontmatter pollution**. ~80 bytes per file × 10,000 files ≈ 1 MB of new YAML in a typical large vault. Bytes-per-file vary by op (40 for `truncation/drop`, ~110 for `post-coordination`). Obsidian's YAML parser is lenient; vaults shared with non-Obsidian tools (static site generators, wikis, Pandoc-based pipelines) may produce warnings on unknown YAML keys but usually don't break.

**Git diff churn**. Every file move/rename/forward-sync writes frontmatter. A vault-wide re-sync touches every file matched by a rule = thousands of "modified" entries in `git diff`. Mitigation strategies:

- **Batching**: a single sync command updates many files in one transaction, reducing per-commit churn (but not total volume)
- **Smudge filters / `.gitattributes`**: strip FTSync frontmatter on commit, restore on checkout — preserves the user's vault working state without polluting history
- **Schema versioning** to detect when a vault-wide re-sync is or isn't needed
- **Opt-in per-rule** so users only pay the churn cost on rules they care about

**Shareability**. Frontmatter exposes folder structure to anyone reading the YAML. If a user shares notes from `Entity/Cybersader/Projects/auth-rewrite/` to a public blog, the frontmatter `_ftsync_origin: "Entity/Cybersader/Projects/auth-rewrite"` broadcasts that organizational structure. Mitigations:

- **Opt-in default**: frontmatter only written when explicitly enabled per rule
- **Strip-on-export**: a separate command or filter that removes FTSync frontmatter before export
- **Hashed paths**: store an opaque hash instead of the literal path, with a separate lookup table in plugin data — preserves recovery without exposing structure
- **Placeholder anchors**: store a stable identifier (e.g., a folder UUID) instead of the path itself

**Two-class cognitive load**. Already named in section 6 — files have or don't have frontmatter origin; inverse behavior differs.

**Obsidian portability**. Other tools (Dataview, Templater, third-party renderers) may not tolerate unknown YAML keys gracefully. The proposal would need to coordinate with the Obsidian convention "use a namespaced object key for plugin-specific frontmatter" — e.g., a top-level `ftsync:` object containing all FTSync fields rather than scattered `_ftsync_origin`, `_ftsync_rule`, etc. The namespace approach also makes strip-on-export easier (delete one key).

## Setup-process design

The user explicitly asked: if this is possible, can it be a setting and part of the setup process? The agents' design recommendation:

**Granularity** — per-rule flag with optional vault-level override. Each rule gets a `frontmatterMemory: { enabled: bool, fields: [...] }` config. Users can also set a vault-level "force enable for all rules" or "force disable" at `SettingsTab` level for global control.

**Default** — opt-in (default off). Users who don't actively want this don't gain frontmatter pollution. New rule creation defaults to disabled; users who want bidirectional recovery on a lossy op explicitly enable it in the rule editor.

**Migration** — when a user enables the feature on an existing rule, offer a one-time backfill: "Sweep all files that match this rule and write frontmatter origin from the current file location? [Yes / Skip]." Files where the current location doesn't match the rule (drift cases) are reported as a separate list — the user decides what to do with them.

**Settings UX**:
- **Per-rule**: toggle in `RuleEditorModal.ts` and `GuidedRuleEditorModal.ts` with brief explainer; warning callout when enabled on a non-lossy op (the feature provides no benefit for `identity`/`truncation-drop`)
- **Vault-level**: `SettingsTab.ts` gets a "Frontmatter memory" section with global enable/disable, schema version display, and the strip-on-export command

**Field naming** — the recommendation is a top-level `ftsync` object key for namespacing, with stable nested fields:

```yaml
ftsync:
  schema: 1                         # for invalidating stale frontmatter
  origin: "Capture/Inbox/2026/Q2"   # the recovered folder path (no filename)
  rule: "inbox-marker"              # which rule wrote this
  synced_at: "2026-04-27T18:30:00Z" # for cross-vault conflict detection
```

Single namespaced object beats scattered `_ftsync_*` keys: easier to strip, easier to validate, simpler for other plugins to ignore.

## Recommendation

Per the user's redirect (honest both-sides assessment, opt-in shipping):

**Adopt** for lossy ops where bidirectional recovery genuinely matters: `marker-only`, `truncation/aggregate`, `truncation/flatten`, `promotion-to-root`, `flattening-to-leaf`, `aggregation`. These five ops produce information loss that frontmatter memory can recover, and they're the use cases users most want to be bidirectional in practice.

**Skip** for already-bijective ops: `identity` and `truncation/drop`. The defensive use case (transform-pipeline irreversibility) doesn't justify default storage; users who want belt-and-suspenders insurance can enable per-rule.

**Defer** for `post-coordination`. The two-class problem plus the asymmetric-inverse problem (removing one of N tags) is genuinely hard. Wait until a real bidirectional-faceted-tagging use case emerges before designing the resolution.

**Behind an opt-in flag per-rule, default off, with optional vault-level override**. Users who don't ask for this don't pay the storage / git-churn / portability costs. Users who do ask for it consciously enable it on lossy rules and accept the philosophy shift.

**Strip-on-export as Phase 4 polish**. Make the option available but not required. Some users will want frontmatter visible (collaboration, debugging); others won't (publishing, sharing).

**Honest acknowledgment in docs**: this is a philosophy shift from stateless-engine to per-file-stateful. Users authoring lossy rules should consciously decide whether they want recovery or not — not have it imposed on them by defaults. The bijection-and-loss bridge page will eventually gain a "conditional bijection via per-file memory" section explaining the two-class model.

## Implementation surface — file-by-file

If this lands, the change set touches the following files (cross-referenced from the codebase mapping in section 3):

- **`src/types/settings.ts`** — add `frontmatterMemory?: FrontmatterMemoryConfig` to `RuleOptions`. New type `FrontmatterMemoryConfig = { enabled: boolean; fields?: ('origin' | 'rule' | 'syncedAt')[] }`.
- **`src/types/typed.ts`** — surface the field on `TypedRuleSpec` for derivation; add doc comments explaining the relationship to `cardinality` and `bijective`.
- **`src/sync/FolderToTagSync.ts:236-257`** — extend `updateTags` (or wrap with a new helper) to also write the `ftsync` namespace object alongside tags. Touch `parseFrontmatter` and the regex-based YAML reconstruction for compatibility.
- **`src/sync/TagToFolderSync.ts:154-195`** — read frontmatter origin before line 206's `applyRuleInverse` call; if present and rule's `frontmatterMemory.enabled === true`, return stored folder path. Otherwise fall through to current logic.
- **`src/engine/applyTransfer.ts`** — no change; frontmatter handling sits above this layer.
- **`src/engine/rulePackLoader.ts`** — validate the new `frontmatterMemory` config field; default to `{ enabled: false }` if missing.
- **`src/ui/RuleEditorModal.ts`, `src/ui/GuidedRuleEditorModal.ts`** — add toggle for the new option; explainer callout; warning when enabled on non-lossy op.
- **`src/ui/SettingsTab.ts`** — vault-level enable/disable; schema version display; strip-on-export command (deferred).
- **Tests**: new `frontmatterMemory.test.ts` covering round-trip per op (especially the five fully-recoverable ops) plus the two-class behavior for `marker-only`.
- **Migration command**: `Folder Tag Sync: Backfill frontmatter origin for rule X` — sweeps the vault, writes origin where current location matches rule, reports drift cases.

Estimated scope: ~200 LOC production + ~50 LOC tests. Comparable to the specificity-and-groups recommendation in size.

## Open questions

The design space has resolved enough to make a recommendation, but several details remain genuinely unsettled:

- **Field naming**: top-level `ftsync` namespace (recommended above) vs. scattered `_ftsync_*` keys vs. nested `folder-tag-sync:`. The namespace approach is cleanest but conflicts with Obsidian's convention of underscore-prefix for "internal" frontmatter. Worth a small RFC before any implementation.
- **Schema versioning**: how does the engine react when frontmatter schema diverges from current code? Re-sync? Warn? Ignore? The recommendation: warn + offer re-sync, but the trigger is unclear.
- **Migration sweep edge cases**: how should the backfill command handle files where the current folder doesn't match the rule (drift)? Silently skip, report as warnings, force-include (and write whatever the current location says)? Probably reportable as a separate list, but the UX hasn't been designed.
- **Strip-on-export tooling**: is this a separate command (user runs before publishing), a plugin filter (live), or a `.gitattributes`-style declarative config (transparent on commit)? Each has tradeoffs in user surprise vs. user control.
- **Cross-vault sync conflict resolution**: when two FTSync installs disagree on what frontmatter says, how does the engine decide which is current? Timestamps? Hash comparison? User prompt? Probably timestamps with conflict-prompt fallback, but not designed.
- **Composition with Phase 2.5 specificity-aware matching**: when a tag matches multiple rules under the new specificity engine, which rule's frontmatter origin gets read? Probably the highest-specificity rule, but requires care because the rule that *wrote* the frontmatter may not be the rule that *would currently match* the tag (if rules have changed). Worth pinning before both features land.

These are not blockers; they're follow-up decisions before implementation.

## Order of operations (if/when this lands)

A recommended phasing if the feature gets prioritized:

1. **Pick field naming + schema versioning** — small RFC, lock in the wire format.
2. **Add `frontmatterMemory` config to types + loader validation** — pure type/config addition, no behavior change.
3. **Implement write side** (`FolderToTagSync` extension) — behind feature flag, default off. Tests for write correctness.
4. **Implement read side** (`TagToFolderSync` extension) — read frontmatter origin before falling through to `applyRuleInverse`. Tests for round-trip per op.
5. **Settings UI** (per-rule toggle + vault-level override + explainer copy).
6. **Migration sweep command** (backfill on opt-in, drift reporting).
7. **Tests + concept-page documentation** — add the "conditional bijection" section to bijection-and-loss.md; cross-link.
8. **Strip-on-export polish** (Phase 4) — separate command initially; declarative config later if requested.

Phase 1–4 lands the core feature behind a flag; Phase 5–6 makes it user-accessible; Phase 7–8 makes it doc-complete and polished.

## Related concepts

- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge page; will eventually gain a conditional-bijection section once this feature lands
- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives this feature operates per-op against
- [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — forward-direction abstraction question; complementary to this entry's inverse-direction recovery focus
- [Path abstractions, part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — concrete code, hybrid coexistence; informs the three-layer composition picture in section 8 above
- [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — six-candidate survey of inverse-direction resolution; this entry's frontmatter-memory proposal is a seventh option that composes with B+C rather than replacing them
- [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) — Phase 2.5 plan; frontmatter memory composes with specificity-aware matching but creates the open-question listed in section 13 (which rule's origin gets read when multiple rules match)
- [Solution brainstorm](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) — meta-shape framing; the SEACOW context-as-disambiguator idea naturally fits as a use case for frontmatter origin
- [Challenge 04 — Name collisions across hierarchy](/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/) — the same-name-different-depth problem; frontmatter memory directly resolves it for forward-synced files
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
- [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — typed-model layers
