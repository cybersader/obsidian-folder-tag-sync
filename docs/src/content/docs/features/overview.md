---
title: Feature overview
description: Everything Folder Tag Sync can do in v0.1.7.
sidebar:
  order: 1
---

## Sync directions

| Direction | What it does |
|---|---|
| **Folder → tag** | Reads file's folder path, produces a tag, writes it to frontmatter |
| **Tag → folder** | Reads file's tags, derives a target folder, moves the file there |
| **Bidirectional** | Both directions active for the same rule |

## Pattern matching

- **Regex** folder and tag patterns with named capture groups
- **Multiple rules** — each with priority ordering
- **Priority resolution** — first matching rule wins

## Transformation pipeline

Applied in order on captured segments before producing the tag or folder:

| Step | Purpose |
|---|---|
| **Emoji handling** | Strip or keep leading/embedded emojis |
| **Number prefix** | Handle Johnny Decimal prefixes (`01 - Projects`) |
| **Case conversion** | snake_case, kebab-case, Title Case, camelCase, PascalCase |
| **Custom regex** | Arbitrary pattern/replacement pairs with flags |

All transformations are reversible — the same pipeline drives folder → tag and tag → folder.

## Rule management

- **Settings UI** with rule list, drag-to-reorder
- **Enable/disable** individual rules
- **Rule editor modal** with form fields conditional on direction
- **Live transformation preview** while editing

## Commands

| Command | What it does |
|---|---|
| Sync folder to tags (current file) | Apply folder-to-tag rules to the active file |
| Sync tags to folder (current file) | Apply tag-to-folder rules to the active file |

## Debug logging

Enable debug mode in settings to write a `debug.log` file in your vault with full operation history. Useful for troubleshooting rule matching.

## Coming soon

See the [roadmap](/obsidian-folder-tag-sync/about/roadmap/) for planned features: automatic sync on file events, conflict resolution, bulk vault operations, folder notes support, and rule pack library.
