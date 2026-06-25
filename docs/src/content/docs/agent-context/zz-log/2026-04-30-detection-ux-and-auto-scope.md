---
title: The detection-UX & auto-scope arc (0.1.22 → 0.1.27)
description: One sustained campaign to solve the "where do my rules apply / what will actually happen?" visibility problem that made the plugin unusable on large real vaults — interactive hierarchical preview, detection tree, anchored instances, hierarchy-first detection, and auto-scoped rules with a visual scope tint. Plus the open wall it surfaced — rule authoring at scale.
tags: [session-log, ux, detection, scope, visibility, enterprise]
sidebar:
  label: "04-30 · Detection UX + auto-scope"
  order: -20260430001
date: 2026-04-30
---

## Where this entry picks up

The prior log entries (specificity + groups, path templates, bijection-memory research) were about getting the *engine* correct. This entry is about a different problem that surfaced when the user actually tried the plugin on a real enterprise-scale vault: **the engine was correct but invisible.** You couldn't see where rules would apply, or what applying would do, before committing — and on a 40+ change vault that made it untrustworthy and effectively unusable.

Versions 0.1.22 → 0.1.27 are one sustained campaign against that single problem. Each version drove the answer deeper toward how users actually perceive their vault.

## The throughline

The pre-0.1.22 baseline gave blind affordances: a flat sync-preview list capped at 100 items, and a detect modal that just said "X signals matched, here are 3 example folders." On a large vault that conveyed nothing about *where* in the structure rules fired or what applying would actually do.

The campaign moves consistently from pack-centric / list-centric thinking toward **hierarchy-first, see-before-you-commit** interaction:

- **0.1.22** makes the *outcome* visible and selectable.
- **0.1.23** makes *detection* spatial.
- **0.1.24** disambiguates *recurrence*.
- **0.1.25** inverts the frame so packs become invisible plumbing.
- **0.1.27** closes the loop with auto-scoped rules + a visual scope tint.

Each step was driven directly by user feedback. The conceptual turning point is 0.1.25 (hierarchy-first) — see the [Decisions](/obsidian-folder-tag-sync/agent-context/decisions/) entry "Packs are invisible plumbing." Every term coined here is defined in the [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/).

## Per-version breakdown

### 0.1.22 — Interactive hierarchical preview with selective apply

Replaced the flat, 100-item-capped sync preview with an interactive modal: a collapsible folder tree with per-subtree file-count badges and inline per-rule colour swatches; **tri-state selection checkboxes** (indeterminate folders, cascading toggles); a live "Apply N selected" button that passes a path filter into `syncVault`; a click-to-filter rule legend; diff-style tag chips; path/rule/tag search; a KPI stat-card bar; and a tree↔flat toggle. Engine: `syncVault` gained an optional `onlyPaths` Set; `previewVault` sample cap raised 100 → 1000.

**Why it mattered:** first move from "blind" to "visible" on the *apply* side. A 40+ change preview was previously unscannable and all-or-nothing; now the user sees the shape of what will change and applies to only chosen branches — making bulk-sync trustworthy at scale.

*Key files:* `src/main.ts` (`VaultSyncPreviewModal`), `src/sync/FolderToTagSync.ts`.

### 0.1.23 — Detection tree: show WHERE each pack detected

Added a sparse interactive **detection tree**. New pure engine module `detectionTree.ts`: `buildDetectionTree()` keeps only paths that lead to a hit plus every ancestor back to root, eliding empty subtrees as "(N other folders, no matches)" badges. It re-evaluates regex against ALL folders (not the old 3-example cap) and reuses `detectPacks`' emoji + JD-prefix normalization. `colorForSignalIndex()` gives deterministic golden-angle hues. Each pack card got a lazy "Show where this detected" toggle and click-to-filter signal chips. 15 unit tests.

**Why it mattered:** moved the *detection* side from blind to visible. "3 example folders" told you nothing about the spatial pattern of hits; the tree shows exactly where detection fired — what you need before trusting a pack on your real vault.

*Key files:* `src/engine/detectionTree.ts` (+ test), `src/ui/DetectVaultModal.ts`.

### 0.1.24 — Anchored instances: disambiguate nested recurrence

Added **anchored-instance grouping** so a pattern that recurs at multiple levels (JD at root AND nested under `01-Projects/Cybersader`) reads as distinct applications, not one scattered `DetectionResult`. An instance = a cluster of hit folders sharing a parent (the anchor). `extractInstances` groups hits by parent (root-first); `buildInstanceTree` nests instances whose anchor is a proper segment-aligned prefix of another's (so `Project` isn't treated as parent of `Projects`). 9 new unit tests. UI: a per-card instance summary with tree-line connectors and a 3-folder preview per instance.

**Why it mattered:** answered direct user confusion about whether the modal showed "packs or instances of those systems" in nested/mixed setups. The nested visual structurally mirrors the real recurrence ("JD inside JD") without a paragraph of explanatory text crowding the UX.

*Key files:* `src/engine/detectionTree.ts` (+ test), `src/ui/DetectVaultModal.ts`.

### 0.1.25 — Hierarchy-first detection view: packs become invisible plumbing

A near-total rewrite of `DetectVaultModal` collapsing N per-pack cards into **one annotated vault tree**. New engine: `collectCrossPackHits` aggregates signals from every detected pack into a single map keyed by folder path (each signal gets a globally-unique index for deterministic colour regardless of pack order; suppressed packs excluded); `buildAnnotatedTree` carries full `(pack, signal)` provenance per node; `collectAnnotatedTreeFolders` walks it for selection. Selection is now **per-folder**; Apply computes the required pack IDs from the selected folders' signals and loads only those, reporting "X folders · Y systems." Pack name demoted to a tooltip; suppressed packs reduced to a one-line notice. 7 new unit tests; ~889 lines changed in the modal.

**Why it mattered:** acted on the key user insight that *"someone applying rules won't care based on system but rather based on their hierarchy."* Both prior per-pack and per-anchor views still organized around packs; this inverts the frame so the user navigates their own folder tree and pack identity becomes invisible plumbing. **The conceptual turning point of the whole arc.**

*Key files:* `src/engine/detectionTree.ts` (+ test), `src/ui/DetectVaultModal.ts`.

### 0.1.27 — Auto-scope rules + visual scope tint + E2E coverage

New pure engine module `scopeRules.ts`: `scopeRule`/`scopeRules` rewrite a pack's rules so `folderPattern` and `folderTemplate` are prefixed with a chosen scope path (regex-escaped, prepended after `^`), `folderEntryPoint` is set explicitly, and rule IDs get a scope-slug suffix to avoid collisions; `minimalScopeCover` folds redundant inner selections into outer scopes via segment-aligned ancestor checks. 19 unit tests + `scopeApplyFlow.test.ts` (9 integration tests running detect → cross-pack hit map → minimal cover → scoped plan → scoped rules on the nested JD-in-SEACOW vault, verifying patterns match inside scope and don't false-positive outside).

The UI "surprise": checking a hit folder paints a thick coloured left border + tinted background that flows down the whole subtree (distinct golden-angle hue per scope), a `SCOPE` pill on the entry point, and a dashed border + "↑ absorbed" label when a check is folded into a parent scope. Apply button reads "Apply (N scopes · M pack-rule-sets)." Added **7 passing wdio-obsidian-service E2E tests** (`scope-detect.e2e.ts`) plus the `nested-mixed` fixture vault; fixed a mocha global-binding import in two existing specs. Final tally: ~786 unit + 7 E2E passing.

**Why it mattered:** closes the visibility loop on the *apply* side — the user picks a hierarchy entry point and literally sees the painted region the rules will reach before committing, with redundant inner selections visibly absorbed. Auto-scoping turns a detected pattern into correctly-scoped, non-colliding rules without hand-writing scope prefixes. **The first real bridge from visibility toward authoring.**

*Key files:* `src/engine/scopeRules.ts`, `scopeRules.test.ts`, `scopeApplyFlow.test.ts`, `src/ui/DetectVaultModal.ts`, `test/specs/scope-detect.e2e.ts`, `test/vaults/nested-mixed/`.

## Where this leaves us — the open wall

Visibility is now solved end-to-end (detection is spatial + hierarchy-first; apply is selective + scope-tinted), but **rule _authoring_ at scale is still the wall.** The plugin can show you where existing packs fire and auto-scope a detected pattern to an entry point — but a user facing a large, idiosyncratic vault that doesn't match a prebuilt pack still hand-crafts `folderPattern` regex and `folderTemplate` strings in the rule editor, one rule at a time.

The 0.1.27 `minimalScopeCover`/`scopeRules` machinery proves the system can **synthesize correct rules from a structural selection**. The open question is how to generalize that into authoring *new* rules (not just scoping existing packs) directly from the hierarchy-first tree.

## Next steps (proposed, not yet committed)

1. **Rule synthesis from selection** — let a user select folders in the hierarchy-first tree and generate brand-new rules (pattern + template inferred from the selected structure), reusing `scopeRules.ts`/`minimalScopeCover` as the foundation.
2. **Authoring-mode annotated tree** — a counterpart to `DetectVaultModal` where the live colour-tinted coverage preview (from 0.1.22 inline coverage + 0.1.27 scope tint) updates as the user defines a rule from folder selections, closing the authoring-time "what will this do" loop visually rather than via the single-sample text preview in the current rule editor.
3. **Shared provenance** — extend `collectCrossPackHits`/`AnnotatedHit` so user-authored rules and pack rules share one annotated tree, letting authors see conflicts/overlaps before saving.
4. **More E2E** — follow the `scope-detect.e2e.ts` pattern + `nested-mixed` fixture for the multi-scope and "absorbed" cases, and for an authoring flow once it exists.
5. **Scale stress-test** — confirm the sparse-tree elision and per-scope hue assignment stay performant and legible on a 1000+ folder, deeply-nested vault.

## Side note: community-plugin submission

Still not in the Obsidian catalog (see [2026-04-13 submission stalled](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-13-submission-pr-stalled/)). `npm run lint` currently fails on ~11 real `obsidianmd/ui/sentence-case` violations (`RuleEditorModal.ts`, `SettingsTab.ts`) plus a misconfigured lint setup that type-checks `*.test.ts` files not in the tsconfig project. Both mechanical; clear them before re-attempting submission. Tracked in [Current state](/obsidian-folder-tag-sync/agent-context/current-state/).
