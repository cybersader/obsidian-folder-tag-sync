---
title: Bijection and loss
description: Built from the eight transfer-op primitives upward — what determinism, lossy/lossless, forward/inverse, and bijection actually mean for a Folder Tag Sync rule. Concrete vault examples per concept.
sidebar:
  order: 6
---

This page reads bottom-up. It starts from the eight [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) you already configure in the rule editor, and builds up to the abstract vocabulary that shows up in the typed-model design (`cardinality`, `bijective`, "lossy direction," "round-trip"). The abstract terms aren't separate ideas — they're properties *of those eight ops*. Reading the ops first makes the rest much shorter.

## Start from the primitives

The eight transfer ops are the only ways a Folder Tag Sync rule can map between folder structure and tag structure. Everything else on this page is a property of a (rule + transfer-op) combination.

| Transfer op | What it does to hierarchy | Lossless? |
|---|---|---|
| `identity` | preserves full depth on both sides | yes (when transforms are reversible) |
| `truncation` (`tailHandling: drop`) | rejects paths deeper than `depth`; matches only what fits | yes — within the depth-bounded domain |
| `truncation` (`tailHandling: aggregate`) | joins deeper segments into one (N+1)th term with a separator | no — separator/segment ambiguity |
| `truncation` (`tailHandling: flatten`) | drops middle segments; keeps the leaf folder name | no — middle ancestry is gone |
| `marker-only` | one fixed tag for the entry folder and everything beneath | no — many sources, one tag |
| `promotion-to-root` | only the first segment after the entry becomes the tag | no — deeper structure dropped |
| `flattening-to-leaf` | only the leaf folder name becomes the tag | no — ancestry dropped |
| `aggregation` | whole path joined with separator into one tag segment | no — separator/segment ambiguity |
| `post-coordination` | N independent flat tags, one per level | no in tag→folder direction (which folder do N tags map to?) |
| `opaque` | no tag is emitted | n/a — no transfer happens |

Read this table once and the rest of the page follows.

## Forward direction vs. inverse direction

A rule has *two* directions. They are not the same operation; they are two different functions that share a vocabulary.

- **Forward direction**: folder → tag. A file moves into a folder; the engine emits tags into the file's frontmatter.
- **Inverse direction**: tag → folder. A user adds a tag to a file; the engine moves the file (or proposes a move) to the matching folder.

A rule's `direction` field declares which directions are wired up: `'folder-to-tag'`, `'tag-to-folder'`, or `'bidirectional'`. The bidirectional case is where determinism matters — and where the per-op behavior splits.

**Concrete example with `identity`:**

```
folder: Projects/Web Auth/oauth-flow.md
forward (identity, kebab-case):  →  #projects/web-auth/oauth-flow
inverse (identity, Title Case):  ←  Projects/Web Auth/oauth-flow
```

Both directions reproduce each other — given the tag, the inverse direction reconstructs the same folder path that produced it. That's what *bidirectional determinism* looks like for an identity rule.

**Concrete example with `truncation` (`tailHandling: 'drop'`):**

```
folder: Capture/Clips/Web/React/Hooks/note.md
forward (truncation depth 2 drop):
   → does NOT match (path is too deep; the rule's pattern rejects it)

folder: Capture/Clips/Web/React/note.md
forward (truncation depth 2 drop):  →  #-clip/web/react
inverse:                            ←  Capture/Clips/Web/React (then user picks the file)
```

For paths *that match*, `truncation/drop` is fully bijective. For paths that are deeper than the depth cap, the rule simply doesn't apply — there's no question of "lossy" because the rule didn't fire.

**Concrete example with `marker-only`:**

```
folder: Capture/Inbox/scratch.md         forward → #-inbox
folder: Capture/Inbox/2026/Q2/notes.md   forward → #-inbox  ← same tag
folder: Capture/Inbox/projects/auth.md   forward → #-inbox  ← same tag

inverse: #-inbox  →  Capture/Inbox/   ← can recover the entry folder, but not which deeper file produced any given tagged note
```

Many distinct folders → one tag, by design. The forward direction throws information away (everything below the entry); the inverse can reconstruct the entry but not what was discarded. **This is the lossy property**, expressed concretely.

## Lossless transformation

A transformation is **lossless** when forward + inverse round-trip without loss. For *every input the rule accepts*: `inverse(forward(folder)) === folder` and `forward(inverse(tag)) === tag`.

The **only** operations that are lossless across all of their accepted domain are:

- `identity` — when the transform pipeline (`caseTransform`, `numberPrefixHandling`, etc.) is itself reversible
- `truncation` with `tailHandling: 'drop'` — within the depth-bounded domain (deeper paths are rejected, not silently lossy)

That's it. Every other transfer op is lossy in at least one direction by design.

The reversibility caveat for `identity`: if the rule applies `caseTransform: 'kebab-case'` to a folder name like `"Web Auth"`, the tag becomes `"web-auth"`. The inverse direction has to put it back. If the inverse `caseTransform` is `'Title Case'`, the round-trip recovers `"Web Auth"` — bijective. But if the original folder was `"web auth"` (already lowercase), the round-trip lands on `"Web Auth"` instead — not bijective in that pair. The rule's `bijective: true` claim is conditional on the transform pipeline being reversible for the data the user actually has.

## Lossy transformation — three concrete shapes

Lossy isn't one thing. It comes in flavors corresponding to *what* gets dropped.

### Flavor 1: collapse to a single tag (many-to-one)

`marker-only`, `promotion-to-root`, `flattening-to-leaf`, and `aggregation` all collapse multiple distinct folders to a single tag form.

```
marker-only:
   Capture/Inbox/today.md         → #-inbox
   Capture/Inbox/yesterday.md     → #-inbox
   Capture/Inbox/projects/foo.md  → #-inbox
   inverse: #-inbox → which folder? entry folder only; the specific path is gone

promotion-to-root:
   Projects/Web Auth/notes.md     → #projects/web-auth
   Projects/Web Auth/oauth/flow.md→ #projects/web-auth   ← deeper path dropped
   inverse: #projects/web-auth → Projects/Web Auth (then any file beneath it could have produced the tag)
```

The **forward direction is many-to-one**; the **inverse direction is many-to-one inverted** — one tag points back to a set of possible source folders, not a unique one. The rule's `cardinality: 'many:1'` field encodes exactly this.

### Flavor 2: ambiguous reconstruction (separator-dependent)

`truncation/aggregate` and `aggregation` join deeper structure with a separator. The inverse can't reliably split back, because separator characters are also legitimate in segment names.

```
truncation depth 2 aggregate '-':
   Capture/Clips/Web/React-Hooks/intro.md  → #-clip/web/react-hooks
   Capture/Clips/Web/React/Hooks/intro.md  → #-clip/web/react-hooks   ← same tag

   inverse: #-clip/web/react-hooks → Capture/Clips/Web/React-Hooks/  or  Capture/Clips/Web/React/Hooks/  ?
```

The forward direction loses the structural information that distinguished the two folders. The inverse can't pick the right one without out-of-band context.

### Flavor 3: ancestry dropped (middle of the path)

`truncation/flatten` drops middle segments while keeping the leaf:

```
truncation depth 2 flatten:
   Capture/Clips/Web/Tutorials/React/Hooks/intro.md  → #-clip/web/tutorials/hooks
                                                        (Tutorials kept as 3rd; React dropped; Hooks kept as 4th)

   inverse: #-clip/web/tutorials/hooks → Capture/Clips/Web/Tutorials/Hooks/   ← but we don't know the original had React in between
```

The leaf identity survives; the middle ancestry doesn't.

## Bijection — when both directions round-trip

A rule is **bijective** when its forward + inverse pair satisfy `inverse(forward(p)) === p` and `forward(inverse(t)) === t` for every input the rule accepts.

By the table above, bijection in Folder Tag Sync is achieved by:

- `identity` with reversible transforms
- `truncation/drop` with reversible transforms

Everything else has a lossy direction by construction. The `bijective: boolean` field on `MappingRule` is the engine's claim about this property; today it's *asserted* (computed from the typed-spec semantics, not from anything visible in the regex pair). The Phase H research log entries explore making it *computable* from explicit slot overlap in path templates.

## Cardinality — the field that names the shape

The `cardinality` field on a rule is `'1:1'`, `'1:many'`, or `'many:1'`. It names the (forward-direction) mapping shape:

- **`1:1`** — one folder produces one tag and vice versa. `identity`, `truncation/drop`. Bijective.
- **`many:1`** — many folders collapse to one tag. `marker-only`, `promotion-to-root`, `flattening-to-leaf`, `aggregation`. Lossy in the forward direction; the inverse direction can recover the *entry folder* (or first segment) but not the specific source path.
- **`1:many`** — one folder fans out to many tags. `post-coordination` is the canonical case (one folder produces N independent tags). Lossy in the *inverse* direction (multiple tags don't pick a unique folder).

`cardinality` and `bijective` are not redundant. `bijective` is the booleanized round-trip claim; `cardinality` describes the shape from one side. A rule can be `1:1` cardinality but not bijective (if the transform pipeline is irreversible for some inputs); the typical case is they agree.

## Collision is a different problem from lossy

This trips people up. They look the same on the surface — "two distinct things look the same" — but they happen at different stages of the pipeline.

| | Collision | Lossy |
|---|---|---|
| **Where it happens** | match step | recoordinate step |
| **What's wrong** | the rule's *pattern* is too permissive | the rule's *transfer op* is many-to-one by design |
| **Direction** | forward (the wrong rule fires) | inverse (the right rule fires, but the inverse can't reconstruct) |
| **Fix** | tighter pattern, more specific anchor | accept it, or pick a different op if you wanted bijection |

**Collision example:**

```
Rule pattern: ^Projects/(.+)$  (any-segment style — too permissive)
folder 1: Entity/Cybersader/Projects/auth/notes.md  → matches → #projects/auth
folder 2: Entity/Bob/Projects/auth/notes.md         → matches → #projects/auth  ← same tag, different intended scope
```

The two folders genuinely *should* be in different scopes (Cybersader's projects ≠ Bob's projects), but the rule's pattern doesn't capture the parent context. The forward direction fired the wrong rule on one of them — both inputs accidentally produce the same output. **Collision = pattern over-match.** The fix is a more specific pattern (`^Entity/(?<owner>[^/]+)/Projects/(?<rest>.+)$`) or scoping the anchor more narrowly.

**Lossy example (same setup, different problem):**

```
Rule transfer: marker-only with marker "inbox"
folder 1: Capture/Inbox/scratch.md        → #-inbox  (this is correct; the rule fires correctly)
folder 2: Capture/Inbox/2026/Q2/notes.md  → #-inbox  (also correct)

inverse: #-inbox → Capture/Inbox/   ← can't tell which file's inbox path produced the tag
```

The pattern fires on the right files. The transfer op (by design) collapses everything beneath `Capture/Inbox` to one tag. The inverse direction can't reconstruct the specific path because the forward direction was many-to-one. **Lossy ≠ wrong; lossy = the intended behavior was many-to-one and the inverse is structurally limited.**

The two failure modes can co-occur — a rule can have an over-permissive pattern *and* a lossy transfer op — but they're independent dimensions. Fixing one doesn't fix the other.

## Why "bijection visibility" matters more than "always bijective"

You can read this whole page two ways:

1. *"We should only ship rules that are bijective."* This is wrong. Marker-only, promotion-to-root, post-coordination — all lossy by design — are useful rules. The library-science vocabulary for *why* you'd want each one is in [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/). Forcing bijection just disallows useful rules.
2. *"We should make per-rule bijection visible at authoring time."* This is right. The user picks the rule and the tradeoff; the system's job is to make the tradeoff legible — *"this rule will not round-trip from tag back to folder; here's what survives the inverse."* That's what the typed-spec does today via `cardinality` + `bijective` metadata, and what path templates would do more directly via slot-overlap visibility.

The abstraction question explored in the [research log entries](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) is not "how do we force determinism." It's "how do we make per-rule determinism status visible at authoring time so the user authors with full information." Bare regex hides this; path templates expose it. Both can be valid in a hybrid system; the system's job is to be honest about which is which.

## See also

- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives this page builds on
- [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) — where two ops would naively stack but collapse into one
- [When to use regex](/obsidian-folder-tag-sync/concepts/when-to-use-regex/) — the escape hatch when no transfer op fits
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — one-line definitions for the vocabulary on this page
- [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — research on making bijection visible from the rule's pattern
- [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — the typed-model layers
