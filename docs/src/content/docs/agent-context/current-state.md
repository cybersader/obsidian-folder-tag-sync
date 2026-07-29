---
title: Current state
description: The "drop a fresh agent (or returning human) here and be oriented in two minutes" snapshot — the v0.1.39 BRAT release, responsive occurrence-first Workbench, and next open wall.
sidebar:
  label: "Current state"
  order: 0.5
---

:::tip[Read this first]
This is the fast-orientation page. If you're a fresh agent or a human returning after time away, read this top-to-bottom, then skim the [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) for any unfamiliar term. It's kept current deliberately — if it's stale, fix it.
:::

**As of:** v0.1.39 is the current BRAT release and includes the responsive Workbench usability repair described below · not yet in the Obsidian community catalog.

## What this plugin is, in one paragraph

Folders are a rigid single hierarchy; tags are a flexible overlapping (polyhierarchical) one. Folder Tag Sync bridges them with **deterministic, rule-based transformations** (regex + transform pipelines — never AI inference). A rule maps a folder shape to a tag shape and can run forward (folder → tag, additive: writes frontmatter tags) or inverse (tag → folder, moves files). Users get value without writing regex via **rule packs** (PARA, Johnny Decimal, SEACOW, …) that the plugin can recognize in the vault, scope to a branch, preview, and install.

## Where we are right now

The released v0.1.39 baseline includes both sync directions, the typed rule model, Path Lens templates, specificity-aware matching, group precedence, the frontmatter witness, bulk sync, known-system detection, `.orgsys` preview/composition, preview-first production support bundles with bounded structured debug logging, and the occurrence-first Taxonomy Workbench.

The release consolidates the previously separate detect and Scan & Snap workflows into **one persistent Taxonomy Workbench**, makes the Workbench occurrence-first, and includes the responsive usability repair that changes how it occupies space:

- **Organizational systems** — a compact shell-owned summary remains visible across every surface. The full occurrence browser is a collapsible side column at wide Workbench widths and a temporary overlay/drawer at narrow widths. One card still represents one anchored occurrence such as `PARA at Work`; repeated anchors stay separate. Incomplete occurrences remain visible by default as inspect-only, and a local preference can hide them.
- **Rule layers** — installed rules are grouped separately by runtime `MappingRule.group` and precedence inside a collapsed disclosure in the systems browser. Current-snapshot links to occurrences remain visibly labelled inferred or unknown because no durable deployment provenance exists yet.
- **Map** — read the vault hierarchy with neutral rows, explicit occurrence-specific Member/Support chips, neutral installed-rule results, and textual **Conflict** badges. Pack-colour rails/tints and decorative cross-panel connectors are removed. Overlapping folders still relate to every applicable occurrence. Detected / My rules / Both modes, folder detail, emitted-tag preview, Settings handoff, and “Choose this branch in scope” remain available. Short panes hide supplementary Map counters so the hierarchy retains usable height.
- **Scope** — inspect all complete/incomplete/suppressed evidence in one hierarchy, but select only branches containing actionable occurrences. Scope tint and absorbed selections reduce choices to a deterministic minimal cover. Deployments stay anchored at `occurrence.anchorPath`, preventing duplicated shapes such as `Projects/Projects`.
- **Candidates** — preview scoped or automatically detected rules grouped by exact occurrence, with coverage, sample emissions, bijectivity/lossiness, conflicts, predicted winners, and exact selection counts. Sorting happens inside each occurrence group. Adding drafts is confirmed and **always persists new rules disabled for review**.

Compatibility and safety contracts:

- Existing command IDs are preserved: `scan-vault-for-systems` routes to a clean Scope state, `scan-and-snap-draft-rules` routes to detected-instance Candidates, and `taxonomy-workbench-open-map` routes to Map.
- Routes reuse one Workbench leaf rather than detaching/recreating it, so workspace state, selected occurrence, local incomplete-visibility preference, and transient choices can survive navigation.
- Detection actionability is occurrence-local. Evidence from unrelated parents cannot combine; support evidence can strengthen its owning member-seeded occurrence but cannot seed one alone.
- Folder topology changes and successful settings saves increment a source revision. Open Workbenches mark themselves stale immediately, debounce recollection, disable stale candidate installation, and recheck freshness before persistence.
- Draft installation never creates/moves folders or changes notes, tags, frontmatter, or current sync behavior. Existing rule enabled states remain unchanged.
- Selected rule IDs are deduplicated, already-installed IDs are skipped, persistence occurs once, and an in-memory rollback restores the previous rule list if saving fails.
- Built-in rule packs are validated into an embedded catalog and bundled into `main.js`; detection, drafting, browsing, and installation work from the standard BRAT assets (`main.js`, `manifest.json`, `styles.css`) without a runtime `rule-packs/` directory.
- `.orgsys` composition remains preview-only. It must not reach the install path until composed group precedence can be persisted safely.

## How this evolved

The v0.1.22–0.1.27 campaign solved the **“where do my rules apply / what will actually happen?”** visibility problem:

- **0.1.22** — interactive [hierarchical sync preview](/obsidian-folder-tag-sync/agent-context/glossary/) with selective apply.
- **0.1.23** — [detection tree](/obsidian-folder-tag-sync/agent-context/glossary/), showing where patterns fired.
- **0.1.24** — [anchored instances](/obsidian-folder-tag-sync/agent-context/glossary/), separating repeated systems at different depths.
- **0.1.25** — [hierarchy-first detection](/obsidian-folder-tag-sync/agent-context/glossary/), making the user's folder tree the primary surface.
- **0.1.27** — [auto-scope](/obsidian-folder-tag-sync/agent-context/glossary/) and [scope tint](/obsidian-folder-tag-sync/agent-context/glossary/).
- **0.1.29 onward** — Scan & Snap candidate drafting, `.orgsys`, composition preview, the dockable Workbench Map, installed-rule sensing, and production support bundles.
- **2026-07-28 unreleased consolidation** — the proven detect, scope, preview, and install seams were connected inside the Workbench instead of competing as separate product surfaces.
- **2026-07-29 occurrence/deck redesign (released in 0.1.38)** — detection became occurrence-local, the Organizational systems / Rule layers read model made groups tangible, candidates became occurrence-grouped, and stale-source guards were added.
- **2026-07-29 responsive repair (released in 0.1.39)** — the always-expanded vertical deck became a compact summary plus wide side browser / narrow drawer; Map rails, pack tints, and decorative connectors were removed; short panes now prioritize the hierarchy over supplementary counters.

## Verification status

The released baseline plus the unreleased responsive repair pass these measured local gates:

- **Bun unit suite:** 1,150 passing, 0 failing, 2,754 assertions across 47 files.
- **Production build / TypeScript:** clean; the generated embedded catalog contains 8 validated packs (approximately 53.9 KiB source payload).
- **Obsidian-community lint:** clean.
- **Real Obsidian 1.12.7:** all 10 serial WDIO specs pass, **68 tests total**. Coverage includes occurrence-group rendering, keyboard tabs, cross-surface selection, incomplete inspect-only behavior, stale-install prevention, command-route recollection, Scope occurrence anchoring, three-file release parity, disabled installation, no fixture mutation, idempotent reinstall, deliberate enablement, support privacy, and the responsive repair's neutral folder rows, textual conflicts, wide side browser, narrow drawer, container-width switching, collapsed Rule layers, short-pane hierarchy preservation, and zero decorative connectors.
- **Docs:** 77 static pages build successfully; route/content smoke is 33/33 green.
- **Repository hygiene:** legacy `DetectVaultModal.ts` and `ScanAndSnapModal.ts` remain deleted; the now-unused `ConnectorOverlay.ts` is deleted; the CRLF-aware diff check is clean.
- **Visual inspection:** fresh desktop, 480 px, approximately 320 px, and short-height Workbench screenshots were inspected directly. The side browser leaves the active surface usable, the drawer does not permanently consume task height, short panes show the hierarchy immediately, and narrow panes remain free of page-level horizontal overflow.

The repair does not change the installation safety boundary: Workbench-generated rules are still added disabled for deliberate review, and no folders, notes, tags, or frontmatter are modified by drafting or installation.

## Next open wall

The occurrence-first deck closes both the duplicated detect-vs-Workbench UX and the folder-label-vs-group mismatch. The next architectural wall is **durable deployment provenance and installable composition**:

1. Define a deployment registry that persists occurrence/source/anchor identity across restart and manual rule edits without pretending current inferred associations are ownership.
2. Reconcile durable deployments across anchor rename/move, deleted evidence, split occurrences, and intentionally accepted incomplete structures.
3. Persist composed group precedence so `.orgsys` mounts can install without changing winner semantics after restart.
4. Add genuinely new rule synthesis for vault structures that match no built-in system, while keeping preview/conflict honesty.
5. Keep inverse-direction ambiguity, attachments, folder notes, and public plugin APIs as separate open questions rather than mixing them into Workbench installation.

## Community-plugin submission status

Not yet accepted into the Obsidian community catalog (a [submission PR stalled — see zz-log 2026-04-13](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-13-submission-pr-stalled/)). The reputation/grading system on community.obsidian.md is downstream of *acceptance*; the gate is passing Obsidian's automated review, which `eslint-plugin-obsidianmd` mirrors locally.

**Current `npm run lint` status:** clean after the final consolidation gate. Continue running lint together with build, unit tests, and the complete real-Obsidian E2E suite before any community-submission retry.

## Reading order for a fresh session

1. **This page** — released baseline, verified unreleased work, and the next wall.
2. [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) — every project term, plain-language, with code locations.
3. [Vision](/obsidian-folder-tag-sync/agent-context/vision/) — the problem and long-term goals.
4. [Decisions](/obsidian-folder-tag-sync/agent-context/decisions/) — what's settled and why.
5. [Open questions](/obsidian-folder-tag-sync/agent-context/open-questions/) — what's genuinely undecided.
6. [Exploration log](/obsidian-folder-tag-sync/agent-context/zz-log/) — dated session history, newest first.

:::note[Known-stale elsewhere]
Some `about/` pages still trail reality (for example, `about/development-status.md` has an old beta version and the roadmap lists several shipped features as future). The `agent-context/` docs are the source of truth for internal state; treat `about/*` version/status claims with suspicion until reconciled.
:::
