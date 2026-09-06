---
title: Workbench tree-first split UX
description: An unreleased local redesign makes the hierarchy the stable Map surface in real Obsidian splits and adds an isolated invented UX lab for evaluation.
tags: [session-log, taxonomy-workbench, responsive-design, split-screen, accessibility, testing]
sidebar:
  label: "07-31 · Workbench tree-first split UX"
  order: -20260731001
date: 2026-07-31
---

## Prompt and measured failure

A real 1904×1061 Obsidian screenshot showed the Workbench in a roughly 924 px split leaf. The hierarchy did not begin until about `y=785`; approximately 72% of the usable Workbench height was consumed first by shell chrome, the organizational-system summary, Map title and introduction, mode controls and explanation, and five stat cards. Opening folder detail could then take another 32% from the remaining tree. Overlapping Johnny Decimal and Enterprise JD evidence rendered as repeated full relation cards on each folder row.

The semantics were correct, but the product objective was wrong: the layout optimized for explaining the model rather than letting the user navigate the hierarchy. The requested local-first outcome was a dynamic split-screen design plus thorough invented examples that could be evaluated directly inside Obsidian without waiting for BRAT.

## Local UX lab

The companion `folder-tag-sync-test-fixtures` plugin now has an unreleased `workbench-ux-lab` topology-only framework rooted at `UX Lab/`. It has no rule-apply or restore commands. Generation uses the existing fixture diff, opens `UX Lab/Start here.md`, and the dedicated clear command removes only marker-owned generated Markdown while preserving foreign notes and non-Markdown files.

The in-app guide walks through seven invented, tag-free scenarios:

1. generic Johnny Decimal plus Enterprise JD actionable at the same anchor;
2. separate complete PARA occurrences at Studio and Home;
3. an incomplete PARA occurrence at Club;
4. generic JD actionable while Enterprise JD remains incomplete;
5. a complete SEACOW shell with support folders and nested JD under Output/Main;
6. complete PARA under deep Unicode context `研究室 🧭/Programme Ω`;
7. ordinary negative-control folders.

A cross-plugin oracle verifies those expectations against the actual detection engine rather than duplicating detection logic in the fixture plugin.

## Two-dimensional layout policy

`src/ui/workbench/workbenchLayout.ts` is a pure classifier over Workbench-body and active-panel width and height. It returns independent decisions for:

- density: `spacious`, `compact`, or `tight`;
- systems browser: `side` or `overlay`;
- folder inspector: `side` or `overlay`.

This replaces the old `width <= 750` plus `height <= 560` binary. A globally large Obsidian window can now correctly produce a compact or tight leaf. The systems browser becomes a side column only when both body dimensions can support it; resizing changes presentation without resetting the user's explicit open/closed preference.

## Tree-first Map

The active panel and Map root no longer scroll. Map uses a compact toolbar, mode explanation that progressively hides by density, one-line summary statistics, and a workspace whose hierarchy is the stable primary scroller. The former bottom detail block is now an adaptive inspector:

- side-by-side only when panel width and height permit;
- otherwise a temporary internal overlay;
- never reduces tree height;
- keeps Close/Escape and focus restoration available.

Scope and Candidates also retain one intentional internal surface scroller rather than falling back to the active panel as a competing page-level scroll region.

## Exact relations without repeated cards

`collectOccurrenceRelations()` remains the exact source. Collapsed Map rows show one relation plus `+N systems`; the currently selected occurrence is promoted into the visible slot when applicable. Expanding the disclosure reveals every exact relation, original `occurrenceKey`, Member/Support role, pack name, and semantic anchor. Compaction is presentation-only and does not merge candidate provenance.

Interaction ownership is now explicit:

- folder disclosure button or tree keyboard arrows change expansion only;
- folder row activation opens the inspector only;
- relation activation focuses that exact occurrence only.

The hierarchy uses tree/treeitem/group semantics, roving focus, `aria-expanded`, visible keyboard focus, and Arrow/Home/End navigation.

## Place preservation

`workbenchMapPresentation.ts` models transient expanded folders, expanded relation groups, scroll offset, and focus-return path. `TaxonomyWorkbenchView` owns it across active-panel destruction and recreation, while `WorkbenchState` remains limited to persisted domain/navigation decisions. Invalid paths are reconciled after a fresh snapshot.

This preserves the user's place across occurrence focus, Map mode changes, folder detail, Map → Scope → Map, and vault snapshot refresh without persisting stale pixel geometry across Obsidian sessions.

## Real-split findings and final visual corrections

Fresh WDIO screenshots at wide, screenshot-shaped, approximately 480 px, approximately 320 px, and short-horizontal layouts exposed two issues that containment assertions alone did not explain:

- Long compact relation text stayed inside its row and tree viewport, but Obsidian's centered button content clipped the beginning of the Enterprise JD label when the button shrank. Map occurrence buttons now align content from the start and retain the full value in their title/accessibility label.
- The short-horizontal overlay inspector inherited `max-height: 70%`, reducing it to roughly 90 px and recreating the tiny bottom scroller this redesign was meant to remove. Tight overlay inspectors now occupy the full Map workspace, keep a sticky Close header, wrap long code/path output, and suppress horizontal scrolling without changing the tree's underlying height or scroll position.

The approximately 320 px plus short-height regression also showed that selected-system summary detail could consume most of the remaining height. Tight narrow summaries now keep the selected system name in one line while hiding redundant object-kind, status, and anchor repetitions; the full details remain in the systems browser.

## Verification

- Companion fixture plugin: 288 tests, 0 failures, 1,216 assertions; strict build clean.
- Main plugin: 17 focused Workbench tests; full Bun suite 1,168 passing, 0 failing, 2,778 assertions across 50 source test files; production build, strict TypeScript, and Obsidian-community lint clean.
- Real Obsidian 1.13.4: all 11 serial WDIO specs pass, 76 tests total. Focused results are split-screen UX 6/6, responsive systems browser 7/7, existing Map 5/5, Map sensing 8/8, Scope 7/7, and Candidates 6/6.
- Docs: 79 static pages built; route/content smoke 33/33.

## Safety and publication boundary

The main plugin changes are presentation/navigation only. Detection scoring, occurrence identity, Member/Support assignment, Scope planning, candidate provenance, rule precedence, disabled-draft installation, and runtime sync are unchanged. The fixture framework is isolated, invented, tag-free, and topology-only.

No private production export, supplied screenshot, vault name, absolute path, note content, frontmatter value, diagnostic, or reverse alias legend was copied into either repository. No version bump, commit, push, tag, GitHub Release, or BRAT publication is part of this pass. The next gate is local in-app evaluation.
