---
title: Bijectivity-representation army findings — synthesis from three-agent dispatch
description: Three Explore agents dispatched in parallel on per-transform bijectivity representation. Agent 1 = formal foundations (lens calculus, refinement types, BiGUL). Agent 2 = practical libraries (monocle-ts, io-ts, path-to-regexp, change-case). Agent 3 = adjacent domains (rsync, git, CRDTs, source maps, crypto, image converters, DB normalization, LLVM). Synthesis converged on a five-layer detection algorithm + per-transform metadata table. Canonical answer documented at concepts/bijectivity-detection.
tags: [research, architecture, bijection, transforms, phase-h]
sidebar:
  label: "04-27 · Bijectivity army findings"
  order: -20260427008
date: 2026-04-27
---

## What this is

The user surfaced a question during the F2 walkthrough: *"Anything that isn't trivially bijective can be encoded in frontmatter to allow for reversal. Granted, this may require building bijectivity representation stuff or abstractions per transform, unless there's something I don't know about? To research maybe with an army?"*

Three Explore agents dispatched in parallel, each with a different prior-art focus:

- **Agent 1 — Formal foundations**: lens calculus (Foster/Pierce, Boomerang, BiGUL), refinement types (Liquid Haskell, F*), algebraic effects, information-theory framing
- **Agent 2 — Practical libraries**: monocle-ts (TypeScript profunctor optics), partial-lenses, Haskell `lens`, io-ts codecs, path-to-regexp, change-case, lodash, slugify
- **Agent 3 — Adjacent domains**: rsync, git revert, CRDTs (Yjs/Automerge), source maps, cryptographic primitives, image format converters, database normalization theory, LLVM optimization passes, migration frameworks

This entry synthesizes the findings. The canonical answer (the detection algorithm + storage layer) is documented at [concepts/bijectivity-detection](/obsidian-folder-tag-sync/concepts/bijectivity-detection/) — read that page first if you want the *what we're doing* answer; this entry covers the *why* and *what we found across the field*.

## Three patterns observed across all domains

Reversibility metadata follows one of three patterns across the surveyed domains:

1. **Implicit (computed from structure)** — git revert (3-way merge attempt), database normalization (CHASE algorithm), cryptographic primitives (one-way functions vs ciphers), LLVM (invariant verifiers).
2. **Explicit-in-structure (config-determines)** — rsync (`--delete` / `--backup` flags), source maps (sidecar metadata), image converters (`quality` / `lossless` parameters).
3. **Stored metadata** (rare) — migration frameworks (presence of `down()` method).

**Folder Tag Sync uses Pattern #2** — config-determines-reversibility, inferred at derivation time via `derive.ts:204-231`'s `deriveBijective()` function and `pipeline.ts:126-157`'s `isTransformReversible()`. This is the production-best pattern and the one Agent 2 confirmed across multiple practical libraries.

## Agent 1 findings — Formal foundations

The lens-calculus literature (Foster/Pierce POPL 2005; Boomerang; BiGUL) validates our approach as sound. Specifically:

- **The three lens laws** (GetPut, PutGet, PutPut) are exactly what our `bijective: true` claim asserts. The literature confirms the boolean is the right shape.
- **Total vs partial lenses** map directly onto our existing primitives. `truncation/drop` is a *partial* lens — defined only within its depth-bounded domain. The pattern's `folderPattern.test(folderPath)` gate is how we enforce partiality.
- **Iso vs Lens vs Prism hierarchy** maps to our transfer ops: `identity` (with reversible transforms) = Iso; `marker-only` = Prism; `post-coordination` = Prism (lossy inverse).
- **Composition theorem**: bijective composition requires both individually-bijective AND intermediate types matching. Our pipeline's separation of recoordination (transfer op) from cosmetic transformation (case/emoji/etc.) is the right structural split.

**Missing from current model**: refinement-type-style domain constraints. A transform like `kebab-case` is reversible *only for inputs in a refined subset* (already lowercase, no internal hyphens). Liquid Haskell and F* point at this pattern; no production system has solved it cleanly for *data-driven rules* (vs *code*).

**Honest finding**: no production bijectivity-detection system exists for our exact domain. Boomerang assumes by construction. Most plugin tools just assert. Our explicit `transfer` + `inverseTransfer` fields are *more principled than most*.

## Agent 2 findings — Practical libraries

| Library | Pattern | Runtime metadata? | Our adoption? |
|---|---|---|---|
| **monocle-ts** | Type-hierarchy (Iso/Lens/Prism) | No; encoded in types | ✗ — wrong level for user-provided rules |
| **partial-lenses** | Type-tracked partiality | No; type-only | ✗ |
| **Haskell `lens`** | Type-hierarchy + lens laws | No; types + contracts | ✗ |
| **io-ts** | Paired decode/encode codecs | No auto-detection | ✗ — compositional but no introspection |
| **path-to-regexp** | TokenData structure | Implicit via token types | ✓ Partial — borrow for Layer 1 |
| **change-case** | None (all lossy) | No | ✗ |
| **slugify libs** | None (all lossy) | No | ✗ |

**Strongest finding**: our existing `derive.ts:deriveBijective()` *is the production pattern*. We compute bijectivity at derivation/spec-inspection time, expose it as a Boolean flag on `MappingRule`, and pair it with `inverseTransfer` (the operation itself, not just a flag).

The recommended enhancement (Agent 2): **granular per-filter metadata** rather than the current coarse-grained config-level flag. Currently we have `reversible: boolean` for the whole pipeline; the proposal is per-filter records (`{ emojiReversible, numberPrefixReversible, caseReversible, customRegexReversible[] }`) so the engine can give per-filter status indicators rather than a single yes/no for the whole rule.

## Agent 3 findings — Adjacent domains

Cross-domain survey of how reversibility metadata is represented in non-lens fields:

- **Database migration frameworks** (Rails, Django, Flyway): reversibility expressed as code structure (presence of `down()` method); no metadata field. Borrowable: explicit "irreversible migration" markers.
- **Git revert**: computed at runtime via 3-way merge attempt; no per-commit metadata. Borrowable: the merge-base (common ancestor) is conceptually the bijection witness; our equivalent is `inverseTransfer`.
- **CRDTs**: orthogonal — about commutativity and convergence, not reversibility per se. Not directly applicable.
- **Source maps** (Babel, TypeScript, esbuild): metadata sidecar pattern. Borrowable for future Path Lens artifact compilation but overkill for in-memory rule metadata.
- **Cryptographic primitives**: type/API structure expresses reversibility (hashes vs ciphers). Our `inverseTransfer: TransferOp | null` follows the same pattern — explicit operation, not a metadata flag.
- **Image format converters** (ImageMagick, ffmpeg, Pandoc): `quality` / `lossless` parameter at call time. Caller decides reversibility. Our `numberPrefixHandling: 'keep' | 'strip' | 'extract'` follows this pattern — config choice determines reversibility.
- **Database normalization theory**: lossless-join decomposition via formal proof (CHASE algorithm). Strong theoretical foundation but heavy machinery for our scope.
- **LLVM optimization passes**: invariant annotations on IR, not per-pass metadata. Useful insight: phase-ordering invariants matter; our pipeline's transform ordering (emoji → number → case → regex) is a similar invariant that affects reversibility.

**Strongest finding**: the cross-domain pattern that fits us best is image-converter-style (config-parameter-determines-reversibility), which is what we already do. The borrow is *making the metadata granular per filter* (Agent 2's recommendation) rather than per whole config.

## Synthesis — what we ship

The five-layer detection algorithm documented at [concepts/bijectivity-detection](/obsidian-folder-tag-sync/concepts/bijectivity-detection/):

1. **Layer 1 — Structural slot-overlap** (parse-time, very cheap)
2. **Layer 2 — Per-transform reversibility metadata** (parse-time, cheap)
3. **Layer 3 — Symbolic round-trip on rule save** (medium, runs on-demand)
4. **Layer 4 — Property-based testing** (expensive, opt-in for rule pack authors)
5. **Layer 5 — Runtime check on inverse direction** (cheap, defense-in-depth, always on)

The storage layer:

- `src/transformers/transformMetadata.ts` (new, ~150 LOC) — per-filter metadata records with `reversibility: 'total' | 'lossy' | 'conditional'` + optional `isReversibleFor(input)` predicate + optional `inverse` function + human-readable `reversibilityDomain` description.
- Integration into existing `derive.ts:deriveBijective()` (extend to read the metadata table).
- Integration into existing `pipeline.ts:isTransformReversible()` (replace the coarse flag-set with the granular table lookup).

**F2 commit 1 implements Layers 1+2** (~50 LOC additional beyond what's already planned). Layer 3 lands in commit 2. Layers 4+5 land later.

## Honest verdict

We're in good shape. Our existing design is industry-best by the cross-domain comparison. The "what's missing" is granularity (per-filter metadata vs per-config flag), which is a contained additive change.

**No fundamental redesign needed.** The user's worry — *"this may require building bijectivity representation stuff or abstractions per transform, unless there's something I don't know about?"* — is real but tractable: we build a small per-transform metadata table (~12 entries today), wire it into the existing derivation logic, and expose granular per-rule status indicators. That's it.

The lens-calculus literature is rigorous but designed for *code* (Boomerang grammars, Haskell types). Our domain is *data-driven rules authored by users at runtime*. Liquid-Haskell-style refinement-type domain constraints are a stretch goal (Layer 3's symbolic check approximates them); not blocking for v1.

## See also

- [Bijectivity detection (concept page)](/obsidian-folder-tag-sync/concepts/bijectivity-detection/) — the canonical *what we're doing* answer, distilled from this synthesis
- [Path Lens operators + bijectivity detection (research log)](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-path-lens-operators-and-bijectivity-detection/) — the original research framing
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge from primitives to bijection vocabulary
- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives whose bijectivity is statically known
- [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — F3, the recovery layer when bijectivity fails per-file
- [Path abstractions Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — Path Lens shapes; bijectivity detection is shape-agnostic
