---
title: Open questions
description: Unresolved design decisions — help wanted.
sidebar:
  order: 4
---

Questions where the right answer isn't obvious yet. Input welcomed — open an issue.

:::note
This page was reconciled against the v0.1.38 BRAT release and its occurrence-first Workbench on 2026-07-29. Several former open questions have shipped — see [Resolved](#resolved-since-this-page-was-written) at the bottom. Terms are defined in the [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/).
:::

## When a tag could resolve to several folders, how do we pick — and when do we ask the user?

A file has tags `#projects/alpha` and `#archive/2024`. Rule 1 says `#projects/*` → `Projects/`, Rule 2 says `#archive/*` → `Archive/`. Where does the file go?

**Partially resolved.** The *automatic* resolution layer shipped with [F1](/obsidian-folder-tag-sync/agent-context/glossary/): [specificity-aware matching](/obsidian-folder-tag-sync/agent-context/glossary/) picks the most-specific rule, and [group precedence](/obsidian-folder-tag-sync/agent-context/glossary/) lets installed packs declare a deterministic pecking order. Priority is now the manual override tiebreak, not the primary key.

**Still open:** the *interactive* path (A1). For genuinely-ambiguous inverse-direction cases where the user should decide rather than have specificity silently pick, there's no conflict-resolution modal in `src/ui/`. Options remain: prompt-on-conflict modal, refuse-and-report, or an opt-in per-rule `onConflict: 'skip' | 'prompt' | 'priority'`. Decide whether automatic resolution is *always* enough or whether a prompt mode is worth the UX cost.

## Should rules support "remove the triggering tag after a successful move" (`removeSourceTag`)?

When tag→folder moves a file, should we strip the triggering tag from frontmatter? Otherwise the tag persists and the next sync is a harmless no-op, but it leaves a breadcrumb the user may not want.

**Still open.** Note this is **distinct from `removeOrphanedTags` (A6), which shipped** — that removes *FTS-written* tags a rule no longer emits, gated by the [frontmatter witness](/obsidian-folder-tag-sync/agent-context/glossary/). `removeSourceTag` is the narrower "consume the tag that triggered *this* move" behavior and is not implemented. Current thinking: opt-in, never default (surprises users).

## How do we handle folder notes (`FolderName/FolderName.md`)?

Some users (especially with the Folder Notes plugin) treat a folder and its eponymous note as one entity. On tag→folder sync, should we move the folder note with the file, skip folder notes, or treat the folder note as the tag-carrier for the whole folder?

**Still open (A3 cross-cutting).** No folder-note handling exists in `TagToFolderSync`. Likely opt-in `handleFolderNote: 'move' | 'skip'`.

## What about attachments?

If `moveToFolder` relocates `my-note.md`, what happens to `_attachments/my-note-image.png`?

**Still open (A3).** `TagToFolderSync` moves only the single `.md`, not attachments/canvases. Needs to read Obsidian's `attachmentFolderPath` and handle edge cases (shared attachment folders, external links). Options: ignore / move-in-lockstep / warn-but-don't-touch.

## Should rule matching be case-sensitive?

Regex is case-sensitive by default; users can add an `i` flag manually, but most probably want case-insensitive matching out of the box.

**Still open.** No `caseSensitive` field exists on `MappingRule`. Proposal: add `caseSensitive: boolean`, default `false`.

## API for other plugins?

Templater and QuickAdd users might want `getTargetFolder(tags)` / `getTagsForFolder(path)` helpers.

**Still open (A2).** No API surface is exposed on the plugin instance yet. Proposal: `app.plugins.plugins['folder-tag-sync'].getTargetFolder(tags)` as a stable, documented API; don't guarantee internal rule-engine stability.

## Genuinely future (no implementation or research yet)

- **F4 — frontmatter-property-driven destination resolution.** Resolve a file's target folder from a frontmatter property rather than its tags. Depends on settled F2/F3 (both shipped) but has no design entry yet.
- **A5 — ordinal slot-value priority + cross-area auto-cleanup.** Use Johnny-Decimal-style ordinals as priority signals and auto-clean tags when a file moves across areas. Depends on the [frontmatter witness](/obsidian-folder-tag-sync/agent-context/glossary/) (shipped) but is otherwise unbuilt.

## The live wall: installable composition and unknown-structure synthesis

The duplicate detect/draft/Map product surfaces are no longer the open question: the current consolidation puts known-system evidence, branch scoping, candidate preview, and disabled installation into one Taxonomy Workbench.

The occurrence-first deck makes the next questions more precise:

1. **What is the durable deployment registry?** The current deck is a snapshot projection. Candidate provenance is exact while planning, but installed rules do not persist `occurrenceKey`, source pack, anchor, or deployment identity. Decide what survives restart and how it reconciles when rules are edited manually.
2. **How should anchor renames and moves reconcile?** Folder topology invalidates and refreshes the current snapshot safely, but a future durable occurrence/deployment record needs a policy for renamed anchors, moved member folders, split occurrences, and deleted evidence.
3. **How should composed `.orgsys` precedence be persisted?** Composition is preview-only because mounted systems need a stable group-precedence contract that survives save/reload. Installing before that is solved could change predicted winners after restart.
4. **How should the plugin synthesize rules for structures no built-in pack recognizes?** Scope selection and coverage/conflict preview are reusable seams, but raw hierarchy → principled typed/template rule synthesis still needs constraints, user controls, and hostile examples. It must not guess silently or turn weak detection evidence into automation.
5. **Should users be able to accept an incomplete occurrence as intentional?** Incomplete evidence is currently inspect-only. A future explicit acceptance mechanism would need durable provenance and clear consequences; lowering thresholds silently is not acceptable.

A direct “mount this system here” Map gesture is now a shortcut/design question over the existing Scope/Candidates machinery, not a separate architecture.

## Resolved since this page was written

- **Vault-wide batch application** — shipped in 0.1.23 as the [hierarchical sync preview](/obsidian-folder-tag-sync/agent-context/glossary/) (`preview-vault-sync` + `sync-entire-vault` commands, `VaultSyncPreviewModal` with dry-run tree, per-rule legend filter, and selective subtree apply). Folder-scoped application also shipped via [auto-scope](/obsidian-folder-tag-sync/agent-context/glossary/) in 0.1.27.
- **"Where do my rules apply?" visibility** — shipped as the rule coverage report (`show-rule-coverage`) plus the whole [detection tree](/obsidian-folder-tag-sync/agent-context/glossary/) / [hierarchy-first](/obsidian-folder-tag-sync/agent-context/glossary/) arc.
- **Separate detect, draft, and Map products** — resolved by the 2026-07-28 Taxonomy Workbench consolidation. The historical command IDs now route into one persistent Map / Scope / Candidates leaf; new drafts install disabled.
- **Orphan tag removal** — shipped as `removeOrphanedTags` (A6), witness-gated.
