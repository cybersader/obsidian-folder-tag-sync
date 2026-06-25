---
title: Authoring at scale — the "Scan & Snap" design + decisions
description: The chosen design for rule authoring at scale — a scan-first wizard (Vault Cartographer / "Scan & Snap") that never opens blank, composes org-system Lego blocks onto the user's real branches, and ships the safe detection-driven path before the risky raw-structure synthesizer. Includes the locked product decisions and the "two manifestation modes" insight.
tags: [session-log, design, authoring, builder, seacow, lego-blocks, decided]
sidebar:
  label: "04-30 · Authoring-at-scale design"
  order: -20260430002
date: 2026-04-30
---

## Where this entry picks up

The [2026-04-30 detection-UX arc](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-detection-ux-and-auto-scope/) closed by naming the open wall: visibility is solved, but **rule authoring at scale** is not. This entry records the design we landed on for that wall, the product decisions the user made, and the build sequencing. It is the active workstream.

The design was produced by a multi-agent design pass (1 grounding read + 4 independent designs + a 3-judge panel + synthesis), all grounded in the actual code. The three judges (feasibility, novice-empathy, correctness) **unanimously** ranked the same winner.

## The problem framing (user's words)

- The anchor pain is **inferring rules from structure**: *"lots of people just don't understand where to start when trying to build up something."*
- The mental model is **SEACOW(r) as a meta-framework**, under which you *"modularly use some of those existing information organizational systems (PARA, Johnny Decimal, Zettelkasten…), kind of like Lego blocks"* — composed onto your real vault.
- All four pains matter, in priority: (1) infer from structure, (2) bulk-author many rules, (3) see impact while authoring, (4) trust correctness (conflicts + lossy warnings before commit).

## The chosen design: "Scan & Snap" (Vault Cartographer)

**A wizard that never opens blank.** One command walks the vault once, runs the existing detection, and narrates the structure back in SEACOW terms (*"you look ~80% SEACOW-outer + JD here; your Work axis is an open slot"*) — which answers "where do I start" and teaches the Lego model in one breath. Then it presents a **candidate-rule table** (not a blank modal): each row is a real rule pre-synthesized onto one of the user's actual branches, with a live match-count chip, a lossy/1:1 chip, and a conflict badge. The user toggles, sorts junk up to delete, tweaks with a one-knob editor ("full path" / "first level only" / "one fixed tag"), and commits behind a confirm. Open SEACOW axes render as "snap a block here" slots offering compatible packs. Later, the user can export their curated set **as their own pack**.

### The key sequencing insight (why this design won)

The genuinely hard, unproven piece is the **raw-structure synthesizer** (infer a rule from folders matching no known system). Grounding verified the inference helpers (`inferFolderScheme`/`inferFolderNaming`) are private, crude, and operate on a single folder name — so true arbitrary-structure inference is real net-new risk (a wrong guess silently yields a lossy/mis-scoped rule the user trusts because they only reviewed coverage).

So we **defer the synthesizer to Phase 3** and ship the MVP entirely from the *proven* path: Phase 1 is essentially a re-skin of the already-tested `DetectVaultModal.applySelected` flow (`detect pack → scopeRules onto the branch → preview → conflict-check → commit`). It produces **nothing the runtime can't already run**. If synthesis quality ever disappoints, the product still wins on detection alone. The risk is contained, not existential.

### Two correctness fixes the panel caught (needed regardless)

1. `computeConflicts(rules, folderPaths)` only inspects the array passed to it — it does **not** union in `settings.rules`. The wizard must compute conflicts over `[...candidates, ...existingRules]` or it can silently commit a rule that collides with an installed one.
2. A raw overlap count **overcounts** benign precedence-resolved overlaps. Pair each badge with `calculateMatchConfidence` to **name the predicted runtime winner** ("rule X wins here"), since `findBestMatch` resolves by group → confidence → priority.

## Locked product decisions

| Decision | Choice |
|---|---|
| **Sequencing** | Safe-first: ship the detection-driven wizard over *recognized* packs first; raw-structure synthesizer is **Phase 3**, behind the validated table. |
| **First screen** | Candidates **enabled by default**; low-confidence / 0-match rows **sort to the top** for fast deletion ("here's your starter set, trim it"). |
| **Vault mutation** | **Read-only for now.** The wizard reads structure and writes rules/tags only — never creates or moves folders (the existing tag-sync stays the only mutation). |
| **SEACOW framing** | Present blocks as **labels / a tagging-style affordance**, not a wall of axis/transfer-op dropdowns. |

## The "two manifestation modes" insight (user, worth keeping)

When you snap an org-system block (e.g. PARA) onto your vault, it can manifest **two ways** — this is the [`folderAnchor`](/obsidian-folder-tag-sync/agent-context/glossary/) distinction made tangible:

1. **Unfold at the current level** — the folders that already exist at this branch *are* the block's buckets (you already have `Projects/ Areas/ Resources/ Archive/` here; PARA just maps them). Read-only; maps existing structure. → anchor `root`, or `under: <existing branch>` with the buckets as existing siblings.
2. **Create a container, then unfold below it** — make a new folder and nest the block's structure under it (create `Work/`, put PARA inside). Requires folder creation. → anchor `under: <new container>` + an `establish.createFolders` action.

**Scope:** the read-only MVP supports **mode 1 only**. Mode 2 (create-then-unfold) rides with **Phase 4** (`establish`), consistent with "read-only for now." The labeling UI should let the user say "this branch *is* PARA" (mode 1) without implying folder creation.

## Phased plan (all on existing seams)

- **Phase 0 (in progress, internal-only)** — pure refactors so the builder can reuse engine code: export `inferFolderScheme`/`inferFolderNaming`; lift the axis→marker table (`AXIS_CONVENTIONS`) into a shared `axisConventions.ts` + a `slugifyToTagEntry` helper; dedupe the emoji/JD normalizer (`matchesNormalized` et al., copy-pasted across `detectPacks.ts` + `detectionTree.ts`) into a shared `folderNormalize.ts`; add a `derive → infer → derive` folderAnchor round-trip test. No UI, no version bump.
- **Phase 1 (MVP)** — `ScanAndSnapModal`: a candidate-rule table forked from `DetectVaultModal`. One vault walk; for each `extractInstances` anchored instance of a detected pack, `scopeRules` it onto the anchor → toggleable rows with `previewRule` coverage chip, `deriveBijective` lossy chip, and a conflict badge computed over **candidates ∪ existing rules** with the `calculateMatchConfidence`-named winner. Sortable triage (0-matches, conflict). Batch "Add N rules" through the verified `onApply` path behind `ConfirmModal`. Unmatched branches get a "draft a rule from this branch" button that opens the guided editor pre-seeded (today's behavior — never worse).
- **Phase 2** — SEACOW axis legend with open "snap" slots; `composeResolver.ts` reads packs' `compatibleWith`/`exclusiveWith` (currently parsed but consumed by **zero** app code) to rank inner blocks for an open axis. Hover scope-tint preview before snapping.
- **Phase 3** — `synthesizeRules.ts`: per dense *unrecognized* branch, sample real child leaf names, run the now-exported inference helpers, pick a default transfer (identity / marker-only / truncation), derive a tagEntry via the lifted slugify helper, emit `Partial<TypedRuleSpec>[]` carrying `folderAnchor` **explicitly** (never re-inferred from regex). Conservative, framed as "draft," trivially deletable, assigned a non-default precedence group.
- **Phase 4** — opt-in `establish.createFolders` execution (idempotent, additive, confirm-gated) = mode-2 "create then unfold"; plus "save as pack" export, closing the Lego loop.

## Biggest risk

Synthesis quality on idiosyncratic vaults (Phase 3) is make-or-break and the one unproven piece. Mitigation is structural and baked into the phasing: ship all real value first from the safe detection path (Phases 1–2 produce nothing the runtime can't run, nothing whose anchor needs regex re-inference), so the wizard is valuable *before* the synthesizer exists; then land synthesis conservatively, behind the validated preview+conflict table, with anchors carried explicitly and every guess shown with an inline rationale.

## Still-open decisions (deferred, not blocking MVP)

- **Conflict strictness at commit:** hard-block while any candidate-vs-existing conflict remains, or warn-and-allow (trusting deterministic `findBestMatch` resolution)? Leaning warn, because the conflict count overcounts benign overlaps.
- **Synthesis aggressiveness (Phase 3):** conservative (high-confidence drafts only, omit unguessable fields) vs comprehensive (best-guess per dense branch). Leaning conservative to protect trust.
