---
title: "Challenge 09: Per-transform reversibility profile — which transforms compose to a bijective whole?"
description: Challenge 02 asks the broad question of whether bidirectional rules are reversible in practice. This challenge drills into the per-transform layer — what's the bijection profile of each pipeline transform (kebab, snake, Title, emoji-strip, number-prefix, custom-regex), under what input domains, and which combinations compose reversibly? Should each transform carry an explicit bijectivity profile in the type system?
tags: [research, architecture, transforms, reversibility, bijection, phase-3]
sidebar:
  label: "09 · Transform reversibility"
  order: 9
---

## Prompt for the dispatched agent

Open this challenge in a fresh-context Claude / LLM session, paste the URL, and say *"research this challenge."* The reading list below is layered for **progressive disclosure** — start at level 1 if you're new to the project, jump deeper if you already know the context.

**The question in one sentence:** what's the bijection profile per pipeline transform (case, emoji, number-prefix, custom-regex), and which combinations compose to a reversible whole — should each transform carry an explicit reversibility metadata field, and how should the engine warn the user when a chosen combination is silently lossy?

### Reading order (level 1 → level 4)

1. **Foundations** (orient first if new to the project):
   - [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary; `bijection`, `lossy`, `lossless`, `cardinality`
   - [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — typed-model layers; the `match → extract → recoordinate → transform → emit` pipeline
2. **Core concepts for this question**:
   - [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge page; per-op lossy/lossless flavors; the load-bearing distinction this challenge applies at the transform layer
   - [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives the transforms run *after*; pipeline ordering matters
3. **Direct context** (the research that frames this challenge):
   - [Challenge 02 — Pipeline reversibility](/obsidian-folder-tag-sync/agent-context/zz-challenges/02-pipeline-reversibility/) — the broader framing this challenge drills down on
   - [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — relevant because templates introduce per-slot transforms (`{slug | kebab}`); the per-transform bijectivity profile composes with slot bijection
   - [Solution brainstorm (working draft)](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) — explicitly names "where templating challenges bijectivity" — transforms are the leak
4. **Reference (optional, code-level grounding)**:
   - [Transformations reference](/obsidian-folder-tag-sync/reference/transformations/) — exact transform definitions
   - [Rule schema](/obsidian-folder-tag-sync/reference/rule-schema/) — `TransformConfig` shape
   - `src/transformers/caseTransformers.ts`, `src/transformers/emojiTransformers.ts`, `src/transformers/numberTransformers.ts`, `src/transformers/regexTransformers.ts` (read on the GitHub repo) — each transform's actual implementation

### Deliverable

Short report at `agent-context/zz-log/YYYY-MM-DD-challenge-09-findings.md` (~1500–2500 words). Required sections: per-transform bijectivity profile (table of (transform, input-domain, output-domain, reversible-yes/no/conditional, edge cases)), composition rules (which transforms commute, which don't, which combinations are bijective on common inputs), recommended type-system additions (e.g., a `reversibility: 'bijective' | 'lossy' | 'conditional'` field on each transform; a `reversibilityFor: string[]` field naming input domains where reversibility holds), recommended engine behavior when an irreversible combination is configured (warn / refuse / silent-with-frontmatter-memory).

### Tone

Treat existing recommendations as **hypotheses to test, not conclusions to defend.** If your analysis says explicit per-transform bijectivity metadata is over-engineered and a simple "is this rule bidirectional? then check transforms aren't `strip-emoji` etc." rule is enough, that's a more valuable finding than a complex matrix. Fresh-agent context-skepticism is the point.

---

## Assumption under test

The plugin's transform pipeline runs a configurable sequence of transformations on each side of a rule:

```
caseTransform: 'snake_case' | 'kebab-case' | 'Title Case' | 'camelCase' | 'PascalCase' | 'none'
emojiHandling: 'strip' | 'keep'
numberPrefixHandling: 'strip' | 'keep' | 'extract'
customRegex: { pattern, replacement }[]
```

A bidirectional rule has separate `folderTransforms` and `tagTransforms`. The pipeline runs forward (folder side's transforms produce the tag); the inverse direction runs the tag side's transforms in reverse to produce the folder candidate.

The implicit assumption: **if the user authors symmetric transforms on both sides, the round-trip is bijective.** E.g., folder side says "Title Case → kebab-case" (i.e., the folder is in Title Case; the engine kebabs it for the tag); tag side says "kebab-case → Title Case" (tags are kebab; the engine Title-Cases them for the folder).

**Is that assumption actually true?** Not for many real inputs.

## Why the simple reading might not hold

### Case transforms aren't bijective on arbitrary input

`snake_case` is a function: `(string) → string`. It's not invertible because:

- `"my project"` → `"my_project"`. The inverse "snake_to_title" maps `"my_project"` → `"My Project"`. But the original was `"my project"` (lowercase). Round-trip lands somewhere different.
- `"My Project"` → `"my_project"`. Inverse: `"My Project"`. **This direction round-trips.** But only because the original happened to be Title Case.
- `"my_project"` (already snake) → `"my_project"` (no-op). Inverse: `"My Project"`. **Doesn't round-trip** because the inverse over-corrects.
- `"NewYork"` (PascalCase) → `"newyork"` (loses word boundaries entirely). Inverse can't recover.

The reversibility is *conditional on input domain*. Title-Case-shaped inputs round-trip via Title↔snake; PascalCase inputs don't; mixed inputs don't.

### `Title Case` itself is ambiguous

There are at least three "Title Case" rules in common use:

- **Capitalize first letter of every word** ("My New York Visit")
- **Capitalize first letter of every word except articles/prepositions** ("My Visit to New York")
- **Capitalize first letter of every segment as defined by the case library** (varies)

Different libraries (lodash, change-case, FTSync's own implementation) make different choices. Composition with snake_case has different behaviors per library.

### Emoji-strip is irreversible

`stripEmoji: true` on the tag side maps `"📁 Projects"` → `"projects"` (after kebab-case). The inverse can't put the emoji back. The folder side's emoji is gone from the tag's information content.

This is *known* irreversible. Today the engine doesn't warn the user; it just runs.

### Number-prefix-strip is irreversible

Same story as emoji. `stripNumberPrefix: true` maps `"10 - Projects"` → `"projects"`. The inverse can't recover the `10`.

`numberPrefixHandling: 'extract'` is interesting — it preserves the prefix as a separate value (e.g., into a slot), which *could* be reversible if the slot is preserved. But today there's no slot machinery; "extract" is documented but not fully consumed downstream.

### Custom regex is unaudited

`customRegex: [{ pattern: 'foo', replacement: 'bar' }]` runs an arbitrary regex substitution. The inverse direction has no corresponding "undo this substitution" — users have to author the matching reverse manually in the other side's transforms.

If the user forgets the reverse (or authors it incorrectly), the round-trip silently drifts. Today the engine doesn't validate.

### Composition order matters

The pipeline is documented as `match → extract → recoordinate → transform → emit`. Inside `transform`, the order is roughly: emoji → number-prefix → case → custom-regex.

But:

- `kebab(stripEmoji("📁 Projects"))` ≠ `stripEmoji(kebab("📁 Projects"))` (kebab on emoji-prefixed input may produce different output depending on case-library handling of unicode)
- `customRegex(case(input))` ≠ `case(customRegex(input))` for many regexes

The engine commits to one ordering. The user's intuition may not match.

### `none` modes look reversible but mask issues

If the user sets `caseTransform: 'none'` on both sides, the round-trip is trivially bijective. But if folder paths are mixed-case and the user expects the tag to be normalized, "none" on the tag side is actually wrong — the user's intent was reversibility, but they got non-normalization instead. The engine doesn't help them notice the mismatch.

## Research brief

The agent should:

### 1. Build the per-transform bijectivity matrix

For each transform option:

| Transform option | Bijective when | Lossy when | Edge cases |
|---|---|---|---|
| `caseTransform: 'snake_case'` | Input is Title Case or PascalCase with clean word boundaries | Input is already snake_case (over-corrects on inverse); Input has acronyms ("NASA"); Input has non-Latin chars | ... |
| `caseTransform: 'kebab-case'` | ... | ... | ... |
| `caseTransform: 'Title Case'` | ... | ... | Word-list ambiguity |
| `caseTransform: 'camelCase'` | ... | ... | ... |
| `caseTransform: 'PascalCase'` | ... | ... | ... |
| `emojiHandling: 'strip'` | Never (irreversible) | Always | n/a |
| `emojiHandling: 'keep'` | Always (no-op) | n/a | Tag-syntax compatibility |
| `numberPrefixHandling: 'strip'` | Never (irreversible) | Always | n/a |
| `numberPrefixHandling: 'extract'` | If the extracted value is preserved in a slot | If the slot is dropped or overwritten | Phase H slot composition |
| `numberPrefixHandling: 'keep'` | Always (no-op) | n/a | n/a |
| `customRegex` | Only if the user authors the matching reverse on the other side | Otherwise | Author can author wrong reverse |

Fill out every cell honestly. "Conditional" answers are fine — say *what* the condition is.

### 2. Define composition rules

For pairs of transforms applied in sequence:

- Which pairs commute (`A(B(x)) === B(A(x))` for all `x` in some domain)?
- Which pairs are bijective when composed (`B⁻¹(A⁻¹(A(B(x)))) === x` for all `x`)?
- For non-commuting pairs, what's the engine's commit ordering, and is it documented?

A worked example: does `kebab(stripEmoji(x))` = `stripEmoji(kebab(x))` for all `x`? Walk through a few cases.

### 3. Propose type-system additions

Sketch the new fields on `TransformConfig`:

```typescript
interface TransformBijectivityProfile {
  reversible: 'always' | 'never' | 'conditional';
  reversibleFor?: string[];  // input domain names where reversibility holds
  reversibleWith?: string[]; // names of inverse transforms (for round-trip pairing)
}
```

Or argue that this is over-engineered and a simpler approach (e.g., a single `bijective` boolean per transform, combined with a `cardinality: 'many:1'` if the rule has any non-bijective transform) is sufficient.

### 4. Design engine behavior when irreversibility is detected

When a user authors a rule with `direction: 'bidirectional'` and an irreversible transform on the tag side (e.g., `stripEmoji: true`), what should the engine do?

- Option α: Silent (current behavior). The user is responsible.
- Option β: Warn at rule-save time. "This rule's tag side strips emojis; the inverse direction will not restore them. Continue? [Yes / No]."
- Option γ: Refuse — `direction: 'bidirectional'` is incompatible with irreversible transforms; force user to set `direction: 'folder-to-tag'` or remove the transform.
- Option δ: Allow with frontmatter memory — when the irreversible transform is configured, automatically enable `frontmatterMemory` on the rule (if Challenge 07 ships).

Justify a recommendation. Multiple options can coexist (e.g., warn + offer frontmatter memory).

### 5. Walk through three concrete bidirectional scenarios

For each, show the rule, the input folder, the forward output (tag), and the inverse output (reconstructed folder). Identify exactly where the round-trip breaks.

- **Scenario A (clean)**: `Projects/Web Auth/note.md` with `caseTransform: 'kebab-case'` on tag side, `'Title Case'` on folder side. Walk through; verify round-trip.
- **Scenario B (emoji loss)**: `📁 Projects/Web Auth/note.md` with `stripEmoji: true` on tag side, `none` on folder side. Walk through; show the leak.
- **Scenario C (custom regex)**: A user-authored `customRegex` on the tag side that strips a domain prefix; the user forgot the reverse on the folder side. Walk through; show the silent drift.

### 6. Compose with related work

- **Templates (Phase H)**: per-slot transforms (`{slug | kebab}`) shift the question from "rule-level transform" to "slot-level transform." Does the bijectivity matrix transfer? Does anything change?
- **Frontmatter memory (Challenge 07)**: if the engine stores origin per-file, transform irreversibility doesn't matter for round-trip recovery — but it still matters for "do tags match expected normalization." How do these compose?
- **Orphan handling (Challenge 08)**: when the engine considers removing an orphaned tag, does transform irreversibility affect the decision (e.g., a tag derived via `stripEmoji` can't be checked against current folder state by re-running the forward)?

## Deliverable

Short report (~1500–2500 words) at `zz-log/YYYY-MM-DD-challenge-09-findings.md`:

- The full per-transform bijectivity matrix
- Composition rules with worked examples
- Recommended type-system additions (or an argument for simpler approach)
- Recommended engine behavior for irreversibility-detection
- Three walked-through bidirectional scenarios with leak identification
- Composition analysis (templates, frontmatter memory, orphan handling)
- Open questions left unresolved

## Hand-off note

This challenge complements Challenge 02 by drilling into a specific layer. Where 02 asks "are bidirectional rules reversible at all?", 09 asks "*which transforms* break reversibility, *under what conditions*, and *how should the engine help the user notice*?"

The agent should produce something concrete enough that the result drives engine code (a real bijectivity profile per transform) — not just a philosophical taxonomy. If the conclusion is "this is a non-issue and we should drop it," that's a valid outcome too.
