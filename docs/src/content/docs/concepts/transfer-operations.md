---
title: Transfer operations
description: The eight library-science primitives that say how folder structure becomes tag structure and vice versa.
sidebar:
  order: 5
---

A `TransferOp` is the **mapping** between the two sides of a rule — the third of the three typed things (folder side, tag side, transfer). There are eight primitives. Each one answers the question "what happens to hierarchy as this rule's folder matches become tags (and vice versa)?"

All eight are drawn from classification theory's vocabulary for how one scheme compresses or expands onto another.

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

Deeper segments are **joined with `separator` into a single (N+1)th tag segment**. The user's "stack everything at the 3rd layer" case.

```
truncation(depth: 2, tailHandling: 'aggregate', separator: '-')
File: Capture/Clips/Web/Tutorials/React/Hooks/intro.md
→ tag = #-clip/web/tutorials-react-hooks
```

Level 1 (entry): `Capture/Clips` → `-clip`. Level 2 preserved: `Web` → `web`. Level 3+ aggregated: `Tutorials/React/Hooks` → `tutorials-react-hooks`. The tag has exactly depth 2 (your chosen hierarchy budget), and the deeper path gets packed into the single (N+1)th tag segment.

**Not bijective**: unpacking `tutorials-react-hooks` back into `Tutorials/React/Hooks/` is lossy — we can't know a hyphen in the aggregated segment isn't a legitimate folder-name hyphen. The plugin warns on save.

### `tailHandling: 'flatten'`

Deeper path **collapses to just the leaf folder name**.

```
truncation(depth: 2, tailHandling: 'flatten')
File: Capture/Clips/Web/Tutorials/React/Hooks/intro.md
→ tag = #-clip/web/hooks
```

Level 2 preserved; the ancestry between level 2 and the leaf is thrown away. Lossy.

## `marker-only`

Flat controlled vocabulary — one fixed tag for everything under the folder, regardless of sub-path.

```ts
{ op: 'marker-only'; marker: string }
```

- **Derived folder pattern**: `^{folderEntry}/.*$`
- **Derived tag pattern**: `^{escape(marker)}$` (fully anchored — single controlled term)
- **Cardinality**: many:1, non-bijective
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

Axis split. Each folder segment becomes **its own flat tag** — N tags instead of one hierarchical tag.

```ts
{ op: 'post-coordination' }
```

- **Use for**: faceted vocabularies where each facet is independent
- **Example**: `Research/Attention/2024-Q4/` → `#research` + `#attention` + `#2024-q4` (three flat tags)

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
