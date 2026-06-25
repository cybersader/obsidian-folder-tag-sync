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

## The active workstream — authoring at scale ("Scan & Snap")

**Visibility is solved end-to-end; rule _authoring_ at scale is the wall** — and as of 2026-04-30 we've **decided the approach** and started building it. Full design + decisions: [Authoring-at-scale design](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-authoring-at-scale-scan-and-snap-design/).

The design is **"Scan & Snap" (Vault Cartographer)** — a scan-first wizard that never opens blank: it walks your vault, narrates it back in SEACOW terms ("you're ~80% SEACOW-outer + JD; your Work axis is an open slot"), and hands you a populated, previewed, conflict-checked candidate-rule table composed from org-system Lego blocks snapped onto your real branches. It was the **unanimous** winner of a 3-judge design panel.

**Locked decisions:** ship the *safe* detection-driven path first (raw-structure synthesizer deferred to Phase 3); candidates **enabled by default** with junk sorted up; **read-only** (no folder creation in MVP); SEACOW axes presented as **labels**, not jargon dropdowns. A user insight to honor: an org-system block manifests two ways — *unfold at the current level* (map existing folders; MVP) or *create a container then unfold below* (Phase 4 `establish`).

**Build status:** **Phase 0 in progress** — pure internal refactors (export inference helpers, share the axis-conventions table + a slugify helper, dedupe the emoji/JD normalizer, add a folderAnchor round-trip test) so the builder reuses engine code. No user-facing change, no version bump. Phases 1→4 are laid out in the design doc, all on existing seams (`detectPacks`, `scopeRules`, `previewRule`, `computeConflicts`, `deriveRule`, `extractInstances`).

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
