---
title: Workbench task-oriented redesign
description: An unreleased local pass turns the responsive occurrence-first Workbench into a clear Explore → Choose → Review journey without changing its domain or safety engines.
tags: [session-log, taxonomy-workbench, usability, information-architecture, testing]
sidebar:
  label: "07-31 · Workbench task-oriented redesign"
  order: -20260731002
date: 2026-07-31
---

:::caution[Superseded detail — same-day follow-up]
The core Explore → Choose → Review journey and safety boundaries in this log remain historical context. A later same-day refinement supersedes the claims that selected-system detail is sticky above the lists. **Organizational systems in this vault** is a global overview; selected evidence expands beneath its card and scrolls with the list. The follow-up also clarifies exact occurrence markers as secondary cues, focus as context rather than Scope filtering, the accessible view-local Scope divider, stable row geometry, independent folder↔tag direction status, and exact conflict-target navigation. See [Workbench evidence and Scope follow-up](/obsidian-folder-tag-sync/agent-context/zz-log/2026-07-31-workbench-evidence-scope-follow-up/).
:::

## Prompt and product failure

The preceding tree-first repair solved split-pane geometry, scrolling, inspector placement, exact relation density, and place preservation. In real use, however, the Workbench still looked like an engine surface. **Map / Scope / Candidates**, detection signals, inclusion boundaries, candidate rules, an unexplained **Show incomplete systems** checkbox, and generic Settings actions did not tell a novice what decision to make next or what pressing a button would do.

The product requirement became a visible journey:

1. **Explore your vault** — find a recognizable system and understand current enabled-rule output.
2. **Choose where rules apply** — select the highest folder to organize.
3. **Review proposed rules** — inspect exact mappings and warnings.
4. **Review in Settings** — land on an exact disabled draft and enable it only deliberately later.

The redesign changes product language, action hierarchy, progressive disclosure, and contextual handoffs. It does not replace the existing detection, planning, candidate, persistence, or runtime engines.

## Stable internals, clearer visible jobs

Visible navigation now reads **Explore your vault → Choose where rules apply → Review proposed rules**. Tight panes use **Explore / Choose / Review**. Internal `map | scope | candidates` values, command IDs, dataset hooks, workspace-state version, route reducers, and one-leaf reuse remain stable for compatibility.

The retired `showIncompleteSystems` preference remains only as a deprecated version-2 state field. Validation normalizes it to the grouped model; it no longer filters cards, alters visible counts, or clears the selected occurrence.

## Ready and Possible systems

The systems browser no longer asks whether incomplete systems should be shown. It always explains two consequences:

- **Ready systems** can continue to proposed rules.
- **Possible systems — more evidence needed** are collapsed by default, inspect-only, and state the missing folders or required parent that prevents continuation.

Selected-system detail is sticky above the lists, so selecting a late card does not require scrolling to a buried detail region. Evidence and role detail are behind **Why this system was detected**. Card activation only focuses the exact `occurrenceKey`; it does not silently constrain Scope or check proposals.

A Ready detail provides the explicit continuation **Choose where this system applies**, which seeds Scope from that occurrence's exact `anchorPath`. A Possible detail provides refresh guidance but no drafting action. In overlay layouts, card inspection keeps the browser open so the consequence and next action remain readable; **Show in vault** is the explicit close-and-focus action.

## Explore your vault

The first job retains the completed tree-first Map architecture. The hierarchy is still the primary scroller, the folder inspector remains side/overlay according to measured space, compact relations preserve exact occurrence identities, and expansion/focus/scroll are view-local.

The visible display modes are **Systems / Active rules / Both**. Technical layer explanation moves behind **How this view works**. Predicted tags remain inline in folder detail; the redundant preview Notice and generic Settings action are removed. When an exact enabled winner exists, the action is **Review winning rule in settings**. The alternate folder-first handoff is **Organize this folder and everything below**.

The primary Explore action depends on context: choose a system, choose a Ready system, or choose where the focused Ready system applies.

## Choose where rules apply

Scope now leads with one decision: select the highest folder Folder Tag Sync should organize; everything below it is included. Focused-system context explicitly says that focus helps locate a system while checked folders determine what continues.

The novice surface removes **Select all hits**. It retains **Clear choices**, Expand all, Collapse all, and a comprehensible **Organize the whole vault** option. **What happens next** separates **Folders included** from **Systems that will propose rules**, preserving each Ready occurrence's exact anchor.

Raw detection counts, weak/suppressed diagnostics, and the existing visual-only signal filter move behind **Why these systems were detected**. The control is called **Highlight detection evidence**, with explicit copy that highlights explain the scan and do not change checked folders or deployments.

## Review proposed rules

Candidate rows are presented as **Proposed rules** with **Suggested from** provenance and **Applies from** anchors. The header uses a compact proposal/system/warning summary rather than five diagnostic cards. Selection utilities are **Include all** and **Clear selection**.

Installable proposals still start selected. That default is intentional: the user already chose the organizing area, saving creates disabled drafts only, a confirmation remains, and no content or active sync behavior changes. The count-bearing action is **Save N draft rules** and the confirmation is **Save disabled draft rules?**

After saving, one Settings handoff replaces one button per added rule. It opens the exact first saved draft. Candidate keys, exact occurrence grouping, stale-source guards, deduplication, existing-ID skipping, one-save persistence, and rollback remain unchanged.

## Exact Settings focus

Both Map-winner and saved-draft handoffs locate a row by exact `data-dtf-rule-id`, center it deterministically, clear the transient `focusRuleId`, and apply an observable `.is-dtf-rule-focus` / `data-dtf-rule-focus="active"` pulse. Adjacent rule rows do not receive the focus marker.

This is now a user-facing UI contract rather than a timing-dependent inline-style detail. Broader Settings and Guided Rule Editor simplification remain follow-up work.

## UX lab and documentation

The invented, marker-owned, tag-free `UX Lab/` topology is unchanged. Its in-app `Start here.md` guide now leads through Explore → Choose → Review → exact Settings focus and moves split geometry, relation disclosure, and mode checks to an advanced section. It explicitly prohibits enabling generated drafts or running either sync direction in the lab.

The README, first-rule guide, feature overview, Current state, Decisions, Glossary, and Open questions now use the task-oriented model while preserving historical logs' original terminology.

## Verification status

The final local verification gates are green:

- Focused state, session, annotated-tree, layout-classifier, and Map-presentation coverage: **42 tests, 0 failures, 129 assertions**.
- Complete main Bun suite: **1,168 tests, 0 failures, 2,779 assertions across 50 files**.
- Companion UX lab: **288 tests, 0 failures, 1,221 assertions**; strict build clean.
- Main production build, strict TypeScript, and Obsidian-community lint: clean; 8 embedded packs remain validated.
- Focused real-Obsidian Workbench run: **7 specs and 40 tests passing**.
- Complete serial real-Obsidian 1.13.4 run: **12 specs and 77 tests passing**. The full run exposed one stale typed-model expectation for the old visible signal legend; it now asserts the closed **Why these systems were detected** disclosure and **Highlight detection evidence** label. Support/Settings-heavy teardown can still emit the known non-failing renderer-timeout warning.
- Documentation: **80 static pages** built; **33/33** route/content smoke checks passed.
- Privacy and artifact scans found no added local absolute paths, supplied screenshots, private diagnostics, reverse alias data, or image/log archives in either repository.

Fresh screenshots were inspected for wide and screenshot-shaped splits, approximately 480 px and 320 px layouts, short-horizontal detail, Scope, Candidates, and the systems browser. Visual review caught and repaired three issues that geometry-only checks had not made obvious: sticky selected detail reopening partly above the drawer, a focused card scrolling underneath that sticky detail, and a long 320 px inspector action clipping at the right edge. Exact saved-draft Settings focus is verified through the connected active tab, visible and centered exact row, transient focus marker, consumed `focusRuleId`, and absence of focus on adjacent rows.

## Safety and publication boundary

Detection scoring, occurrence identity, Member/Support assignment, required-parent suppression, Scope planning, candidate generation, rule precedence, disabled-draft persistence, stale guards, and runtime sync are unchanged. Draft saving does not create or move folders and does not change notes, tags, frontmatter, or current enabled states.

No private production topology, screenshot, vault name, absolute path, note content, frontmatter value, diagnostic, or reverse alias data is used. No version bump, commit, push, tag, GitHub Release, docs publication, or BRAT publication is authorized in this pass. The next gate is complete local automated and visual evaluation.