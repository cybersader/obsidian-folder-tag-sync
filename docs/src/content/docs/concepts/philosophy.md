---
title: Philosophy — the typed model
description: Why Folder Tag Sync has an axis-typed rule model on top of regex, and what problem it solves.
sidebar:
  order: 1
---

Folder Tag Sync runs on regex — that's the low-level. But regex is the wrong layer for a user to author a rule in. A rule is really a **statement about how the folder side of a knowledgebase is structured, how the tag side is structured, and how structure crosses between them**. Regex is just one way to express that statement after you've already made it.

The typed model is how you make the statement first. Regex stays available as the escape hatch when you need it.

The architecture is built on a **progressive-disclosure** commitment: a novice user picks a rule pack from the catalog (PARA, Johnny Decimal, Zettelkasten, SEACOW-cyberbase) and gets value on day one without ever touching the layers below. As the user aligns the system to their own workflow — custom organizational schemes, multi-entity vaults, opt-in per-file recovery for lossy ops, slot transforms, group precedence — the deeper layers (Layer 2 typed model; Layer 1 raw regex) become available *progressively*. Each increment in the [development plan](/obsidian-folder-tag-sync/about/development-plan/) respects this contract.

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

1. **How the folder side is structured** — the [`FolderClassifier`](/obsidian-folder-tag-sync/concepts/folder-classifiers/) (a typed description of how this folder organizes content). What [axes](/obsidian-folder-tag-sync/concepts/axes/) (dimensions of classification — "by owner" vs "by project" vs "by date") does this folder classify? Is it enumerative (numbered siblings; order matters — e.g. Johnny Decimal categories) / hierarchical (deep subject tree, narrowing with depth) / faceted (multiple independent sub-axes under one root) / authority-root (per-entity workspace root, like `Entity/Cybersader/`) / container-only (a folder that holds things but doesn't classify them)? How is it named? How deep?
2. **How the tag side is structured** — the [`TagVocabulary`](/obsidian-folder-tag-sync/concepts/tag-vocabularies/) (a typed description of how this tag is shaped). What axis does this tag carry? Is it pre-coordinated (concepts fused into one term, like `#projects/web-auth`) / post-coordinated (concepts applied separately as multiple tags, like `#projects` + `#web-auth`) / flat-keyword (single-concept tag, no hierarchy)? Does it use a prefix marker (an optional leading character on tags showing axis membership, like `#-clip` or `#--privateAxis`)? Is the tag authoritative (this tag is the source of truth), or derived from the folder?
3. **An explicit mapping between the two sides** — the [`TransferOp`](/obsidian-folder-tag-sync/concepts/transfer-operations/) (one of eight library-science primitives that says how hierarchy crosses between the sides). Identity, truncation, promotion-to-root, flattening-to-leaf, post-coordination, aggregation, marker-only, or opaque.

Two sides, independently typed, then mapped. Each half is its own statement about a slice of your knowledgebase; the mapping is how they bridge.

## Why both sides are typed independently

Folders and tags are not mirror images. A folder tree can carry, at best, one or two axes. Tags carry everything the folder tree can't:

> SEACOW is a set of orthogonal classification axes. Knowledge has more axes than a folder tree can carry. Tags carry the axes folders can't.

So describing "the folder side" and "the tag side" as separate typed things — and then saying how they cross — lets each side be honest about what it's doing. A container-only folder (`Attachments/`) doesn't pretend to classify anything; a flat-keyword tag (`#urgent`) doesn't pretend to pre-coordinate.

### The structural difference, drawn

Visually: folders form a strict hierarchy (one parent per child); tags form a polyhierarchy (multi-parent reachability — the same item sits under several broader categories at once). The same `notes.md` file lives at *exactly one* folder path, but it's reachable from *several* tag paths simultaneously.

<figure aria-label="Two trees side-by-side. The folder tree shows a strict hierarchy where one file (notes.md) lives at exactly one path from the vault root. The tag tree shows a polyhierarchy where the same file is reachable through three different tag paths simultaneously (#projects/web/auth, #topic/oauth, #owner/cybersader). The visual contrast makes concrete what 'polyhierarchy' means as a structural property." style="margin: 1.5em 0;">
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 1.25em;"><div style="border: 1.5px solid currentColor; border-color: rgba(125,125,125,0.4); border-radius: 12px; padding: 1em 1.25em;"><div style="font-size: 0.78em; font-weight: 700; letter-spacing: 0.06em; opacity: 0.75; margin-bottom: 0.6em;">FOLDER SIDE &middot; strict hierarchy</div><div style="font-size: 0.85em; opacity: 0.85; margin-bottom: 0.5em;">One parent per child. <strong>Exactly one path</strong> from root to <code dir="auto">notes.md</code>.</div><pre style="margin: 0; font-family: ui-monospace, monospace; font-size: 0.85em; line-height: 1.55; padding: 0.6em 0.7em; background: rgba(125,125,125,0.1); border-radius: 4px; overflow-x: auto;">Vault/
&#9500;&#9472; Projects/
&#9474;  &#9500;&#9472; Web/
&#9474;  &#9474;  &#9492;&#9472; Auth/
&#9474;  &#9474;     &#9492;&#9472; <strong style="color: #4f8a4a;">notes.md</strong>
&#9474;  &#9492;&#9472; Mobile/
&#9474;     &#9492;&#9472; iOS/
&#9474;        &#9492;&#9472; spec.md
&#9492;&#9472; Capture/
   &#9492;&#9472; Inbox/
      &#9492;&#9472; scratch.md</pre><div style="font-size: 0.82em; opacity: 0.78; margin-top: 0.5em; font-style: italic;">Path to notes.md: <code dir="auto">Projects/Web/Auth/notes.md</code>. Only one. The OS enforces this.</div></div><div style="border: 1.5px solid currentColor; border-color: rgba(125,125,125,0.4); border-radius: 12px; padding: 1em 1.25em;"><div style="font-size: 0.78em; font-weight: 700; letter-spacing: 0.06em; opacity: 0.75; margin-bottom: 0.6em;">TAG SIDE &middot; polyhierarchy</div><div style="font-size: 0.85em; opacity: 0.85; margin-bottom: 0.5em;">Multi-parent reachability. <strong>Three paths</strong> all reach the same <code dir="auto">notes.md</code>.</div><pre style="margin: 0; font-family: ui-monospace, monospace; font-size: 0.85em; line-height: 1.55; padding: 0.6em 0.7em; background: rgba(125,125,125,0.1); border-radius: 4px; overflow-x: auto;">#projects/
&#9474;  &#9492;&#9472; web/
&#9474;     &#9492;&#9472; auth &#x2192;&#x2500;&#x2510;
&#9474;                  &#9474;
#topic/                  &#9474;
&#9474;  &#9492;&#9472; oauth &#x2192;&#x2500;&#x2500;&#x2500;&#x2500;&#x2524;&#x2500;&#x2500; <strong style="color: #4f8a4a;">notes.md</strong>
&#9474;                  &#9474;
#owner/                  &#9474;
   &#9492;&#9472; cybersader &#x2192;&#x2524;</pre><div style="font-size: 0.82em; opacity: 0.78; margin-top: 0.5em; font-style: italic;">Same file, three tag paths: <code dir="auto">#projects/web/auth</code>, <code dir="auto">#topic/oauth</code>, <code dir="auto">#owner/cybersader</code>. Each is a different angle on the same content.</div></div></div>
</figure>

The plugin's job is to bridge these two structurally different things deterministically. Some bridges round-trip cleanly (`identity`, `truncation/drop`); others throw information away by design (`marker-only`, `promotion-to-root`); the typed model surfaces which is which. See [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) for the per-op breakdown.

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

The short version: folders look more like **classification schemes** (a single tree where each item lives at one place), and tags look more like **descriptor-based indexing** (a controlled vocabulary — a pre-approved set of terms — applied as typed edges so each item can be reachable from many places at once). The plugin's job is to let you declare which kind of surface each side is, and how they map. Library science already has the vocabulary for that.

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
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — what determinism, lossy/lossless, and round-trip mean per transfer-op
- [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) — how primitives stack in practice
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
