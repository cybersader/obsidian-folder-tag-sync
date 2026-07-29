---
title: Taxonomy Workbench consolidation
description: Known-system detection, hierarchy scoping, candidate triage, and disabled rule installation become one persistent Map/Scope/Candidates workflow.
tags: [session-log, taxonomy-workbench, detection, scoping, rule-packs, brat, testing]
sidebar:
  label: "07-28 · Workbench consolidation"
  order: -20260728001
date: 2026-07-28
---

## Prompt

The product had three user-facing implementations of one conceptual workflow:

- a Detect organizational systems modal;
- a Scan & Snap candidate modal;
- the dockable Taxonomy Workbench Map.

The user asked whether detection should simply consolidate into the Workbench, then authorized implementation and automated verification.

## Decision

Consolidate the **user-facing product surface**, not the domain engines.

The Taxonomy Workbench is now one persistent ItemView with:

1. **Map** — detected-system rails plus enabled installed-rule sensing.
2. **Scope** — hierarchy-first evidence, root/ancestor selection, scope tint, absorbed selections, and deterministic minimal-cover deployments.
3. **Candidates** — scoped/detected-instance drafts with coverage, emissions, lossiness, conflicts, predicted winners, confirmation, and installation results.

The pure engines remain separate so detection thresholds, scope planning, candidate planning, state reconciliation, pack loading, and installation can be tested without Obsidian or DOM state.

## Safety decision

The user chose **Install disabled**.

Every newly added Workbench rule is forced to `enabled: false`. Existing rule states are preserved. Candidate analysis uses enabled copies so coverage and conflicts remain honest, but persistence uses fresh disabled clones. Adding drafts does not create or move folders and does not modify notes, tags, frontmatter, or current sync behavior.

The install reducer:

- deduplicates selected IDs;
- skips already-installed IDs regardless of their enabled state;
- reports exact requested/unique/added/existing/duplicate counts;
- avoids a save when nothing is new;
- saves once when needed;
- restores the previous in-memory rule array if saving fails.

## Detection and scope boundary

Detection now has an explicit partition:

- **surfaced/actionable** — `score >= 1` and not suppressed by a missing required parent;
- **below threshold** — useful context but never an action source;
- **suppressed** — missing a required parent and never an action source.

Only surfaced results may create rails, scope hits, deployments, exclusivity warnings, or candidates. `collectCrossPackHits` enforces the same boundary defensively.

`scopePackPlan.ts` extracts the former DOM-coupled scope calculation. It supports hierarchy inclusion selections, ancestor-at-or-under semantics, vault-root selection, deterministic sorting, and exact deployment deduplication. Each surfaced hit cluster stays anchored at its shared parent; selecting a direct signal therefore cannot produce a duplicated `Projects/Projects`-style rule. Visual signal filtering does not change deployment calculation.

## Persistent Workbench state

`workbenchState.ts` defines a versioned serializable state covering:

- active surface;
- Map mode;
- selected scope paths and signal filter identity;
- candidate source, sort, and selected keys;
- selected folder detail.

`TaxonomyWorkbenchView` implements `getState` / `setState`, requests layout persistence after local changes, reconciles restored state against fresh folders/signals/candidates, and uses generation cancellation to discard stale asynchronous collection.

The historical command IDs remain compatibility routes:

- `scan-vault-for-systems` → clean Scope;
- `scan-and-snap-draft-rules` → detected-instance Candidates;
- `taxonomy-workbench-open-map` → Map.

Routing reuses an existing Workbench leaf and creates a main-area leaf only when none exists.

## Three-file BRAT parity

The old modals read `rule-packs/*.json` at runtime, but BRAT releases ship only `main.js`, `manifest.json`, and `styles.css`. Test-only pack staging had hidden this gap.

The pack build now generates:

- metadata-only `rule-packs/manifest.json`;
- full validated `rule-packs/catalog.json`.

`BundledRulePackRepository` statically imports the catalog, validates and deep-freezes normalized packs, and is bundled into `main.js`. Detection, candidate drafting, bundled-pack browsing, and installation therefore work from the real three-file release layout.

`.orgsys` composition remains preview-only because composed group precedence is not yet persisted safely.

## UI and accessibility

The existing Map became a reusable panel; Scope and Candidates became sibling panels beneath the same shell. Primary actions have visible click/touch controls rather than relying on context menus. Narrow-pane E2E uses an approximately 480 CSS-pixel viewport. The Workbench preserves Settings handoff and adds visible emitted-tag preview and “Choose this branch in scope” actions.

## Adversarial review fixes

A final correctness review found four gaps that focused happy-path E2E had not exposed:

1. Reusing the Workbench leaf through Map/Scan commands could reuse a stale snapshot after folders or Settings changed. External routes now always recollect live vault/settings data.
2. A direct signal selection could anchor a pack one level too deep (`Projects/Projects`). Scope planning now preserves detected instance parents and keeps distinct nested instances.
3. Nested literal rules replaced their original entry point, causing emissions such as `#projects/projects/web`. Candidate scoping now prepends the deployment anchor to the original entry point.
4. Inverse-only candidates were passed through the forward preview and could fabricate all-folder coverage/emissions. They now show **Inverse only** and **Tag conflicts not analyzed**, with the same uncertainty repeated in final preview/confirmation.

The narrow Map rendering was also tightened so long emission chips ellipsize inside the row rather than forcing a horizontal scrollbar.

## Verification

Focused real-Obsidian coverage on Obsidian 1.12.7 verifies:

- exact legacy command IDs;
- no legacy modal opening;
- one-leaf reuse and state preservation;
- hierarchy-first Scope evidence, signal filters, ancestor/root selection, tint, absorbed selections, and minimal covers;
- embedded-catalog candidate generation without staging `rule-packs/`;
- default selection, sorting, coverage/emissions/lossiness/conflict evidence;
- confirmation and exact installation results;
- disabled persistence and no fixture file/folder/frontmatter changes;
- automatic recollection and idempotent reinstall;
- explicit enablement before Map sensing becomes active;
- Settings round-trip and touch-visible actions;
- desktop and narrow screenshots.

Final gate after legacy modal deletion:

- Production build and TypeScript check: clean.
- Obsidian-community lint: clean.
- Bun unit suite: **1,103 passing, 0 failing**, 2,563 assertions across 46 files.
- Real-Obsidian WDIO: **all 9 specs pass, 62 tests total** on Obsidian 1.12.7; serial runtime 16m28s.
- Docs production build: **75 pages**; route/content smoke: **33/33 passing**.
- CRLF-aware `git diff --check`: clean.
- Final screenshots inspected: desktop/narrow Map, minimal-cover Scope, candidate preview, post-install state, and enabled-rule sensing.
- Release-layout test installation contains only `main.js`, `manifest.json`, and `styles.css` (excluding local runtime state such as `data.json`).

## Delivery boundary

No version bump, commit, tag, push, GitHub Release, or BRAT publication was performed. Those remain a separate outward-facing step requiring explicit authorization after all gates are green.
