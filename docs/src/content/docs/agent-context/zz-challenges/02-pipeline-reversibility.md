---
title: "Challenge 02: Pipeline reversibility"
description: Bidirectional sync assumes transformations are reversible. They aren't always. What's the failure mode and does it matter?
tags: [research, correctness]
sidebar:
  label: "02 · Pipeline reversibility"
  order: 2
---

## Prompt for the dispatched agent

Open this challenge in a fresh-context Claude / LLM session, paste the URL, and say *"research this challenge."* The reading list below is layered for **progressive disclosure** — start at level 1 if you're new to the project, jump deeper if you already know the context.

**The question in one sentence:** are bidirectional rules actually reversible in practice, or do transformations and edge cases cause silent drift the user won't notice until a round-trip produces the wrong file location?

### Reading order (level 1 → level 4)

1. **Foundations** (orient first if new to the project):
   - [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary; especially the `bijection`, `lossless`, `lossy`, `cardinality`, and `surjection / injection / bijection` entries
   - [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — the typed-model layers; why determinism is non-negotiable
2. **Core concepts for this question**:
   - [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge page; built bottom-up from the eight transfer ops; lossy/lossless flavors enumerated; collision-vs-lossy distinction
   - [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives with per-op forward + inverse worked examples; *the* answer to "which ops are reversible"
   - [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) — when two ops would naively stack but collapse into one with a mode flag; reversibility implications
3. **Direct context** (the research that frames this question):
   - [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — argues bijection visibility is a load-bearing property of the abstraction
   - [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — a proposed feature that *changes* what's reversible on a per-file basis
   - [Challenge 07](/obsidian-folder-tag-sync/agent-context/zz-challenges/07-frontmatter-as-bijection-memory-validation/) — practical-validation challenge for the frontmatter-memory feature
4. **Reference (optional)**:
   - [Rule schema](/obsidian-folder-tag-sync/reference/rule-schema/) — exact field definitions for `direction`, `cardinality`, `bijective`
   - [Transformations reference](/obsidian-folder-tag-sync/reference/transformations/) — case / emoji / number-prefix / custom-regex transforms; the per-transform reversibility profile

### Deliverable

Short report at `agent-context/zz-log/YYYY-MM-DD-challenge-02-findings.md` (~1500–2500 words). Required sections: a formal definition of "reversibility" applicable to FTSync (string-equality? semantic equivalence? user-perceived equivalence?), enumeration of where the current pipeline breaks reversibility (per transform, per transfer op, per edge case), recommended mitigations (which can be fixed in code, which require rule-author discipline, which are inherent to the abstraction), and the residual question — "is silent drift acceptable when the user opted into a many:1 op?"

### Tone

Treat existing recommendations as **hypotheses to test, not conclusions to defend.** If your analysis says reversibility is mostly a non-issue in practice, that's a more valuable finding than confirming the warnings. Fresh-agent context-skepticism is the point.

---

## Assumption under test

A rule set with `direction: 'bidirectional'` and matching `folderTransforms` / `tagTransforms` should produce round-trip fidelity: sync a folder to a tag, then that tag back to a folder, and end up where you started.

## Why it might not hold

### Lossy transformations
`stripEmoji: true` drops information. If a folder is `📁 01 - Projects/My Cool Thing` and the tag becomes `projects/my_cool_thing`, the reverse sync will produce `Projects/My Cool Thing` — **no emoji, no number prefix**. That's lossy.

### Case conversion isn't a bijection
`Title Case` → `snake_case` is lossy (spaces lost, capitalization normalized). `snake_case` → `Title Case` is a guess: `my_new_york_visit` could become `My New York Visit` or `My New York visit` depending on heuristics. "Title case of the first letter of each word" is itself ambiguous for words like "for", "the", "at".

### Custom regex is unaudited
Users can write `customRegex: [{ pattern: 'foo', replacement: 'bar' }]` in `tagTransforms` with no corresponding reverse in `folderTransforms`. The pipeline happily runs; the user gets silent drift.

### Attachment folders
If a tag→folder move relocates `my-note.md`, what about `my-note attachments/`? If we don't move it too, links break. If we move it, we're making a lossy decision about attachment ownership.

## Research brief

1. **Define "reversibility" formally.** Is it:
   - **Exact**: `f(g(x)) === x` always — provably impossible with lossy transforms
   - **Stable under round-trip**: `f(g(f(g(x)))) === f(g(x))` — settles after one round-trip, then stays stable
   - **Best-effort**: single round-trip produces "close enough" output; we document the tradeoffs

2. **Catalog every transformation's reversibility class.**
   - `stripEmoji`: not reversible (information lost)
   - `handleNumberPrefix: 'strip'`: not reversible
   - `caseTransform`: loose — different target cases have different reverse guesses
   - `customRegex`: depends entirely on pattern; can be lossy or not
   - Classify each as: `bijective` / `lossy` / `user-defined`

3. **Design the user-facing contract.** Should the plugin:
   - Warn when a rule is marked `bidirectional` but transforms aren't reversible?
   - Refuse to enable bidirectional when mismatched?
   - Just document "bidirectional means best-effort; use at your own risk"?

4. **Test harness.** Write a property-based test that:
   - Generates random folder paths
   - Runs them through a bidirectional pipeline
   - Asserts round-trip stability after one cycle
   - Records every divergence for review

## Deliverable

- Reversibility classification table for all transforms
- Recommendation for the user-facing contract
- Optional: property-based test module

Log findings in `zz-log/`.
