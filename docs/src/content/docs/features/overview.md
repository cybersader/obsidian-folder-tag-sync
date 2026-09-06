---
title: Feature overview
description: Current Folder Tag Sync capabilities, including the task-oriented Taxonomy Workbench, deterministic mapping rules, safe previews, and both sync directions.
sidebar:
  order: 1
---

## Taxonomy Workbench

:::caution[Unreleased local refinement]
The Workbench behavior described in this section is under local evaluation. It has not been versioned, committed, pushed, released through BRAT, or published to the docs site; publication requires separate authorization.
:::

Taxonomy Workbench turns recognized folder systems into reviewable mapping rules through one persistent Obsidian view:

1. **Explore your vault** — inspect Ready and Possible systems alongside current enabled-rule output.
2. **Choose where rules apply** — check the highest folders to organize; everything below is included while each system keeps its correct detected starting folder.
3. **Review proposed rules** — inspect exact source-system provenance, coverage, examples, round-trip behavior, and overlaps.
4. **Review in Settings** — save rules disabled and jump to the exact highlighted draft for deliberate review.

### Global organizational-systems overview

- **Organizational systems in this vault** remains a vault-wide overview across Explore, Choose, and Review; selecting or focusing one occurrence does not turn the browser into a scoped filter.
- **Ready organizational systems** have enough occurrence-local evidence to propose rules.
- **Organizational systems needing more folders** remain inspect-only and state the missing folder types or unavailable required parent.
- Selecting an occurrence expands **Why Folder Tag Sync recognized this organizational system** directly beneath that card. The evidence scrolls with the card list rather than becoming a sticky header.
- Member and Support evidence stays attached to exact anchored occurrences; evidence from unrelated branches cannot combine.
- Overlapping systems retain separate identities and candidate provenance.

### Exact occurrence markers

A restrained deterministic marker follows one exact `occurrenceKey` across the compact overview, occurrence card, Explore relation, Scope context, and Scope plan. Repeated deployments of one pack can receive different markers, and the limited palette can repeat.

Markers are secondary, `aria-hidden` cues. System names, Ready/possible status, **Identifies**/**Supports** relationship text, exact semantic paths, and collision-safe occurrence identity carry the meaning; color never establishes pack identity, ownership, or actionability by itself.

### Responsive, tree-first layout

- The folder hierarchy remains the primary Explore scroller in wide, split, narrow, and short panes.
- The systems browser becomes a side column or overlay according to measured width and height.
- Folder detail becomes a side inspector or full-workspace overlay without shrinking tree height.
- Exact overlapping relations compact behind `+N systems` and expand without merging occurrence identities.
- Expansion, focused folder, selected occurrence, and scroll position survive ordinary rerenders and stage navigation in the open leaf.
- Scope has separate folder-chooser and plan scrollers joined by a focusable horizontal separator. Pointer drag, Arrow Up/Down, Shift+Arrow, Home/End, and double-click are supported.
- The preferred Scope split and both scroll positions are view-local to the open Workbench, not persisted detection or planning state.
- Scope rows reserve stable rail, checkbox, and disclosure slots so control geometry does not jump between parents, leaves, selected rows, absorbed rows, or inspect-only rows.

### Focus is context, not Scope filtering

A focused organizational system coordinates the same exact occurrence across the overview, tree, and plan. In Scope it may be labelled **Current organizational system** or **Current focus**, but focus never adds, removes, or filters deployments. Only checked folders determine which Ready occurrences continue; all Ready occurrences at or below those boundaries keep their own exact anchors.

### Directional status and exact conflict navigation

Each proposed rule reports the two directions independently:

- **Folder → tag**
- **Tag → folder**

Each direction is labelled Exact, Available, Conditional, Lossy, Unavailable, or Uncertain with a plain-language explanation. A lossy round-trip is not automatically blamed on both directions when the available evidence identifies only one side—or cannot identify which side causes the loss.

Conflict review names exact proposed and installed rule targets. Proposed targets focus and briefly highlight the exact Candidate row without changing selection. Installed targets open Settings centered on the exact rule. Predicted winners use the exact rule name at the sampled folder instead of exposing only an ID or anonymous conflict count.

## Safe proposed-rule installation

- Workbench-generated rules are always added **disabled**.
- Saving drafts does not run sync or modify folders, notes, tags, or frontmatter.
- Stale vault/settings snapshots cannot be installed until refreshed.
- Existing IDs are skipped, duplicate selections are deduplicated, persistence happens once, and in-memory rules roll back if saving fails.
- Enabling a saved rule is a separate deliberate action in Settings.

## Sync directions

| Direction | What it does |
|---|---|
| **Folder → tag** | Reads a note's folder path, produces tags, and writes them to frontmatter |
| **Tag → folder** | Reads tags, derives a target folder, and moves the note |
| **Bidirectional** | Supports both directions when the rule has an honest inverse |

## Rule model and matching

- Typed rules combine a `FolderClassifier`, `TagVocabulary`, and `TransferOp`.
- Raw regex remains available for structures the typed model cannot express.
- Rules support root, any-segment, and parent-scoped anchors for repeated/nested deployments.
- Runtime resolution uses group precedence, specificity, and priority tiebreaks.
- Round-trip metadata distinguishes exact, conditional, lossy, and unknown mappings.

## Transformation pipeline

Folder and tag sides can use ordered transformations such as:

| Step | Purpose |
|---|---|
| **Emoji handling** | Strip or preserve emoji markers |
| **Number prefix** | Preserve or remove Johnny Decimal-style prefixes |
| **Case conversion** | snake_case, kebab-case, Title Case, camelCase, or PascalCase |
| **Custom regex** | Apply explicit pattern/replacement transforms |

Not every mapping is reversible. The editor and Workbench surface lossy or uncertain round trips instead of claiming otherwise.

## Rule packs and system definitions

- Bundled packs include PARA, Johnny Decimal variants, SEACOW, Zettelkasten, and other validated definitions.
- Packs are embedded into `main.js`, so standard BRAT assets are sufficient.
- `.orgsys` definitions can be previewed and composed; composition remains preview-only until precedence and deployment provenance can be persisted safely.

## Rule management

- Guided and advanced rule editors.
- Enable/disable individual rules and groups.
- Group precedence and specificity-aware resolution.
- Folder/tag examples and current-vault match previews.
- Import/export and bundled rule-pack browsing.

## Preview and bulk operations

- Hierarchical sync previews with selective apply.
- Bulk folder-to-tag sync with confirmation.
- Conflict and winner visibility before mutation.
- Frontmatter witness data for safer inverse behavior.

## Support and privacy

The support-bundle preview can include configuration, derived rule diagnostics, a complete folder-only tree, and a bounded sanitized debug-log tail.

By default it excludes note filenames, note contents, frontmatter values, vault name, and absolute paths. Nothing uploads automatically; the user previews before copying.

## Commands

Important commands include:

| Command | What it does |
|---|---|
| **Taxonomy Workbench: explore your vault** | Opens the first job in the persistent Workbench leaf |
| **Taxonomy Workbench: choose where rules apply** | Opens a fresh folder-selection state |
| **Taxonomy Workbench: review proposed rules** | Reviews proposals from Ready detected systems |
| **Sync folder to tags (current file)** | Applies enabled folder-to-tag rules to the active note |
| **Sync tags to folder (current file)** | Applies enabled tag-to-folder rules to the active note |
| **Preview vault sync** | Builds a dry-run plan before bulk changes |

See the [roadmap](/obsidian-folder-tag-sync/about/roadmap/) for work that is not yet shipped.
