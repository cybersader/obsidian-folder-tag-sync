---
title: Workbench semantic legibility
description: A presentation-only pass makes parent context, occurrence anchors, evidence, inclusion boundaries, candidate objects, and runtime layers explain themselves without relying on colour.
tags: [session-log, taxonomy-workbench, semantic-design, accessibility, visual-testing, testing]
sidebar:
  label: "07-30 · Workbench semantic legibility"
  order: -20260730001
date: 2026-07-30
---

## Prompt

After the occurrence-first and responsive repairs, the Workbench still required users to infer its mental model from flat strings and visually similar cards. A path such as `OrgDeckFixture/Work` did not show that `OrgDeckFixture` was structural context while `Work` was the anchor where PARA applied. The same ambiguity appeared between a selected Scope folder and the system anchor it included, a Candidate group and an individual Candidate rule, and a detected occurrence and an installed Rule layer.

The goal was not to change detection or planning. It was to make every important object answer four questions visibly:

1. What is this?
2. Where is it in context?
3. What state is it in?
4. What happens if I act on it?

## Shared semantic-path grammar

`src/ui/workbench/SemanticPath.ts` now provides one pure path description plus compact and stacked renderers. A vault-relative path is split into:

- muted **Parent context**;
- the emphasized focused segment, labelled for the surface (`Applies here`, `Evidence folder`, `Folder inspected`, `Inclusion boundary`, `System anchor`, or `Rule anchor`);
- a complete accessible label and title preserving the full path;
- explicit **Vault root** text for the empty path.

Stable DOM hooks expose the semantic path, context part, and focus part for real-Obsidian tests. Long, deeply nested, and Unicode paths wrap without losing the applicable segment.

## Organizational systems and installed layers

Each browser card now identifies itself as a **System occurrence**, renders its semantic **Applies here** anchor, and states the lifecycle consequence:

- complete/actionable: ready to produce candidate rules;
- incomplete: inspect only until missing member roles exist;
- suppressed: inspect only because the required parent system is not actionable.

Selecting a card explicitly focuses that occurrence across Map, Scope, and Candidates and does not add or enable rules. Selected detail separates Member roles, Support evidence, missing roles, evidence-folder paths, and parent-system relationships.

The separate disclosure is now **Installed rule layers**. Its cards are labelled **Runtime layer**, describe installed precedence groups rather than systems, and report **Possible system link — inferred** or **No system link recorded**. This preserves the honesty boundary: current installed rules have no durable occurrence ownership provenance.

## Map, Scope, and Candidates

### Map: understand this vault

Map states that it is read-only. Mode explanations distinguish detected occurrence evidence from enabled installed-rule output. Structured **Member of** / **Support for** annotations place the system name and semantic system anchor on separate lines, avoiding the old compressed `Member · Pack @ Anchor` string. Folder detail identifies the inspected folder, enabled winner, predicted tag output, matching enabled rules, and a **For this folder** action group. The Scope handoff says **Use this branch as an inclusion boundary**.

### Scope: choose what to include

Scope now explains that checked folders are inclusion boundaries and do not replace each occurrence's detected anchor. Selected rows say **Inclusion boundary**; redundant selections say **Covered by parent boundary**; rows containing only incomplete/suppressed evidence say **Inspect only**. The plan summary has separate sections for:

1. inclusion boundaries;
2. system anchors that will generate candidates.

A focused real-Obsidian assertion proves that selecting `ScopeDetectFixture/Work/Projects` creates a boundary at `Projects` while the included PARA occurrence remains anchored at `ScopeDetectFixture/Work`.

### Candidates: review disabled drafts

Each group identifies one source **System occurrence** and semantic system anchor. Each row identifies one **Candidate rule** and its rule anchor. Focusing a group does not select its rules. Checking a row queues a disabled draft, with plain labels for matches, round-trip behavior, conflict analysis, and folder-to-tag examples.

Visible action language changed from activation-sounding “install” wording to **Add selected disabled drafts** throughout preview, confirmation, progress, failure, and success states. The underlying atomic reducer and persistence contract did not change.

## Visual corrections found during verification

Fresh screenshots caught a Candidate group-header regression that semantic content made obvious: the header used a 100% flex-basis object label without enabling flex wrapping, producing a tall mostly blank header. The header now wraps, aligns from the start, and has a deterministic maximum-height E2E assertion.

Occurrence annotations also became cramped when relation, system, and semantic anchor competed on one line. They now wrap the anchor onto a separate labelled line, improving desktop and narrow layouts without reintroducing decorative connectors or colour-only meaning.

## Obsidian 1.13.4 test-harness compatibility

The final serial run used Obsidian 1.13.4 rather than the previous 1.12.7 baseline. In 1.13.4, Settings-tab controls and modals opened from Settings can live in the active tab's owner document even when they are not discoverable from the renderer's global `document.body`. Product behavior remained correct, but older WDIO selectors falsely reported missing controls.

Settings integration tests now resolve controls through `app.setting.activeTab.containerEl`, retain that element's owner document for Settings-launched modals, and use the input element's own realm when invoking native value setters. The Scope Settings handoff verifies the real Scan button and modal closure; Map Settings handoff verifies that `SettingsTab` consumed the pending focused rule ID; support-bundle and typed-editor tests continue to click the real rendered controls.

## Verification

Measured gates for the semantic-legibility working tree:

- Semantic-path unit tests: **5 passing**.
- Full project Bun suite: **1,155 passing, 0 failing**, 2,759 assertions across 48 files.
- Production build and strict TypeScript check: clean; 8 embedded built-in packs.
- Obsidian-community ESLint: clean.
- Complete serial real-Obsidian 1.13.4 suite: **10/10 specs and 70/70 tests passing**. The focused Workbench counts are systems browser **7**, Map **5**, Map sensing **8**, Scope **7**, and Candidates **6**; support-bundle privacy is **7** and typed model/UI is **20**.
- Docs: **78 static pages** built; route/content smoke is **33/33**.
- Fresh invented-fixture screenshots inspected directly: Map Both mode, selected occurrence browser/detail, opened Installed rule layers, Scope boundary-versus-anchor planning, Candidates before/after adding disabled drafts, 480 px drawer, approximately 320 px pane, and short-height pane.
- Candidate-header geometry now fails if a semantic group header exceeds 100 CSS px. Narrow Map relations wrap onto full-width rows instead of colliding.
- Core detection/planning/persistence/runtime directories have no diff. CRLF-aware whitespace validation and added-line private-identifier scanning are clean; screenshots and support-bundle images remain untracked and unpublished.

The fixtures are invented and permanent. The previously supplied production export and its private names, screenshots, diagnostics, aliases, and derived structure were not reconstructed, written into the repository, or uploaded for this pass.

## Safety and release boundary

This is a presentation and accessibility change. It does not alter detection scoring, occurrence identity, member/support assignment, scope planning, candidate provenance, rule precedence, source revisions, install reduction, or runtime synchronization. Workbench-added rules remain disabled; drafting and adding them do not create or move folders or modify notes, tags, or frontmatter.

After verification completed, the user separately authorized publication. This pass was released as **v0.1.41** through the standard BRAT-compatible GitHub Release containing only `main.js`, `manifest.json`, and `styles.css`.
