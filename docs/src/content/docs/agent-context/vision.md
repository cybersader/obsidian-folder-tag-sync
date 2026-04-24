---
title: Vision
description: The problem this plugin solves and the design philosophy behind the solution.
sidebar:
  order: 1
---

## The problem

Obsidian (and every file-based knowledge system) forces a split:

- **Folders** are rigid single-hierarchies — a file lives in exactly one place. Necessary for file storage. Map cleanly to the filesystem.
- **Tags** are flexible overlapping hierarchies — a file can have many tags. Better for knowledge representation. Don't map to the filesystem.

Users need both. Usually they end up maintaining them in parallel: drop a file in a folder, then *also* remember to tag it. The two drift out of sync. The mental overhead compounds.

## The solution

**Bidirectional, rule-based sync** between folder paths and tag frontmatter. Deterministic transformations only — no AI inference, no surprises.

```
File event → Rule matcher → Transformation pipeline → Sync executor
```

## Design philosophy

### Deterministic over AI
Every transformation is a regex or a pipeline step. Given the same input, always the same output. Users can reason about, test, and trust the output.

### User control
Rules are explicit, inspectable, ordered by priority. No magic. Previewable before applied.

### Safe operations
- Preview changes before applying
- No destructive operations without confirmation
- Debug log for every sync operation

### Flexible but simple
Powerful regex with named capture groups. Sensible defaults out of the box. Most users shouldn't need to write their own regex — pre-made rule packs (SEACOW, PARA, Zettelkasten, Johnny Decimal) will cover common workflows.

## Scope limits

**What this plugin does:**
- Folder ↔ tag bidirectional sync
- Regex pattern matching and transformation
- Rule-based priority resolution

**What it doesn't do:**
- Infer "what a file is about" — that's Smart Connections' job
- Replace tags or folders — it syncs the two
- Handle relationships beyond folder↔tag (use Dataview, Breadcrumbs for graph queries)

## Long-term vision

Phase 1 (done): Core sync both directions, rule engine, settings UI, 156+ tests.

Phase 2 (next): Conditional form fields, rule pack library (SEACOW/PARA/Zettelkasten), rule testing/preview UI.

Phase 3: Templater/QuickAdd API, batch "apply to vault" command, advanced conflict resolution, rule groups.

Phase 4: Community pack marketplace, sync history/undo, analytics.

See the [roadmap](/obsidian-folder-tag-sync/about/roadmap/) for details.
