---
title: Current state
description: The "drop a fresh agent (or returning human) here and be oriented in two minutes" snapshot — the v0.1.41 BRAT baseline plus the unreleased local Workbench evidence, Scope, and candidate-review refinements.
sidebar:
  label: "Current state"
  order: 0.5
---

:::tip[Read this first]
This is the fast-orientation page. If you're a fresh agent or a human returning after time away, read this top-to-bottom, then skim the [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) for any unfamiliar term. It's kept current deliberately — if it's stale, fix it.
:::

**As of:** v0.1.41 is the current BRAT release. It adds a self-explaining semantic grammar across the Workbench on top of the v0.1.40 card-containment repair · not yet in the Obsidian community catalog.

**Unreleased local work (2026-07-31):** `feature/workbench-split-ux` combines the tree-first split repair with a task-oriented product journey and a follow-up evidence/Scope/candidate clarification. Visible navigation is **Explore your vault → Choose where rules apply → Review proposed rules**, while stable internal `map | scope | candidates` state and command IDs remain compatible. **Organizational systems in this vault** is a global overview across all three jobs. Selecting an occurrence expands its identifying evidence beneath that card; the evidence scrolls with the list and is deliberately not sticky. Exact occurrence markers provide a restrained secondary cross-surface cue while text and semantic paths remain authoritative. In Scope, focus is context only—checked folders are the sole deployment filter—and a keyboard-accessible view-local divider separates the stable folder chooser from the plan without persisting UI geometry as domain state. Proposed rules show each sync direction independently, name exact conflict targets, navigate to exact proposed or installed rows, and still save as count-bearing disabled drafts. No version bump, commit, push, Release, docs publication, or BRAT publication has been made; local evaluation comes first.

The companion `folder-tag-sync-test-fixtures` branch `feature/workbench-ux-lab` adds an isolated topology-only `UX Lab/` generator with seven invented scenarios: overlapping JD + Enterprise JD, repeated Ready PARA, a PARA occurrence needing more folders, partial Enterprise, SEACOW support plus nested JD, deep Unicode PARA, and a negative control. It has no rule-apply path and opens an in-app `Start here.md` guide. The guide now exercises the global organizational-systems overview, non-sticky selected evidence, secondary exact-occurrence markers, focus-versus-folder-selection boundary, stable Scope row geometry, accessible view-local divider, directional statuses, exact conflict-target navigation, disabled Settings focus, and the local no-publication boundary.

## What this plugin is, in one paragraph

Folders are a rigid single hierarchy; tags are a flexible overlapping (polyhierarchical) one. Folder Tag Sync bridges them with **deterministic, rule-based transformations** (regex + transform pipelines — never AI inference). A rule maps a folder shape to a tag shape and can run forward (folder → tag, additive: writes frontmatter tags) or inverse (tag → folder, moves files). Users get value without writing regex via **rule packs** (PARA, Johnny Decimal, SEACOW, …) that the plugin can recognize in the vault, scope to a branch, preview, and install.

## Where we are right now

The released v0.1.41 baseline includes both sync directions, the typed rule model, Path Lens templates, specificity-aware matching, group precedence, the frontmatter witness, bulk sync, known-system detection, `.orgsys` preview/composition, preview-first production support bundles with bounded structured debug logging, and the occurrence-first Taxonomy Workbench.

The release consolidates the previously separate detect and Scan & Snap workflows into **one persistent Taxonomy Workbench**, makes the Workbench occurrence-first, and includes the responsive usability repair that changes how it occupies space. The v0.1.40 containment follow-up explicitly resets multi-line browser controls to content-driven height so occurrence evidence, missing roles, long anchors, selected detail, and Rule layers remain inside their own boxes across themes.

The v0.1.41 semantic-legibility release adds one shared visual grammar: every important object states **what it is**, **where it sits in context**, **what state it is in**, and **what an action will do**. Semantic paths render parent context separately from the applicable segment, preserve a complete accessible label, and wrap long or Unicode paths without making colour carry the meaning:

- **Organizational systems** — the shell shows Ready/possible counts and a compact focused-system context without implying that focus constrains planning. The side/overlay browser is a global **Organizational systems in this vault** overview: Ready occurrences come first, occurrences needing more folders stay in a collapsed inspect-only group, and selected evidence expands beneath the selected card and scrolls naturally with the list. A Ready card offers the explicit **Choose where this system applies** transition; card focus alone still does not add, enable, filter, or silently select rules. Exact occurrence markers are secondary cues only.
- **Installed rule layers** — installed rules remain separate from detected systems, grouped by runtime `MappingRule.group` and precedence inside a collapsed disclosure. Current-snapshot occurrence links remain explicitly inferred or unknown because durable deployment provenance does not exist yet.
- **Explore your vault** (`map` internally) — the tree-first read-only surface distinguishes system evidence from enabled installed-rule output through **Systems / Active rules / Both**. Predicted tags are inline; redundant preview Notices and generic Settings actions are gone. Exact winner links say **Review winning rule in settings**, and the alternate branch handoff says **Organize this folder and everything below**.
- **Choose where rules apply** (`scope` internally) — the primary decision is the highest folder to organize; everything below is included. The selected occurrence is **Current organizational system** context and may be marked **Current focus**, but only checked folders determine the plan. Stable rail/checkbox/disclosure slots keep row geometry aligned across topology and state changes. Separate chooser and plan scrollers are joined by an accessible horizontal separator with pointer and keyboard resizing; preferred split height and both scroll offsets are view-local. **What happens next** separates included folders from Ready systems at their exact occurrence anchors. Raw stats, weak/suppressed evidence, and visual highlighting remain explanatory and cannot change the plan.
- **Review proposed rules** (`candidates` internally) — exact source occurrence grouping, anchors, examples, coverage, stale protection, and disabled-draft safety remain. Each row now reports **Folder → tag** and **Tag → folder** independently instead of collapsing all reversibility into one ambiguous badge. **Rule overlap** sections name exact proposed and installed targets; proposed targets focus the exact Candidate row without changing checks, installed targets open the exact Settings row, and the sampled predicted winner uses the exact rule name. Proposals start selected, **Save N draft rules** confirms and persists them disabled, and no files, folders, tags, frontmatter, or current sync behavior change.

Compatibility and safety contracts:

- Existing command IDs are preserved: `scan-vault-for-systems` routes to a clean Scope state, `scan-and-snap-draft-rules` routes to detected-instance Candidates, and `taxonomy-workbench-open-map` routes to Map.
- Routes reuse one Workbench leaf rather than detaching/recreating it, so workspace state, focused occurrence, scope choices, and transient selections can survive navigation. The retired `showIncompleteSystems` field remains only as version-2 state compatibility and normalizes to the grouped always-available model.
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
- **2026-07-28 consolidation (released beginning in 0.1.38)** — the proven detect, scope, preview, and install seams were connected inside the Workbench instead of competing as separate product surfaces.
- **2026-07-29 occurrence/deck redesign (released in 0.1.38)** — detection became occurrence-local, the Organizational systems / Rule layers read model made groups tangible, candidates became occurrence-grouped, and stale-source guards were added.
- **2026-07-29 responsive repair (released in 0.1.39)** — the always-expanded vertical deck became a compact summary plus wide side browser / narrow drawer; Map rails, pack tints, and decorative connectors were removed; short panes now prioritize the hierarchy over supplementary counters.
- **2026-07-30 containment follow-up (released in 0.1.40)** — real production-shaped cards exposed Obsidian/theme fixed button heights. Multi-line cards and headers now use content-driven height, wrap long titles safely, and are guarded by child-containment and sibling-intersection geometry assertions.
- **2026-07-30 semantic-legibility pass (released in 0.1.41)** — parent context and the applicable path segment became separate semantic elements; systems, evidence, Scope boundaries, system anchors, Candidate groups/rules, and runtime layers now identify their object type and action consequence in plain text. Visual inspection also exposed and fixed a Candidate-header flex-wrap regression and cramped occurrence annotations.
- **2026-07-31 tree-first split-screen redesign (unreleased local branch)** — measured width + height tiers replace binary responsiveness; the hierarchy becomes Map's stable primary scroller; folder detail stops shrinking it; repeated occurrence cards compact behind exact `+N systems` disclosure; independent expansion/inspection/focus actions and view-local place preservation target actual vertical and horizontal Obsidian splits.
- **2026-07-31 task-oriented Workbench redesign (unreleased local branch)** — visible nouns become jobs; Ready/possible grouping replaces an unexplained preference; Scope becomes a highest-folder decision; proposed-rule saving uses one count-bearing disabled-draft CTA and exact Settings focus. A same-day follow-up supersedes the earlier sticky-detail description: the browser remains a global overview and selected evidence expands in place under the card.
- **2026-07-31 evidence, Scope, and candidate follow-up (unreleased local branch)** — exact occurrence markers become secondary cross-surface cues; focus is clarified as context rather than Scope filtering; an accessible view-local Scope divider and stable row slots preserve usable geometry; Candidate rows expose directional status plus exact named conflict navigation.

## Verification status

The v0.1.41 semantic-legibility release passes these measured gates:

- **Bun unit suite:** 1,155 passing, 0 failing, 2,759 assertions across 48 files, including 5 focused semantic-path tests.
- **Production build / TypeScript:** clean; the generated embedded catalog contains 8 validated packs (approximately 53.9 KiB source payload).
- **Obsidian-community lint:** clean.
- **Real Obsidian 1.13.4:** all 10 serial WDIO specs pass, **70 tests total**. Coverage includes occurrence-group rendering, keyboard tabs, cross-surface selection, semantic context/focus paths, complete versus inspect-only consequences, Candidate group/rule identity, Runtime-layer language, stale-install prevention, command-route recollection, inclusion-boundary-versus-system-anchor planning, three-file release parity, disabled installation, no fixture mutation, idempotent reinstall, deliberate enablement, support privacy, Settings-owner-document compatibility, neutral Map rows, textual conflicts, wide side browser, narrow drawer, approximately 320 px and short-pane layouts, zero decorative connectors, and card/detail/Runtime-layer containment.
- **Docs:** 78 static pages build successfully; route/content smoke is 33/33 green.
- **Repository hygiene:** core detection, planning, persistence, sync, and runtime files have no diff; the CRLF-aware diff check and added-line private-identifier scan are clean. Generated screenshots and existing support-bundle images remain untracked and unpublished.
- **Visual inspection:** fresh invented-fixture screenshots were inspected directly for Map Both mode, selected occurrence detail, Installed rule layers, Scope boundary-versus-anchor planning, Candidates before/after adding disabled drafts, the 480 px drawer, approximately 320 px pane, and short-height pane. Semantic labels wrap without overlap, Candidate group headers remain bounded, and inclusion boundaries stay visibly distinct from system anchors.

The unreleased tree-first, task-oriented branch has additionally passed these local gates:

- **Companion UX lab:** 288 tests, 0 failures, 1,232 assertions; the focused fixture registry is 167/167 with 1,101 assertions; strict build is clean; 35 marker-owned, tag-free invented notes are generated under `UX Lab/` with the in-app guide.
- **Main plugin:** 42 focused Workbench state/session/presentation tests and the complete 1,168-test Bun suite pass with 0 failures and 2,779 assertions across 50 source test files; production build, strict TypeScript, and Obsidian-community lint are clean.
- **Focused real Obsidian 1.13.4 journey:** 7 Workbench specs pass, **40 tests total**: navigation (5/5), Organizational systems (7/7), Map sensing and exact winner focus (8/8), Scope (7/7), proposed-rule saving (6/6), split geometry/interactions (6/6), and the end-to-end novice journey (1/1).
- **Complete real Obsidian 1.13.4 suite:** all 12 serial WDIO specs pass, **77 tests total**, including the legacy typed-model Scope assertion updated for the closed **Why these systems were detected** disclosure. The known non-failing renderer-timeout warning can still appear during teardown of support/Settings-heavy specs.
- **Responsive visual review:** fresh wide, screenshot-shaped split, approximately 480 px, approximately 320 px, short-horizontal, Scope, Candidates, and systems-browser PNGs were inspected directly. The earlier review caught sticky-detail reopening/occlusion and a clipped 320 px inspector action. The same-day evidence follow-up supersedes the sticky-detail approach entirely: selected evidence now expands beneath its card and scrolls with the global list. Wrapping full-width tight-pane actions keep next steps readable without reducing hierarchy space. Exact Settings focus is additionally guarded by connected-container, visible-row, centered-row, exact-ID, and adjacent-row assertions.
- **Docs:** 81 static pages build successfully and route/content smoke is 33/33 green, including the same-day evidence/Scope follow-up log.

The preceding v0.1.40 containment fix received private local-only production-shape validation in an isolated `/tmp` vault. No private fixture, path, screenshot, diagnostic, alias, or derived structure was written into the repository or uploaded. The v0.1.41 semantic-legibility pass used only invented permanent fixtures and did not reconstruct that production export.

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

1. **This page** — released baseline, current verification, and the next wall.
2. [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) — every project term, plain-language, with code locations.
3. [Vision](/obsidian-folder-tag-sync/agent-context/vision/) — the problem and long-term goals.
4. [Decisions](/obsidian-folder-tag-sync/agent-context/decisions/) — what's settled and why.
5. [Open questions](/obsidian-folder-tag-sync/agent-context/open-questions/) — what's genuinely undecided.
6. [Exploration log](/obsidian-folder-tag-sync/agent-context/zz-log/) — dated session history, newest first.

:::note[Known-stale elsewhere]
Some `about/` pages still trail reality (for example, `about/development-status.md` has an old beta version and the roadmap lists several shipped features as future). The `agent-context/` docs are the source of truth for internal state; treat `about/*` version/status claims with suspicion until reconciled.
:::
