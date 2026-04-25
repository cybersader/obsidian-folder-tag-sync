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

## The eight primitives at a glance

| Op | Shape | Bijective | When to use |
|---|---|---|---|
| `identity` | full depth preserved | yes | mirror the folder tree into tags |
| `truncation` | first N segments + `tailHandling` | depends | cap tag depth; stack/drop/flatten the rest |
| `marker-only` | one flat tag for everything under folder | no | inboxes, attachments, template markers |
| `promotion-to-root` | only the first segment becomes the tag | no | coarse collection ("this is a project", no more) |
| `flattening-to-leaf` | only the last segment becomes the tag | no | indexing by leaf name, ignoring ancestry |
| `post-coordination` | N independent flat tags, one per level | no | faceted vocabularies |
| `aggregation` | whole path joined with separator | no | compact descriptor tags |
| `opaque` | no tag emitted at all | — | container folders with no tag semantic |

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

## `flattening-to-leaf`

Only the **last** segment (the leaf folder) becomes the tag. Ancestry is dropped.

```ts
{ op: 'flattening-to-leaf' }
```

- **Cardinality**: many:1
- **Use for**: leaf-name indexing — "tag this file by the deepest folder it sits in"

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

- **Example**: `Web/Tutorials/React/Hooks/` → `#-clip/web-tutorials-react-hooks` (one tag, compact descriptor)

## `opaque`

**No tag is emitted**. The folder exists for clustering only.

```ts
{ op: 'opaque' }
```

- **Use for**: `Attachments/`, `Drafts/`, `_archive/` — folders whose contents shouldn't be tagged automatically

## Picking the right op — a decision tree

1. **Should this folder emit a tag at all?** No → `opaque`. Yes → continue.
2. **Is the folder depth meaningful in the tag?** No → `marker-only` (flat) or `promotion-to-root` / `flattening-to-leaf` (single-segment). Yes → continue.
3. **Do you want full depth?** Yes → `identity`. No, cap it → `truncation` (pick `tailHandling`).
4. **Are levels independent facets, not a single hierarchical term?** Yes → `post-coordination`. No, compact them → `aggregation`.

See [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) for how common multi-primitive situations collapse into single primitives with mode flags.
