---
title: Writing a rule pack
description: Author a pack from scratch by describing folder and tag sides independently, then the transfer between them.
sidebar:
  order: 2
---

A rule pack is a JSON document describing one organizational framework. Authoring one in the typed model means describing three things for each rule:

1. How the folder side is structured ([`FolderClassifier`](/obsidian-folder-tag-sync/concepts/folder-classifiers/))
2. How the tag side is structured ([`TagVocabulary`](/obsidian-folder-tag-sync/concepts/tag-vocabularies/))
3. How they map ([`TransferOp`](/obsidian-folder-tag-sync/concepts/transfer-operations/))

The plugin derives the regex and transform pipeline for you.

## Worked example — authoring a SEACOW pack from scratch

We'll build a minimal 3-rule pack covering capture, entity, and output.

### Step 1 — the pack metadata

```json
{
  "name": "My SEACOW pack",
  "description": "Capture/Entity/Output rules for my vault",
  "version": "1.0.0",
  "author": "YourName",
  "rules": []
}
```

### Step 2 — rule 1: capture inbox (marker-only)

The capture axis is flat keyword — `#-inbox` just says "this is raw material". Folder is container-only (doesn't subdivide).

```json
{
  "typedSpec": {
    "id": "capture-inbox",
    "name": "Capture inbox",
    "priority": 10,
    "direction": "tag-to-folder",
    "enabled": true,
    "folder": {
      "axes": ["capture"],
      "scheme": "container-only",
      "naming": "word",
      "subdivisionDepth": 0,
      "siblingUniformity": "unique"
    },
    "tag": {
      "axis": "capture",
      "coordination": "flat-keyword",
      "prefixMarker": "-",
      "authority": "tag-authoritative"
    },
    "transfer": { "op": "marker-only", "marker": "-inbox" },
    "inverseTransfer": { "op": "marker-only", "marker": "-inbox" },
    "folderEntry": "Capture/Inbox",
    "tagEntry": "-inbox",
    "options": {
      "createFolders": true,
      "addTags": false,
      "removeOrphanedTags": false,
      "syncOnFileCreate": true,
      "syncOnFileMove": true,
      "syncOnFileRename": false
    }
  }
}
```

Derivation produces `folderPattern: "^Capture/Inbox/.*$"`, `tagPattern: "^-inbox$"`, and the right transform defaults.

### Step 3 — rule 2: entity workspace (identity)

The entity axis uses `--` prefix. Folder is authority-root (each entity is its own scope). Transfer is identity — full depth preserved.

```json
{
  "typedSpec": {
    "id": "entity-cybersader",
    "name": "Entity: Cybersader",
    "priority": 20,
    "direction": "bidirectional",
    "enabled": true,
    "folder": {
      "axes": ["entity", "work"],
      "scheme": "authority-root",
      "naming": "word",
      "subdivisionDepth": "unbounded",
      "siblingUniformity": "parallel"
    },
    "tag": {
      "axis": "entity",
      "coordination": "pre-coordinated",
      "prefixMarker": "--",
      "authority": "mutual"
    },
    "transfer": { "op": "identity" },
    "inverseTransfer": { "op": "identity" },
    "folderEntry": "Entity/Cybersader",
    "tagEntry": "--cybersader",
    "options": { "createFolders": true, "addTags": true, "syncOnFileCreate": true, "syncOnFileMove": true, "syncOnFileRename": true, "removeOrphanedTags": false }
  }
}
```

Note `axes: ["entity", "work"]` — the folder carries both. The entity root scopes the Work taxonomy that lives inside. No composition needed; this is one folder, two axes.

### Step 4 — rule 3: capture clips with depth cap (truncation)

The compound case. Clips should only propagate 2 levels of hierarchy into tags; deeper paths stack into the third tag segment.

```json
{
  "typedSpec": {
    "id": "capture-clip",
    "name": "Capture: Clips (depth 2 + stack deeper)",
    "priority": 15,
    "direction": "tag-to-folder",
    "enabled": true,
    "folder": {
      "axes": ["capture"],
      "scheme": "hierarchical",
      "naming": "word",
      "subdivisionDepth": 2,
      "siblingUniformity": "unique"
    },
    "tag": {
      "axis": "capture",
      "coordination": "pre-coordinated",
      "prefixMarker": "-",
      "authority": "tag-authoritative"
    },
    "transfer": { "op": "truncation", "depth": 2, "tailHandling": "aggregate", "separator": "-" },
    "inverseTransfer": { "op": "truncation", "depth": 2, "tailHandling": "aggregate", "separator": "-" },
    "folderEntry": "Capture/Clips",
    "tagEntry": "-clip",
    "options": { "createFolders": true, "addTags": true, "syncOnFileCreate": true, "syncOnFileMove": true, "syncOnFileRename": true, "removeOrphanedTags": false }
  }
}
```

`File: Capture/Clips/Web/Tutorials/React/Hooks/intro.md → #-clip/web/tutorials-react-hooks`.

### Step 5 — save and test

Save the file as `.obsidian/plugins/folder-tag-sync/rule-packs/my-seacow.json`. Open the plugin settings, click **Browse bundled rule packs**, pick your pack. The 3 rules appear in your settings list. Test with a file in each folder.

## The minimal shape reference

Every `typedSpec` needs:

- `id`, `name`, `priority`, `direction`, `enabled`
- `folder` (see [Folder classifiers](/obsidian-folder-tag-sync/concepts/folder-classifiers/))
- `tag` (see [Tag vocabularies](/obsidian-folder-tag-sync/concepts/tag-vocabularies/))
- `transfer` + `inverseTransfer` (see [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/))
- `folderEntry` (no trailing slash)
- `tagEntry` (includes prefix marker, no trailing slash — e.g. `-clip`, not `clip`)
- `options`

Every `typedSpec` may optionally include:
- `description`
- `transformOverrides` to override derivation defaults for case / emoji / number-prefix handling

## Authoring legacy (Layer 1 only)

You can also author a rule pack with only raw regex + transforms. See [When to use regex](/obsidian-folder-tag-sync/concepts/when-to-use-regex/) for when this makes sense. The schema is documented in `rule-packs/README.md` inside the plugin folder.

## Tips

- **Start with one rule, one axis.** Get the inbox rule working end-to-end before adding entity and output.
- **Test bidirectionality.** If your rule is `direction: 'bidirectional'`, verify both folder→tag and tag→folder flows — they can hide subtle asymmetries (e.g. one side strips emoji, the other doesn't).
- **Use priority to layer.** See the [Compound cases](/obsidian-folder-tag-sync/concepts/compound-cases/) "container at level 1, taxonomy below" example — that pattern needs two rules with priorities 10 (outer marker) + 20 (inner truncation).
- **Version your pack.** If you share it or iterate on it, bump `version` so future imports can detect schema drift.
