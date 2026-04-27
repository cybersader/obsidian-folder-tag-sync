---
title: SEACOW axes
description: The six orthogonal classification axes that folders and tags both carry.
sidebar:
  order: 2
---

An **axis** (a dimension of classification — "by owner" vs "by project" vs "by date") is exactly that: one direction along which content can be sorted. Knowledge has more than one axis — which is why folder trees alone can't express the whole structure of a knowledgebase. A folder tree picks *one* axis (whichever one you put at the top of the hierarchy); tags can carry the rest.

Folder Tag Sync adopts the six **orthogonal classification axes** (independent dimensions — moving along one shouldn't require moving along another) from the SEACOW meta-framework (System / Entity / Activities[Capture, Output, Work] / relation), originally documented in [cybersader/crosswalker](https://cybersader.github.io/crosswalker/agent-context/knowledge-organization/). Every [folder classifier](/obsidian-folder-tag-sync/concepts/folder-classifiers/) and every [tag vocabulary](/obsidian-folder-tag-sync/concepts/tag-vocabularies/) declares which axis (or axes) it participates in.

## The six axes

### `system`

Platform, tool, config. The infrastructural layer that everything else runs on.

- **Folder examples**: `System/`, `Templates/`, `.obsidian/`
- **Tag conventions**: `/` prefix (e.g. `/template`, `/obsidian`)

### `entity`

Workspace owner, user, agent, authority. Per-person / per-team workspaces.

- **Folder examples**: `Cybersader/`, `Username1/`, `TeamA/`
- **Tag conventions**: `--` prefix (e.g. `#--cybersader/…`, `#--username1/…`)

### `capture`

Ingestion — the inbox layer, clippings from the web, raw material.

- **Folder examples**: `Capture/Inbox/`, `Capture/Clips/Web/`
- **Tag conventions**: `-` prefix (e.g. `#-inbox`, `#-clip/web`)

### `output`

Publishable, external-facing. The polished side.

- **Folder examples**: `Output/Main/`, `Output/Public/Security/`
- **Tag conventions**: `_` prefix (e.g. `#_/essays/on-attention`, `#_publicTaxonomy/security/zero-trust`)

### `work`

Active processing, derivation. PARA (Projects/Areas/Resources/Archive — Tiago Forte's framework) and Johnny Decimal (numbered category folders for ASCII sort order) and project organization live here.

- **Folder examples**: `Projects/Q4-Roadmap/`, `10 - Projects/11 - Q4 Roadmap/`
- **Tag conventions**: no prefix — bare words (e.g. `#projects/q4-roadmap`)

### `relation`

Flat cross-link keywords. Post-coordinated (concepts applied separately as multiple independent tags, not fused into one hierarchical term); authored directly on notes, not derived from folder paths.

- **Folder examples**: (none — relation tags don't derive from folder structure)
- **Tag conventions**: flat keywords (e.g. `#topic/attention`, `#author/kahneman`)

## Axes as prefix conventions — optional but useful

The **prefix-marker convention** (an optional leading character on tags showing axis membership — `/` `--` `-` `_`) is not mandatory. It's a community-reached agreement that makes axis membership visible in the tag pane and — critically — gives ASCII-sort ordering that groups axes together:

```
#--cybersader   (entity)
#--username1    (entity)
#-clip          (capture)
#-inbox         (capture)
#/template      (system)
#_/essays       (output)
#projects       (work)
```

Your vault doesn't have to use these. The plugin supports any `prefixMarker` value (including `null` for un-prefixed), and the typed model tags each vocabulary with its axis independently of whether you use prefixes.

## Why six and not five or seven

The axis count is the point where the abstraction stops being generic and starts reflecting actual knowledge-work practice. Fewer axes (say, just "topic" and "container") underspecify — you can't distinguish a capture inbox from an output taxonomy. More axes — per-project, per-status, per-priority — start duplicating what tags already handle well as flat facets.

Six is the number that came out of years of SEACOW iteration in the crosswalker project. It's not precious — if a seventh axis becomes persistently useful, it gets added. But the six have been stable through many framework variants.

## What the plugin uses axes for (right now and later)

- **Today (Phase 2)**: every typed rule names its axis on both sides. Tests assert axis closure: a file's tags collectively cover at least the axes the file's framework declares it should.
- **Coming in Phase 2B**: the rule-editor UI will pick the axis first, then narrow the choices for folder classifier / tag vocabulary / transfer op based on what makes sense for that axis (e.g. the `container-only` folder scheme is the common choice for a `capture` inbox).
- **Coming in Phase 3**: auto-detection. Scan your vault, look at top-level folders and tag prefixes, guess the active axes — ask "it looks like you're using entity + work + capture; want to install a SEACOW rule pack?"
