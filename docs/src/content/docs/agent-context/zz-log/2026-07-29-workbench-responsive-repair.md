---
title: Workbench responsive repair
description: The v0.1.38 Workbench keeps occurrence-first semantics while replacing unexplained folder colours and a vertically stacked deck with a responsive systems browser.
tags: [session-log, taxonomy-workbench, responsive-design, accessibility, visual-testing, testing]
sidebar:
  label: "07-29 · Workbench responsive repair"
  order: -20260729002
date: 2026-07-29
---

## Prompt

Production use of v0.1.38 exposed two usability failures in the Taxonomy Workbench:

1. Green/red and pack-coloured folder-row treatments looked like unexplained success/failure states even though the actual concepts were occurrence membership, installed-rule output, and conflicts.
2. The always-expanded Organizational systems deck was stacked above Map, Scope, or Candidates. In narrow or short Obsidian panes, the deck and active surface became competing vertical scroll regions and the hierarchy could collapse to an unusable sliver.

The repair had to preserve the occurrence-first product model and shared selection without preserving those visual and spatial choices.

## Neutral hierarchy semantics

Map folder rows no longer render pack-colour rails, inherited pack tints, or a pack-stack analysis. A row's organizational-system meaning is now carried by explicit occurrence-specific **Member** and **Support** chips. Overlapping folders still expose every applicable occurrence, and alternative signals for the same occurrence/relation deduplicate without collapsing member and support into one relation.

Installed-rule emissions use neutral Obsidian background, border, and text variables rather than success green. Rule collisions render an explicit textual **Conflict** badge with an accessible label naming the matching rule IDs and predicted winner. Colour can support the badge but no longer carries the meaning alone.

The old decorative connector overlay was removed after direct screenshot inspection showed its dotted lines crossing cards and Map content. Textual relations remain authoritative and no replacement line language was introduced.

## Responsive systems browser

The Workbench shell now keeps a compact **Organizational systems** summary beneath the surface tabs. It exposes complete/incomplete counts, the selected system's name, anchor, and status, and one button for opening or hiding the full browser.

The full browser is no longer permanently stacked above the active task:

- At wide Workbench widths it is a collapsible side column beside Map, Scope, or Candidates.
- At narrow Workbench widths it becomes a temporary in-Workbench drawer with a scrim and close action.
- Selecting an occurrence in the narrow drawer updates shared selection and closes the drawer while retaining the current surface.
- **Rule layers** remain available in the browser but start inside a collapsed disclosure.

The browser manages `aria-expanded`, `aria-controls`, `aria-hidden`, focus restoration, and `inert` state. While a narrow drawer is open, the underlying active panel is hidden from assistive interaction. Escape, the toolbar close button, the scrim, and occurrence selection all provide deterministic closure paths.

## Container- and height-aware layout

Responsive behavior is based on the actual Workbench container rather than the browser window. This matters in Obsidian because a narrow split can exist inside a wide desktop window.

The wide layout uses a bounded systems column and a `minmax(0, 1fr)` active panel. Collapsing the browser lets the active panel take the full body width. The narrow layout overlays the browser instead of permanently consuming active-panel height, and controls/chips wrap without introducing page-level horizontal overflow.

A `ResizeObserver` also marks short Workbench containers. In short mode, the Map title and supplementary counters are hidden and the hierarchy receives a minimum usable height. The first short-pane screenshot revealed that the counters had consumed all remaining space; the follow-up screenshot confirmed that the tree is now immediately visible.

## Verification

Measured gates for the responsive repair and unchanged release baseline:

- Focused occurrence-relation renderer tests: **4 passing, 0 failing**.
- Full Bun suite: **1,150 passing, 0 failing**, 2,754 assertions across 47 files.
- Production build and strict TypeScript check: clean; 8 embedded built-in packs.
- Obsidian-community ESLint: clean.
- Real Obsidian 1.12.7 WDIO: **10/10 specs and 68/68 tests passing**.
- Responsive browser spec: **7 passing**, including side-by-side geometry, collapse/reopen ARIA state, narrow drawer behavior, focus/inert boundaries, container-width switching, approximately 320 px overflow, short-height hierarchy preservation, and stale-install prevention.
- Map specs: **13 passing** across ordinary and sensing coverage, including neutral rows, exact overlapping occurrence relations, neutral emissions, and textual conflict semantics.
- Docs: 77 pages build and the 33-route/content smoke suite passes.
- Fresh desktop, 480 px, approximately 320 px, and short-height screenshots were captured and inspected directly.

## Safety and release boundary

This repair changes presentation and interaction only. Detection output, occurrence identity, candidate provenance, source freshness, and installation reduction remain modular and deterministic. Candidate installation still adds new rules disabled, preserves existing enabled states, saves once with rollback on failure, and does not create or move folders or modify notes, tags, or frontmatter.

This repair ships in **v0.1.39** through the standard BRAT-compatible GitHub Release containing `main.js`, `manifest.json`, and `styles.css`. Publication was separately authorized after all implementation, visual, privacy, and non-destructive gates passed.
