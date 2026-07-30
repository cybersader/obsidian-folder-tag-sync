---
title: Glossary
description: Plain-language definitions of every term in this project — the typed model, Path Lens templates, detection, scoping, and the recent hierarchy-first UX — each with a concrete example and where it lives in code.
sidebar:
  label: "Glossary"
  order: 0.6
---

Every term the project uses, defined plainly, with a concrete example and the file it lives in. If you've been away and a word in a commit message or doc isn't landing, it's here. Organized roughly newest-and-most-confusing first; the foundational vocabulary is lower down.

The whole glossary is one page on purpose — use your browser's find (Ctrl/Cmd-F) to jump to any term named in "Related."

## Detection & the hierarchy-first scan

These are the terms from the v0.1.22–0.1.27 visibility campaign and the consolidated Taxonomy Workbench that now owns detection, scoping, and candidate review.

### Taxonomy Workbench
**In plain terms:** The one persistent Obsidian pane for understanding organizational systems and turning that evidence into reviewable rules. It has three surfaces — **Map**, **Scope**, and **Candidates** — while detection, scope planning, candidate analysis, and installation stay separate pure/testable engines underneath.

Legacy commands are compatibility routes, not separate products: the old detect command opens Scope, the old draft command opens Candidates from detected instances, and the map command opens Map. The same Workbench leaf is reused so navigation does not discard unrelated state.

*Lives in:* `src/ui/TaxonomyWorkbenchView.ts`; state/routing in `src/workbench/workbenchState.ts`; snapshot orchestration in `src/workbench/WorkbenchSession.ts`; panels in `src/ui/workbench/` · *Related:* Organizational systems deck, Workbench Map, Workbench Scope, Workbench Candidates, disabled draft, hierarchy-first detection view

### Semantic path / parent context / focused segment
**In plain terms:** A Workbench path is presented as two meanings rather than one flat string. **Parent context** answers “inside what larger structure?” while the bold **focused segment** answers “which folder matters for this object or action?” The focus label changes by surface: **Applies here**, **Evidence folder**, **Folder inspected**, **Inclusion boundary**, **System anchor**, or **Rule anchor**.

**Example:** For `OrgDeckFixture/Work`, an occurrence card renders muted parent context `OrgDeckFixture` and emphasized **Applies here** `Work`. Assistive text still exposes the complete path and both labels. Vault root is written explicitly as **Vault root** rather than an empty string.

*Lives in:* `src/ui/workbench/SemanticPath.ts`; shared styling in `styles.css` · *Related:* system anchor, inclusion boundary, organizational-system occurrence, Workbench Map

### System anchor
**In plain terms:** The folder where one detected organizational-system occurrence applies. The anchor belongs to the occurrence and remains stable when a user selects a deeper Member folder as an inclusion boundary.

**Example:** Selecting `Work/Projects` can include the PARA occurrence whose system anchor is `Work`. The UI shows both paths separately so the selection cannot be mistaken for the occurrence's identity.

*Lives in:* `DetectionOccurrence.anchorPath` in `src/engine/detectPacks.ts`; rendered through `SemanticPath.ts` · *Related:* organizational-system occurrence, inclusion boundary, scope point

### Inclusion boundary
**In plain terms:** A checked Scope folder that says “include complete system occurrences at or below this branch.” It is a selection boundary, not necessarily the system anchor or final literal rule entry point.

**Example:** Checking `Work/Projects` produces an inclusion boundary at `Projects` while the PARA deployment remains anchored at `Work`. Checking `Work` as well makes `Projects` redundant and labels it **Covered by parent boundary**.

*Lives in:* selection state and plan rendering in `src/ui/workbench/WorkbenchScopePanel.ts`; pure reduction in `src/engine/scopeRules.ts` · *Related:* system anchor, scope point, minimal scope cover, absorbed selection

### Candidate group / candidate rule
**In plain terms:** A **Candidate group** is one exact source system occurrence, identified by `occurrenceKey` and system anchor. A **Candidate rule** is one proposed rule row inside that group. Focusing the group does not select its rows; checking a row queues that individual rule as a disabled draft.

*Lives in:* grouping in `src/engine/scanAndSnapPlan.ts`; rendering in `src/ui/workbench/WorkbenchCandidatePanel.ts` · *Related:* Workbench Candidates, organizational-system occurrence, disabled draft

### Organizational-system occurrence
**In plain terms:** One deployment-shaped occurrence of a known organizational system at one anchor. `PARA at Work` and `PARA at Home` are separate occurrences even though both use the PARA definition. A `Projects` folder is evidence inside an occurrence; it is not independently “a PARA.”

Occurrence confidence is local: evidence under unrelated parents cannot combine into a false complete system. Each occurrence is `actionable`, `incomplete`, or `suppressed`, has a collision-safe key, and retains its member/support evidence and missing roles.

*Lives in:* `src/engine/detectPacks.ts` (`DetectionOccurrence`, `partitionDetectionOccurrences`) · *Related:* member evidence, support evidence, anchored instances, Organizational systems deck

### Member evidence / support evidence
**In plain terms:** **Member** folders establish a system occurrence and represent its coordinated roles. **Support** folders add shape and confidence to the nearest compatible member-seeded occurrence but can never create an occurrence alone.

**Example:** In SEACOW, `Capture` can seed an occurrence as a member while `Capture/Inbox` attaches as support. In PARA, `Projects` and `Areas` are distinct member roles. Alternative regexes sharing one semantic role count once.

*Lives in:* rule-pack `detection.anyOf` metadata plus `src/engine/detectPacks.ts` · *Related:* signal, organizational-system occurrence, incomplete occurrence

### Organizational systems deck
**In plain terms:** The occurrence-card content inside the responsive **Organizational systems** browser. A compact summary remains visible above Map, Scope, and Candidates; the full browser sits beside the active surface at wide Workbench widths and opens as a temporary drawer at narrow widths. It renders one selectable **System occurrence** card per anchor, separates parent context from **Applies here**, states complete versus inspect-only consequences, preserves selection across surfaces, and shows incomplete occurrences by default.

Selecting a card focuses the same occurrence across Map, Scope, and Candidates; it does not add or enable rules. Selected detail separates Member roles, Support evidence, missing roles, and parent-system relationships. Folder rows and candidate-group headers carry typed textual relations back to exact occurrence keys. Those labels are the complete relationship language: decorative cross-panel connectors were removed after visual testing showed that they crossed content and recreated unexplained line noise.

*Lives in:* shell/summary/browser ownership in `src/ui/TaxonomyWorkbenchView.ts`; cards in `src/ui/workbench/OrganizationalSystemsDeck.ts`; projection in `src/workbench/organizationalSystemsProjection.ts` · *Related:* organizational-system occurrence, typed relation, Workbench Map, Workbench Candidates

### Installed rule layers
**In plain terms:** The collapsed browser view of installed rules grouped by `MappingRule.group` in runtime precedence order, with Ungrouped last. Every card is labelled **Runtime layer** because this is execution structure, not a detected system and not proof that one organizational system owns those rules. Occurrence links say **Possible system link — inferred** or **No system link recorded**.

*Lives in:* `src/ui/workbench/RuleLayersSection.ts`; projection in `src/workbench/organizationalSystemsProjection.ts` · *Related:* group precedence, inferred association, Organizational systems deck

### Typed relation / inferred association
**In plain terms:** A typed relation says *how* two visible things are connected — for example member, support, scoped-under, or candidate-source — using text and stable keys rather than color alone. Candidate-to-occurrence provenance is exact because the planner carries `occurrenceKey`. Installed rules lack durable deployment provenance, so their links to system occurrences are labelled **inferred** or **unknown**, never ownership.

*Lives in:* `src/workbench/organizationalSystemsProjection.ts`; rendered by the persistent deck and folder/candidate chips · *Related:* Installed rule layers, organizational-system occurrence, candidate provenance

### Workbench Map
**In plain terms:** The read-only **understand** surface. It overlays structured **Member of** / **Support for** occurrence evidence and the neutral results of enabled installed rules onto the same folder hierarchy without merging those layers. Each relation labels its system anchor separately. Folder detail identifies the inspected folder, enabled winner, predicted tag output, other matching rules, and actions **For this folder**. Rows do not use arbitrary pack-colour rails or inherited tints; multiple rule matches are labelled with textual **Conflict** badges.

*Lives in:* `src/ui/workbench/WorkbenchMapPanel.ts`; sparse rendering in `src/ui/annotatedTreeRender.ts`; installed-rule sensing in `src/engine/folderRuleView.ts` · *Related:* Taxonomy Workbench, detection tree, cross-pack hit map

### Workbench Scope
**In plain terms:** The interactive hierarchy-first **choose what to include** surface. A user selects vault root or folder branches as **Inclusion boundaries**, sees supporting scope tint and parent-covered selections, and previews the exact system anchors that will generate candidates. The plan summary deliberately lists boundaries and anchors in separate sections. Signal filtering changes emphasis only; it never removes hidden pack hits from deployment calculation.

Only actionable occurrences can create deployments. Rows containing only incomplete or suppressed evidence stay visible as **Inspect only**, with disabled checkboxes. Ancestor selection intentionally includes actionable occurrences below that branch, while root selection includes every actionable occurrence. Deployments remain anchored at `occurrence.anchorPath` rather than blindly at the clicked boundary or signal path, preventing duplicated shapes such as `Projects/Projects`.

*Lives in:* `src/ui/workbench/WorkbenchScopePanel.ts`; pure planning in `src/engine/scopePackPlan.ts` · *Related:* scope point, minimal scope cover, surfaced detection, Workbench Candidates

### Workbench Candidates
**In plain terms:** The **review disabled drafts** surface. A group header identifies one exact source **System occurrence** and its system anchor; each row identifies one **Candidate rule** and its rule anchor. Rows report `Matches N folders`, `Round trip`, conflict analysis, examples, sorting, and exact selection counts before confirmation.

Focusing a group does not select its candidate rows. Checking a row queues that candidate as a disabled rule draft, and the action is named **Add selected disabled drafts**. Candidates can come from explicit Scope deployments or actionable detected occurrences. Rows are grouped by exact `occurrenceKey`, and low-signal/conflict sorting happens inside each occurrence group without changing candidate-key selection. The analysis temporarily treats source-disabled rules as enabled so preview/conflict evidence is honest; persistence creates fresh disabled copies. Inverse-only (`tag-to-folder`) candidates are labelled explicitly: folder coverage is not applicable and tag-side overlaps are not claimed because the Workbench does not collect a complete tag inventory.

*Lives in:* `src/ui/workbench/WorkbenchCandidatePanel.ts`; planning in `src/engine/scanAndSnapPlan.ts`; installation reduction in `src/engine/ruleInstallPlan.ts` · *Related:* Taxonomy Workbench, anchored instances, disabled draft

### Surfaced detection
**In plain terms:** The compatibility pack-level summary meaning “this pack has at least one actionable occurrence.” New action consumers use occurrence status directly; pack-level `score >= 1` remains only for legacy hand-built results without occurrence data.

Incomplete and suppressed occurrence evidence remains diagnostic and inspectable. `collectCrossPackHits` exposes separate all-evidence and actionable-only maps so display can explain partial systems without accidentally turning them into deployments or candidates.

*Lives in:* `src/engine/detectPacks.ts` (`isSurfacedDetection`, `partitionDetectionResults`, `partitionDetectionOccurrences`); defensive hit partitioning in `src/engine/detectionTree.ts` · *Related:* organizational-system occurrence, signal, cross-pack hit map, Workbench Scope

### Disabled draft
**In plain terms:** A rule added by the Workbench is persisted with `enabled: false`, regardless of the source pack's enabled flag. “Selected” means “add this draft for review,” not “arm synchronization.”

Installation deduplicates selected rule IDs, skips IDs already installed in either enabled state, saves once, rolls the in-memory list back if saving fails, and reports exact added/existing/duplicate counts. Drafting does not create or move folders and does not change note files, tags, frontmatter, or current sync behavior.

*Lives in:* `src/engine/ruleInstallPlan.ts`; atomic persistence in `src/main.ts` (`installWorkbenchRules`) · *Related:* Workbench Candidates, Taxonomy Workbench

### Hierarchy-first detection view
**In plain terms:** Workbench Scope shows your vault as one folder tree with detection chips on each folder, instead of a list of “packs found.”

The original detect UI was pack-centric (a card per pack definition with its signals listed inside), which didn't match how users inspect a vault. Scope therefore keeps the unified sparse folder tree as its action surface. The responsive Organizational systems summary/browser complements that tree at a different semantic level: it groups evidence into anchored occurrences so users can inspect and focus `PARA at Work` as one coordinated object rather than treating every matched folder as a standalone taxonomy.

**Example:** A folder row `📁 01 - Active` can carry two textual relations such as **Member of Johnny Decimal** and **Member of PARA**, each with its own separately labelled system anchor, because it contributes to two occurrences. Selecting its ancestor can include both actionable occurrences; selecting either relation focuses the matching occurrence card.

*Lives in:* `src/ui/workbench/WorkbenchScopePanel.ts`; planning in `src/engine/scopePackPlan.ts` · *Related:* detection tree, cross-pack hit map, signal, auto-scope

### Detection tree
**In plain terms:** A sparse folder tree built from a detection scan that keeps only folders that matched a pattern plus their ancestors, so you can see *where* in the vault patterns fired.

A flat list of hits doesn't tell you where detections live in your structure, and rendering the full vault tree would be unusable on large vaults. `buildDetectionTree` (and its cross-pack twin `buildAnnotatedTree`) keep every hit folder, walk up to add each hit's ancestors so the path-from-root is visible, and collapse all other subtrees into per-node `elidedChildCount` counters. A 5000-folder vault with 12 hits renders as ~30 nodes (12 hits + ancestors), not 5000.

**Example:** `buildAnnotatedTree(folderPaths, hitMap)` keeps `Projects` and `Projects/01 - Active` (Active is a hit, Projects is its ancestor) while `Projects/Drafts` is elided into `Projects.elidedChildCount`.

*Lives in:* `src/engine/detectionTree.ts` (`buildDetectionTree`, `buildAnnotatedTree`) · *Related:* elision, cross-pack hit map, hierarchy-first detection view, anchored instances

### Signal (detection signal)
**In plain terms:** A single named regex pattern from a rule pack's `detection` block that says "if a folder matches this, the pack probably applies."

Detection scores each pack against the vault using its `detection.anyOf` list of signals; each signal carries a `folderRegex`, a `scope` (`name` | `path` | `leafName`), and an optional `label`. The hierarchy-first UI treats *signals* (not packs) as the primary unit users care about — every signal gets a stable colour and becomes a clickable legend chip and per-folder chip. Folder strings are tested in raw, emoji-stripped, and emoji+JD-stripped forms so signals written against semantic names still match decorated folders.

**Example:** A signal `{folderRegex:'^\d+ - ', scope:'leafName', label:'JD numbered'}` fires on the leaf `01 - Active` and on the emoji-normalized form of `📁 01 - Active`.

*Lives in:* `src/engine/detectPacks.ts` (`DetectionSignalResult`, `detectPacks`, `matchesNormalized`); colour via `detectionTree.ts` `colorForSignalIndex` · *Related:* cross-pack hit map, detection tree, scope point

### Cross-pack hit map / AnnotatedHit
**In plain terms:** A merged map from folder path → the list of (pack, signal) pairs that matched that folder, combining hits from every detected pack into one structure.

Because the UI is hierarchy-first and pack-blind, it needs per-folder annotations regardless of which pack a signal came from. `collectCrossPackHits` walks every surfaced `DetectionResult`, assigns each signal a globally-unique `globalIndex` (driving deterministic colours), and produces `hitsByPath` where each `AnnotatedHit` pairs a `folderPath` with its `AnnotatedSignal` (which still carries `packId`/`packName` for deployment plumbing). Below-threshold and suppressed packs are intentionally excluded so the tree cannot turn weak evidence into actionable scope hits.

**Example:** `hitMap.hitsByPath.get('Projects/01 - Active')` → `[{signal:{packId:'johnny-decimal', label:'JD numbered', globalIndex:0}}, {signal:{packId:'para', label:'PARA', globalIndex:3}}]`.

*Lives in:* `src/engine/detectionTree.ts` (`collectCrossPackHits`, `collectAllHits`) · *Related:* signal, detection tree, hierarchy-first detection view

### Anchored instances / DetectionInstance
**In plain terms:** A cluster of sibling hit folders that share a common parent, so the same organizational pattern applied at two different depths shows up as two distinct instances.

A vault can apply the *same* pattern at multiple levels (JD numbering at root *and* again nested under an entity subfolder). Without grouping, the UI shows "JD detected" as one tree of scattered hits and you can't tell one big match from N independent applications. `extractInstances` groups hits by their parent folder (the instance's `anchorPath`), and `buildInstanceTree` nests instances whose anchor is a proper segment-aligned prefix of another's — so recurrence is shown structurally instead of via explanatory text.

**Example:** Hits at `01 - Projects`, `02 - Areas` (anchor `''`) and `01 - Active`, `02 - Archive` (anchor `Projects/Cybersader`) yield two instances: JD at root, JD again under `Projects/Cybersader/`.

*Lives in:* `src/engine/detectionTree.ts` (`extractInstances`, `buildInstanceTree`, `isAnchorPrefix`) · *Related:* detection tree, scope point, minimal scope cover

### Elision / elidedChildCount
**In plain terms:** Each kept tree node carries a count of its real child folders that were dropped because their subtrees had no hits — rendered as a "… N other folder(s), no matches" affordance.

To keep the detection tree compact on large vaults, only hit folders and their ancestors are kept; everything else is *summarized* rather than dropped silently, so you still see the dim full context. After building the sparse tree, a pass counts, for each kept node, how many of its actual vault children weren't kept and stores it as `elidedChildCount`, which the renderer turns into an italic faint badge per node (plus a top-level badge on the root).

**Example:** A `Projects` node with one kept child `01 - Active` and three unmatched siblings renders the kept child plus "… 3 other folder(s), no matches."

*Lives in:* `src/engine/detectionTree.ts` (third pass in `buildDetectionTree`/`buildAnnotatedTree`); rendered by `src/ui/workbench/WorkbenchScopePanel.ts` and `src/ui/annotatedTreeRender.ts` · *Related:* detection tree, hierarchy-first detection view

## Selecting & scoping

What happens when you check folders in the detection tree and apply.

### Scope point
**In plain terms:** A selected inclusion branch that survives minimal-cover reduction and determines which detected system instances proceed to Candidates.

A checked folder that the minimal-cover algorithm keeps (i.e. not covered by a selected ancestor) gets the strongest supporting tint and an explicit **Inclusion boundary** badge. `buildScopePackPlan` includes surfaced hit clusters at-or-under that branch, but anchors each deployment at the cluster's shared parent. The boundary is therefore not necessarily the system anchor or final literal rule entry point.

**Example:** Checking a direct `Work/Projects` PARA signal includes the PARA instance and shows the selected row as a scope point, while the deployment summary correctly anchors PARA at `Work` so the generated rule is `^Work/Projects…`, not `^Work/Projects/Projects…`.

*Lives in:* `src/ui/workbench/WorkbenchScopePanel.ts`; pure deployment planning in `src/engine/scopePackPlan.ts` · *Related:* minimal scope cover, absorbed selection, scope tint, auto-scope

### Minimal scope cover
**In plain terms:** A reduction of the selected scope folders that drops any folder already contained by another selected folder, so a pack's rules aren't applied twice at overlapping scopes.

You may check both an outer folder and an inner one; since the outer scope's rules already match folders anywhere beneath it, applying at both would fire the rules twice. `minimalScopeCover` sorts selections shortest-path-first and keeps a path only if no already-kept path is an ancestor-or-equal of it (segment-aligned, with empty-string root absorbing everything). The cover drives the apply plan, the apply-button label (N scopes), and which rows render as scope points vs absorbed selections.

**Example:** `minimalScopeCover(['Projects','Projects/Web','Projects/Web/Auth'])` returns `['Projects']`; selecting `''` (root) plus others collapses to `['']`.

*Lives in:* `src/engine/scopeRules.ts` (`minimalScopeCover`, `isAncestorOrEqual`) · *Related:* scope point, absorbed selection, auto-scope, scope tint

### Auto-scope / scopeRule
**In plain terms:** When you select a folder in the detection tree, the pack's rules are rewritten so they only fire inside that folder — making the selection semantic, not just visual.

The hierarchy-first view promises that picking a folder localizes rules to that branch; without rewriting, a pack's rules would fire wherever their original pattern matched *anywhere* in the vault, defeating the selection. `scopeRule` produces a **new** rule that prepends the regex-escaped, anchored scope path into `folderPattern` (right after `^`), literally prefixes `folderTemplate`, sets `folderEntryPoint` to the scope path, suffixes the `id` with a path slug (so multiple scopes don't collide on insert), and appends ` @ <scopePath>` to the name. An empty scope (`''`) is a no-op clone, preserving vault-wide behavior.

**Example:** `scopeRule` for pattern `^\d+ - .*` scoped to `Projects/Cybersader/01 - Active` yields `folderPattern` `^Projects/Cybersader/01 - Active/\d+ - .*`, `folderEntryPoint` `Projects/Cybersader/01 - Active`, `id` `…__projects-cybersader-01-active`.

*Lives in:* `src/engine/scopeRules.ts` (`scopeRule`, `scopeRules`, `scopePattern`, `scopeTemplate`, `pathToSlug`); deployments are planned in `src/engine/scopePackPlan.ts` and candidate copies are scoped in `src/engine/scanAndSnapPlan.ts` · *Related:* scope point, minimal scope cover, scope tint, cross-pack hit map

### Scope tint
**In plain terms:** A coloured background region painted into a scope point's subtree so you can see which detection evidence the selected inclusion branch contains.

Selection should feel semantic — checking a folder visibly wraps its subtree in the scope's colour so the included branch is obvious. Each cover scope gets a stable golden-angle hue (`scopeColorForIndex`); the scope point itself gets a strong tint (alpha 0.20) plus a thick left border and badge, while inside-scope descendants get a faint tint (0.07) of the most-specific containing scope's colour, keeping multi-scope selections visually separable. Tints recompute on every re-render. The separate deployment summary names the actual detected instance anchors used to scope rule copies.

**Example:** Checking `Projects` shades the Projects row a strong blue and faintly tints every folder beneath it the same blue; checking a second scope `Areas` paints its subtree a distinct hue.

*Lives in:* `src/ui/workbench/WorkbenchScopePanel.ts` (scope colour assignment and row tinting) · *Related:* scope point, minimal scope cover, absorbed selection

### Absorbed selection
**In plain terms:** A folder you checked that the minimal-cover algorithm discarded because an ancestor folder is also selected — shown dimmed with a **Covered by parent boundary** label.

When both a parent and child folder are selected, the child is redundant (the parent boundary already covers it), but silently dropping the check would be confusing. The tree detects this (path is in `selectedFolders` but not in the cover set) and renders the row dim with a dashed supporting border and the explicit parent-boundary label. This makes the cover reduction visible rather than mysterious.

**Example:** With both `Projects` and `Projects/Cybersader` checked, the `Projects/Cybersader` row dims and shows **Covered by parent boundary** since only `Projects` remains in the minimal inclusion-boundary cover.

*Lives in:* `src/ui/workbench/WorkbenchScopePanel.ts` (selected-vs-cover rendering) · *Related:* minimal scope cover, scope point, scope tint

## Preview & apply

### Hierarchical sync preview
**In plain terms:** The "Preview vault sync" modal renders proposed folder → tag changes as a collapsible folder tree with per-file diff pills, instead of a flat list.

Bulk forward-sync can touch 100+ files, and a flat list is unscannable, so `VaultSyncPreviewModal` builds a folder tree (`buildPreviewTree`) from the preview items, renders each file as a leaf with green add-pill tag chips, and groups them under collapsible folder rows. It supports a per-rule colour-coded legend/filter, a search box, a flat-view fallback, and selective apply. Because the tree collapses subtrees on demand, the preview item cap was raised from 100 → 1000 while staying navigable.

**Example:** Previewing reveals `Projects` → `01 - Active` (3 files, each `+#projects/active`); checking the Projects folder row applies to all three.

*Lives in:* `src/main.ts` (`VaultSyncPreviewModal`; `buildPreviewTree`/`collectLeaves`); `src/sync/FolderToTagSync.ts` `previewVault`/`syncVault` with `onlyPaths` · *Related:* tri-state checkbox selection, detection tree, absorbed selection

### Tri-state checkbox selection
**In plain terms:** Folder checkboxes in the sync preview show *checked* when all descendant files are selected, *unchecked* when none are, and *indeterminate* (a dash) when only some are.

The hierarchical preview supports selective apply, so a parent folder's checkbox must reflect partial descendant selection rather than just on/off. Each folder row collects all descendant leaves (`collectLeaves`), counts how many are selected, and sets checked/unchecked/indeterminate accordingly; toggling a folder cascades to every descendant leaf, and toggling a leaf re-renders so ancestor checkboxes recompute. Apply forwards the selected paths via `syncVault`'s `onlyPaths` (or `undefined` when the full set is selected, so files past the 1000-item cap still sync).

**Example:** Selecting 2 of 5 files under `Projects` makes the Projects checkbox render indeterminate; clicking it then selects all 5.

*Lives in:* `src/main.ts` (`VaultSyncPreviewModal.renderFolderRow`; `collectLeaves`) · *Related:* hierarchical sync preview, absorbed selection, minimal scope cover

## The typed rule model (Layer 2)

The foundational vocabulary. A rule is three independently-typed things — a folder side, a tag side, and the mapping between them — sitting on top of the raw regex the engine actually runs.

### MappingRule (Layer 1 vs Layer 2)
**In plain terms:** The single data structure for one folder↔tag mapping rule, where **Layer 1** fields (raw regex + transform config) actually drive sync and **Layer 2** fields (the typed model) are optional, additive metadata.

The sync engines only ever read low-level regex + transform pipelines (Layer 1), while a richer, principled typed description (Layer 2: `folder`/`tag`/`transfer`/`inverseTransfer`/`cardinality`/`bijective`) rides along for UI, derivation, and inference without changing the runtime. A rule can be authored purely at Layer 2 (`derive.ts` compiles down), purely at Layer 1 (hand-authored regex), or as a Path Lens template (`folderTemplate`/`tagTemplate`). The split keeps regex as an always-available escape hatch while letting most users think in the typed/template vocabulary.

**Example:** A rule with `folderPattern: '^Entity/Cybersader(?:/|$)'` is Layer 1; the same rule also carrying `folder: {axes:['entity']}`, `transfer: {op:'identity'}`, `bijective: true` is Layer 2 metadata.

*Lives in:* `src/types/settings.ts` (`MappingRule`, lines 53-136); typed fields in `src/types/typed.ts` · *Related:* derive, Path Lens template, TransferOp, FolderClassifier, TagVocabulary, rule pack

### FolderClassifier
**In plain terms:** A typed description of how one folder organizes its contents — which classification axes it covers, its scheme, naming style, depth, and whether siblings are parallel.

It's the "folder side" of the typed model. It exists so a folder can be honest about what it's doing — a container-only folder (`Attachments/`) declares it doesn't classify, while an enumerative folder (Johnny Decimal) declares its numbered siblings are order-meaningful. The vocabulary (enumerative / hierarchical / faceted / authority-root / container-only) is lifted from library/classification science, not invented here.

**Example:** For `Entity/Cybersader/`: `{ axes: ['entity','work'], scheme: 'authority-root', naming: 'word', subdivisionDepth: 'unbounded', siblingUniformity: 'unique' }`.

*Lives in:* `src/types/typed.ts` (`FolderClassifier`); inference in `src/engine/inferTyped.ts`; `docs/.../concepts/folder-classifiers.md` · *Related:* TagVocabulary, TransferOp, SEACOW(r), Johnny Decimal, PARA, folderAnchor

### TagVocabulary
**In plain terms:** A typed description of how one tag is shaped — which axis it carries, whether its concepts are fused or applied separately, its optional prefix marker, and which side is authoritative.

It's the "tag side" of the typed model, typed *independently* from the folder side because folders and tags aren't mirror images — tags carry the polyhierarchical axes a single folder tree can't. `coordination` (pre-coordinated / post-coordinated / flat-keyword) borrows the library-science distinction between fusing concepts into one term vs applying them as independent descriptors. `prefixMarker` encodes the SEACOW ASCII-sort convention (`/` system, `--` entity, `-` capture, `_` output, `''` work, `null` relation), and `authority` records whether the folder or tag is the source of truth.

**Example:** For `#--cybersader/…`: `{ axis: 'entity', coordination: 'pre-coordinated', prefixMarker: '--', authority: 'mutual' }`.

*Lives in:* `src/types/typed.ts` (`TagVocabulary`); marker→axis inference in `src/engine/inferTyped.ts`; `docs/.../concepts/tag-vocabularies.md` · *Related:* FolderClassifier, TransferOp, SEACOW(r), MappingRule

### TransferOp
**In plain terms:** One of eight primitives describing how hierarchy crosses between the folder side and tag side of a rule (e.g. preserve full depth, cap at N levels, collapse to one marker).

It's the "mapping" — the third typed thing in a rule — and it's runtime-enforced: when a rule fires, the transfer op *recoordinates* (reshuffles) path segments into tag segments before any cosmetic case/emoji transforms run. The eight ops (identity, truncation, promotion-to-root, flattening-to-leaf, post-coordination, aggregation, marker-only, opaque) come from classification theory's vocabulary for how one scheme compresses or expands onto another. The set is deliberately small; common compound behaviors are absorbed as mode flags (e.g. `truncation.tailHandling: drop|aggregate|flatten`) rather than new primitives. Only identity and truncation/drop round-trip cleanly; the rest are lossy by design and the user picks the loss they accept.

**Example:** `{ op:'truncation', depth:2, tailHandling:'drop' }` makes `Capture/Clips/Web/intro.md` → `#-clip/web` but rejects paths deeper than 2 segments; `{ op:'marker-only', marker:'-inbox' }` collapses everything under `Capture/Inbox/` to a single `#-inbox`.

*Lives in:* `src/types/typed.ts` (`TransferOp` union); recoordination in `src/engine/applyTransfer.ts`; derivation in `src/engine/derive.ts`; `docs/.../concepts/transfer-operations.md` · *Related:* derive, bijectivity, A7 (tag fan-out), FolderClassifier, TagVocabulary

### derive (Layer 2 → Layer 1 compiler)
**In plain terms:** The pure function `deriveRule(spec)` that compiles a typed rule spec (folder classifier + tag vocabulary + transfer op) down into the raw regex patterns and transform configs the sync engines actually consume.

It exists so a user can describe a mapping once in typed terms and never hand-author regex; the resulting `MappingRule` carries *both* the Layer 1 regex/transform fields (used at runtime) and the Layer 2 typed metadata (for UI). It's deterministic with no Obsidian imports. `deriveFolderPattern` emits anchor-aware regex (root / any-segment / under-prefix) and special-cases marker-only and truncation/drop; `deriveCardinality`/`deriveBijective` compute the 1:1 / many:1 / 1:many and round-trip verdicts. `inferTyped.ts` is the reverse, best-effort direction (Layer 1 → Layer 2) for displaying or migrating legacy regex rules.

**Example:** A spec with `transfer {op:'marker-only', marker:'-inbox'}`, entry `Capture/Inbox` derives `folderPattern '^Capture/Inbox(?:/.*)?$'`, `tagPattern '^-inbox$'`, `cardinality 'many:1'`, `bijective false`.

*Lives in:* `src/engine/derive.ts` (`deriveRule`); reverse inference in `src/engine/inferTyped.ts` · *Related:* MappingRule, TransferOp, folderAnchor, rule pack, Path Lens template

### folderAnchor
**In plain terms:** A first-class field declaring *where* in the vault tree a rule's pattern fires: at vault root (`'root'`), at any path-segment boundary (`'any-segment'`), or only under a literal parent prefix (`{ under: 'X' }`).

It makes "which layer does this organizational system live at" an explicit concept rather than an implicit `^` baked into every pattern — needed for nested deployments (JD under `Output/`, PARA under `Work/`) and for round-tripping the typed model. The three modes compile to distinct regex prefixes (`root` → `^body`, `any-segment` → `(?:^|/)body`, `under` → `^X/body`). Sync engines are anchor-agnostic (they consume the compiled `folderPattern`), so the field is metadata the derivation/inference round-trip and guided modal reason about, and it contributes a specificity bonus in matching.

**Example:** `folderAnchor { under: 'fixtures' }` makes a Projects rule match `fixtures/Projects/…` but NOT a root-level `Projects/…`.

*Lives in:* `src/types/typed.ts` (`FolderAnchor`); `compileWithAnchor` in `src/engine/derive.ts`; anchor bonus in `src/engine/ruleMatcher.ts`; tests in `anchorRoundTrip.test.ts` · *Related:* derive, specificity-aware matching, Johnny Decimal, PARA, MappingRule

### Bijectivity / lossy vs reversible
**In plain terms:** Whether a rule round-trips — `forward(inverse(t)) === t` and `inverse(forward(p)) === p` for every accepted input — i.e. whether the folder → tag → folder cycle reconstructs the original.

It matters because the plugin bridges a strict folder hierarchy and a polyhierarchical tag system, and the system's job is to be *honest* about which direction (if any) throws information away. A reversible rule (identity, truncation/drop within depth) can reconstruct the other side; a lossy rule (marker-only, promotion-to-root, flattening-to-leaf, aggregation, post-coordination, truncation aggregate/flatten) deliberately collapses many inputs to one output. The verdict is **computed, not asserted**: `computeBijectivity` composes Layer 1 (structural slot-overlap — folder-only slots = lossy forward, tag-only slots = config error) with Layer 2 (per-transform reversibility), yielding total/conditional/lossy. "Conditional" means reversible only within a documented domain (e.g. kebab-case round-trips unless the input has internal double-dashes).

**Example:** Identity with reversible case transforms is bijective (total); a marker-only rule is lossy forward (`Capture/Inbox/a/b` → `#-inbox` loses `a/b`); a kebab-case filter slot is "conditional."

*Lives in:* `src/engine/compileTemplate.ts` (`computeBijectivity`); per-transform metadata in `src/transformers/transformMetadata.ts`; typed-op verdict in `src/engine/derive.ts` · *Related:* TransferOp, frontmatter witness, filter slot, Path Lens template

## Path Lens templates (F2)

A peer abstraction to the typed model: write the pattern as a literal path with named slots, and the engine understands the *roles* of the pieces — which gives it the slot-name overlap it needs to compute bijectivity.

### Path Lens template
**In plain terms:** A pattern written with named slots in braces (e.g. `Projects/{topic}/{deeper...}`) that compiles to regex internally but lets the engine introspect which part is a literal, which is a variable, and what role it plays.

A rule with both `folderTemplate` and `tagTemplate` is "template-shaped": it syncs via slot-extraction + per-slot filter pipelines instead of the typed-op runtime. Templates exist because regex captures only syntax ("does this string look right?") while templates capture some semantics ("what role does each piece play?"). The compiler is a pure function producing a `CompiledTemplate` (regex + slot list + source); the loader auto-derives `folderPattern`/`tagPattern` from the compiled regex so the existing matcher works unchanged, and the runtime dispatches to `applyTemplate.ts` via `isTemplateRule`.

**Example:** `folderTemplate 'Projects/{topic}'` + `tagTemplate 'projects/{topic | kebab-case}'` makes `Projects/Web Auth` → `#projects/web-auth`.

*Lives in:* `src/engine/compileTemplate.ts` (`compileTemplate`, `CompiledTemplate`, `SlotDef`); runtime `src/engine/applyTemplate.ts`; loader Path C `src/engine/rulePackLoader.ts` · *Related:* slot, glob slot, filter slot, Tier B inline-regex slot, bijectivity, F2

### slot `{name}`
**In plain terms:** A single-segment placeholder in a template that captures exactly one path segment (compiles to a named regex group matching `[^/]+`).

Slots are the variable parts of a template; the slot's *name* is what the engine uses to bind values across the folder and tag templates (same name on both sides = round-trip binding). A segment slot deliberately can't cross a `/`, keeping the surrounding literal segments anchored. Because JS regex named groups disallow hyphens, the compiler sanitizes `topic-name` to an internal name like `topic_name__s0` but maps back to the original in the public slot API.

**Example:** In `Projects/{topic}`, `{topic}` captures `Web` from `Projects/Web` but does NOT match `Projects/Web/Auth` (that needs a glob slot).

*Lives in:* `src/engine/compileTemplate.ts` (`parseSlot`; default body `[^/]+`) · *Related:* Path Lens template, glob slot, filter slot, Tier B inline-regex slot

### glob slot `{name...}`
**In plain terms:** A multi-segment placeholder (trailing `...`) that captures one *or more* path segments, spanning across `/` (compiles to `.+`).

It exists for the "everything below here" case where depth is variable. A special **trailing-optional-glob** case is detected: when a glob slot is the LAST token AND immediately preceded by a `/`, both the leading `/` and the capture become optional — so `Projects/{deeper...}` matches the bare `Projects` folder AND `Projects/X/Y/Z`. This restores the typed-model "entry-or-anywhere-below" shape (the old `^Projects(?:/|$)`) in one template; at runtime the slot value is `undefined` for bare-prefix matches.

**Example:** `Capture/Inbox/{discarded...}` matches both `Capture/Inbox` and `Capture/Inbox/2026/Q2`; in the second, `{discarded...}` = `2026/Q2`.

*Lives in:* `src/engine/compileTemplate.ts` (glob kind detection; `trailingOptionalGlob`) · *Related:* slot, Path Lens template, filter slot, TransferOp

### filter slot `{name | filter}`
**In plain terms:** A slot with one or more pipe-delimited, Jinja-style filters (e.g. `{topic | strip-invalid-tag-chars | kebab-case}`) that transform the captured value at sync time.

Filters express cosmetic/structural transformations (case conversion, emoji stripping, number-prefix handling, joining glob segments) per-slot rather than per-whole-rule. The compiler records only the filter *names*; the `applyFilter` runtime turns names into actual transformations via the existing case/emoji/number transformers. Forward sync applies folder-side filters then tag-side filters; inverse walks the chains in reverse using each filter's metadata inverse. Each filter carries a reversibility profile (total/conditional/lossy) that feeds the per-slot bijectivity verdict.

**Example:** `{topic | kebab-case}` turns `Web Auth` into `web-auth`; `{tail... | join('-')}` joins glob-captured `React/Hooks` into `react-hooks`.

*Lives in:* `src/engine/compileTemplate.ts` (filter parsing); `src/transformers/applyFilter.ts`; profiles in `src/transformers/transformMetadata.ts` · *Related:* slot, glob slot, Path Lens template, bijectivity

### Tier B inline-regex slot `{name:regex}`
**In plain terms:** A slot whose capture body is a user-supplied regex after a colon (e.g. `{num:\d+}`), replacing the default `[^/]+` / `.+` matcher.

The "Tier B" escape hatch for when a slot needs a specific shape the default matcher can't express. It carries a critical **safety validation**: for *segment* slots the user regex is rejected at compile time if it can match `/`, because otherwise one slot would eat across path segments and break the template's anchoring. Glob slots allow `/` by definition. The compiler uses balanced-brace counting so quantifiers like `\d{1,2}` (which contain a literal `}`) aren't mistaken for the slot terminator. A trailing `...` can follow the regex to make a constrained glob (`{name:\d+...}`).

**Example:** `{area:\d{1,2}}` matches `10` in `10 - Projects`, but `{bad:.+}` is rejected with a `TemplateParseError` because `.+` can match `/`.

*Lives in:* `src/engine/compileTemplate.ts` (`validateInlineRegex`; balanced-brace search) · *Related:* slot, glob slot, Path Lens template

## Rule packs & matching

### Rule pack
**In plain terms:** A JSON file bundling a set of rules (plus metadata) shipped together, usually aligned with a known system like PARA, Johnny Decimal, Zettelkasten, or SEACOW.

Rule packs are the progressive-disclosure entry point — a novice installs a pack from the catalog or detects one in their vault and gets value without touching regex. The loader is shape-aware: a rule with `typedSpec` runs through `deriveRule` (Layer 2→1), a rule with `folderTemplate`/`tagTemplate` compiles as a Path Lens template (mutually exclusive per rule), and a legacy raw-regex rule passes through with best-effort inferred typed metadata. Packs also carry composition metadata: `id`, `axes`, `compatibleWith`/`exclusiveWith`, `detection` signals, and `establish.createFolders` (bootstrap a new vault).

**Example:** `rule-packs/seacow-cyberbase.json` ships six rules; `rule-packs/jd.json` declares `axes:['work']`, `compatibleWith:['seacow-outer']`, and detection signals like `^\d{1,2} - [A-Za-z]`.

*Lives in:* `src/engine/rulePackLoader.ts` (`loadRulePackFromJSON`, `RulePack`); `rule-packs/*.json` · *Related:* derive, Path Lens template, group precedence, specificity-aware matching, PARA, JD, SEACOW(r)

### Specificity-aware matching (F1)
**In plain terms:** Choosing which rule wins when several match by scoring each pattern's specificity (literal chars, slashes, anchor) as the *primary* sort key, with the user-set priority number used only as a within-group tiebreak.

Earlier the user-authored priority number was the sole ordering mechanism, which couldn't express that a more literal/anchored pattern is genuinely more specific. `calculateMatchConfidence` penalizes greedy wildcards (`.*`/`.+`) heaviest, penalizes capture groups and bare stars lightly, rewards literal-character count (capped) and path-depth slashes, and adds an anchor-aware bonus (root > under-prefix > any-segment/none). `findBestMatch` sorts the winning group by confidence descending, then priority as the manual override.

**Example:** Against `Entity/Cybersader/10 - Projects/foo`, a rule with `^Entity/Cybersader(?:/|$)` (more literals, root anchor) scores higher than a loose `^\d{1,2} - .*` JD pattern, so it wins even with equal priorities.

*Lives in:* `src/engine/ruleMatcher.ts` (`calculateMatchConfidence`; confidence-primary sort in `findBestMatch`) · *Related:* group precedence, folderAnchor, F-codes, rule pack

### Group precedence
**In plain terms:** An optional ordered list of rule-group names (highest → lowest) that partitions matching rules across packs, so the highest-precedence group with any match wins outright before specificity/priority decide *within* that group.

The F1 Step 3 cross-pack composability layer, modeled on CSS `@layer`: rules carry an optional `group` (default `'__default__'`, lowest), packs declare a pack-level group, and the vault's `groupPrecedence` setting orders them. This lets multiple installed packs coexist — e.g. an entity pack's rules can always beat a generic JD pack's regardless of which is individually "more specific." With no precedence configured, groups fall to a stable alphabetical tiebreak so behavior is deterministic with zero config.

**Example:** With `groupPrecedence ['entity-cyberbase', 'jd']`, a path matched by both resolves to the entity group first; only within it does confidence/priority break ties.

*Lives in:* `src/engine/ruleMatcher.ts` (group partition + `groupRank`); `group`/`groupPrecedence` in `src/types/settings.ts` · *Related:* specificity-aware matching, rule pack, F-codes, MappingRule

## Memory & cleanup

### Frontmatter witness (F3)
**In plain terms:** An opt-in `fts:` block written into a file's frontmatter recording where FTS synced it from (origin folder, rule id, the tags FTS wrote, timestamp) — so the engine can later tell which tags it owns and recover lossy round-trips per-file.

It closes the "per-instance precision gap": a rule's bijectivity verdict is conservative across *all* inputs, but for a *specific* file that was forward-synced, the engine has more info if it recorded the original values. The witness gives bijective recovery on lossy rules for files synced at least once (inverse returns `witness.origin` directly instead of computing through a lossy filter inverse) and unblocks safe orphan-cleanup (A6) and cross-area-move detection (A5) by distinguishing FTS-written tags from user-added ones. Off by default (`frontmatterMemory` option) to avoid polluting frontmatter; the parser/injector are pure with no Obsidian dependency.

**Example:** After syncing `Projects/Web Auth` → `#projects/web-auth` with `frontmatterMemory` on, the file gains an `fts:` block with `origin: "Projects/Web Auth"`; the inverse later reuses that exact origin.

*Lives in:* `src/sync/frontmatterWitness.ts` (`WitnessRecord`, `injectWitness`, `parseWitness`); seam in `src/engine/applyTemplate.ts`; wired in `src/sync/FolderToTagSync.ts` · *Related:* bijectivity, removeOrphanedTags, F-codes, Path Lens template

### removeOrphanedTags (A6)
**In plain terms:** A per-rule option that, on forward sync, removes FTS-written tags the rule no longer emits — but only safely, using the frontmatter witness to know which tags FTS owns vs which the user added by hand.

It addresses the hard problem that naive tag-removal could delete user-authored tags that merely *look* rule-shaped. The clean solution requires the F3 witness: when `removeOrphanedTags` is true and the file has an `fts:` witness from a prior sync, the engine removes only tags listed in `witness.tags` that are no longer emitted; without a witness it safely skips cleanup. The flag long existed in the data model (and shipped packs set it true), but witness-gated execution was an unwired gap until 0.1.18 — which is what the "A6" label tracks.

**Example:** A file synced from a folder later renamed loses its now-stale `#old-name` tag (the witness recorded FTS wrote it and the rule no longer emits it), while a hand-added `#priority-high` tag is left untouched.

*Lives in:* `src/types/settings.ts` (`removeOrphanedTags` in `RuleOptions`); witness-gated cleanup in `src/sync/FolderToTagSync.ts` · *Related:* frontmatter witness, F-codes, A7 (tag fan-out), bijectivity

## Frameworks & roadmap shorthand

### SEACOW(r)
**In plain terms:** The six-axis knowledge-organization meta-framework the plugin adopts: **S**ystem, **E**ntity, **A**ctivities (**C**apture, **O**utput, **W**ork), and **r**elation — the orthogonal dimensions both folders and tags can classify along.

A folder tree can carry at best one or two axes, so the plugin uses SEACOW's axis set to say which dimension a folder classifies and which a tag carries, then maps between them. Each axis has a conventional tag prefix marker for ASCII-sort grouping: System `/`, Entity `--`, Capture `-`, Output `_`, Work no prefix, relation flat keywords. Borrowed from the cybersader/crosswalker project, not invented here; the `(r)` makes the relation axis explicit alongside SEACOW's core.

**Example:** Folder `Entity/Cybersader/` (entity axis) syncs to tag `#--cybersader/`; `Capture/Inbox/` (capture axis) → `#-inbox`; plain `#research` is a relation tag, intentionally not folder-derived.

*Lives in:* `src/types/typed.ts` (`Axis` + `ALL_AXES`); `rule-packs/seacow-cyberbase.json`; `docs/.../concepts/axes.md` · *Related:* FolderClassifier, TagVocabulary, rule pack, PARA, JD

### Johnny Decimal (JD)
**In plain terms:** An organizational system of numbered category folders (`10 - Projects`, `20 - Areas`) whose numeric prefixes give a stable ASCII sort order — treated by the plugin as an enumerative folder scheme on the Work axis.

A canonical rule pack and a folder-classifier scheme: JD folders are enumerative (numbered siblings where order is meaningful), and the plugin preserves the numeric prefix through sync (`numberPrefixHandling: 'keep'`) so the tag mirrors the folder (`10 - Projects` ↔ `#10-projects`). Detection signals match strict 2-digit (`^\d{1,2} - [A-Za-z]`) and compact (`^\d{1,2}-[a-z]`) forms, and the detect engine normalizes emoji + JD prefixes so `📁 01 - Projects` is still recognized. JD lives under the Work axis and can deploy standalone at root or nested under a SEACOW outer root via a `folderAnchor`.

**Example:** `rule-packs/jd.json`'s rule: `folderPattern '^\d{1,2} - [^/]+(?:/|$)'` bidirectionally syncs `10 - Projects/…` to tag `10-projects` preserving the prefix.

*Lives in:* `rule-packs/jd.json`; JD-prefix normalization in `src/engine/detectPacks.ts` (`stripJDPrefix`, `matchesNormalized`) · *Related:* PARA, SEACOW(r), FolderClassifier, folderAnchor, rule pack

### PARA
**In plain terms:** Tiago Forte's four-bucket method (Projects, Areas, Resources, Archive), shipped as a rule pack that identity-transfers between the folder hierarchy and tag hierarchy.

The simplest canonical pack — four top-level Work folders mapped 1:1 (identity transfer) to four tag namespaces, so folder and tag structure stay mirror images. A day-one progressive-disclosure starting point and the prototypical example of the identity transfer op (bijective when transforms are reversible). It declares `axes:['work']`, detects when ≥2 of Projects/Areas/Resources/Archive roots are present, can bootstrap those folders via `establish.createFolders`, composes with `seacow-outer` and `jd-output`, and is exclusive with `gtd`.

**Example:** `rule-packs/para.json`'s `para-projects` rule identity-syncs `Projects/…` folders to `#projects/…` tags; detection fires when ≥2 of `^Projects$`/`^Areas$`/`^Resources$`/`^Archive$` are found.

*Lives in:* `rule-packs/para.json`; identity transfer op in `src/types/typed.ts` · *Related:* Johnny Decimal, SEACOW(r), TransferOp, rule pack, FolderClassifier

### The F-codes (F1/F2/F3) and A-codes (A4–A7)
**In plain terms:** Roadmap shorthand threaded through code comments. **F-codes** are foundational engine increments; **A-codes** are advanced/secondary features.

Concretely: **F1** = specificity-aware matching + rule groups + group precedence (shipped). **F2** = bidirectional Path Lens templates (compiler + runtime + loader + bijectivity chip; MVP shipped). **F3** = opt-in frontmatter witness for per-file bijection memory (write- and read-side both shipped). **A4** = surfacing which side preserves more information. **A5** = ordinal/JD slot-value priority + auto-cleanup on cross-area moves (depends on F3). **A6** = implementing `removeOrphanedTags` safely (depends on F3; shipped). **A7** = emitting multiple tags by splitting comma-separated content within one folder segment (distinct from the post-coordination transfer op, which splits along path segments).

**Example:** A code comment "F1 Step 3 — Cross-pack precedence cluster" on `MappingRule.group`, or "F3 commit 1 — Passive frontmatter witness" on the `frontmatterMemory` option.

*Lives in:* `docs/.../about/roadmap.md`; labels referenced throughout `src/types/settings.ts`, `src/engine/ruleMatcher.ts`, `src/engine/compileTemplate.ts`, `src/sync/frontmatterWitness.ts` · *Related:* specificity-aware matching, Path Lens template, frontmatter witness, removeOrphanedTags, group precedence, bijectivity
