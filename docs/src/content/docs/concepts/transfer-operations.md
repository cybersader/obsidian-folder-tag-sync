---
title: Transfer operations
description: The eight library-science primitives that say how folder structure becomes tag structure and vice versa.
sidebar:
  order: 5
---

A `TransferOp` is the **mapping** between the two sides of a rule — the third of the three typed things (folder side, tag side, transfer). There are eight primitives. Each one answers the question "what happens to hierarchy as this rule's folder matches become tags (and vice versa)?"

All eight are drawn from classification theory's vocabulary for how one scheme compresses or expands onto another. Each one is **runtime-enforced** by the sync engines — when a rule fires, the typed transfer op drives the **recoordination** (reshuffle path segments per the transfer op's rules before the cosmetic transforms run) of source-side path segments into destination-side tag segments before the transform pipeline (case, emoji, number-prefix) ever sees the strings.

The pipeline is:

```
match → extract → recoordinate (this page) → transform → emit
```

`recoordinate` is the pure function `applyTransfer` in `src/engine/applyTransfer.ts`. The sync engines call `applyRuleForward` (for folder→tag) or `applyRuleInverse` (for tag→folder), both of which thread the typed transfer op through this pipeline.

For the abstract framing of what each op does to information — round-trip behavior, lossy vs. lossless flavors, the difference between collision and lossy — see [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/), which is built bottom-up from this page.

## The eight primitives at a glance

| Op | Cardinality | One-line summary |
|---|---|---|
| `identity` | 1:1 | full depth preserved on both sides |
| `truncation/drop` | 1:1 (within depth) | first N segments only; deeper paths are rejected |
| `truncation/aggregate` | many:1 | first N segments + deeper joined with a separator |
| `truncation/flatten` | many:1 | first N segments + the leaf only; middle ancestry dropped |
| `marker-only` | many:1 | one fixed tag for the entry folder and everything beneath |
| `promotion-to-root` | many:1 | only the first segment after the entry becomes the tag |
| `flattening-to-leaf` | many:1 | only the leaf folder name becomes the tag |
| `post-coordination` | 1:many | N independent flat tags, one per level |
| `aggregation` | many:1 | whole path joined with separator into one tag segment |
| `opaque` | n/a | no tag is emitted (clustering folder only) |

`identity` and `truncation/drop` are the only ops that round-trip cleanly (when transforms are reversible) — given the tag, the inverse direction reconstructs the original folder path. Every other op deliberately throws information away in some direction; the user picks the lossy property they're willing to accept. Per-op forward/inverse worked examples are in each section below; for the bigger-picture framing of round-trip behavior, lossy flavors, and the collision-vs-lossy distinction, see [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/).

## `identity`

Preserve full depth on both sides.

```ts
{ op: 'identity' }
```

- **Derived folder pattern**: `^{folderEntry}/`
- **Derived tag pattern**: `^{tagEntry}/`
- **Cardinality** (the shape of the mapping — 1:1, many:1, or 1:many): 1:1, bijective (round-trip: forward then inverse gets you back to the original) when transforms are reversible
- **Use for**: output taxonomies, entity-root identity transfer, PARA (Tiago Forte's Projects/Areas/Resources/Archive) buckets

**Worked example** (with `folderEntry = "Output/Public"`, `tagEntry = "_publicTaxonomy"`, kebab-case (a-style-name-with-dashes) on tag side):

```
forward:
   Output/Public/Security/Zero-Trust/principles.md  →  #_publicTaxonomy/security/zero-trust

inverse:
   #_publicTaxonomy/security/zero-trust  →  Output/Public/Security/Zero-Trust/   (then user picks the file)
```

Every path segment round-trips. The case transforms (Title Case ↔ kebab-case) are reversible if applied symmetrically. Bijective.

## `truncation`

Bounded specificity — tag carries only the first N folder segments. The `tailHandling` option says what happens to everything deeper.

```ts
{
  op: 'truncation';
  depth: number;
  tailHandling: 'drop' | 'aggregate' | 'flatten';
  separator?: string;  // required when tailHandling === 'aggregate'
}
```

### `tailHandling: 'drop'`

Deeper segments are ignored on the tag side. The derived regex enforces this by REJECTING deeper paths — they don't match the rule at all.

```
truncation(depth: 2, tailHandling: 'drop')
folderEntry = "Capture/Clips"
→ folderPattern = ^Capture/Clips/([^/]+)(?:/([^/]+))?$

File: Capture/Clips/Web/intro.md           → matches, tag = #-clip/web
File: Capture/Clips/Web/React/intro.md     → matches, tag = #-clip/web/react
File: Capture/Clips/Web/React/Hooks/intro.md → does NOT match
```

Bijective. This is the strict option — use it when content deeper than N shouldn't participate in this rule.

### `tailHandling: 'aggregate'`

Deeper segments are **joined with `separator` into a single (N+1)th tag segment**. The "stack everything at the 3rd layer" case.

```
truncation(depth: 2, tailHandling: 'aggregate', separator: '-')

File: Capture/Clips/Web/Tutorials/React/Hooks/intro.md
Folder path:           Capture/Clips/Web/Tutorials/React/Hooks
Strip entry:                          Web/Tutorials/React/Hooks
Recoordinate (depth 2, aggregate '-'):  ['Web', 'Tutorials', 'React-Hooks']
Apply tag transforms (kebab):         ['web', 'tutorials', 'react-hooks']
Rejoin + prepend entry:               -clip/web/tutorials/react-hooks
Emit:                                 #-clip/web/tutorials/react-hooks
```

Level 1 of the source (the entry folder `Capture/Clips`) is consumed by the entry-strip step. Levels 2 and 3 of the source (`Web`, `Tutorials`) become the first two tag segments. Level 4+ of the source (`React`, `Hooks`) get joined with `-` into the single third tag segment. The tag has exactly depth 2 in your chosen vocabulary, and the deeper folder path is preserved as one compressed term.

**Not bijective**: unpacking `react-hooks` back into `React/Hooks/` is lossy — we can't know a hyphen in the aggregated segment isn't a legitimate folder-name hyphen. The plugin marks `bijective: false` on the rule.

### `tailHandling: 'flatten'`

Deeper path **collapses to just the leaf folder name**. Ancestry between depth N and the leaf is dropped.

```
truncation(depth: 2, tailHandling: 'flatten')

File: Capture/Clips/Web/Tutorials/React/Hooks/intro.md
Recoordinate:    ['Web', 'Tutorials', 'Hooks']  ← React dropped, Hooks is the leaf
Emit:            #-clip/web/tutorials/hooks
```

Use when you care about the leaf identity but not the path that led there.

## `marker-only`

Marker-only (one fixed tag for the entry folder and everything beneath, regardless of sub-path) — a flat controlled-vocabulary term applied to a whole subtree.

```ts
{ op: 'marker-only'; marker: string }
```

- **Derived folder pattern**: `^{folderEntry}(?:/.*)?$` — matches the entry folder *and* anything beneath it
- **Derived tag pattern**: `^{escape(marker)}$` (fully anchored — single controlled term, can't be a prefix of a longer tag)
- **Cardinality**: many:1, non-bijective
- **Marker is NOT re-cased** — it's a literal controlled-vocabulary term, so the runtime bypasses the tag transform pipeline for marker-only ops. `#-inbox` stays `#-inbox` no matter what `caseTransform` says.
- **Use for**: `Capture/Inbox/ ↔ #-inbox`, `System/ ↔ /template`

**Worked example** (with `folderEntry = "Capture/Inbox"`, `marker = "-inbox"`):

```
forward:
   Capture/Inbox/scratch.md            →  #-inbox
   Capture/Inbox/2026/Q2/notes.md      →  #-inbox     ← same tag, deeper path collapsed
   Capture/Inbox/projects/auth.md      →  #-inbox     ← also collapsed

inverse:
   #-inbox  →  Capture/Inbox/   ← entry folder recovered; specific deeper path is unrecoverable
```

Many distinct folder paths collapse to one tag by design. The forward direction throws information away; the inverse can reconstruct the entry folder but not which specific sub-path produced any given tagged file. Lossy in the forward direction (intentionally).

## `promotion-to-root`

Only the **first** segment after the entry becomes the tag. Everything deeper is dropped.

```ts
{ op: 'promotion-to-root' }
```

- **Derived folder pattern**: `^{folderEntry}/([^/]+)(?:/.*)?$`
- **Derived tag pattern**: `^{tagEntry}/([^/]+)$`
- **Cardinality**: many:1
- **Use for**: coarse collection — "this belongs to project X; the inner structure isn't worth tagging"

**Worked example** (with `folderEntry = "Projects"`, `tagEntry = "projects"`):

```
forward:
   Projects/Web Auth/notes.md            → #projects/web-auth
   Projects/Web Auth/oauth/flow.md       → #projects/web-auth   ← deeper structure dropped
   Projects/Web Auth/oauth/refresh.md    → #projects/web-auth   ← also dropped to same tag

inverse:
   #projects/web-auth → Projects/Web Auth    ← recovers entry + first segment, not which file beneath it produced the tag
```

The inverse direction recovers `Projects/Web Auth` reliably; everything below that is information the forward direction discarded. Lossy in the forward direction; the inverse can't reconstruct deeper structure.

## `flattening-to-leaf`

Only the **last** segment (the leaf folder) becomes the tag. Ancestry is dropped.

```ts
{ op: 'flattening-to-leaf' }
```

- **Cardinality**: many:1
- **Use for**: leaf-name indexing — "tag this file by the deepest folder it sits in"

**Worked example** (with `folderEntry = "Sources"`, `tagEntry = "via"`):

```
forward:
   Sources/Books/Knuth/TAOCP.md          → #via/knuth
   Sources/Conferences/2024/USENIX/Knuth.md → #via/knuth   ← different ancestry, same leaf, same tag
   Sources/Knuth/preface.md              → #via/knuth   ← also collapses

inverse:
   #via/knuth → Sources/…/Knuth/         ← we know the leaf is "Knuth" but not which ancestry produced it
```

The leaf identity survives forward; the path that led there does not. Use when "what folder is this file in?" matters but "where in the tree is that folder?" does not.

## `post-coordination`

Axis split. Each folder segment becomes **its own flat tag** — N tags instead of one hierarchical tag. The sync engine emits all N to the file's frontmatter.

```ts
{ op: 'post-coordination' }
```

- **Cardinality**: 1:many
- **Use for**: faceted vocabularies where each facet is independent

**Worked example** (with `folderEntry = "Research"`, kebab-case on tag side):

```
forward:
   Research/Attention/2024-Q4/notes.md   →  #attention  +  #2024-q4
   (file frontmatter gets both tags; hierarchy between them is gone)

inverse:
   #attention  +  #2024-q4   →  ???
   one tag can only place a file in one folder; multiple tags don't pick one
```

Lossy in the inverse direction by construction — N independent tags don't compose into a single folder path. Typically users author asymmetric rule pairs: forward direction is `post-coordination` (folder → many flat tags), inverse direction is `flattening-to-leaf` or `identity` so adding one tag still moves the file somewhere predictable.

## `aggregation`

Whole path joined with separator into a single tag segment. Think of it as `truncation(depth: 0, tailHandling: 'aggregate')`.

```ts
{ op: 'aggregation'; separator: string }
```

- **Cardinality**: many:1
- **Example** (`folderEntry = "Capture/Clips"`, `tagEntry = "-clip"`, `separator = '-'`):

```
forward:
   Capture/Clips/Web/Tutorials/React/Hooks/intro.md  → #-clip/web-tutorials-react-hooks
   Capture/Clips/Web-Tutorials/React/Hooks/intro.md  → #-clip/web-tutorials-react-hooks   ← same tag

inverse:
   #-clip/web-tutorials-react-hooks → ambiguous: could split as Web/Tutorials/React/Hooks
                                      or as Web-Tutorials/React/Hooks (or other splits)
```

Lossy because separator characters in segment names collide with the segment-joining separator. Use when you want a single compact tag and don't need the inverse to round-trip cleanly.

## `opaque`

**No tag is emitted**. The folder exists for clustering only.

```ts
{ op: 'opaque' }
```

- **Cardinality**: n/a — there's no transfer happening
- **Inverse direction**: also a no-op (no tag exists to invert)
- **Use for**: `Attachments/`, `Drafts/`, `_archive/` — folders whose contents shouldn't be tagged automatically

`opaque` isn't lossy or lossless — it's the absence of a transfer. The folder exists in the file system, the rule matches it, and the rule explicitly chooses to do nothing. Useful when a folder is structurally part of an organizational system but shouldn't carry a tag (clustering-only).

## Picking the right op — a decision tree

1. **Should this folder emit a tag at all?** No → `opaque`. Yes → continue.
2. **Is the folder depth meaningful in the tag?** No → `marker-only` (flat) or `promotion-to-root` / `flattening-to-leaf` (single-segment). Yes → continue.
3. **Do you want full depth?** Yes → `identity`. No, cap it → `truncation` (pick `tailHandling`).
4. **Are levels independent facets, not a single hierarchical term?** Yes → `post-coordination`. No, compact them → `aggregation`.

See [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) for how common multi-primitive situations collapse into single primitives with mode flags.

## See also

- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge from these primitives upward to round-trip behavior, lossy flavors, cardinality, collision-vs-lossy
- [Bijectivity detection](/obsidian-folder-tag-sync/concepts/bijectivity-detection/) — the algorithm + storage layer the engine uses to compute whether a rule is bijective at runtime, given these primitives + per-filter transform metadata
- [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) — when two ops would naively stack but collapse into one with a mode flag
- [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — why these eight ops, and what they mean as part of the typed model
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
- [When to use regex](/obsidian-folder-tag-sync/concepts/when-to-use-regex/) — when none of the eight fit and you need raw regex
