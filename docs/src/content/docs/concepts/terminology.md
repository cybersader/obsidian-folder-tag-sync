---
title: Terminology
description: Plain-English glossary for the vocabulary used across the typed model, the path-abstraction research, and the rule-pack system.
sidebar:
  order: 8
---

The plugin's docs use vocabulary borrowed from a few different fields — information science, formal language theory, URL routing, bidirectional programming — that aren't all in the same dialect. This page is a working glossary. Each entry has a one-line plain-English definition, a concrete example, and a link to where the term gets used in depth.

If you find a term that's not on this page but is load-bearing somewhere in the docs, it's a bug — file an issue or open a PR.

## Filesystem and tag terms

### Folder path

A literal string identifying a folder's location in the vault, like `Projects/Web/auth-rewrite`. The OS enforces that every file has exactly one folder path. We use *vault path* as a synonym for the relative path from the vault root.

### Tag

A literal Obsidian tag like `#projects/web`. The `#` prefix is implicit in Obsidian; the docs sometimes drop it for readability. **Nested tags** use `/` separators (`#projects/web` is a child of `#projects`).

### Tag namespace

A subtree of the tag system — `#projects/...` is one namespace; `#capture/...` is another. Tags compose into a **polyhierarchy** (the same file can be reachable via `#projects/web` AND `#q4-2026` AND `#ritual/auth` simultaneously). See [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) for why polyhierarchy matters here.

### Strict hierarchy vs. polyhierarchy

A **strict hierarchy** enforces single parentage — each item has exactly one parent. Filesystems are strict hierarchies. A **polyhierarchy** permits multiple parents — the same item can sit under several broader categories at once. Obsidian tags are polyhierarchical. The plugin's reason-to-exist is bridging the two. See [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/).

## Rules and rule packs

### Rule

A single mapping between a folder pattern and a tag pattern. Rules carry direction (`folder-to-tag`, `tag-to-folder`, or `bidirectional`), a transfer operation, and transform configuration.

### Rule pack

A collection of rules shipped together as JSON, typically aligned with a known organizational system (PARA, Johnny Decimal, Zettelkasten, SEACOW). The user installs a pack from the catalog or scans their vault for a matching one.

### Pattern

The matching half of a rule. Today, patterns are JavaScript regular expressions: `^Projects(?:/|$)`. Phase H is exploring **templates** as a peer to regex — see the next entry.

### Template

A pattern with named slots: `Projects/{slug}/{rest...}`. Templates compile to regex internally; the difference is what authoring time looks like and what the system can introspect about the rule. See [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) and [part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/).

### Slot

A named placeholder in a template that captures a piece of the matched path. `{slug}` matches a single path segment; `{rest...}` matches one or more segments. The terms `slug` and `rest` are borrowed from URL routing (Express, FastAPI, Next.js); the plugin keeps these names because they match prior art.

> **Why `slug`?** It's the URL-routing convention for "one path-segment placeholder." Mentally substitute the role you want — `{project-name}`, `{owner}`, `{slug}` are all single-segment slots; the name is just a variable label. The trailing `...` (as in `{rest...}` or `{notes...}`) is a glob slot — it matches one or more segments.

### Anchor

Where a rule fires in the vault tree. Today's modes:

- `'root'` — must match at vault root (the rule's pattern is anchored to position 0)
- `'any-segment'` — matches at any path-segment boundary
- `{ under: 'X' }` — matches only when nested under the literal prefix `X`

In the template world (Phase H), the anchor is *implicit* in the template's literal prefix — `Projects/{slug}` is root-anchored; `{base}/Projects/{slug}` is any-segment with the prefix captured.

### Direction

Each rule declares which way data flows: `folder-to-tag` (folder events propagate to tags), `tag-to-folder` (tag changes propagate to folder layout), or `bidirectional` (both). The bidirectional case is where the bijection question lives.

## Transformations

### Forward direction vs. inverse direction

The **forward** direction is folder → tag. The **inverse** direction is tag → folder. A bidirectional rule defines both. Whether they round-trip cleanly is the bijection question.

### Lossless transformation

A transformation is **lossless** if the original input can be perfectly reconstructed from the output. The two lossless transfer ops in Folder Tag Sync are `identity` and `truncation/drop` (within the depth-bounded domain) — see [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/#lossless-transformation) for the full enumeration.

### Lossy transformation

A transformation is **lossy** if information is dropped going forward (or inverse) and can't be reconstructed in the other direction. Three flavors, each tied to specific transfer ops — see [Bijection and loss · Lossy transformation — three concrete shapes](/obsidian-folder-tag-sync/concepts/bijection-and-loss/#lossy-transformation--three-concrete-shapes):

- **Many-to-one collapse** — `marker-only`, `promotion-to-root`, `flattening-to-leaf`, `aggregation`. Many distinct folders → one tag.
- **Ambiguous reconstruction** — `truncation/aggregate`, `aggregation`. Separator characters in segment names collide with the join separator.
- **Ancestry dropped** — `truncation/flatten`. Middle path segments are discarded; only first N + leaf survive.

Lossy isn't a bug — it's deliberate when the user's mental model is "anything in this folder is just *that thing*." The system's job is to be honest about which direction is lossy.

### Bijection / round-trip

A rule is **bijective** if `forward(inverse(t)) === t` and `inverse(forward(p)) === p` for every input it accepts. Equivalent to: lossless in both directions. The plugin has a `bijective: boolean` field on rules; today it's *asserted* (computed from typed-spec semantics), and Phase H research explores making it *computable* from template-slot overlap. See [Bijection and loss · Bijection](/obsidian-folder-tag-sync/concepts/bijection-and-loss/#bijection--when-both-directions-round-trip).

### Surjection / injection / bijection

Function-theoretic terms used in [Part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/#vocabulary-borrowed-from-prior-fields):

- **Injective (one-to-one)** — distinct inputs go to distinct outputs.
- **Surjective (onto)** — every output is reachable from some input.
- **Bijective** — both. Perfect 1-to-1 correspondence; the function has a true inverse.

## Failure modes

### Collision

When two distinct inputs accidentally produce the same output because the rule's pattern was too permissive. **Forward-direction problem; happens at the *match* step.** A root-anchored rule like `^10 - Projects` matches both `Entity/Cybersader/10 - Projects/foo` and `Entity/Bob/10 - Projects/foo` if the engine doesn't notice the parent context. They collapse to the same `#10-projects/foo` tag — different intended meanings, same output.

> **Collision vs. lossy — the difference:** Collision is when the abstraction lets two things look the same that shouldn't (the *pattern* is too permissive). Lossy is when the abstraction deliberately throws information away (the *transfer op* is many-to-one by design). Different stages of the pipeline; different fixes. See [Bijection and loss · Collision is a different problem from lossy](/obsidian-folder-tag-sync/concepts/bijection-and-loss/#collision-is-a-different-problem-from-lossy) for the side-by-side.

### Pattern over-match

A specific kind of collision where the rule's pattern accepts more strings than the user intended. Often the result of an unanchored or any-segment pattern colliding with structurally similar folders elsewhere. The fix is usually to add a literal prefix or scope the anchor more narrowly.

### Pattern under-match

The inverse problem: the rule's pattern is too restrictive and misses folders the user wanted to sync. Often surfaces when a user authors a root-anchored rule (`^Projects/`) but their vault has it nested somewhere (`fixtures/Projects/`).

## Abstraction-shape vocabulary

### Syntax vs. semantics

A regex captures **syntax** — does this character sequence satisfy this pattern? A template captures (some) **semantics** — which part is the layer, which part is a variable, what name does it carry, what role does it play in the rule. Both produce the same yes/no match answer; the difference is what the system knows about the parts.

> **Plain-English version:** regex tells the engine "does this string look right?" Templates tell the engine "what role does each piece of this string play?" They produce the same match decision; templates know more about why.

### Pre-coordination vs. post-coordination

Already covered in [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/). Briefly: a **pre-coordinated** descriptor fuses concepts in one term (`#projects/q4-roadmap` is one hierarchical token carrying two concepts). A **post-coordinated** descriptor splits concepts into independent tags applied together (`#projects` AND `#q4` AND `#roadmap`). Folder paths are pre-coordinated; tag systems can be either.

### Provenance

Which abstraction shape a rule was authored in (regex / template / marker-only). Surfaced per-rule in the guided modal under the [hybrid coexistence story](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) so the user can see what guarantees apply to each rule.

### Hybrid coexistence

The architecture proposed in [Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) where multiple rule-shape abstractions (regex, template, etc.) live side-by-side in the same rule pack. The loader normalizes them all to one internal form for the engine; the UI surfaces per-rule provenance.

## User-facing concepts

### Files outside the abstraction

A file that doesn't match any rule's pattern is invisible to the sync engine. The plugin doesn't enforce naming conventions — it acts only where the user has explicitly authored a rule. Templates aren't a fence around your vault; they're an opt-in description of structure that already exists. Adding templates to the system doesn't require renaming anything.

### Guided modal vs. advanced modal

The **guided modal** is the typed-fields editor — folder entry, tag entry, axis tile selection, transfer-op cards. The **advanced modal** is the raw regex editor — for power users or rules templates can't express. Both edit the same underlying rule; the guided form constrains you to template-shaped rules, the advanced form lets you write any regex.

### Vault scan vs. rule-pack import

Two ways rules get into your settings:

- **Vault scan** — the plugin walks your folder structure, detects shapes that match known organizational systems (PARA, JD, etc.), and offers matching packs.
- **Rule-pack import** — you pick a pack from the catalog directly without scanning. Useful when you're setting up a new vault to match a system rather than recognizing one.

## See also

- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives this glossary's lossy/lossless/bijection terms are properties *of*
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bottom-up bridge from transfer-op primitives to round-trip behavior, lossy flavors, cardinality, and the collision-vs-lossy distinction
- [Bijectivity detection](/obsidian-folder-tag-sync/concepts/bijectivity-detection/) — how the engine computes the bijectivity verdict for a rule (storage layer + algorithm)
- [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — why the typed-model layers exist; pre/post-coordination explained at length
- [When to use regex](/obsidian-folder-tag-sync/concepts/when-to-use-regex/) — current escape-hatch guidance
- [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — vocabulary in research-doc context
- [Path abstractions, part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — concrete code, hybrid coexistence
