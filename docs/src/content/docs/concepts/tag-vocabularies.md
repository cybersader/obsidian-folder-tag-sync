---
title: Tag vocabularies
description: How the tag side of a rule describes its axis, coordination mode, prefix marker, and authority.
sidebar:
  order: 4
---

A tag is a **term in a controlled vocabulary** that points to a concept along one axis. Every tag is axis-pure — one tag, one axis. The `TagVocabulary` captures how a particular tag family behaves.

```ts
interface TagVocabulary {
  axis: Axis;
  coordination: 'pre-coordinated' | 'post-coordinated' | 'flat-keyword';
  prefixMarker: '/' | '--' | '-' | '_' | '' | null;
  authority: 'folder-authoritative' | 'tag-authoritative' | 'mutual';
}
```

## Coordination — how concepts combine in a single tag

Borrowed directly from classification theory.

### `pre-coordinated`

Concepts are **fused in the term** itself. `#projects/q4-roadmap` is one pre-coordinated tag: the projects-concept and the q4-roadmap-concept are combined in a single hierarchical term.

- **Examples**: `#projects/q4-roadmap`, `#--cybersader/10-projects/11-q4-roadmap`, `#_publicTaxonomy/security/zero-trust`
- **Pairs with**: hierarchical or enumerative folder schemes, identity or truncation transfer
- **Effect**: one tag captures the position; tag hierarchy mirrors folder hierarchy

### `post-coordinated`

Concepts are **applied separately** — multiple independent tags describe one note. `#projects` + `#q4-roadmap` co-exist as separate tags rather than fusing.

- **Examples**: `#topic/attention` + `#author/kahneman` + `#2024` on one note
- **Pairs with**: faceted folder schemes, `post-coordination` transfer, relation axis
- **Effect**: many tags per note; filtering is the union of axis values

### `flat-keyword`

Single-concept tags that don't compound. `#urgent`, `#inbox`, `#draft`.

- **Examples**: `#-inbox`, `#urgent`, `/template`
- **Pairs with**: container-only folder schemes, `marker-only` transfer
- **Effect**: one tag says one thing; no hierarchy

## Prefix markers — optional axis signals

The documented SEACOW prefix conventions:

| Marker | Axis | Example |
|---|---|---|
| `/` | system | `#/template` |
| `--` | entity | `#--cybersader/...` |
| `-` | capture | `#-inbox`, `#-clip/web` |
| `_` | output | `#_/essays`, `#_publicTaxonomy/...` |
| `` (empty) | work | `#projects/q4-roadmap` |
| `null` | relation or un-prefixed | `#topic/attention` |

Prefix markers buy you two things:

1. **Visual axis grouping** in the tag pane, because ASCII sort naturally puts prefixes first:
   ```
   #--cybersader  (entity — two dashes)
   #-clip         (capture — single dash)
   #/template     (system — slash)
   #_/essays      (output — underscore)
   #projects      (work — word)
   ```
2. **Fast axis recognition** when scanning a note's tag list — you see the marker before the term.

Your vault doesn't have to use these. Set `prefixMarker: null` (or `''`) if your convention is flat, and the plugin works the same way.

## Authority — which side "wins" in bidirectional rules

This determines what happens when the folder path and the tag disagree:

- **`folder-authoritative`**: the folder path is the source of truth. If a user adds a tag that would imply a different folder, sync ignores it. Used when folder is the canonical location and tags are derived views.
- **`tag-authoritative`**: the tag is the source of truth. If the user moves a file, the tag stays the same and the file may be moved back. Used for tag-driven organization systems where folders are just a projection.
- **`mutual`**: either side can be edited; the last change propagates. Used for symmetric bidirectional rules.

The `direction` field on the rule and the `authority` field on the tag vocabulary are redundant in some combinations — if `direction: 'folder-to-tag'`, authority is necessarily `folder-authoritative`. The `authority` field still lives on the vocabulary because it's a property of how the tag is *meant* to work, independent of any particular rule that uses it.

## Axis-pure: one axis per tag

Every `TagVocabulary.axis` is a single value, not a list. This is not because a tag couldn't theoretically combine axes, but because **combining axes in a single tag is what pre-coordination already does**. `#--cybersader/10-projects` already mixes `entity` and `work` by virtue of being a pre-coordinated term under the entity root — but the tag as a controlled-vocabulary entry is classified as `entity` (the root axis). The inner `10-projects` is part of the pre-coordinated term, not a second axis declaration.

If you genuinely need two independent axes on one note, you apply two tags — one per vocabulary. That's exactly what post-coordination is for.

## What vocabularies compile to (derivation)

For identity-transfer, the tag side compiles to `^{tagEntry}/` — an anchor-prefix match. The `prefixMarker` is folded into `tagEntry` (e.g. `-clip`, not just `clip`), so the regex sees the full anchor.

For `marker-only` transfer, the derived pattern is a full anchor on the exact marker:

```
marker = "-inbox"
  → ^-inbox$
```

This prevents `#-inbox` from matching accidentally if someone writes `#-inbox/sub-thing` — the marker is a single controlled term by definition.
