---
title: Transfer operations
description: The eight library-science primitives that say how folder structure becomes tag structure and vice versa.
sidebar:
  order: 5
---

A `TransferOp` is the **mapping** between the two sides of a rule — the third of the three typed things (folder side, tag side, transfer). There are eight primitives. Each one answers the question "what happens to hierarchy as this rule's folder matches become tags (and vice versa)?"

All eight are drawn from classification theory's vocabulary for how one scheme compresses or expands onto another. Each one is **runtime-enforced** by the sync engines — when a rule fires, the typed transfer op drives the recoordination of source-side path segments into destination-side tag segments before the transform pipeline (case, emoji, number-prefix) ever sees the strings.

The pipeline is:

```
match → extract → recoordinate (this page) → transform → emit
```

`recoordinate` is the pure function `applyTransfer` in `src/engine/applyTransfer.ts`. The sync engines call `applyRuleForward` (for folder→tag) or `applyRuleInverse` (for tag→folder), both of which thread the typed transfer op through this pipeline.

For the abstract framing of what each op does to information — round-trip behavior, lossy vs. lossless flavors, the difference between collision and lossy — see [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/), which is built bottom-up from this page.

## The eight primitives at a glance

| Op | Shape | Cardinality | Inverse recovers… | When to use |
|---|---|---|---|---|
| `identity` | full depth preserved | 1:1 | the original folder path | mirror the folder tree into tags |
| `truncation/drop` | first N segments; rejects deeper paths | 1:1 (within depth) | the original folder path (rejected paths weren't in the rule's domain) | cap tag depth; refuse anything deeper |
| `truncation/aggregate` | first N segments + deeper joined with separator | many:1 | a path candidate, but separator/segment boundary is ambiguous | cap depth and keep deeper-structure as one compressed term |
| `truncation/flatten` | first N segments + leaf only | many:1 | first N + the leaf folder; middle ancestry is lost | cap depth and keep the leaf identity but not the ancestry |
| `marker-only` | one fixed tag for entry + everything beneath | many:1 | the entry folder only; specific deeper path is lost | inboxes, attachments, template markers |
| `promotion-to-root` | only first segment after entry → tag | many:1 | entry + first segment; deeper structure is lost | coarse collection ("this is a project", no more) |
| `flattening-to-leaf` | only the leaf folder name → tag | many:1 | the leaf folder name; ancestry is lost | leaf-name indexing, ignoring ancestry |
| `post-coordination` | N independent flat tags, one per level | 1:many | not uniquely — multiple tags don't pick one folder | faceted vocabularies |
| `aggregation` | whole path joined with separator into one tag | many:1 | a path candidate; separator/segment boundary ambiguous | compact descriptor tags |
| `opaque` | no tag is emitted | n/a | n/a — there's no tag to invert | container folders with no tag semantic |

The "Inverse recovers…" column is the load-bearing one for understanding lossy vs. lossless. `identity` and `truncation/drop` are the only two that fully recover the original folder path on the inverse direction — they're the bijective ones (when transforms are reversible). Every other op deliberately throws information away in some direction; the user picks the op with the lossy property they're willing to accept.

## `identity`

Preserve full depth. Folder `Output/Public/Security/Zero-Trust/` → tag `#_publicTaxonomy/security/zero-trust`.

```ts
{ op: 'identity' }
```

- **Derived folder pattern**: `^{folderEntry}/`
- **Derived tag pattern**: `^{tagEntry}/`
- **Cardinality**: 1:1, bijective when transforms are reversible
- **Use for**: output taxonomies, entity-root identity transfer, PARA buckets

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

Flat controlled vocabulary — one fixed tag for everything under the folder (and the folder itself), regardless of sub-path.

```ts
{ op: 'marker-only'; marker: string }
```

- **Derived folder pattern**: `^{folderEntry}(?:/.*)?$` — matches the entry folder *and* anything beneath it
- **Derived tag pattern**: `^{escape(marker)}$` (fully anchored — single controlled term, can't be a prefix of a longer tag)
- **Cardinality**: many:1, non-bijective
- **Marker is NOT re-cased** — it's a literal controlled-vocabulary term, so the runtime bypasses the tag transform pipeline for marker-only ops. `#-inbox` stays `#-inbox` no matter what `caseTransform` says.
- **Use for**: `Capture/Inbox/ ↔ #-inbox`, `System/ ↔ /template`

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

- **Use for**: faceted vocabularies where each facet is independent
- **Worked example**: `Research/Attention/2024-Q4/` (with `folderEntry: 'Research'`) → `#attention` + `#2024-q4` (two flat tags, hierarchy lost)
- **Inverse direction**: a single tag can only place a file in one folder, so the inverse uses just the first emitted segment list — typically users author rules where the forward is post-coordination and the inverse is `flattening-to-leaf` or `identity` for asymmetric handling

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
- [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) — when two ops would naively stack but collapse into one with a mode flag
- [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — why these eight ops, and what they mean as part of the typed model
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
- [When to use regex](/obsidian-folder-tag-sync/concepts/when-to-use-regex/) — when none of the eight fit and you need raw regex
