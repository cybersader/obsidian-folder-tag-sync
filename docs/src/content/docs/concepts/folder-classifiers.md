---
title: Folder classifiers
description: How the folder side of a rule describes its classification scheme, naming, depth, and sibling uniformity.
sidebar:
  order: 3
---

A folder is a classification point. The `FolderClassifier` tells the plugin what *kind* of classification it is — so derivation can produce the right regex, transforms, and depth enforcement.

```ts
interface FolderClassifier {
  axes: Axis[];
  scheme: 'enumerative' | 'hierarchical' | 'faceted' | 'authority-root' | 'container-only';
  naming: 'word' | 'ordinal' | 'symbol-prefixed' | 'emoji-prefixed' | 'mixed';
  subdivisionDepth: number | 'unbounded';
  siblingUniformity: 'parallel' | 'unique';
}
```

## The five schemes

### `enumerative`

Numbered siblings. Order is meaningful. Johnny Decimal lives here.

- **Examples**: `10 - Projects/`, `20 - Areas/`, `30 - Resources/`
- **Naming pairing**: usually `ordinal`
- **Typical transfer op**: `identity` with `numberPrefixHandling: 'keep'`

### `hierarchical`

Strict subject tree. Each folder classifies its contents into a subject; subfolders narrow the subject. Deep Output taxonomies are the canonical case.

- **Examples**: `Output/Public/Security/Network/...`
- **Naming pairing**: `word`
- **Typical transfer op**: `identity` (preserve the taxonomy depth)

### `faceted`

Multiple independent sub-axes intermixed under one root. Rare in practice — most faceted vocabularies live on the tag side, not the folder side.

- **Examples**: a `Research/` folder where subfolders are intermixed topic + status + year
- **Naming pairing**: `mixed`
- **Typical transfer op**: `post-coordination` (emit N flat tags instead of one hierarchical tag)

### `authority-root`

Per-authority workspace. Each top-level child is a separate identity / owner, and the inner shape repeats per authority.

- **Examples**: `Cybersader/`, `Username1/`, `TeamA/`
- **Naming pairing**: `word` or `symbol-prefixed`
- **Typical transfer op**: `identity` (match the whole sub-path under the authority)
- **Axes**: typically `['entity']` OR `['entity', 'work']` when the authority also scopes a Work layer

### `container-only`

Clusters content without classifying it. Useful for inboxes, attachment dumps, draft folders — the folder exists to group, not to say what's *in* the group.

- **Examples**: `Capture/Inbox/`, `Attachments/`, `Drafts/`
- **Naming pairing**: `word`
- **Typical transfer op**: `marker-only` (one flat tag for everything under this folder) or `opaque` (no tag at all)
- **`subdivisionDepth: 0`** — by definition, container-only folders don't subdivide

## Naming conventions

- `word` — plain words: `Projects/`, `Security/`
- `ordinal` — numbered prefix: `10 - Projects/`, `21 - Research/`
- `symbol-prefixed` — leading symbol: `--Cybersader/`, `_Public/`
- `emoji-prefixed` — leading emoji: `📁 Projects/`, `🗂️ Archive/`
- `mixed` — more than one convention in the same subtree

**Derivation uses this field** to decide the transform pipeline:
- `emoji-prefixed` → `emojiHandling: 'strip'` by default (tag side can't have emoji)
- `ordinal` → `numberPrefixHandling: 'keep'` by default (preserves JD numbering in tags)
- `symbol-prefixed` → handled by the `prefixMarker` on the tag vocabulary

## Depth and uniformity

- **`subdivisionDepth`**: how many levels of subfolder this scheme expects. `'unbounded'` for taxonomies that can go arbitrarily deep; a finite number for depth-capped schemes. Used by `truncation`-op rules to enforce the cap in the derived regex.
- **`siblingUniformity`**: are siblings all the same shape (`parallel`, e.g. each entity root has the same inner structure) or each shaped differently (`unique`, e.g. `System/` has one shape, `Output/` has another)? Future wildcard support (Phase 3) will care about this.

## `axes` is a list, not a single value

One folder can genuinely carry two axes. The canonical case:

```yaml
folder: "Entity/Cybersader/10 - Projects/11 - Q4 Roadmap/"
axes: [entity, work]
scheme: authority-root
```

The top level is the entity workspace (`entity` axis). Inside it, the JD-numbered Work taxonomy lives. One folder, two axes — not two folders stacked. This is the main reason `axes` is `Axis[]` rather than `Axis`: some folders legitimately participate in more than one dimension of classification.

## What classifiers compile to (derivation)

For identity-transfer rules, the folder side compiles to `^{folderEntry}/` — a simple anchor-prefix pattern. Depth semantics (from `subdivisionDepth`) are carried in the typed metadata for future enforcement phases; the baseline regex doesn't bound depth.

For `truncation` with `tailHandling: 'drop'`, the derived pattern caps depth at N segments:

```
folderEntry = "Capture/Clips"
depth = 2
tailHandling = 'drop'
  → ^Capture/Clips/([^/]+)(?:/([^/]+))?$
```

Paths deeper than the cap don't match the rule — their content stays put on disk but won't produce or respond to tags under this rule. Use `tailHandling: 'aggregate'` or `'flatten'` if you want every path to match regardless of depth. See [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/#truncation).
