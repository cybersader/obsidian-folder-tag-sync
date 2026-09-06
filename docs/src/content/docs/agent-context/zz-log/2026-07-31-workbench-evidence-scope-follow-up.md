---
title: Workbench evidence and Scope follow-up
description: A same-day clarification keeps Organizational systems global, makes selected evidence non-sticky, separates focus from Scope filtering, and adds explicit directional and conflict review guidance.
tags: [session-log, taxonomy-workbench, accessibility, scope, candidate-review, testing]
sidebar:
  label: "07-31 · Workbench evidence + Scope follow-up"
  order: -20260731003
date: 2026-07-31
---

## Why this follow-up exists

The earlier task-oriented redesign correctly established **Explore your vault → Choose where rules apply → Review proposed rules → Review in Settings**, but one presentation claim was wrong for the final interaction model: selected-system detail should not become a sticky block above the occurrence lists.

That framing made a focused occurrence look like the scope of the entire browser. The Workbench instead needs two simultaneous truths:

1. **Organizational systems in this vault** remains a global overview across every job.
2. A selected occurrence can reveal its exact evidence without becoming a filter or consuming permanent sticky space.

This log supersedes that narrow detail in [Workbench task-oriented redesign](/obsidian-folder-tag-sync/agent-context/zz-log/2026-07-31-workbench-task-oriented-redesign/) while preserving the earlier log as historical context.

## Global overview with non-sticky selected evidence

The systems browser remains a vault-wide occurrence overview across Explore, Choose, and Review:

- Ready occurrences appear before occurrences needing more folders.
- Selecting a card expands **Why Folder Tag Sync recognized this organizational system** directly beneath that card.
- The evidence scrolls with the card list; it is deliberately not sticky.
- The compact shell summary can still name the focused occurrence without implying that the browser or Scope has been filtered to it.
- Evidence remains exact to the selected `occurrenceKey`; unrelated parents cannot combine.

This preserves the selected occurrence's context while keeping the complete vault model visible.

## Exact occurrence markers are secondary cues

A deterministic marker follows one exact occurrence across the compact summary, occurrence card, Explore relation, Scope context, and Scope plan.

The marker hashes the full collision-safe occurrence key rather than only the pack ID. Repeated PARA or Johnny Decimal deployments can therefore receive different markers. The restrained palette can also repeat, so marker color is never identity by itself.

The accessible hierarchy remains:

1. organizational-system name;
2. Ready or needs-more-folders status;
3. **Identifies** or **Supports** relation;
4. exact semantic path;
5. exact occurrence identity.

Markers are `aria-hidden` supporting cues, not pack-wide ownership, status, or actionability signals.

## Focus is context, not Scope filtering

Scope now states the distinction explicitly:

- **Current organizational system** identifies the occurrence being followed across surfaces.
- **Current focus** can annotate that occurrence in the deployment plan.
- Focus never adds, removes, or filters deployments.
- Checked folders are the sole planning input.
- A checked parent can include several Ready occurrences even when only one is focused.
- Each included occurrence retains its own exact anchor.

The explicit **Choose where this system applies** action may seed a checkbox from the focused Ready occurrence, but the resulting checked folder—not the continuing focus—is what affects the plan.

## View-local accessible Scope split

Scope has two intentional scroll regions:

- **Choose folders to organize**
- **Scope plan and next actions**

A focusable horizontal separator joins them. It supports pointer dragging, Arrow Up/Down, larger Shift+Arrow steps, Home/End limits, and double-click reset. ARIA orientation, min/max/current values, value text, and disabled state describe the current split.

Preferred plan height plus chooser/plan scroll offsets are view-local presentation state owned by the open Workbench. They survive ordinary rerenders and surface navigation without being persisted as detection, selection, or deployment state.

## Stable Scope row geometry

Scope rows reserve fixed slots for:

- inclusion/absorbed rail;
- checkbox;
- disclosure control.

Parents, leaves, checked rows, absorbed child selections, and inspect-only rows therefore keep their controls aligned. Expanding a branch or changing selection state does not shift the folder name and controls sideways. Checkbox focus is restored after the rerender that follows a selection change.

## Directional rule status

Candidate review no longer compresses reversibility into one ambiguous badge. Every proposed rule reports:

- **Folder → tag**
- **Tag → folder**

Each direction is labelled Exact, Available, Conditional, Lossy, Unavailable, or Uncertain with a plain-language consequence. Template-slot and typed-transfer evidence can locate information loss when it is genuinely known. A global lossy verdict does not become a fabricated claim that both directions are lossy.

Inverse-only uncertainty remains explicit: folder inventory cannot prove tag-side conflict absence.

## Exact conflict targets and navigation

A **Rule overlap** section now names exact targets instead of stopping at an anonymous conflict count:

- A proposed target carries its exact rule name, Candidate key, source system, anchor, and shared-folder sample. Activating it focuses and briefly highlights that exact proposed row without changing checkboxes.
- An installed target carries its exact rule name and persisted ID. Activating it opens Settings centered on that exact row.
- The sampled predicted winner resolves to the exact rule name whenever the target exists in the snapshot.

This makes conflict review navigable while preserving selection and disabled-draft safety.

## Invented in-app UX Lab follow-up

The companion `workbench-ux-lab` topology remains invented, marker-owned, tag-free, and topology-only. No private topology or note metadata was introduced.

Its generated `Start here.md` guide now asks the evaluator to verify:

1. the vault-wide organizational-systems overview across all jobs;
2. selected evidence expanding in place and scrolling rather than sticking;
3. exact occurrence markers as secondary cues;
4. focus as context while checked folders remain the Scope filter;
5. stable Scope row slots;
6. pointer and keyboard operation of the view-local divider;
7. independent folder→tag and tag→folder status;
8. exact proposed/installed conflict-target navigation;
9. exact saved-draft Settings focus with adjacent rows unaffected;
10. the explicit local no-publication boundary.

The guide still prohibits enabling generated drafts or running either sync direction.

## Documentation updated

The follow-up reconciles:

- `README.md`
- `CLAUDE.md`
- `getting-started/first-rule.md`
- `features/overview.md`
- `agent-context/current-state.md`
- `agent-context/decisions.md`
- `agent-context/glossary.md`
- `agent-context/open-questions.md`
- the earlier task-oriented log through a superseding note

Historical logs retain their original narrative except for the explicit superseding callout.

## Focused non-UI verification

- Companion focused fixture registry: **167 passing, 0 failing, 1,101 assertions**.
- Companion complete source suite: **288 passing, 0 failing, 1,232 assertions across 2 files**.
- Companion strict TypeScript + production build: clean.
- Documentation: **81 static pages built successfully**; route/content smoke **33/33 passed**. The build emitted only the existing Vite browser-externalization and chunk-size warnings.

## Safety and publication boundary

This pass changes documentation and the invented UX Lab guide/tests only. It does not modify main-plugin TypeScript source or real-Obsidian E2E tests.

No private production topology, screenshot, vault name, absolute path, note content, frontmatter value, diagnostic, reverse alias data, or enabled fixture rule was added. No sync command was run.

No version bump, commit, push, tag, GitHub Release, docs deployment, BRAT publication, screenshot publication, or other release action is authorized. Publication is a separate decision after complete local verification.
