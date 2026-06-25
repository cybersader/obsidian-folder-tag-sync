---
title: Scan & Snap Phase 0+1 shipped (v0.1.29)
description: The first clickable slice of the authoring-at-scale builder ships — Phase 0 engine refactors plus Phase 1 (pure planner + ScanAndSnapModal). A command that scans your vault and drafts conflict-checked candidate rules from detected packs, no regex by hand. Includes the E2E gotcha that the release gate caught.
tags: [session-log, builder, scan-and-snap, shipped, e2e]
sidebar:
  label: "04-30 · Scan & Snap shipped (0.1.29)"
  order: -20260430003
date: 2026-04-30
---

## Where this entry picks up

Continues from the [Scan & Snap design](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-authoring-at-scale-scan-and-snap-design/). The design's Phase 0 and Phase 1 are now built, tested, and shipped as **v0.1.29** (BRAT). This is the first time a user can scan their vault and get drafted rules without writing regex.

Built across three delegated subagents (each verified independently by the main agent), with the release gate — the real-Obsidian E2E run + version bump — kept under direct control. That gate earned its keep: it caught a failure the unit tests couldn't.

## What shipped

### Phase 0 — engine refactors (commit `847f58b`, no version bump)
Pure, internal, zero user-facing change, so the builder can reuse engine code:
- Exported `inferFolderScheme` / `inferFolderNaming` from `inferTyped.ts` (were private).
- Lifted `AXIS_CONVENTIONS` (axis→marker table) into a shared `src/engine/axisConventions.ts` + added `slugifyToTagEntry`.
- Deduped the copy-pasted emoji/JD normalizer (`matchesNormalized` et al.) into `src/engine/folderNormalize.ts`; both `detectPacks.ts` and `detectionTree.ts` import it.
- Added a `derive → infer → derive` round-trip test proving `folderAnchor` survives **when carried explicitly**, plus a documented test showing `under:` anchors are *not* recoverable from regex shape alone (why the future synthesizer must carry anchors, never re-infer them).
- **Known quirk pinned, not fixed:** `stripEmojiAndJD` doesn't fully normalize emoji+JD folders at *inner* path segments (`Output/📁 01 - Projects/Web` → `Output/ 01 - Projects/Web`). Preserved verbatim (silently "fixing" would shift detection) and locked with a `KNOWN QUIRK` test. Only affects path-scoped signals on deeply-nested decorated vaults — revisit deliberately when next touching detection.

### Phase 1a — the pure planner (commit `937ebce`, no version bump)
`src/engine/scanAndSnapPlan.ts` — `buildScanAndSnapPlan(input)` turns detected packs + vault folders into `CandidateRow[]`. For each detected pack's [anchored instance](/obsidian-folder-tag-sync/agent-context/glossary/), it `scopeRules` the pack's rules onto the anchor and computes per row: coverage (`previewRule`), bijectivity verdict (layered over template/typed/flag shapes, falling back to `'unknown'`), and a **conflict analysis computed over `candidates ∪ existingRules`** that distinguishes benign candidate-vs-candidate overlap from the dangerous collides-with-an-installed-rule case, naming the predicted runtime winner via `findBestMatch`. Plus `sortCandidatesByNoise` / `sortCandidatesByConflict` triage helpers. 19 unit tests.

### Phase 1b — the modal (commit `ef54e65`) + bump (`7edd517` → v0.1.29)
`src/ui/ScanAndSnapModal.ts` + the `scan-and-snap-draft-rules` command ("Scan & snap: draft rules from my vault"). On open: walk folders → `detectPacks` → load detected packs' JSON from disk → `buildScanAndSnapPlan` → render a candidate table. Per the locked decisions: **every candidate checked by default**, **junk (0-match) sorted to the top**, **read-only** (never creates/moves folders). Each row shows a coverage chip, a bijectivity chip (Lossy / 1:1 / Conditional), and a conflict badge (red "Overlaps an existing rule" vs soft "Overlaps another candidate", with the predicted winner in the tooltip) plus sample folder→tag emissions. "Add N rules" → confirm modal → dedupe-by-id merge into settings.

## The E2E gotcha the release gate caught

The first real-Obsidian E2E run **failed 4/6**: the modal opened but rendered zero candidate rows (empty state). Root cause: the wdio install only copies `main.js` / `manifest.json` / `styles.css` — **not** the `rule-packs/` folder. Detection still works (the manifest is *bundled into the build*), so the modal opens; but the modal loads pack *rules from disk* to build candidates, finds none, and shows the empty state.

This is a **test-environment gap, not a product bug** — real BRAT/community installs ship the full plugin directory, so the pack files are present. The fix (in `scan-and-snap.e2e.ts`, same approach as `typed-model.e2e.ts`): the `before` hook now reads the repo's `rule-packs/*.json` (Node side) and stages them into the test vault's plugin dir via the adapter before the modal runs. Re-run: **6/6 green.**

Worth noting: the earlier `scope-detect` E2E never exercised disk pack-loading (it only renders the detection tree, which needs just the bundled manifest + folder list). Scan & Snap is the first E2E to load pack files on open, so it surfaced the gap. **Latent robustness question for later:** consider bundling pack *rules* at build time too (the way the manifest already is), so the feature degrades gracefully even on a stripped install.

## Verification (all independently re-run by the main agent)
- `bun run build` clean · `bun test src` **843 pass / 0 fail** · `npm run lint` **0 errors** (submission-readiness held) · `scan-and-snap.e2e.ts` **6/6 pass** in real Obsidian · no AI attribution in any commit.

## Next: Phase 2

The SEACOW axis legend with open "snap" slots — activating the `compatibleWith` / `axes` pack metadata that's currently parsed but consumed by zero app code, so a user sees "your Work axis is an open slot" and can snap a compatible block (PARA / JD / Zettelkasten) onto it, with a hover scope-tint preview. Then Phase 3 (the raw-structure synthesizer) and Phase 4 (establish + save-as-pack). See the [design entry](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-authoring-at-scale-scan-and-snap-design/) for the full plan.
