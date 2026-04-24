---
title: Your first rule
description: Walk through creating a folder-to-tag sync rule that maps /Projects/* to #projects/*.
sidebar:
  order: 2
---

This walkthrough creates a simple **folder-to-tag** rule: any file under `Projects/` gets a corresponding `#projects/...` tag.

## Open settings

**Settings** → **Community plugins** → click the gear icon next to **Folder Tag Sync**.

## Add a rule

Click **Add new rule**. The rule editor modal opens.

### Direction

Choose **Folder → tag**. The UI will show only the fields relevant to this direction.

### Folder pattern

Regex that matches the folder path you want to watch.

```
^projects/(.*)$
```

This matches any file directly or recursively under `Projects/` (case-insensitive by default — see [tag depth nuance](/obsidian-folder-tag-sync/concepts/tag-depth/) for how depth is handled).

### Tag entry point

The prefix applied to the generated tag:

```
projects/
```

### Transformations

Optional pipeline applied to the captured folder segments before tagging. For a clean default:

- **Strip emoji** — removes leading emoji from folder names
- **snake_case** — converts `"My Cool Thing"` to `"my_cool_thing"`

## Save and test

1. Click **Save**
2. Drop a note into `Projects/My First Project/`
3. Run command **Folder Tag Sync: Sync folder to tags (current file)**
4. Check the frontmatter — you should see `tags: [projects/my_first_project]`

## Next steps

- Read [transformations reference](/obsidian-folder-tag-sync/reference/transformations/) for all pipeline options
- Set up automatic sync on file events (coming in a future release)
- Explore [rule priority and conflicts](/obsidian-folder-tag-sync/concepts/tag-depth/)
