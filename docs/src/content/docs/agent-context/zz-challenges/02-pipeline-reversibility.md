---
title: "Challenge 02: Pipeline reversibility"
description: Bidirectional sync assumes transformations are reversible. They aren't always. What's the failure mode and does it matter?
tags: [research, correctness]
sidebar:
  label: "02 · Pipeline reversibility"
  order: 2
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
