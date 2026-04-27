---
title: Bijectivity detection
description: How the Path Lens engine determines whether a rule round-trips — the storage layer (per-transform metadata) and the algorithm layers (structural slot overlap, per-transform reversibility, symbolic execution, property-based testing, runtime defense). Built bottom-up from existing primitives in derive.ts and pipeline.ts; aligns with lens-calculus formal foundations and production library patterns.
sidebar:
  order: 6
---

This page documents **how the engine knows whether a rule is bijective**. Not as an asserted metadata claim ("trust the rule author"), but as a computed property the engine derives from the rule's structure plus per-transform metadata.

It builds on [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) (which says *why* bijectivity matters) and [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) (which gives the eight primitives that determine the structural side). This page covers the **detection layer that bridges them** — what the engine stores about each transform, and the algorithm it runs to decide a rule's bijectivity status.

The work synthesizes findings from a three-agent research dispatch (formal foundations, practical libraries, adjacent domains) plus the existing codebase patterns in `src/engine/derive.ts:204-231` (`deriveBijective()`) and `src/transformers/pipeline.ts:126-157` (`isTransformReversible()`). The good news: our current pattern is already industry-best — Pattern #2 from the cross-domain survey (config-determines-reversibility, inferred at derivation time). What this page adds is a more granular metadata layer per transform, plus the layered algorithm that composes the existing checks into one unified bijectivity verdict.

## What gets stored, where

The bijectivity verdict for a rule depends on three sources of information:

1. **Transfer-op semantics** (already in `src/types/typed.ts:138-167`). Each of the eight `TransferOp` primitives carries an inherent bijectivity profile — `identity` is bijective; `marker-only` is many:1 by design; etc. The verdict here is *static per op* and already encoded in the typed model.

2. **Per-transform reversibility metadata** (the new layer this page proposes). Each filter in the transform pipeline (`kebab-case`, `snake_case`, `Title Case`, `lower`, `upper`, `strip-emoji`, `strip-num-prefix`, `keep-num-prefix`, `extract-num-prefix`, `join('-')`, custom regex) needs a metadata record specifying its reversibility characteristics. This is the granular layer that the current `isTransformReversible()` flag-set abstracts over.

3. **Per-rule slot overlap** (Path Lens specific, F2 onward). When a rule is authored in a Path Lens shape (template / lens-flavored / slot-objects), the slots that appear on both sides round-trip; slots only on one side document a lossy direction. This is purely structural — derivable from the rule's syntax without runtime checks.

The combined verdict for a rule:

```
rule.bijective = transferOpBijective(rule.transfer)
              ∧ allTransformsReversible(rule.folderTransforms ∪ rule.tagTransforms)
              ∧ allSlotsCovered(rule.folderTemplate, rule.tagTemplate)  // F2 only
```

The current engine implements parts 1 and 2 (with coarse-grained transform flags); part 3 lands when F2 ships.

## The per-transform metadata table

This is the storage layer the user surfaced as "building bijectivity representation stuff or abstractions per transform." Each filter in the F2 v1 set carries a record like:

```typescript
interface TransformBijectivityProfile {
  /** Always reversible | never reversible | conditional on input domain */
  reversibility: 'total' | 'lossy' | 'conditional';

  /**
   * If 'conditional', the predicate that says when reversibility holds.
   * The engine can call this on actual input values to determine bijectivity
   * for a specific input. Optional; absent = 'always conditional'.
   */
  isReversibleFor?: (input: string) => boolean;

  /**
   * Human-readable description of the input domain for which this transform
   * is reversible. Surfaced in the UI as part of the rule's status indicator.
   */
  reversibilityDomain?: string;

  /**
   * The inverse transform (if available). For round-trip computation, the
   * engine needs both directions. Some transforms have no inverse (strip-emoji);
   * those are 'lossy'.
   */
  inverse?: (output: string) => string;
}
```

Concrete entries for the F2 v1 filter set:

| Filter | Reversibility | Domain (when conditional) | Has inverse? |
|---|---|---|---|
| `keep` (no-op) | `total` | n/a | yes (identity) |
| `kebab-case` | `conditional` | input is single-line word characters; no internal hyphens | yes (Title Case approximation) |
| `snake_case` | `conditional` | input is single-line word characters; no internal underscores | yes (Title Case approximation) |
| `Title Case` | `conditional` | input has clean word boundaries; no acronyms | yes (kebab/snake) |
| `lower` | `conditional` | input is already lowercase | yes (Title Case best-guess) |
| `upper` | `conditional` | input is already uppercase | yes (Title Case best-guess) |
| `strip-emoji` | `lossy` | n/a | no |
| `strip-num-prefix` | `lossy` | n/a | no |
| `keep-num-prefix` | `total` | n/a | yes (no-op) |
| `extract-num-prefix` | `conditional` | extracted prefix is preserved in a separate slot | yes (re-attach) |
| `join('-')` | `lossy` | inputs contain no `-` characters | no (separator collision) |
| `regex-replace(pattern, replacement)` | `lossy` (default) | inputs match the pattern unambiguously | no (custom-author-provided inverse only) |

This table lives at `src/transformers/transformMetadata.ts` (proposed). Each entry is a constant; new filters get added as the F2 implementation grows.

The entries are conservative — `lossy` by default unless we have evidence the transform round-trips. This avoids the failure mode where the engine claims bijectivity that doesn't hold at runtime.

## The detection algorithm — five layers

A rule's bijectivity verdict is computed by composing five layers, in order from cheap-and-static to expensive-and-runtime:

### Layer 1 — Structural slot-overlap (parse time, very cheap)

Walk the folder template's slots and the tag template's slots. The rule passes Layer 1 iff every folder slot appears in the tag template, every tag slot appears in the folder template, and there are no unsourced or matched-but-discarded slots beyond what the engine deliberately allows.

```typescript
function passesLayer1(rule: PathLensRule): boolean {
  const folderSlots = extractSlotNames(rule.folderTemplate);
  const tagSlots = extractSlotNames(rule.tagTemplate);
  return folderSlots.size === tagSlots.size && [...folderSlots].every(n => tagSlots.has(n));
}
```

Layer 1 catches the most common authoring mistake — slot name typos or accidentally omitting a slot. It runs at template-parse time (no runtime cost).

For non-Path-Lens shapes (regex), Layer 1 is skipped; structural overlap doesn't apply.

### Layer 2 — Per-transform reversibility (parse time, cheap)

For each slot in the rule, walk its filter pipeline; look up each filter in the metadata table from the previous section. Combine results:

- All filters `total` → slot is `total`
- Any filter `lossy` → slot is `lossy`
- All filters `total` or `conditional` → slot is `conditional`

The rule's overall reversibility is the conjunction of all slots' reversibilities — `lossy` if any slot is lossy; `conditional` if no lossy but at least one conditional; `total` only if every slot is total.

```typescript
function passesLayer2(rule: PathLensRule, table: TransformMetadataTable): RuleBijectivityVerdict {
  const slotResults = rule.slots.map(slot =>
    composeFilterChain(slot.filters, table)
  );
  const aggregate = aggregateReversibility(slotResults);
  return aggregate;
}
```

The current `isTransformReversible()` in `pipeline.ts` is a coarse-grained version of Layer 2. The proposed enhancement is splitting the per-filter metadata into individual records (table above) so the verdict is granular per slot, not per whole config.

### Layer 3 — Symbolic round-trip on rule save (medium cost)

When the user saves a rule, the engine runs forward + inverse on a small set of representative inputs (drawn from the user's actual vault folders matching the rule's pattern). If any round-trip fails, the engine warns:

> *"This rule failed bijection on `Projects/Web Auth/oauth-flow.md` — inverse direction produced `projects/web-auth/oauth-flow` (different from original after Title-Case round-trip). Consider enabling frontmatter memory or normalizing folder casing."*

Concrete failure cases the user can react to. Layer 3 catches Layer 2's "conditional" verdicts that fail in practice on the user's actual data.

```typescript
function passesLayer3(rule: PathLensRule, samples: string[]): SymbolicCheckResult {
  const failures: string[] = [];
  for (const folder of samples) {
    const tag = applyForward(folder, rule);
    if (tag === null) continue;
    const reconstructed = applyInverse(tag, rule);
    if (reconstructed !== folder) failures.push(folder);
  }
  return { passed: failures.length === 0, failures };
}
```

Sample selection: the engine picks ~10 folders matching the rule's pattern (or all if fewer). For large vaults, this is fast; for small vaults, it covers everything.

### Layer 4 — Property-based testing (expensive, opt-in)

Power users can request a deeper check from settings: *"Run 1000 random round-trips on this rule against a generator targeting realistic folder patterns; report failures."* Used by rule pack authors before publishing — not for everyday rule authoring.

QuickCheck-style; not implemented in v1. Lives behind an "Advanced — verify bijection" command in the settings UI.

### Layer 5 — Runtime check on inverse direction (cheap, always runs)

Even after Layers 1-4, the engine also checks at runtime when the inverse direction fires: did the inverse produce a folder that matches the rule's forward pattern? If not, the rule is broken on this specific input. The engine logs / warns rather than producing a destructive move.

```typescript
function applyInverseSafely(tag: string, rule: PathLensRule): string | null {
  const proposedFolder = applyInverse(tag, rule);
  if (proposedFolder === null) return null;

  const reconstructedTag = applyForward(proposedFolder, rule);
  if (reconstructedTag !== tag) {
    // Round-trip check failed at runtime — abort the move
    console.warn(`Rule ${rule.id} round-trip check failed on ${proposedFolder}`);
    return null;
  }

  return proposedFolder;
}
```

This is defense-in-depth — even if Layers 1-4 missed something, Layer 5 prevents destructive runtime moves. Cheap to implement; always on; never produces a wrong file move.

## How this composes with other foundations

The five-layer detection system lives *between* several other foundation pieces and is intentionally narrow in scope:

- **[Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/)** provides the eight primitives whose bijectivity is statically known. Bijectivity detection at the transfer-op level is already covered there.
- **[Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/)** explains *why* bijection matters and the philosophical framing (lossy ≠ broken; lossy is intentional). Bijectivity detection turns those concepts into runtime decisions.
- **[Path abstractions Part 2 — solutions in practice](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/)** surveys the seven candidate Path Lens shapes; bijectivity detection is *shape-agnostic* (works for regex, templates, slot-objects, lens-flavored).
- **[Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/)** is the *recovery layer* that complements bijectivity detection: when a rule is *not* bijective, frontmatter memory provides per-file recovery. The two compose: per-rule status from this page, plus per-file witness from F3 frontmatter memory, gives the user a complete picture.
- **[F4 frontmatter-property-driven destination](/obsidian-folder-tag-sync/about/roadmap/)** extends the storage layer further — when slot values come from frontmatter properties, the bijectivity-detection algorithm has a new input source to reason about.

The detection algorithm doesn't replace any of these. It's the bridge between transfer-op semantics (static) and runtime behavior (dynamic).

## Implementation plan

The detection algorithm lands in three phases tied to F2 implementation:

### F2 commit 1 — Layers 1+2 (~50 LOC additional)

When the path-template compiler emits a `CompiledTemplate`, the result includes:

1. The compiled regex (the existing output)
2. The slot list with per-slot filter metadata (NEW)
3. A computed bijectivity verdict (`total` / `conditional` / `lossy`) based on Layers 1+2

The rule editor's status chip surfaces this verdict directly. Green chip for `total`; yellow chip for `conditional` with the conditional-domain message; orange chip for `lossy` with the lossy-direction signal.

The metadata table at `src/transformers/transformMetadata.ts` ships with this commit — initially populated for the F2 v1 filter set. Future filter additions extend the table.

### F2 commit 2 — Layer 3 (~100 LOC additional)

Symbolic round-trip on rule save. Triggered after the user clicks "Save rule" or "Apply changes" in the rule editor. Runs against a sample of vault folders (or `__fixtures__/vaultFolderLists.ts` synthetic samples in tests).

Adds a "Verify bijection" entry to the rule editor that runs Layer 3 on demand for users who want deeper validation.

### F2 commit 3 / future — Layer 4 (opt-in advanced) + Layer 5 (always-on runtime)

Layer 4 ships as an Advanced settings command: "Run 1000 round-trips on this rule" with a progress bar and a failures report. Useful for rule pack authors before publishing.

Layer 5 ships in `applyTransfer.ts:applyRuleInverse` as a defensive check before returning the proposed folder destination. Catches anything Layers 1-4 missed.

## Open questions

These are real and unresolved:

- **How does the user override the engine's verdict?** If the engine says `conditional` and the user knows their data satisfies the domain, can they assert `iso: true` and the engine accepts it? Or always trust the engine's check? Per the lens-calculus literature, user assertions should be respected when explicit; the engine's role is to *warn*, not *forbid*.
- **How is "conditional bijection" surfaced?** A rule that's bijective for word-character inputs but not for emoji-prefixed inputs — what does the status chip say? "Yes (for these inputs)" with a hover-reveal? "Conditional" is the plain answer; the ergonomics of communicating the *condition* are the question.
- **What's the cost of Layer 3 on rule save in a 10K-file vault?** Running symbolic checks against all matching folders could be slow. Mitigations: throttle to 10-20 samples; run async; only on first save; opt out via setting.
- **Per-transform metadata: who maintains the table?** Small (~12 filters today) but extends as new filters land. Source of truth is `src/transformers/transformMetadata.ts`; new filter PRs must include their reversibility profile.
- **Domain-restricted bijectivity** — a rule may be bijective on the user's vault but not on arbitrary inputs. Does the engine specialize the verdict to the user's domain, or stay general? Layer 3 implicitly does the former; explicit specialization is a future feature.

## Why this design (vs alternatives)

The three-agent research dispatch surveyed the alternatives:

- **Type-hierarchy reversibility** (monocle-ts, Haskell `lens`) — encodes Iso/Lens/Prism distinction in types. *Wrong abstraction level for user-provided rules*; we'd need users to declare which optic level a rule belongs to, and they don't think in those terms.
- **Codec composition** (io-ts) — paired decode/encode with no auto-reversibility detection. *Same compositional pattern as our existing approach*, but without the per-filter metadata granularity we need for per-rule warnings.
- **Token-structure reversibility** (path-to-regexp) — implicit in token types. *Could be borrowed* for the structural Layer 1 check, but doesn't help with Layers 2-5.
- **No metadata** (change-case, slugify) — pure forward transformations; the caller must track loss separately. *Insufficient* for our bidirectional engine.
- **Formal lens calculus** (Boomerang, BiGUL) — assume reversibility by construction at compile time. *Different paradigm*; we want to support discovered, runtime-authored rules, not compile-time-checked grammars.

Our design — three-layer storage (transfer-op semantics + per-transform metadata + slot overlap) and five-layer algorithm (structural / per-transform / symbolic / property-based / runtime) — composes the best of each. We have the explicitness of codec libraries, the granularity of refinement-type-flavored conditions, and the defense-in-depth of runtime checks.

This is more rigorous than any production system surveyed. Boomerang assumes; monocle-ts encodes-in-types; io-ts composes-without-introspection; we *compute*.

## See also

- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — why bijection matters; the philosophical framing
- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives whose bijectivity is statically known
- [Path Lens operators + bijectivity detection (research log)](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-path-lens-operators-and-bijectivity-detection/) — the full research framing
- [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — the recovery layer when bijectivity fails
- [Path abstractions Part 2 — solutions in practice](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — Path Lens shapes
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
