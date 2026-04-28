---
title: Roadmap
description: Planned features and enhancements
sidebar:
  order: 1
---


This document tracks planned features, UI improvements, and enhancement ideas for the Dynamic Tags & Folders plugin.

This roadmap is the **feature inventory**. The companion [development plan](/obsidian-folder-tag-sync/about/development-plan/) is the *path through* the inventory — UX-first sequencing, with per-increment user-testing checkpoints, organized so the plugin remains a **progressive system**: easy to start (sensible defaults; rule packs work day one without regex literacy), powerful as you align it to your workflow (templates, slot transforms, frontmatter memory, group precedence, per-rule status indicators surface for users who want them).

Each increment in the development plan is independently shippable, validated against the test vault before promotion, and accompanied by docs / positioning updates so the framing stays honest about what the plugin currently does.

## Immediate UI Improvements

### 1. Conditional Form Fields Based on Direction

**Problem**: Rule editor currently shows all options regardless of sync direction, which can be confusing.

**Solution**: Show/hide options based on selected direction:

#### Folder-to-Tag Direction
**Show:**
- Folder pattern & entry point
- Folder transformations
- Tag entry point
- Tag transformations
- `addTags` option
- `removeOrphanedTags` option ✅ (only relevant here!)
- `syncOnFileCreate`, `syncOnFileMove`, `syncOnFileRename`
- `keepRelationTags` option

**Hide:**
- `createFolders` option (N/A - folders already exist)
- Folder conflict resolution (folder is the source)

#### Tag-to-Folder Direction
**Show:**
- Tag pattern & entry point
- Tag transformations
- Folder entry point
- Folder transformations
- `createFolders` option
- `syncOnFileCreate`, `syncOnFileMove`, `syncOnFileRename`
- `moveAttachments` option
- `handleFolderNote` option
- `onConflict` dropdown
- `removeSourceTag` option (remove the tag after moving)
- `keepDestinationTag` option

**Hide:**
- `removeOrphanedTags` option (N/A - tags are the source)

#### Bidirectional
**Show:**
- All options (both directions active)
- Clear indication of which options apply to which direction
- Could use tabs or sections: "Folder → Tag Options" and "Tag → Folder Options"

**Implementation Priority**: High (improves UX significantly)

---

### 2. Field Validation & Helpful Hints

**Features:**
- Real-time validation of regex patterns
- Preview of how transformations will work
- Tooltips explaining each option
- Warning icons for potentially conflicting settings
- Examples in placeholder text

**Implementation Priority**: Medium

---

### 3. Rule Testing/Preview

**Features:**
- "Test Rule" button in rule editor
- Shows how rule would process sample files/tags
- Displays transformation steps
- Highlights potential conflicts
- Dry-run mode before actually moving files

**Implementation Priority**: High

---

## New Features

### 1. Default Rule Packs (High Priority)

**Inspiration**: Tasks plugin's preset task formats

**Features:**
- Library of pre-made rule packs for common workflows:
  - **SEACOW(r) Framework** (Capture/Output/Work/Entity/System)
  - **PARA** (Projects/Areas/Resources/Archives)
  - **Zettelkasten** (Inbox/Permanent/Literature/Fleeting)
  - **JD (Johnny Decimal)** (Numeric hierarchies)
  - **Simple Flat to Nested** (Convert flat tags to nested folders)
  - **Emoji-based Organization**
- UI to browse and preview rule packs
- **Confirmation dialog** before importing: "This will add [N] rules to your configuration. Continue?"
- Option to import all rules or select specific ones
- Each pack includes:
  - Name & description
  - Author
  - Version
  - List of rules with explanations
  - Usage notes

**UI Components Needed:**
- "Browse Rule Packs" button in settings
- Modal showing available packs
- Pack details view with preview
- Import confirmation dialog
- Success/error notifications

**File Structure:**
```
rule-packs/
├── seacow-cyberbase.json
├── para-method.json
├── zettelkasten.json
├── johnny-decimal.json
└── README.md (explains pack format)
```

**Implementation Priority**: High

---

### 2. Rule Pack Export/Share

**Features:**
- Export current rules as a rule pack
- Add metadata (name, description, author)
- Share as JSON file
- Community-contributed rule packs repository
- In-app rule pack marketplace/browser

**Implementation Priority**: Medium

---

### 3. Bulk Rule Operations

**Features:**
- Select multiple rules
- Enable/disable in bulk
- Change priority in bulk
- Duplicate rules
- Apply transformations to multiple rules
- Export selected rules

**Implementation Priority**: Low

---

### 4. Rule Groups/Folders

**Features:**
- Organize rules into collapsible groups
- E.g., "SEACOW Rules", "Project Rules", "Archive Rules"
- Drag-and-drop between groups
- Enable/disable entire groups
- Group-level settings that cascade to rules

**Implementation Priority**: Medium

---

### 5. Visual Rule Builder

**Features:**
- Flowchart-style rule creation
- Drag-and-drop components
- Visual pattern matcher
- Live preview of transformations
- Simpler for non-technical users

**Implementation Priority**: Low

---

### 6. Advanced Conflict Resolution

**Features:**
- Custom conflict resolution strategies per rule
- "Always prefer tag X over Y"
- "Merge into multi-folder structure" (using links/aliases)
- "Create disambiguation note"
- Log conflicts for manual review

**Implementation Priority**: Medium

---

### 7. Sync History & Undo

**Features:**
- Track all sync operations
- View history of moves/tag changes
- Undo last sync operation
- Rollback to previous state
- Export sync log

**Implementation Priority**: Medium

---

### 8. Rule Analytics

**Features:**
- Show how many files each rule affects
- Most/least used rules
- Rules with errors or conflicts
- Performance metrics (rule execution time)
- Suggestions for rule optimization

**Implementation Priority**: Low

---

### 9. Template Integration

**Features:**
- API for Templater/QuickAdd
- Helper functions: `getTargetFolder(tags)`, `getTargetTags(folder)`
- Auto-suggest tags based on folder
- Auto-suggest folder based on tags
- Integration with new note creation workflow

**Implementation Priority**: High (mentioned in original requirements)

---

### 10. Batch Processing

**Features:**
- "Apply rules to existing vault" command
- Select scope: entire vault, folder, or tag query
- Show preview of changes before applying
- Progress bar with cancel option
- Summary report after completion

**Implementation Priority**: High

---

### 11. Smart Suggestions

**Features:**
- AI/pattern-based rule suggestions
- "You have many files in folder X with tag Y - create a rule?"
- Detect common patterns in vault
- Suggest rule refinements
- Auto-complete for patterns based on vault structure

**Implementation Priority**: Low

---

### 12. Multi-Vault Support

**Features:**
- Different rule sets per vault
- Import/export vault-specific configs
- Global rules vs. vault-specific rules
- Sync rules across vaults

**Implementation Priority**: Low

---

### 13. Resolution-Engine Improvements — match confidence + rule-group precedence

**Problem**: Today's `findBestMatch` (`src/engine/ruleMatcher.ts:97-117`) sorts matches by `priority` then by `confidence` (specificity tiebreak). The `calculateMatchConfidence` heuristic at `ruleMatcher.ts:156-185` produces a 0..1 score from a regex pattern — but it has known weaknesses:

- Doesn't penalize alternation (`(foo|bar|baz|...)` scores high on length but is *less* specific than a literal segment).
- Anchor awareness is implicit — two patterns differing only in `^foo` vs `(?:^|/)foo` vs `^prefix/foo` score similarly under the current formula despite wildly different actual specificity.
- Slot-count proxy is missing — when path templates land (Phase H), slot count *is* specificity in a clean way, but today's regex-shape heuristic can't see slots.
- Tied scores are common — high tie rate means priority still ends up doing real disambiguation work the heuristic should do.

Also: `findBestMatch` doesn't have a rule-group concept, so multiple third-party rule packs (PARA + JD + SEACOW) can silently collide on the same input.

**Solution** (researched in detail at [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/)): two combined improvements.

1. **Refine the specificity heuristic.** Promote `calculateMatchConfidence` from tiebreak to primary sort key. Add anchor-awareness (root / under / any-segment bonuses), slot-count handling for future template rules, and refined wildcard/alternation penalties (Formula 3 in the research entry).
2. **Add rule groups (CSS @layer-style).** New optional `group?: string` field on `MappingRule`. Group precedence is configurable per-vault (default derived from SEACOW axes when groups declare axes). The combined algorithm: group precedence wins outright; within a group, specificity sort; priority becomes the manual override tiebreak.

**File-by-file scope** (~150 LOC of production code, ~30 LOC of tests):

- `src/engine/ruleMatcher.ts` — refine `calculateMatchConfidence`, swap sort key in `findBestMatch`, add group-by-precedence layer
- `src/types/settings.ts` — add `group?: string` to `MappingRule`
- `src/types/typed.ts` — add group field to `TypedRuleSpec`
- `src/engine/rulePackLoader.ts` — validate group field; default group from pack ID if missing
- `src/ui/SettingsTab.ts` — drag-to-reorder list of declared groups
- `src/ui/RuleEditorModal.ts`, `src/ui/GuidedRuleEditorModal.ts` — group dropdown; rename "Priority" to "Priority (override)"
- `rule-packs/*.json` — backfill `group` field on PARA/JD/SEACOW packs

**Recommended phasing**: refine `calculateMatchConfidence` first (pure refactor, no behavior change), audit shipped packs to compare new vs old implied ordering, then swap the sort order. Add the group field as a separate phase.

**Implementation Priority**: High — addresses Challenge 01 (rule priority stress test) and Challenge 04 (name collisions across hierarchy) directly.

**Note on item #4 above**: the existing "Rule Groups/Folders" feature (line 159) is a *UI organization* feature — collapsible groups in the rule list for visual structure. It's distinct from the *resolution-engine groups* described here, which are layered partitions in the matching algorithm. Same word, different concepts; both can coexist (resolution-engine groups can drive the UI organization, but they don't have to be the same boundary).

---

### 14. Frontmatter as Bijection Memory — opt-in per-file recovery for lossy ops

**Problem**: Today the engine is *stateless* per-file. It computes tags from rules + folder paths, and computes folders from rules + tag names. Each file is processed independently. When a transfer op is lossy (`marker-only`, `truncation/aggregate`, `truncation/flatten`, `promotion-to-root`, `flattening-to-leaf`, `aggregation`), the inverse direction can only fall back to "the rule's entry folder + best guess" because the forward direction threw information away.

**Theory** (researched in detail at [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/)): if a forward sync writes the origin folder path to the file's frontmatter, the inverse direction can read it and reconstruct the *exact* source folder for that specific file — making lossy ops bijective on a per-file basis even though they remain lossy per-rule.

**Trade-off** (the philosophy shift): the engine becomes *per-file stateful* rather than purely a function of rules + folder structure. This is honest but introduces:

- Frontmatter pollution (~80 bytes per synced file × vault size)
- Git diff churn (every sync writes frontmatter)
- Shareability concerns (frontmatter exposes folder structure)
- A two-class problem: forward-synced files have origin metadata (bijective inverse); manually-tagged files don't (fall-back-to-entry inverse)

**Recommended design**: opt-in per-rule flag with vault-level override. Default off. Top-level namespaced `ftsync:` object in frontmatter (`ftsync.origin`, `ftsync.rule`, `ftsync.schema`). Migration command sweeps existing files and backfills origin from current location on opt-in. Strip-on-export support as Phase 4 polish.

**Per-op coverage**:

- ✅ **Fully recoverable with frontmatter memory**: `marker-only`, `truncation/aggregate`, `truncation/flatten`, `promotion-to-root`, `flattening-to-leaf`, `aggregation`
- ⚠️ **Partially recoverable** (two-class or asymmetric inverse): `marker-only` (manual-tag class), `post-coordination`
- 🔵 **Skip** (already bijective): `identity`, `truncation/drop`

**File-by-file scope** (~200 LOC of production code, ~50 LOC of tests):

- `src/types/settings.ts` — add `frontmatterMemory?: FrontmatterMemoryConfig` to `RuleOptions`
- `src/types/typed.ts` — surface field on `TypedRuleSpec`
- `src/sync/FolderToTagSync.ts` — extend `updateTags` (lines 236–257) to write origin
- `src/sync/TagToFolderSync.ts` — read origin before line 206's `applyRuleInverse` call
- `src/engine/rulePackLoader.ts` — validate the new config field
- `src/ui/RuleEditorModal.ts`, `src/ui/GuidedRuleEditorModal.ts` — per-rule toggle + explainer
- `src/ui/SettingsTab.ts` — vault-level override
- New: migration backfill command + `frontmatterMemory.test.ts`

**Recommended phasing**: pick field naming + schema versioning first (small RFC), then types/loader, then write side (behind flag), then read side, then settings UI, then migration sweep, then docs (concept-page extension on bijection-and-loss).

**Implementation Priority**: Medium — wait for explicit user demand for bidirectional recovery on lossy ops. Useful for users who actively want round-trip behavior; pure overhead for users who don't.

**Related**: addresses the inverse-direction case from [Challenge 04](/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/) for forward-synced files; composes orthogonally with Phase 2.5 specificity-aware matching and Phase H path templates (the three layers — rule design / per-file recovery / new-file behavior — are independent and complementary).

---

### 15. Frontmatter-property-driven destination resolution (future)

**Problem**: today (and after Phase 2.5), the inverse direction (tag → folder) decides destination using a combination of (a) which rule's pattern matches the tag, (b) the rule's specificity score and group precedence, (c) priority as the manual override tiebreak, and — once Increment 3 ships — (d) the file's `fts.origin` frontmatter witness.

But none of these account for **other frontmatter properties on the file**. A user with `entity: cybersader` vs `entity: bob`, `priority: high` vs `priority: low`, or `status: active` vs `status: archived` might want the same tag to route the file to *different folders depending on those properties*.

**Theory**: extend the rule pack with optional "frontmatter conditions" that influence destination selection. A rule could say:

```json
{
  "id": "projects-by-owner",
  "tagPattern": "^projects/(.+)$",
  "folderTemplate": "Entity/{entity}/Projects/{slug}",
  "frontmatterConditions": {
    "entity": { "required": true, "fromProperty": "entity" }
  }
}
```

When the user adds `#projects/web-auth` to a file with `entity: cybersader` in frontmatter, the inverse direction uses the property to populate `{entity}` → file moves to `Entity/Cybersader/Projects/Web Auth/`.

**This is more sophisticated than the current model**:

- **Today**: tag pattern + rule specificity decide destination
- **With frontmatter witness (Increment 3)**: + per-file origin can recover exact previous location for forward-synced files
- **With frontmatter-property conditions (this item)**: + arbitrary frontmatter properties influence destination on a per-file basis, including for files that have never been forward-synced

**Composes with multiple in-flight pieces**:

- **Templates (Phase H)**: the natural carrier — a slot in the template can be filled from a frontmatter property rather than from the tag itself
- **Specificity-aware matching (Phase 2.5)**: rules with frontmatter conditions could rank higher in confidence if their conditions are satisfied (and lower if they conflict)
- **SEACOW axes**: the natural use case is dispatching by axis values stored in frontmatter (e.g., `entity: <value>`, `system: <value>`)
- **Conflict resolution UI** (Phase 3): when frontmatter conditions are partially satisfied, the modal can surface "would you like to set entity to X to use rule Y?"

**Implementation Priority**: Future (Phase 4+). Wait for path templates (Phase H, Increment 2) to land first — frontmatter conditions are most natural as slot-population sources, which means they need slots to populate. Also benefits from the typed model maturing further so the user authoring surface stays simple.

**Open questions**:

- Schema: new `frontmatterConditions` field per rule, or extend the existing slot-resolution syntax (e.g., `{entity:fromProperty}`)?
- Behavior when the property is missing on a file (no `entity:` set): fall back to non-conditional rule? Use a default? Refuse to match?
- Property normalization: case-sensitive match on property values? Prefix-match? Regex?
- Composition with templates' filter syntax: does `{entity | kebab}` apply when `entity` is sourced from frontmatter rather than the tag?
- UX: how does the rule editor expose "this rule reads from frontmatter"? Per-slot toggle? Separate section?

**Note**: this is a *generalization* of the SEACOW context-as-disambiguator idea from the [solution brainstorm](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) — it makes context-aware destination resolution a first-class part of the rule format rather than a special case. Worth its own research challenge before implementation.

---

## Implementation tracks — Foundation, Application, Polish

The previous "Phase 1 / 2 / 3 / 4" framing buried foundational architecture work as polish. The restructure below separates the **load-bearing architectural primitives** (Foundation track — what FTSync *is*) from **UX surfaces built on top** (Application track) from **long-tail nice-to-haves** (Polish track).

**Some Foundation pieces ship in parallel with each other and with Application work where dependencies allow.** This isn't a strict pipeline. Each item explicitly names its `depends on` and what it `unlocks`.

### Phase 1: Core Functionality (Current — legacy reference)
- ✅ Transformation engine
- ✅ Rule matching
- ✅ UI components (basic)
- ⏳ Folder-to-tag sync engine
- ⏳ Tag-to-folder sync engine

## How to read this section

Three tracks, **not** a strict pipeline. The Foundation track is sequential by dependency; pieces within Application and Polish run in parallel with each other and with Foundation work where dependencies allow. Each item names its own dependencies and what it unlocks downstream.

### Foundation already shipped (history, not roadmap)

- **Phase 1** — Core Functionality: transformation engine, rule matching, basic UI, folder→tag and tag→folder sync, manual sync commands ✅
- **Phase 2** — Typed model + rule packs: `FolderClassifier` + `TagVocabulary` + `TransferOp`, eight transfer-op primitives, vault-scan organizational-system detection, four shipped rule packs (PARA, JD, SEACOW-cyberbase, Zettelkasten) ✅
- **Phase G** — Layer-aware folder anchors (`'root'` / `'any-segment'` / `{ under: 'X' }`) ✅
- **F1 (Specificity-aware matching + rule groups) — all 3 steps** ✅: Step 1 refined `calculateMatchConfidence` (Formula 3 with anchor-aware bonuses); Step 2 swapped sort order in `findBestMatch` (confidence primary, priority tiebreak override); Step 3 added optional `group?: string` field on `MappingRule` + cross-pack `groupPrecedence` partition + drag-to-reorder UI + "Priority (override)" relabel.
- **F2 (Path Lens templates) — commit 1 (compiler + runtime + loader + UI mode toggle)** ✅: pure compiler in `src/engine/compileTemplate.ts` with Tier A operators (`{name}`, `{name...}`, `{name | filter}`); per-transform reversibility metadata in `src/transformers/transformMetadata.ts`; runtime in `src/engine/applyTemplate.ts` with forward + inverse using `applyFilterChain` / `applyFilterChainInverse`; engine dispatch via `isTemplateRule` in `applyTransfer.ts`; loader Path C in `rulePackLoader.ts`; rule-editor mode toggle (Template/Regex) with bijectivity status chip; demo pack `rule-packs/templates-demo.json`. F3 (Frontmatter witness) plug-in seam documented in [bijectivity detection · Per-rule vs per-instance bijectivity](/obsidian-folder-tag-sync/concepts/bijectivity-detection/#per-rule-vs-per-instance-bijectivity--the-f3-plug-in-seam).

The shipped foundation is what FTSync is *today*. The Foundation track below continues that lineage; these are the architectural primitives the user is researching and authoring rules against.

---

## Foundation track (next)

These are the **load-bearing architectural primitives**. They're what FTSync is becoming, not features sitting on top. The user has been researching them because they affect the foundations of how rules are authored, evaluated, and stored.

Sequence is mostly determined by dependencies (each item's "depends on" line). Some pieces can ship in parallel; that's noted explicitly.

### F1 — Specificity-aware matching + rule groups

- **What the user experiences**: rules just work better. A user with overlapping rules (`^Projects/(.+)$` and `^Projects/Web/(.+)$`) finds that the more-specific one fires without manually swapping priority numbers. Imported rule packs (PARA + JD + SEACOW) coexist without silent collision. The "Priority" field gets relabeled "Priority (override)" with a tooltip explaining when it actually matters.
- **Status**: ✅ All 3 steps shipped (resolves Challenge 01 stress case + cross-pack precedence).
- **Depends on**: nothing.
- **Unlocks**: ergonomic ordering for cross-pack composability; provides the natural specificity score for F2 (slot count = specificity once templates land).
- **Step 3 — `group` field + cross-pack precedence**: optional `group?: string` on `MappingRule`; default group derived from pack ID; vault-level group-precedence config (drag-to-reorder); rename "Priority" → "Priority (override)" in rule editors.
- **Can run in parallel with**: any other foundation item; A1 / A3 in Application track.

### F2 — Bidirectional path templates

- **What the user experiences**: the rule editor gets a top-of-pane mode toggle: **"Template" / "Regex"**. Template mode shows a single-line input with named slots (`Projects/{slug}` ↔ `#projects/{slug}`); the user authors without regex literacy. Regex mode is the existing surface, unchanged. New rules default to Template mode; existing regex rules keep working as-is. Each rule shows a per-rule status chip — *"This rule round-trips"* (green) or *"Lossy forward — `{owner}` is matched but discarded"* (orange) — explaining what's reversible. The README + docs reposition at this milestone: "regex" stops being the headline; templates become the default authoring surface.
- **Status**: ✅ **Commit 1 shipped — this IS the F2 MVP.** Compiler + runtime (forward + inverse) + loader Path C + UI mode toggle + demo pack `templates-demo.json` (6 rules covering identity / kebab-filter / glob / marker-only / emoji-prefixed / JD+emoji). Commits 2 + 3 demoted to **post-MVP polish** — see "MVP boundary" subsection below.
- **Depends on**: F1 ideally (so slot count can be the natural specificity score when templates land), but not strictly — templates can ship before F1 Step 3 if needed.
- **Unlocks**: per-slot transforms; bijection visibility from slot overlap; the natural carrier for F4 property-driven destination; deeper specificity heuristic that replaces regex-shape scoring.
- **Scope (commit 1, shipped)**: new `PathTemplate` type, Tier A slot syntax (`{name}` / `{name...}` / `{name | filter}`), pure compiler in `src/engine/compileTemplate.ts`, runtime in `src/engine/applyTemplate.ts`, loader Path C in `rulePackLoader.ts`, rule-editor template-mode toggle, per-rule status chip.
- **Can run in parallel with**: F3 (frontmatter witness — different layer, no shared code paths).

#### MVP boundary (decided 2026-04-28)

The F2 commit 1 ship IS the MVP. The user is going to test this with real vaults; backtrack-and-rework remains an option if the slot syntax / filter set turns out wrong. To preserve flexibility, the following are explicitly **deferred to post-MVP** and not blocking:

- **F2 commit 2 (lens-flavored shape — `iso` / `cardinality` annotations)** — variant authoring shape on top of the same compiler. Adds explicit user assertions about bijection. Decision-gated on Q2–Q4 (slot syntax detail, slot vocabulary, hybrid coexistence depth). Demoted to **Polish** track.
- **F2 commit 3 (slot-objects shape — JSON-flavored editor)** — third variant authoring shape; same engine, different editor surface. Demoted to **Polish** track.
- **Per-slot transformation expansion** — current filter set covers the common cases (identity, kebab-case, snake_case, Title Case, strip-emoji, strip-num-prefix, join). Adding more filters is incremental; not MVP-blocking.

If real-world testing surfaces friction with the Tier A slot syntax (`{name}` / `{name...}`) or with the filter semantics, the MVP can be backtracked: it's a single commit-set (commits 1a–1d) and the rule shape is opt-in (existing regex rules continue to work). Backtracking would mean either tightening Tier A or adding a Tier B slot operator (see development plan).

### F3 — Hybrid frontmatter witness

- **What the user experiences**: a new toggle in the rule editor — *"Remember origin in frontmatter for bidirectional recovery"*. Off by default; opt-in per rule. When enabled on a lossy rule (`marker-only`, `truncation/aggregate`, etc.), files synced via that rule gain a small `fts:` block in their YAML. The inverse direction then reads it and moves files back to their *exact* origin instead of falling back to the rule's entry folder. A migration command surfaces: *"Backfill origin metadata for existing tagged files? [Yes / Skip]"*. Users who don't enable it see no YAML change; users who do get exact-recovery on lossy ops.
- **Status**: **Post-MVP** (decided 2026-04-28). The plug-in seam is in place in F2 commit 1 (`src/engine/applyTemplate.ts` documents the future `ctx?: { storedSlots? }` parameter). Research + validation complete (Challenge 07). Implementation gated on the 6 decision-gate questions in [development plan](/obsidian-folder-tag-sync/about/development-plan/) — these are user-input questions (namespace shape, schema, backfill behavior, etc.) not blocked on additional research. **MVP without F3**: bijective + conditional template rules round-trip cleanly (sufficient for identity-style rule packs like PARA-templated). Lossy template rules (marker-only) work forward, but inverse falls back to entry folder rather than recovering exact origin.
- **Depends on**: nothing strictly. Can ship before, alongside, or after F2.
- **Unlocks**: per-file bijection recovery for lossy ops; resolves the inverse-direction underspecification problem (Challenge 04); orphan-vs-relation-tag distinction (Challenge 08).
- **Three sub-phases**: 3a passive witness (write-only, behind feature flag); 3b active disambiguator (read on inverse direction); 3c safety nets (drift detection, vault-rename safeguard, stale-rule cleanup).
- **Scope**: optional `frontmatterMemory?` config field on `RuleOptions`; `fts:` namespaced object in YAML (sig + rule + pv); reconstructible cache at `.obsidian/plugins/folder-tag-sync/cache.json`; settings UI per-rule toggle + vault-level override; migration backfill command.
- **Can run in parallel with**: F2 (different layer); A1 (conflict UI benefits from witness for showing recovery candidates but doesn't depend on it).

### F4 — Frontmatter-property-driven destination resolution

- **What the user experiences**: a rule's template can pull slot values from the file's frontmatter properties (`{entity}` ← frontmatter `entity:` field). Same tag `#projects/web-auth` routes to `Entity/Cybersader/Projects/Web Auth/` for files with `entity: cybersader` and `Entity/Bob/Projects/Web Auth/` for files with `entity: bob` — without authoring two separate rules. The rule editor exposes "this slot reads from frontmatter property X." When the property is missing on a file, a configurable fallback applies (default folder, prompt, or refuse).
- **Status**: future research — needs its own challenge dispatch + research entry before scope is settled.
- **Depends on**: F2 (templates). Slots are the natural carrier for property-sourced values (`{entity}` filled from frontmatter `entity:`).
- **Unlocks**: SEACOW context-as-disambiguator becomes a first-class part of the rule format; per-file destination influenced by arbitrary frontmatter properties beyond the rule pattern.
- **Scope**: extends rule schema with `frontmatterConditions` (or extends slot syntax with property-source markers); inverse-direction algorithm reads property values when populating slots; UX surface in rule editor for declaring property dependencies.
- **Sequencing**: probably ships *after* F2 but *before* extensive A2 plugin API work (since the API has to commit to whether `getFolderForTag(tag, file)` reads frontmatter properties).

### A6 — Implement `removeOrphanedTags` (gap; flag exists in data model but unwired)

- **What the user experiences today (the gap)**: the `removeOrphanedTags` flag exists in `RuleOptions` and is settable per-rule, but the sync engine never reads it. When a file moves between folders that match the same rule with different slot captures (e.g., `0 - Tasks/X.md` → `5 - Archive/X.md`), the new tag (`#5-archive-...`) gets added but the old tag (`#0-tasks-...`) stays. Files accumulate stale tags over time.
- **What "fixed" looks like**: when `removeOrphanedTags: true`, on file change/rename: the sync engine compares (a) the set of tags currently in frontmatter, (b) the set of tags ANY enabled rule emits for the current path, and removes tags that are in (a) but not (b) AND are tags FTS originally wrote.
- **The hard part — knowing which tags FTS owns**: without bookkeeping, removal is a guessing game. If user has a manually-added tag like `#priority-high` and the rule's pattern happens to match it shape-wise, naive cleanup could delete user-authored tags. **The clean solution requires F3 (frontmatter witness)** — when FTS writes a tag, it records that fact in a `fts:owned` field in frontmatter. Cleanup then only removes tags listed in `fts:owned` that no rule still emits.
- **Status**: open gap, depends on F3. Do NOT implement before F3 lands; without the witness, any heuristic risks data loss.
- **Workaround until then**: users can manually remove stale tags after cross-area moves, OR use a separate cleanup command (post-MVP polish — could ship a "Clean orphan tags from current file" command that uses heuristics + asks confirmation).
- **Composes with A5 (ordinal slot-value priority)**: A5 builds on top of orphan-cleanup. A5 isn't possible without first having reliable orphan-cleanup via F3 witness.

### A5 — Ordinal slot-value priority + auto-orphan-cleanup on cross-area moves

- **What the user experiences**: in vaults that use numbered organizational systems (single-digit JD, two-digit JD, mixed JD-PARA), the captured slot value carries an *ordinal meaning* — lower number = higher priority / earlier in the workflow / closer to active work; higher number = archived / deeper / colder. When a file moves between numbered areas (e.g., `0 - Tasks/X` → `5 - Archive/X`, the user is implicitly *demoting* the file). The engine should recognize the cross-area move semantically and automatically clean up the now-orphaned higher-priority tag (`#0-tasks/x` removed when `#5-archive/x` is added).
- **Status**: open feature request (raised 2026-04-28 during the catch-all `{num} - {name}/{deeper...}` discussion). No research yet.
- **Depends on**: F1 (priority + group precedence — the structural framing); F2 (templates with the `{num}` slot to extract the numeric value); F3 (frontmatter witness — so the *previous* numeric slot value is recorded per-file and the engine knows what to clean up); A1 (conflict UI — surfacing the "tag to remove" decision before applying).
- **Unlocks**: ergonomic JD-PARA hybrid workflows; "promote/demote a file" becomes a meaningful action; orphan-tag cleanup becomes value-aware rather than rule-presence-based; surfaces the underlying ordinal semantics that users already mentally use.
- **Concrete example (the JD-PARA mix scenario)**:
  - User has rule `{num} - {name}/{deeper...}` ↔ `#{num}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}` covering all numbered roots
  - File at `0 - Tasks, Planning/Q4-Roadmap.md` has tag `#0-tasks-planning/q4-roadmap`
  - User moves the file to `5 - Archive, Admin/Q4-Roadmap.md`
  - Engine sees: same file, same `{name}` slot value (`Q4-Roadmap`), `{num}` changed from `0` to `5`. Recognizes cross-area move via slot-value diff.
  - Forward sync emits new tag `#5-archive-admin/q4-roadmap`. The OLD tag `#0-tasks-planning/q4-roadmap` is now orphaned because the file isn't in `0 - Tasks, Planning` anymore.
  - With `removeOrphanedTags: true` AND ordinal-priority awareness, engine knows to remove the lower-numbered tag automatically (the user "promoted to a higher number" = "archived" = "let the lower-priority tag go").
  - Without ordinal-priority awareness, the orphan cleanup is purely structural — the engine removes ANY tag that no longer matches a rule's pattern. That works for clean cross-area moves but isn't ordinal-aware (e.g., wouldn't know that promoting *up* in priority should keep the lower-priority tag).
- **Frontmatter-as-priority-source variant (can of worms — flagged for caution)**: priority could come from a frontmatter property (`status: archived` or `priority: low`) rather than a numeric slot. This composes with F4 (property-driven destination) — slot value pulled from frontmatter rather than path. Same ordinal-priority logic applies, but with arbitrary property values instead of digits. Risk: introduces a second source-of-truth for priority that can disagree with the path's numeric prefix; needs a clear precedence rule (e.g., "frontmatter wins for files that have it set; path-prefix used otherwise"). Defer until F4 is settled.
- **Scope when designed**:
  - Per-rule flag: `priorityFromSlot: '<slot-name>'` (e.g., `priorityFromSlot: 'num'`) marks which slot carries ordinal priority. Engine compares slot values to determine cross-area moves.
  - Diff detection: at sync time, compare current vs previous slot values for the same file (requires F3 frontmatter witness for the "previous" reference).
  - Cleanup policy: configurable — "always remove lower-priority orphans," "always remove any orphan," "prompt on diff," or "never auto-remove."
  - UI: status chip per rule indicates "ordinal-priority-aware" + tooltip explaining the cleanup behavior.
- **Implementation Priority**: post-MVP, after F3 lands (since this depends on the witness for tracking previous state). Genuinely complex; expect a research entry first.

### A4 — Information-flow asymmetry UX (which side preserves more info?)

- **What the user experiences**: per-rule, the editor shows a directional indicator: *"Creating from the folder side preserves more information than the tag side"* (or vice versa, or "symmetric"). Surfaces the per-instance bijectivity reality that lossy filters create. Concrete example: with `{name | strip-invalid-tag-chars | kebab-case}`, authoring `1 - Tasks, Planning/note.md` produces tag `#1-tasks-planning/note.md`. If a future user creates JUST the tag `#1-tasks-planning` (no folder yet), the inverse-created folder is `1 - tasks-planning` (no comma, no Title Case). The tag→folder direction can't recover what the original folder had.
- **Status**: open feature request (raised 2026-04-28 during 0.1.13 cross-area-move discussion). No research yet.
- **Depends on**: F2 (templates with per-slot filter chains). Composes with F3 (frontmatter witness fills the gap with per-file stored origin).
- **Unlocks**: clear authoring guidance for users — *"if you want full preservation, create folders first; tags can always recover the bijective subset."*
- **Scope**: per-rule analysis at compile time — for each slot, compute "info-flow direction" by examining filter chain reversibility. UI surface: directional arrow icon (folder→tag dominant, tag→folder dominant, or balanced) next to the bijectivity status chip. Hover tooltip: concrete example of what's preserved on which side.
- **Implementation Priority**: post-MVP polish, but small. Could ship alongside F3 since both surface per-instance reversibility.

### F5 (future research) — Slot composition operators

- **The question**: can the lens express *combining* multiple slots into one segment (folder `{a}/{b}` ↔ tag `{a}-{b}`) or *splitting* one slot across multiple segments (one folder slot → multiple tag slots)? F2 v1 explicitly excludes these because the inverse direction is structurally ambiguous (can't reliably split `a-b` back to `a/b` without explicit composition rules) and the formal vocabulary requires Boomerang-style lens-calculus composition operators.
- **Status**: out of F2 v1 scope. Filed here so it doesn't get lost; revisit if a real workflow surfaces the need.
- **Depends on**: F2 v1 stable (template + lens-flavored + slot-objects in production). Likely also depends on real-world authoring data showing users actually want this.
- **Scope when designed**: a separate research entry surveying lens composition operators (Boomerang's `;`, `|`, `*` combinators), evaluating tradeoffs, picking a v1 syntax that doesn't sacrifice readability.

### Cross-cutting foundation work (threads through F1—F4)

- **Orphan / relation-tag semantics** (Challenge 08): pin definitions for `removeOrphanedTags` and `keepRelationTags`. Bears on F3 (witness directly answers "did FTSync write this tag?") and on A1 conflict UI. Dispatch the challenge during F1 or F2; bake findings into F3.
- **Per-transform reversibility profile** (Challenge 09): per-transform bijection metadata; warning behavior on irreversible bidirectional configurations. Bears on F2 (templates' per-slot transforms) and F3 (which transforms are reversible affects whether frontmatter memory is even needed). Dispatch the challenge during F2; bake findings into F2's status-indicator copy.

---

## Application track (parallel-shippable on top of foundation)

Once the relevant foundation pieces land, these can ship in parallel — they don't depend on each other.

### A1 — Interactive conflict-resolution UI

- **Depends on**: F1 (specificity to know when matches are *genuinely* close; otherwise the engine can pick silently); benefits from F3 (witness shows "this candidate has stored origin").
- **Unlocks**: honest UX for the inverse-direction ambiguity (Challenge 04 in the genuinely-multiple-plausible-destinations case).
- **Scope**: conflict-resolution modal; per-tag remembered choices; configurable threshold (when does the modal fire vs. silently first-match).

### A2 — Plugin API for Templater / QuickAdd / Dataview

- **Depends on**: F1, F2, F3 should all be reasonably stable so the API can commit to behavior.
- **Unlocks**: external plugin ecosystem integration; programmatic access to forward + inverse functions.
- **Scope**: read-only surface (`getTagsForFolder`, `getFolderForTag`, `listRules`); eventing model; consistency contract; versioning policy. Write surface deferred until concrete demand.

### A3 — Attachment + folder-note handling on tag→folder moves

- **Depends on**: nothing strictly; can ship in parallel with foundation work.
- **Unlocks**: realistic move semantics for vaults with attachments / canvases / folder notes.
- **Scope**: per-rule policy (move-with / leave / prompt); Obsidian "Files & Links" mode dispatch; folder-note edge cases.

### A4 — Cross-device coordination + Obsidian Sync interaction

- **Depends on**: F3 (the non-commutative-write problem only matters once frontmatter memory is shipping writes).
- **Unlocks**: safe multi-device usage; idempotent writes across devices.
- **Scope**: detection of stale frontmatter; conflict resolution algorithm; mobile compatibility verification.

---

## Polish track (after foundation + application stabilize)

These are genuine "polish" items — they make the experience nicer, but they don't change what the system *is*.

- Rule pack marketplace
- Analytics (rule-usage, error tracking, performance metrics)
- Sync history + undo
- Visual rule builder
- Mobile-specific testing + optimization
- Strip-on-export tooling for frontmatter witness

---

## Legacy phase numbering (for cross-references)

The numbered phases below are kept for cross-references in research log entries that pre-date the F/A/P restructure. They map roughly:

- **Phase 1** = "Core Functionality" foundation (shipped)
- **Phase 2** = "Typed model + rule packs" foundation (shipped)
- **Phase 2.5** = F1 (specificity + groups; Steps 1-2 shipped, Step 3 ahead)
- **Phase 3** = F2 + F3 + A1 + A2 (the next major round of work)
- **Phase 4** = F4 + Polish track
- **Phase G** = layer-aware anchors (shipped within Phase 2 era)
- **Phase H** = F2 (templates)

Going forward, prefer the F/A/P labels in new docs and commit messages.

### Phase 2: UI Polish & Usability (legacy reference)
- 🎯 Conditional form fields
- 🎯 Default rule packs
- 🎯 Rule testing/preview
- Field validation
- Better error messages

### Phase 2.5: Resolution-engine refinement (legacy = F1, item #13)
- ✅ Refine `calculateMatchConfidence` (Formula 3 — anchor-aware, alternation-penalized, slot-aware)
- ✅ Audit shipped rule packs against the new formula vs. user-authored priority
- ✅ Swap sort order in `findBestMatch` — confidence becomes primary key, priority becomes tiebreak
- Add optional `group?: string` field to `MappingRule`; backfill on shipped packs (F1 Step 3)
- Group-precedence config + drag-to-reorder UI in settings (F1 Step 3 cont.)
- Rename "Priority" → "Priority (override)" in rule editors (F1 Step 3 cont.)

### Phase 3: Advanced Features (legacy = F2 + F3 + A1 + A2)
- Template integration (API) → A2
- Batch processing → A2 / vault-scan utility
- Conflict resolution strategies (interactive UI for genuinely ambiguous tag→folder cases — candidate D from the resolution research) → A1
- Rule groups (UI-organization version — item #4; distinct from resolution-engine groups in Phase 2.5) → orthogonal UI feature
- Path templates (Phase H from the regex-vs-templates research) → F2
- Frontmatter as bijection memory (item #14) — opt-in per-rule storage of origin info to make lossy ops recoverable per-file → F3

### Phase 4: Polish & Community (legacy = F4 + Polish)
- Frontmatter-property-driven destination resolution (item #15) → F4 (still foundation, not polish)
- Rule pack marketplace → Polish
- Analytics → Polish
- Sync history → Polish
- Visual rule builder → Polish

---

## UI Mockup Notes

### Conditional Fields Implementation

```typescript
// In RuleEditorModal.ts
onDirectionChange(direction: RuleDirection) {
  // Show/hide sections based on direction
  if (direction === 'folder-to-tag') {
    this.hideElement(this.createFoldersToggle);
    this.showElement(this.removeOrphanedTagsToggle);
  } else if (direction === 'tag-to-folder') {
    this.showElement(this.createFoldersToggle);
    this.hideElement(this.removeOrphanedTagsToggle);
  } else if (direction === 'bidirectional') {
    this.showElement(this.createFoldersToggle);
    this.showElement(this.removeOrphanedTagsToggle);
    // Maybe add tabs or sections
  }
}
```

### Rule Pack Import Modal

```
┌─────────────────────────────────────────┐
│  Browse Rule Packs                  [X] │
├─────────────────────────────────────────┤
│                                         │
│  Available Packs:                       │
│                                         │
│  [📦 SEACOW(r) Framework]              │
│      6 rules • Capture, Output, Work    │
│      By: Cybersader                     │
│                                         │
│  [📦 PARA Method]                       │
│      4 rules • Projects, Areas, etc.    │
│      By: Tiago Forte                    │
│                                         │
│  [📦 Zettelkasten]                      │
│      5 rules • Slip-box method          │
│      By: Community                      │
│                                         │
│  [+ Import Custom Pack from JSON]       │
│                                         │
└─────────────────────────────────────────┘
```

### Import Confirmation

```
┌─────────────────────────────────────────┐
│  Confirm Import                     [X] │
├─────────────────────────────────────────┤
│                                         │
│  You are about to import:               │
│                                         │
│  Pack: SEACOW(r) Framework              │
│  Rules: 6                               │
│                                         │
│  This will add the following rules:     │
│  • CAPTURE: Clip folder sync            │
│  • CAPTURE: Inbox flat tag              │
│  • ENTITY: Cybersader work structure    │
│  • OUTPUT: Public Taxonomy structure    │
│  • OUTPUT: Main public facing (_/)      │
│  • SYSTEM: Templates and config         │
│                                         │
│  ⚠️  Existing rules will not be        │
│     modified or replaced.               │
│                                         │
│           [Cancel]  [Import Rules]      │
│                                         │
└─────────────────────────────────────────┘
```

---

## Related Design Decisions

### Why Conditional Fields?
1. **Reduces cognitive load**: Users only see relevant options
2. **Prevents errors**: Can't configure irrelevant settings
3. **Clearer intent**: Direction-specific options make purpose obvious
4. **Better mobile UX**: Less scrolling on smaller screens

### Why Default Rule Packs?
1. **Lower barrier to entry**: New users can start quickly
2. **Educational**: Shows examples of well-structured rules
3. **Community building**: Users can share their workflows
4. **Best practices**: Curated packs embody good patterns

### Why Confirmation Dialogs for Import?
1. **Prevents accidents**: Users review before committing
2. **Shows what changes**: Transparency about modifications
3. **Allows cancellation**: User maintains control
4. **Builds trust**: Clear communication about actions

---

## Questions to Resolve

1. **Rule Pack Format**: Should we support multiple formats (JSON, YAML)?
2. **Pack Versioning**: How do we handle updates to rule packs?
3. **Pack Dependencies**: Can one pack reference/extend another?
4. **Conflict Detection**: What if imported rules conflict with existing ones?
5. **Auto-Updates**: Should packs support auto-update from repository?

---

## Technical Implementation Notes: Modular Content in Obsidian Plugins

### The Challenge
Everything ships in `main.js` - no external files. How do we handle rule packs?

### Approaches (from simplest to most complex)

#### 1. **Bundle JSON into main.js** (Recommended for Built-in Packs)
esbuild automatically bundles imported JSON files:

```typescript
// In your code
import seacowPack from './rule-packs/seacow-cyberbase.json';
import paraPack from './rule-packs/para-method.json';

const BUILT_IN_PACKS = [seacowPack, paraPack];
```

Ensure `tsconfig.json` has:
```json
{ "compilerOptions": { "resolveJsonModule": true } }
```

**Pros**: Simple, works out of box, no external dependencies
**Cons**: Built-in packs only, can't add community packs without rebuilding

#### 2. **User-imported JSON files** (For Custom Packs)
Users import JSON files from their vault:

```typescript
// Use Obsidian's Vault API
const file = this.app.vault.getAbstractFileByPath('my-pack.json');
if (file instanceof TFile) {
  const content = await this.app.vault.read(file);
  const pack = JSON.parse(content);
}
```

**Pros**: Users can add custom packs, share via files
**Cons**: User must manage files in vault

#### 3. **Fetch from URL** (For Community Marketplace)
```typescript
const response = await requestUrl({
  url: 'https://raw.githubusercontent.com/user/repo/pack.json'
});
const pack = response.json;
```

**Pros**: Dynamic community packs, auto-updates possible
**Cons**: Requires network, security concerns, URL maintenance

#### 4. **Store in plugin data.json** (Hybrid Approach)
Import once, store in settings:

```typescript
// On import
this.settings.installedPacks.push(importedPack);
await this.saveSettings();

// On load
const allPacks = [...BUILT_IN_PACKS, ...this.settings.installedPacks];
```

**Pros**: Persist user-imported packs, works offline after import
**Cons**: Settings file can grow large

### Recommended Strategy for This Plugin

1. **Phase 1**: Bundle 3-5 built-in packs directly in main.js (SEACOW, PARA, Zettelkasten, etc.)
2. **Phase 2**: Allow users to import custom packs from JSON files in their vault
3. **Phase 3** (optional): Community pack browser fetching from GitHub repo

### Obsidian Plugin Limitations to Consider

- **No external assets**: Everything must be in main.js, manifest.json, or styles.css
- **No server-side**: Plugins run client-side only
- **Sandboxed**: Limited file system access (vault only via API)
- **Mobile compatibility**: Network requests may behave differently
- **Auto-updates**: Only through new plugin releases (version bump)

### How Tasks Plugin Handles Presets

The Tasks plugin bundles "Status Collections" (presets) directly in the code. Users click a button in settings to import them into their configuration. This is the same approach we should use - bundle built-in packs, let users import to their settings.

**Sources:**
- [Obsidian Forum: Support for assets in plugins](https://forum.obsidian.md/t/support-for-assets-in-plugins/25837)
- [esbuild-plugin-obsidian](https://github.com/eth-p/esbuild-plugin-obsidian)
- [Tasks Plugin User Guide](https://publish.obsidian.md/tasks/Introduction)

---

## Community Contributions

To contribute:
1. Create a rule pack following the format in `rule-packs/README.md`
2. Test it thoroughly in your vault
3. Submit PR with pack JSON and documentation
4. Include usage examples and screenshots

---

## Next Steps

1. ✅ Document conditional field logic
2. ✅ Create SEACOW(r) rule pack
3. ⏳ Implement conditional UI fields in RuleEditorModal
4. ⏳ Create rule pack browser modal
5. ⏳ Add import functionality
6. ⏳ Write rule pack format documentation
