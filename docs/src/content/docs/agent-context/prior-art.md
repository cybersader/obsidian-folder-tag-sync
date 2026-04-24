---
title: Prior art
description: Existing plugins and tools that solve adjacent problems.
sidebar:
  order: 5
---

## Direct inspiration

### Auto Note Mover
[farux/obsidian-auto-note-mover](https://github.com/farux/obsidian-auto-note-mover)

Rule-based file movement based on regex patterns. Main architectural inspiration for this plugin's rule engine.

**What we borrowed:**
- Regex-based folder/tag matching
- Rule priority ordering
- Settings UI structure (list + add/edit/delete)

**What we added:**
- Bidirectional sync (AutoNoteMover is one-way only)
- Transformation pipeline (case conversions, emoji handling, number-prefix handling)
- Explicit reverse-direction transforms

## Tag management

### Tag Wrangler
[pjeby/tag-wrangler](https://github.com/pjeby/tag-wrangler)

Rename, merge, and manage tags directly from the tag pane. Complementary to this plugin — Tag Wrangler handles bulk tag operations; we handle folder↔tag mapping.

### Nested Tags
[sujinjeon3107/obsidian-nested-tags](https://github.com/sujinjeon3107/obsidian-nested-tags)

UI improvements for hierarchical tag display. Doesn't overlap our scope.

## Folder ↔ note mapping

### Folder Notes
[LostPaul/obsidian-folder-notes](https://github.com/LostPaul/obsidian-folder-notes)

Treats a folder and its eponymous note as one entity. Potential future integration — see [open questions: folder notes](/obsidian-folder-tag-sync/agent-context/open-questions/).

## Metadata & frontmatter

### Metadata Menu
[mdelobelle/metadatamenu](https://github.com/mdelobelle/metadatamenu)

Advanced frontmatter management with types, constraints, and UI controls. Different scope — handles arbitrary metadata; we handle the specific case of tags.

### Templater / QuickAdd
Template engines. Not competitors — integration targets. See [open questions: API](/obsidian-folder-tag-sync/agent-context/open-questions/).

## Dataview-adjacent

### Dataview
[blacksmithgu/obsidian-dataview](https://github.com/blacksmithgu/obsidian-dataview)

Query engine over vault metadata. We should **not** conflict with Dataview's tag queries — tags this plugin writes must be readable by Dataview's `tags` field without transformation.

### Breadcrumbs
[SkepticMystic/breadcrumbs](https://github.com/SkepticMystic/breadcrumbs)

Hierarchical relationships via frontmatter properties. Different axis — handles arbitrary hierarchies; we specifically handle folder↔tag.

## Architectural references

### Obsidian Tasks
[obsidian-tasks-group/obsidian-tasks](https://github.com/obsidian-tasks-group/obsidian-tasks)

Complex query system, well-architected settings UI. Good reference for:
- Query language design
- Settings drag-and-drop UX
- Preset/collection pattern (inspiration for rule packs)

### Liam's Periodic Notes
[liamcain/obsidian-periodic-notes](https://github.com/liamcain/obsidian-periodic-notes)

Clean plugin architecture. Good reference for:
- Settings tab structure
- Event-driven file handling

## Why not just Notion / Tana?

Both have built-in polyhierarchy without folders. Obsidian users chose Obsidian specifically because of the filesystem + markdown + local-first approach. This plugin lets them keep all three while gaining the polyhierarchy benefit.

## Why not just use tags?

Folders are still necessary:
- File sorting in the file explorer (hierarchical browse)
- Integration with external tools (everything understands filesystems; fewer things understand Obsidian's tag index)
- Attachment organization (`_attachments/` conventions assume folders)
- Vault portability (another markdown editor can read folders; tags are Obsidian-specific metadata)

So the goal isn't "replace folders with tags" — it's "make folders and tags stay in sync so both stay useful."
