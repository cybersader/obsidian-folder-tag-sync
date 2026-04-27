---
title: Path Lens operators + deterministic bijectivity detection
description: Two related research questions for F2. (1) What operators should the path templating system support — filter syntax, optional slots, glob slots, inline regex, default values? (2) How does the engine determine whether a given rule is bijective without assertions or metadata? Surveys the algorithmic approaches (structural slot overlap, per-transform reversibility, symbolic execution, property-based testing, type-based checks), evaluates tradeoffs, recommends a layered detection strategy.
tags: [research, architecture, abstraction, bijection, operators, phase-h]
sidebar:
  label: "04-27 · Path Lens operators + bijectivity"
  order: -20260427007
date: 2026-04-27
---

## Why this exists

The user surfaced two coupled questions during the F2 (Path Lens) decision-gate walkthrough:

> *"Developing certain operators too could be helpful for the path templating system, but I'm not sure how we deterministically determine bijectivity in the logic engine that we build."*

The questions are coupled because **the operator set determines what the bijectivity-detection algorithm has to handle.** Add a `| kebab` filter and the algorithm has to know whether kebab-case is reversible. Add an `{slug?}` optional slot and the algorithm has to handle missing-value cases. Add `{deeper...}` glob slots and the algorithm has to handle variable-depth captures.

This entry covers both. It's grounded in the [Path Lens comparison entry](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-abstraction-shape-comparison/), [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/), and [Path abstractions Part 2's prior-art survey](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/).

Status: research only; informs F2 commit 1 design but doesn't block it. Commit 1 can ship with a *minimal* bijectivity check (structural slot overlap) and refine the algorithm in subsequent commits as more operators land.

## Part 1 — Operators the path templating system likely needs

Drawing from path-template prior art (path-to-regexp, FastAPI, Express, TanStack Router) and template engines (Jinja, Liquid, Mustache), the operator set splits into three tiers.

### Tier A — In F2 v1 scope (essential)

These are needed for the canonical PARA / JD / SEACOW workflows.

| Operator | Syntax | Example | Purpose |
|---|---|---|---|
| **Single-segment slot** | `{name}` | `Projects/{topic}` | Captures one path segment by name |
| **Glob slot** | `{name...}` | `Projects/{topic}/{deeper...}` | Captures one or more remaining segments |
| **Filter pipe** | `\|` | `{topic \| kebab}` | Per-slot transform; chainable (`\| filter1 \| filter2`) |
| **Literal segments** | (just text) | `Projects/Web/{topic}` | Path components matched literally |

Filters in F2 v1 (subset of the existing `TransformConfig` semantics):

- `kebab` — kebab-case
- `snake` — snake_case
- `title` — Title Case
- `lower`, `upper`
- `strip-emoji`
- `strip-num-prefix`, `keep-num-prefix`, `extract-num-prefix`
- `join('-')` — for glob slots, join captured segments with separator

### Tier B — Probably needed before F2 v1 ships, but tractable

| Operator | Syntax | Example | Purpose |
|---|---|---|---|
| **Optional slot** | `{name?}` | `Projects/{slug?}` | Slot may be empty; rule still matches without it |
| **Inline regex constraint** | `{name:regex}` | `{number:\d+}` | Match only if value satisfies inline regex |
| **Default values** | `{name ?? "default"}` | `{owner ?? "default-user"}` | Fallback when slot is empty (especially after filter chain) |
| **Optional-prefix marker** | `?` before literal | `📁? Projects/{topic}` | Literal-prefix is optional (your emoji-prefix bug case) |

The optional-prefix marker is what handles `📁 10 - Projects/...` and `10 - Projects/...` matching the same rule without writing two separate rules.

### Tier C — Deferred to future research

These are powerful but introduce non-trivial bijectivity-detection problems.

| Operator | Syntax | Example | Why deferred |
|---|---|---|---|
| **Slot combining** | (none — composition) | folder `{a}/{b}` ↔ tag `{a}-{b}` | Inverse direction is ambiguous; requires Boomerang-style composition operators (F5) |
| **Slot splitting** | (none — composition) | one folder slot → multiple tag slots | Same as above |
| **Conditional sections** | `{if name}...{end}` | `Projects/{if owner}{owner}/{end}{topic}` | Conditional template chunks; opens up Liquid/Jinja-flavored complexity |
| **Loops** | `{for x in ...}` | (n/a in path templating) | Templates aren't loop-y; would only be needed for tag-side post-coordination across N slots |
| **Property bindings** | `{name:fromProperty}` | `{owner:fromProperty(entity)}` | F4 future feature; pulls value from frontmatter property instead of folder path |
| **Generalized property sources** | `{any-slot:from(any-property)}` | `{section:from(category)}` | Generalization of F4: any slot can source from any frontmatter property, not just specific declared ones. Same bijectivity caveats apply. |
| **Fuzzy slots** | `{topic ~= "Web*"}` (illustrative) | `{topic ~= "Web*"}` matches "Web", "WebDev", "WebApp" | **Far-future research** — huge can of worms. Bijectivity becomes probabilistic; engine becomes non-deterministic for inverse direction; runs counter to the project's "deterministic over AI" principle. Flagged here so the operator-set design doesn't accidentally close the door, but no near-term plan to ship. |

Tier C is the hairy stuff. The bijectivity-detection algorithm doesn't have to handle these in v1; if and when they land, the algorithm extends.

## Is there an existing templating language for this abstraction?

Honest answer surveyed in [Path abstractions Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/): **pieces exist; no full off-the-shelf match.** The Path Lens combines three things — declarative path-pattern syntax + per-slot transforms + bidirectional semantics — and existing languages cover at most two of the three.

**Closest existing pieces** (all from the Part 2 survey):

- **`path-to-regexp`** — JS-ecosystem default for URL routing; ships with paired `match()` + `compile()` APIs that are *almost* bidirectional. Slot syntax `:name`, `:name(\d+)` for constraints, `*splat` for glob. Production-grade, ~7M weekly downloads. **Closest to a real bidirectional path template language.** But URL-shaped, not folder-tag-shaped, and no per-slot transform pipeline.
- **Jinja2 / Handlebars / Liquid** — production-grade templating with pipe-filter syntax (`{{name | filter}}`). Closest match for the operator set. **But forward-direction only**; no inverse semantics.
- **Augeas `.aug` lenses** — closest formal bidirectional language; production-tested for editing Linux config files. Ships full lens-calculus combinators (`del`, `store`, `key`, `seq`, `*`, `|`). **But it's a full DSL with academic syntax**; not a path-shaped template language.
- **OpenAPI 3 path templates** — `{name}` in paths plus parameter objects with type info. Specification, not a runtime; closest to the slot-objects shape (C).
- **Boomerang / BiGUL** — academic lens calculus with formal round-trip laws. **Right theory; wrong syntax** for user-facing rule authoring.

**Combinations the Path Lens would assemble**:

- **From `path-to-regexp`**: slot syntax + paired forward/inverse runtime model
- **From Jinja-family**: pipe-filter syntax for per-slot transforms (`{name | filter1 | filter2}`)
- **From Augeas / Boomerang**: bidirectional reasoning + bijectivity vocabulary (without the formal academic syntax)

**No existing language has all three.** The closest single language is `path-to-regexp` with a custom filter extension (~50 LOC for the filter pipeline on top of an existing parser). That's a viable F2 v1 implementation strategy: vendor `path-to-regexp` for the slot parsing and add filter-pipe support, rather than writing a new parser from scratch.

**Whether to vendor `path-to-regexp`** is itself a design choice (the [Part 2 research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) had this as an open question). Tradeoff: ~5KB minified + an external dependency vs. ~50 LOC of bespoke parser. F2 commit 1 will need to pick one.

## Part 2 — The bijectivity question

Given a Path Lens rule (in template, lens-flavored, or slot-objects shape), is the round-trip bijective?

This is *not* a metadata claim — `bijective: true` on a rule is what the engine asserts via the typed model today, but the user can lie about it. The question is: **how does the engine compute the truth?**

A rule's bijectivity has three layers:

1. **Structural bijectivity** — slot overlap between sides; do all slots flow through both directions?
2. **Per-transform reversibility** — does each filter in the slot's pipeline reverse cleanly?
3. **Pipeline reversibility** — does the *composition* of filters reverse cleanly? (May not, even if individual filters do.)

A rule is bijective only if all three layers pass for the rule's input domain.

## Part 3 — Six approaches to determining bijectivity

### Approach 1 — Structural slot-overlap check

The simplest. Walk the folder and tag templates; collect their slot names. A rule is *structurally* bijective iff:

- Every folder slot appears on the tag side
- Every tag slot appears on the folder side
- (No "matched but discarded" slots; no "unsourced" slots)

```typescript
function isStructurallyBijective(folderTemplate: PathTemplate, tagTemplate: PathTemplate): boolean {
  const folderSlots = extractSlotNames(folderTemplate);
  const tagSlots = extractSlotNames(tagTemplate);
  return folderSlots.size === tagSlots.size && [...folderSlots].every(n => tagSlots.has(n));
}
```

**Pros**: trivial to implement; runs at template-parse time; catches the common "I forgot to put the slot on both sides" mistake.

**Cons**: completely ignores transforms. A rule with `{topic | strip-emoji}` on the tag side has slot overlap but isn't bijective (emoji-strip is irreversible). False positive.

### Approach 2 — Per-transform reversibility metadata

Each filter in the pipeline carries a `reversible: boolean | 'conditional'` metadata flag. The engine looks up each filter in a table:

| Filter | Reversible? | Notes |
|---|---|---|
| `kebab` | `'conditional'` | Reversible for input that's already lowercase-with-no-internal-hyphens |
| `snake` | `'conditional'` | Same as kebab |
| `title` | `'conditional'` | Reversible if input is single-line; loses semantics for "the", "of", etc. |
| `lower` | `'conditional'` | Reversible if input was already lowercase |
| `upper` | `'conditional'` | Reversible if input was already uppercase |
| `strip-emoji` | `false` | Irreversible (emoji is gone) |
| `strip-num-prefix` | `false` | Irreversible (prefix is gone) |
| `keep-num-prefix` | `true` | No-op |
| `extract-num-prefix` | `'conditional'` | Reversible if extracted value is preserved |
| `join('-')` | `false` | Irreversible (separator collision) |

A rule is bijective for a given slot iff its filter pipeline is reversible end-to-end. "Conditional" means "depends on input."

**Pros**: precise; engine can warn "this rule is conditionally bijective for inputs matching X."

**Cons**: requires per-filter metadata (manageable — finite filter set). Conditional cases still need runtime checking.

### Approach 3 — Type-based bijectivity

Assign types to slots and filters. Bijectivity holds if the type chain folder-side → tag-side → folder-side is identity.

Example:

- `topic: string` (folder slot type)
- `kebab: string → kebab-string` (filter signature)
- `topic | kebab` produces `kebab-string`
- For the inverse: `kebab-string → string` requires another filter that's the inverse of `kebab` — `kebab^-1`. If no such filter exists or isn't pipelined, the chain doesn't round-trip.

**Pros**: cleanest formal foundation; aligns with bidirectional programming literature.

**Cons**: introduces a type system the user has to understand; significant complexity for marginal practical benefit unless we want formal lens calculus.

### Approach 4 — Symbolic execution against representative inputs

Generate a small set of representative inputs (the user's actual vault folders, plus synthetic variants); run the rule's forward direction; run the inverse on the result; check if it equals the original.

```typescript
function isBijectiveBySymbolicCheck(rule: Rule, samples: string[]): { bijective: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const folder of samples) {
    const tag = rule.forward(folder);
    if (!tag) continue;
    const reconstructed = rule.inverse(tag);
    if (reconstructed !== folder) failures.push(folder);
  }
  return { bijective: failures.length === 0, failures };
}
```

**Pros**: tests *actual* behavior, not metadata. Catches transform-pipeline bugs.

**Cons**: results depend on sample set; doesn't prove bijection for *all* inputs, only the tested ones. A rule may pass the test but fail on inputs the test didn't cover.

### Approach 5 — Property-based testing (QuickCheck-style)

Generate random inputs from a domain (e.g., `[A-Z][a-z]+/[a-z\-]+`); run round-trip; verify identity for all generated inputs.

**Pros**: stronger evidence than fixed-sample symbolic execution.

**Cons**: random generation may miss edge cases; runtime cost is significant if checked on every rule edit.

### Approach 6 — User-asserted bijectivity

The rule author claims `iso: true` (or whatever the lens-flavored shape uses); the engine trusts the claim.

**Pros**: zero algorithmic cost; matches today's `bijective: boolean` field behavior.

**Cons**: the user can lie. The engine surfaces lies only when the inverse direction misbehaves at runtime — which is exactly when the user least wants surprises.

## Part 4 — Recommended layered detection strategy

No single approach gives full coverage. A layered strategy gives the engine the right balance:

### Layer 1 — Structural slot-overlap (cheap; runs at parse time)

Every rule gets a structural check on save. If slots don't overlap, the engine warns: *"Tag side references slots `{owner}` not present on folder side — unsourced; fix before saving."* Catches authoring errors before they ship.

### Layer 2 — Per-transform reversibility check (cheap; runs at parse time)

For every slot's filter pipeline, look up each filter's `reversible` metadata. Compute the slot's overall reversibility:

- All `true` → reversible
- Any `false` → irreversible
- All `true` or `'conditional'` → conditionally reversible

The rule's overall reversibility is the conjunction of all slots' reversibilities.

Engine surfaces this as a per-rule status indicator: *"Round-trips: yes"*, *"Lossy forward (matched-but-discarded slot)"*, or *"Conditional: depends on whether `{topic}` input is single-word lowercase."*

### Layer 3 — Symbolic check on save (medium cost; runs at rule-save time)

When user saves a rule, the engine runs round-trip on a small set of representative inputs (drawn from the user's actual vault folders that match the rule's pattern). If any round-trip fails, the engine warns: *"This rule failed bijection on `Projects/Web Auth/...` — inverse direction produced `projects/web-auth/...` (different from original)."* Concrete failure case the user can react to.

### Layer 4 — Optional property-based check (expensive; runs on demand)

User can request a deeper check from settings: *"Run 1000 random round-trips on this rule; report failures."* Used by power users and rule pack authors before publishing.

### Layer 5 — Runtime check on inverse direction (cheap; always runs)

Even after Layers 1–4, the engine *also* checks at runtime when the inverse direction fires: did the inverse produce a folder that matches the rule's forward pattern? If not, the rule is broken on this specific input. Engine logs / warns rather than producing a destructive move.

This is a defense-in-depth strategy. Layer 1 catches authoring errors; Layer 2 catches semantic errors; Layer 3 catches edge cases; Layer 4 is for paranoid validation; Layer 5 prevents runtime destruction.

## Part 5 — How this composes with F2 commits + F3 (frontmatter witness)

**F2 commit 1 (templates)** — implement Layer 1 (structural slot-overlap) and Layer 2 (per-transform reversibility) at minimum. The compiled template carries metadata about each slot's filter chain; the engine derives bijectivity status from this. Show as a status indicator in the rule editor.

**F2 commit 2 (lens-flavored)** — extend Layer 2 to honor explicit `iso: true` / `iso: false` claims as user-asserted bijectivity (Approach 6 layered on top of structural check). When the user's `iso` claim disagrees with the engine's structural+transform check, surface the disagreement clearly.

**F2 commit 3 (slot-objects)** — extend Layers 1-2 to handle the verbose slot-object syntax. Same algorithms; different parser.

**F3 (frontmatter witness)** — composes with bijectivity detection. When a rule is *not* bijective, frontmatter memory becomes the recovery mechanism (the witness records pre-transform slot values so the inverse can reconstruct). Per-rule status: *"This rule isn't bijective per Layer 2 (kebab transform is conditional), but frontmatter memory is enabled, so per-file recovery is bijective."* This is the load-bearing UX surface.

**A1 (conflict UI)** — uses the bijectivity status to rank candidates. Bijective rules should be preferred over lossy ones when both match the same tag.

## Part 6 — Open questions

- **How does the user override the engine's bijectivity verdict?** If the engine says "conditional," can the user assert `iso: true` and the engine accepts it? Or always trust the engine's check?
- **How is "conditional bijection" surfaced?** A rule that's bijective for word-character inputs but not for emoji-prefixed inputs — what does the status indicator say? "Yes (for these inputs)"? "Conditional"?
- **What's the cost of Layer 3 on rule save?** Running symbolic checks against all matching folders in a 10K-file vault on every rule save could be slow. Throttle? Run async? Only on first save?
- **Per-transform metadata: who maintains it?** The transform table is small (~10 filters today) but extends with each new filter. Who owns the source of truth?
- **Domain-restricted bijectivity** — a rule may be bijective on the user's vault but not on arbitrary inputs. Does the engine specialize the bijectivity claim to the user's domain, or stay general?

## Part 7 — What this means for F2 commit 1

Concrete asks for the implementation:

1. **Implement Layer 1 + Layer 2 in `compileTemplate.ts`**: when compiling a template, also compute structural slot-overlap and per-slot reversibility metadata; expose as part of the `CompiledTemplate` shape.
2. **Surface in the rule editor**: status chip per rule reflecting bijectivity (green = round-trips, orange = conditional / lossy direction, red = broken).
3. **Per-transform metadata table**: ship as a small constant in `src/transformers/` — list of filters and their reversibility.
4. **Defer Layer 3 / Layer 4 / Layer 5** to F2 commit 2 or later; they're additive enhancements.

Estimated additional scope: ~50 LOC in commit 1 for Layers 1+2; ~100 LOC in commit 2 for Layer 3; Layer 4 is opt-in advanced; Layer 5 is part of `applyRuleInverse`.

## Related concepts

- [Path Lens comparison](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-abstraction-shape-comparison/) — the four candidate shapes and operators
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge from transfer ops to bijection vocabulary
- [Path abstractions Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — prior art for hybrid coexistence
- [Frontmatter as bijection memory](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — F3, the recovery mechanism for non-bijective rules
- [Challenge 02 — Pipeline reversibility](/obsidian-folder-tag-sync/agent-context/zz-challenges/02-pipeline-reversibility/) — the broader reversibility question that this entry drills into for templates specifically
- [Challenge 09 — Per-transform reversibility](/obsidian-folder-tag-sync/agent-context/zz-challenges/09-per-transform-reversibility-profile/) — the per-transform metadata table this entry depends on
- [F5 (roadmap) — slot composition operators](/obsidian-folder-tag-sync/about/roadmap/) — the deferred Tier C operators
