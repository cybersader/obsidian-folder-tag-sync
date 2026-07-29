---
title: Organizational systems deck
description: Detection becomes occurrence-local and the persistent Workbench makes anchored system groups tangible without pretending inferred rule links are durable ownership.
tags: [session-log, taxonomy-workbench, detection, organizational-systems, rule-layers, accessibility, testing]
sidebar:
  label: "07-29 · Organizational systems deck"
  order: -20260729001
date: 2026-07-29
---

## Prompt

The consolidated Taxonomy Workbench still presented known systems mainly as labels attached to individual folders. That made the evidence visible, but not the coordinated group. A `Projects` folder could look independently labelled “PARA” even though the meaningful object is the whole anchored occurrence, such as **PARA at Work**, with its member roles, supporting evidence, rule candidates, overlaps, and lifecycle state.

The requested redesign was to make organizational-system groups tangible and explorable while preserving folder-first navigation and deterministic, non-destructive rule generation.

## Product model

The Workbench now distinguishes three related but non-equivalent structures:

1. **Organizational-system occurrences** — anchored groups detected from local folder evidence. Repeated systems at different anchors remain separate.
2. **Folder relations** — a folder can be a member or support for every applicable occurrence, including overlapping systems.
3. **Rule layers** — installed runtime rules grouped by `MappingRule.group` and precedence. They are not treated as the owner or identity of a detected system.

One persistent **Organizational systems** deck remains mounted across Map, Scope, and Candidates. Complete occurrences are actionable. Incomplete and suppressed occurrences remain visible by default for inspection, but cannot create Scope deployments or Candidates. **Show incomplete systems** is a local Workbench preference rather than a plugin setting.

## Occurrence-local detection

Detection now produces first-class anchored occurrences instead of using a pack-wide score as the action boundary.

- Member evidence seeds an occurrence at a shared local anchor.
- Support evidence attaches to the nearest compatible member-seeded occurrence and can strengthen its local score, but cannot create an occurrence alone.
- Evidence can be counted by stable semantic roles or distinct folder paths according to pack policy.
- Alternative signals may share one role, preventing naming variants from inflating confidence.
- `scopedUnder` relationships resolve against qualifying parent occurrences with explicit locality semantics.
- Each occurrence is independently `actionable`, `incomplete`, or `suppressed`.
- Pack-level detection summaries remain compatibility/reporting data; they no longer authorize actions.

Bundled PARA, Johnny Decimal, SEACOW, and enterprise detection metadata was updated for the new roles and occurrence policies. The generated manifest and embedded catalog validate the extended schema.

## Occurrence-native planning

The detection tree now exposes both:

- an all-evidence map for honest display; and
- an actionable-only map for deployment and candidate planning.

Scope selection includes an actionable occurrence when the selected boundary contains its anchor or evidence, but deployment always stays anchored at `occurrence.anchorPath`. Selecting a support folder therefore deploys the owning system occurrence rather than inventing a new nested anchor. Incomplete and suppressed occurrences never deploy.

Candidate rows retain exact `occurrenceKey` provenance and are grouped by occurrence. Noise and conflict sorting happens inside each group while checkbox selection remains keyed by the exact candidate row. Exclusive-system warnings are occurrence-local rather than pack-global.

## Persistent read model

`organizationalSystemsProjection.ts` is a pure immutable projection that joins current detection output, candidate rows, installed rules, and precedence into:

- occurrence cards;
- exact candidate groups;
- precedence-ordered Rule layers;
- typed occurrence/folder/candidate/rule relations.

Candidate provenance is exact while the candidate plan exists. Installed rules do not persist source pack, anchor, occurrence key, or deployment identity, so their associations are rendered as **inferred** or **unknown**. The deck is deliberately a current-snapshot read model, not a durable deployment registry.

Workbench persisted state migrated from v1 to v2 with:

- `selectedSystemInstanceKey`;
- `preferences.showIncompleteSystems`.

Valid v1 states migrate without losing their surface, Map mode, Scope choices, Candidate choices, or folder detail. Selection persists across surfaces and one-leaf route reuse, but reconciliation clears an occurrence that no longer exists or is hidden by the local preference.

## Shell and interaction design

The Workbench shell now owns three persistent pieces outside the replaceable active panel:

- `OrganizationalSystemsDeck`;
- `RuleLayersSection`;
- `ConnectorOverlay`.

Occurrence cards lead with system name, anchor, lifecycle state, evidence threshold, member/support counts, and missing roles. Selecting a card reveals member, support, missing-role, parent-scope, and suppression relations. Incomplete and suppressed details explicitly say **Inspect only**.

Map and Scope folder rows render textual occurrence-specific relation chips. A folder involved in overlapping systems exposes every applicable occurrence key. Candidate group headings select the same occurrence card, preserving cross-surface identity.

On desktop, a pointer-inert, `aria-hidden` SVG draws connectors only from the selected occurrence to visible endpoints. Text chips remain the semantic source. Connectors disappear in narrow panes. Container queries based on actual Workbench width reflow the deck and chips at approximately 480 px and 320 px without page-level horizontal overflow.

The Map/Scope/Candidates navigation now follows tab semantics with ArrowLeft, ArrowRight, Home, and End behavior. Collection status uses a polite live region; errors use alert semantics; primary controls retain native buttons, checkboxes, disclosures, and touch-sized targets.

## Freshness and installation safety

The plugin owns a monotonic Workbench source revision. It increments after:

- a successful settings save;
- folder creation;
- folder deletion;
- folder rename/move.

Ordinary note edits do not invalidate folder topology. An open Workbench marks its snapshot stale immediately, announces the refresh, disables Candidate installation, debounces recollection, and compares the candidate snapshot revision again before persistence. A stale plan is refused and recollected rather than installed.

The existing installation boundary remains unchanged:

- new Workbench rules are always persisted disabled;
- current enabled states remain unchanged;
- installation does not create/move folders or modify notes, tags, frontmatter, or current sync behavior;
- candidate IDs are deduplicated and existing IDs are skipped;
- persistence occurs once, with in-memory rollback on save failure.

## Privacy boundary

Full occurrence evidence is not serialized into support bundles. Support detection summaries explicitly omit occurrence anchors, keys, and evidence arrays. Existing support guarantees remain intact: no note filenames by default, note contents, frontmatter values, vault name, absolute paths, reverse alias legend, automatic upload, or silently truncated “complete” folder tree.

## Verification

Final measured gates for this redesign:

- Focused Workbench model/render tests: **36 passing, 0 failing**, 146 assertions.
- Full Bun unit suite: **1,152 passing, 0 failing**, 2,765 assertions across 47 files.
- Production build and strict TypeScript check: clean; 8 embedded packs, approximately 53.9 KiB source payload.
- Obsidian-community ESLint: clean.
- Real Obsidian 1.12.7 WDIO: **10/10 specs and 68/68 tests passing**, serial runtime 16m48s.
- The new deck spec contributes 6 passing tests, including keyboard tabs, cross-surface occurrence identity, incomplete inspect-only behavior, local preference reconciliation, selected-only desktop connectors, narrow-pane removal, and stale-install prevention.
- Existing Scope, Candidates, Map, support/privacy, typed-model, and idempotency suites remain green.
- Desktop, 480 px, and approximately 320 px screenshots were captured and inspected.

The final documentation build/smoke and repository diff checks are recorded in the current-state page after their gate run.

## Deferred wall

This slice intentionally does not create durable ownership. The next architectural work is to define a deployment registry that can survive restart and manual edits, reconcile anchor renames/moves and split occurrences, persist composed `.orgsys` precedence, and support explicit acceptance of intentional incomplete systems without silently lowering thresholds.

## Release delivery

This work ships in **v0.1.38** through the standard BRAT-compatible GitHub Release. The release contains `main.js`, `manifest.json`, and `styles.css`; the tag-triggered workflow rebuilds those assets from the committed source. Workbench-generated rules remain disabled by default after publication.
