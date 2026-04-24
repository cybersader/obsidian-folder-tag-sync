---
title: Philosophy — the typed model
description: Why Folder Tag Sync has an axis-typed rule model on top of regex, and what problem it solves.
sidebar:
  order: 1
---

Folder Tag Sync runs on regex — that's the low-level. But regex is the wrong layer for a user to author a rule in. A rule is really a **statement about how the folder side of a knowledgebase is structured, how the tag side is structured, and how structure crosses between them**. Regex is just one way to express that statement after you've already made it.

The typed model is how you make the statement first. Regex stays available as the escape hatch when you need it.

## The three layers

```
Layer 3 — user intent            "I want clips to only go 2 deep"
Layer 2 — typed model            FolderClassifier + TagVocabulary + TransferOp
Layer 1 — raw regex + transforms folderPattern, tagPattern, TransformConfig
Layer 0 — Obsidian               sync engines, vault API calls
```

**Phase 2 adds Layer 2.** It sits on top of Layer 1 — it doesn't replace it. A rule can be authored entirely at Layer 2 (the plugin derives Layer 1 for you), entirely at Layer 1 (if you need regex escape hatches the typed model can't express), or a mix.

## What a rule actually is — two independently typed sides plus a mapping

The typed model isn't a single description of a rule. It's **three things**:

1. **How the folder side is structured** — the [`FolderClassifier`](/obsidian-folder-tag-sync/concepts/folder-classifiers/). What [axes](/obsidian-folder-tag-sync/concepts/axes/) does this folder classify? Is it enumerative (JD-style numbered siblings) / hierarchical (deep subject tree) / faceted / authority-root / container-only? How is it named? How deep?
2. **How the tag side is structured** — the [`TagVocabulary`](/obsidian-folder-tag-sync/concepts/tag-vocabularies/). What axis does this tag carry? Is it pre-coordinated / post-coordinated / flat-keyword? Does it use a prefix marker? Is the tag authoritative, or derived from the folder?
3. **An explicit mapping between the two sides** — the [`TransferOp`](/obsidian-folder-tag-sync/concepts/transfer-operations/). Identity, truncation, promotion-to-root, flattening-to-leaf, post-coordination, aggregation, marker-only, or opaque.

Two sides, independently typed, then mapped. Each half is its own statement about a slice of your knowledgebase; the mapping is how they bridge.

## Why both sides are typed independently

Folders and tags are not mirror images. A folder tree can carry, at best, one or two axes. Tags carry everything the folder tree can't:

> SEACOW is a set of orthogonal classification axes. Knowledge has more axes than a folder tree can carry. Tags carry the axes folders can't.

So describing "the folder side" and "the tag side" as separate typed things — and then saying how they cross — lets each side be honest about what it's doing. A container-only folder (`Attachments/`) doesn't pretend to classify anything; a flat-keyword tag (`#urgent`) doesn't pretend to pre-coordinate.

## Primitives are small. Real rules are primitives *stacked*

This is the other half of the principle, and it's load-bearing.

Most real-world mappings aren't one pure primitive — they're **two primitives composed**:

- *"Preserve the first two levels of the folder path; stack everything deeper into one aggregated segment."* → `truncation(depth: 2)` ∘ `aggregation(separator: '-')` applied to the tail
- *"The entity workspace is an authority-root that identity-transfers, but the inner Work layer is JD-ordinal."* → `authority-root` folder scheme ∘ `identity` transfer ∘ `numberPrefixHandling: 'keep'` on transforms
- *"Clips folder is a container at level 1; subfolders are a 2-deep taxonomy that maps identity."* → `container-only` (level 1) ∘ `truncation(depth: 2, tail: 'drop')` (levels 2–3)

The response is not to add a primitive per composition. That would blow up the vocabulary. Instead: **keep the primitive set small** (8 transfer ops, 5 folder schemes, 3 tag coordinations), and **make each primitive carry the options** needed to absorb its common compound behaviors.

Concretely:

- [`truncation`](/obsidian-folder-tag-sync/concepts/transfer-operations/#truncation) gets a `tailHandling: 'drop' | 'aggregate' | 'flatten'` option that absorbs the compound "preserve N then do something with the tail" cases.
- `FolderClassifier.axes` is a **list**, because an entity root that scopes a Work taxonomy is genuinely two axes on one folder — not a composition of rules.
- Transforms (`caseTransform`, `emojiHandling`, `numberPrefixHandling`) compose naturally inside a single rule because they're primitive-independent.

Where two primitives really are distinct surfaces — e.g. an entity rule and a Work rule both matching the same path — you get **two rules**, prioritized. That stays the model. You never need to author `truncation ∘ aggregation` as two rules if it's one semantic operation; the primitive carries the mode flag. See [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) for how to spot the difference.

## Why library science

The vocabulary here — enumerative, hierarchical, faceted, pre-coordinated, post-coordinated, controlled vocabulary, broader-term / narrower-term — is not invented for this plugin. It's drawn from classification theory and knowledge organization (KO) literature. When the types feel principled and durable, that's because they are — they've been refined over a century of thinking about how humans organize subjects into hierarchies, facets, and controlled vocabularies.

The short version: folders look more like **classification schemes** (a single tree), and tags look more like **descriptor-based indexing** (a controlled vocabulary applied as typed edges). The plugin's job is to let you declare which kind of surface each side is, and how they map. Library science already has the vocabulary for that.

## When to drop to regex

Even with eight primitives × mode flags, there are rules the typed model can't cleanly express. Most of these involve:

- Non-Latin character handling where the transform pipeline's built-in case transforms don't fit
- Unusual prefix conventions where the five `prefixMarker` values don't match your tag vocabulary
- Ad-hoc migration rules where you want to match exactly one directory with specific regex

For these, author the rule directly at Layer 1 — raw regex patterns + a `TransformConfig`. The typed fields stay empty. The sync engines consume Layer 1 regardless of whether Layer 2 is present. See [When to use regex](/obsidian-folder-tag-sync/concepts/when-to-use-regex/).

## Related concepts

- [SEACOW axes](/obsidian-folder-tag-sync/concepts/axes/) — the meta-dimension both sides carry
- [Folder classifiers](/obsidian-folder-tag-sync/concepts/folder-classifiers/) — the 5 scheme kinds
- [Tag vocabularies](/obsidian-folder-tag-sync/concepts/tag-vocabularies/) — coordination modes + prefix markers
- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the 8 mapping primitives
- [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) — how primitives stack in practice
