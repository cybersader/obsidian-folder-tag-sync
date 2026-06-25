---
title: Current state
description: The "drop a fresh agent (or returning human) here and be oriented in two minutes" snapshot — where the project is, the live direction, and the open wall, as of v0.1.27.
sidebar:
  label: "Current state"
  order: 0.5
---

:::tip[Read this first]
This is the fast-orientation page. If you're a fresh agent or a human returning after time away, read this top-to-bottom, then skim the [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) for any unfamiliar term. It's kept current deliberately — if it's stale, fix it.
:::

**As of:** v0.1.27 · distributed via BRAT · not yet in the Obsidian community catalog.

## What this plugin is, in one paragraph

Folders are a rigid single hierarchy; tags are a flexible overlapping (polyhierarchical) one. Folder Tag Sync bridges them with **deterministic, rule-based transformations** (regex + transform pipelines — never AI inference). A rule maps a folder shape to a tag shape and can run forward (folder → tag, additive: writes frontmatter tags) or inverse (tag → folder, moves files). Users get value without writing regex via **rule packs** (PARA, Johnny Decimal, SEACOW, …) they can detect in their vault or install from a catalog.

## Where we are right now

The engine is mature: two sync directions, a typed rule model, Path Lens templates, specificity-aware matching, frontmatter witness, bulk sync, and detection of known systems all ship. Test health is strong — **~795 unit tests (Bun) + 7 real-Obsidian E2E tests (wdio-obsidian-service), all green** as of 0.1.27.

The most recent campaign (v0.1.22 → 0.1.27) was one sustained push to solve the **"where do my rules apply / what will actually happen?" visibility problem** — the wall that made the plugin unusable on large real vaults. See the full arc in [zz-log 2026-04-30](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-detection-ux-and-auto-scope/). In short:

- **0.1.22** — interactive [hierarchical sync preview](/obsidian-folder-tag-sync/agent-context/glossary/) with selective apply (you see and pick the changes, by branch).
- **0.1.23** — [detection tree](/obsidian-folder-tag-sync/agent-context/glossary/): a scan now shows *where* in the vault each pattern fired.
- **0.1.24** — [anchored instances](/obsidian-folder-tag-sync/agent-context/glossary/): "JD at root AND inside Projects/X" reads as two distinct instances, not one blur.
- **0.1.25** — [hierarchy-first detection view](/obsidian-folder-tag-sync/agent-context/glossary/): packs become invisible plumbing; you navigate *your* folder tree.
- **0.1.27** — [auto-scope](/obsidian-folder-tag-sync/agent-context/glossary/) + [scope tint](/obsidian-folder-tag-sync/agent-context/glossary/): selecting a folder rewrites rules to fire only inside it, and the subtree visibly paints the reach before you apply.

## The live open question (the actual wall)

**Visibility is solved end-to-end; rule _authoring_ at scale is not.** The plugin can show you where existing packs fire and auto-scope a detected pattern to an entry point. But a user facing a large, idiosyncratic vault that *doesn't* match a prebuilt pack still hand-crafts `folderPattern` regex and `folderTemplate` strings in the rule editor, one rule at a time.

The 0.1.27 `scopeRules` / `minimalScopeCover` machinery proved the system can **synthesize correct rules from a structural selection**. The open question is how to generalize that into authoring *new* rules directly from the hierarchy-first tree — *"I can see exactly what my rules do; now how do I create the rules I need across a big vault without writing regex by hand?"*

**Likely next steps** (from the arc analysis — not yet committed):

1. Generalize scope-from-selection into rule **synthesis** — select folders in the tree, generate brand-new rules (pattern + template inferred from the selected structure), reusing `scopeRules.ts`.
2. An authoring-mode counterpart to the detection tree with a **live coverage preview** that updates as you define a rule (close the "what will this do" loop visually, not via the single-sample text preview in the current rule editor).
3. Share one annotated tree between user-authored rules and pack rules so authors see conflicts/overlaps before saving.
4. Stress-test the detection tree + scope tint on a **1000+ folder** vault for performance and legibility.

## Community-plugin submission status

Not yet accepted into the Obsidian community catalog (a [submission PR stalled — see zz-log 2026-04-13](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-13-submission-pr-stalled/)). The reputation/grading system on community.obsidian.md is downstream of *acceptance*; the gate is passing Obsidian's automated review, which `eslint-plugin-obsidianmd` mirrors locally.

**Current `npm run lint` status (as of this snapshot):** NOT clean. Two issues:

- **Real blockers:** ~11 `obsidianmd/ui/sentence-case` violations in `src/ui/RuleEditorModal.ts` and `src/ui/SettingsTab.ts` (Title Case / non-sentence-case UI strings the review bot rejects).
- **Config noise:** the lint config tries to type-check `*.test.ts` files that aren't in the `tsconfig` project, producing parser errors. Fix by excluding test files from the lint `files` glob (or adding them to a lint tsconfig). Not a real violation, but it buries the real ones.

Both are mechanical fixes; neither is done yet. Knock these out before re-attempting submission.

## Reading order for a fresh session

1. **This page** — where we are + the live direction.
2. [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) — every project term, plain-language, with code locations. Use it the moment a term is unfamiliar.
3. [Vision](/obsidian-folder-tag-sync/agent-context/vision/) — the problem and long-term goals.
4. [Decisions](/obsidian-folder-tag-sync/agent-context/decisions/) — what's settled and why.
5. [Open questions](/obsidian-folder-tag-sync/agent-context/open-questions/) — what's genuinely undecided.
6. [Exploration log](/obsidian-folder-tag-sync/agent-context/zz-log/) — dated session history, newest first.

:::note[Known-stale elsewhere]
Some `about/` pages still trail reality (e.g. `about/development-status.md` says "v0.1.7 beta"; the roadmap's "Rule Analytics" item lists shipped features as future). The `agent-context/` docs are the source of truth for internal state; treat `about/*` version/status claims with suspicion until reconciled.
:::
