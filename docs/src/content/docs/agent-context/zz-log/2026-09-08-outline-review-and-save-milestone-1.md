---
title: Outline review and save (milestone 1)
description: The annotated outline stops being a preview and completes one job — review a detected system, decline part of it, and save exactly that as disabled rules. Verified locally and staged as the 0.1.41-workbench-outline.2 test build.
tags: [session-log, taxonomy-workbench, annotated-outline, disabled-drafts, release-engineering, testing]
sidebar:
  label: "09-08 · Outline review and save"
  order: -20260908001
date: 2026-09-08
---

## What this milestone had to fix

`0.1.41-workbench-outline.1` shipped the annotated outline as an explicitly preview-only surface: the Save control was unconditionally disabled, and the comparison treated proposed rules as if enabled while excluding installed rules. That made it a proposal, not a prediction, and it left the user unable to finish anything. Milestone 1 of the "complete organization journeys" plan is the smallest honest completion: *review and save existing systems*, with no activation attached.

The three failures worth naming, because they shaped the design:

1. **Several selections, one save.** Comparison, counts, confirmation, and Save were each capable of deriving their own rule set from a slightly different input. That is how a declined interpretation quietly comes back at save time.
2. **A selection is not a coverage claim.** Checking a `Projects` hit can select a *parent-anchored* PARA pack. The old surface said nothing about the anchor, so "I selected Projects" and "these are the folders this rule will match" were silently different statements.
3. **A hypothetical that excludes reality.** Comparing proposals against nothing is not a prediction of what will happen in a vault that already has installed rules competing at real group precedence.

## The canonical reviewed selection

`src/ui/workbench/outlineReviewPlan.ts` is a new pure module that derives one reviewed rule set consumed by every downstream consumer. Selected paths still discover candidate deployments through `buildScopePackPlan`; explicit occurrence choices then filter those deployments by exact `occurrenceKey` *before* reviewed rules are derived. The unfiltered snapshot never reaches Save.

Two consequences are load-bearing. Occurrence-to-rule-ID membership is preserved, because one occurrence can produce several rules — so system count and rule count are reported separately, and one row never implies one rule. And a restored selection is deliberately not a restored review approval: consequential panel-local decisions are promoted into Workbench/session state with compatible normalization, but reopening a selection does not re-approve it.

## Truth in comparison

**Current behavior** now renders beside **If these drafts were enabled**, built from enabled installed rules plus exactly the chosen proposals, at actual group precedence, through the production `findMatchingRules` / `selectBestMatch` / `applyRuleForward` path rather than a parallel implementation. Installed rules that are disabled stay identifiable but do not compete unless explicitly included in the hypothetical set. Nothing reorders precedence or modifies installed rules implicitly.

The output states stay distinct rather than collapsing into "no tag": `no-match`, `empty`, `invalid`, and `valid`, crossed with `unchanged` and `changed`. Three rules follow from that:

- A valid loser is never promoted to hide an invalid winner.
- An invalid *installed* rule is attributed to that installed rule, not blamed on a draft.
- Coverage says whether it is complete for current folders or sampled, instead of implying completeness.

Forward comparison does not certify reverse safety. Reverse/bidirectional capability is exposed explicitly, and activation is not offered here at all.

## The save boundary

Save is blocked while a chosen draft has a known invalid forward output in the evaluated coverage, and the block names the offending folder and offers a correction. The count-bearing **Save N disabled rules** action reuses the existing guarded seam (`installWorkbenchRules`, `buildRuleInstallPlan`) rather than adding a second independent save path: revision revalidation immediately before mutation, ID deduplication, forced-disabled cloning, busy protection, truthful partial and skipped results. Refresh invalidates review approval instead of silently approving newly generated rules.

Afterwards the panel shows the exact saved rules and an action to open them in Settings. Saved and active status is derived from persisted rules, so reopening finds them rather than offering duplicate installation, and enabled, disabled, and hand-edited same-ID rules are each reported as what they are. Unknown or empty branches explain that detection is not a judgment of organization quality.

## Verification

Run serially under `build-contained`, on the milestone diff over `feature/workbench-split-ux` at `900c2f3`:

| Check | Result |
|---|---|
| `bun x tsc -noEmit -skipLibCheck` | clean |
| `eslint src` | clean |
| `bun test src` | 1,305 tests |
| `bun test scripts` (release gate) | 38 tests |
| production esbuild bundle | green |
| full end-to-end suite, real Obsidian 1.13.7, `WDIO_MAX_INSTANCES=1` | 14 specs, 98 tests, exit 0, 1m44 |

The new `test/specs/workbench-outline-saving.e2e.ts` covers the four cases that matter: an invalid chosen draft blocks the save while invalid *installed* behavior is attributed separately; cancel adds zero rules and a stale confirmation is refused without writing drafts; the exact reviewed IDs are saved disabled with fixture bytes and folder topology unchanged and the exact Settings row focused; and reopening reports enabled, disabled, and edited same-ID rules truthfully without duplicates.

## Release shape

Staged as the test build `0.1.41-workbench-outline.2`. Per `scripts/validate-release-tag.mjs`, a test tag bumps `manifest.json` only — `versions.json` and `main` stay on stable `0.1.41` — and is accepted only because base `0.1.41` already exists as both a stable tag and a published, non-draft GitHub release. The distribution boundary stays three files: `main.js`, `manifest.json`, `styles.css`, with built-in packs embedded in the bundle.

## What is still not permitted

This completes safe **drafting**. It is not adoption. There is no activation, no apply-to-existing-notes, no bulk undo or conflict-aware recovery, no versioned scope/exclusion contract, and no integrated no-regex custom journey — the existing custom editor stays discoverable, but milestone 2 has not been claimed. Not certified on mobile, across community themes, or on large vaults. Hands-on BRAT observation of whether the job is understandable comes before broadening into milestone 2.
