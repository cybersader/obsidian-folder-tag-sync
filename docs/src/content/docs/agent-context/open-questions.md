---
title: Open questions
description: Unresolved design decisions — help wanted.
sidebar:
  order: 4
---

Questions where the right answer isn't obvious yet. Input welcomed — open an issue.

## How should we handle multiple matching tags pointing to different folders?

A file has tags `#projects/alpha` and `#archive/2024`. Rule 1 says `#projects/*` → `Projects/`. Rule 2 says `#archive/*` → `Archive/`. Where does the file go?

**Options:**

- **First-match wins (current approach)** — Rule priority decides. Simple, but user has to know which tag "wins."
- **Move to most specific** — Look for the longest common folder prefix across matching rules.
- **Prompt on conflict** — Pop a modal: "Multiple rules match. Choose destination."
- **Refuse to move** — Log conflict, skip file, surface in a report.

**Current thinking:** Start with first-match-wins (already built). Add `onConflict: 'skip' | 'prompt' | 'priority'` in Phase 2 as an opt-in per-rule setting.

## Should rules support "remove tag on successful move"?

When tag→folder moves a file, should we then strip the triggering tag from frontmatter? Otherwise the tag persists and next sync is a no-op, which is fine — but it leaves a breadcrumb the user may not want.

**Options:**

- **Keep the tag** (current, implicit) — Tag remains as metadata; file's location also reflects it. Redundant but safe.
- **Remove via `removeSourceTag: true`** — Opt-in. Clean for users who treat folders as the source of truth post-sort.
- **Remove by default, opt out with `keepDestinationTag: true`** — Implies the move "consumes" the tag.

**Current thinking:** Add opt-in `removeSourceTag` in Phase 2. Never remove by default — surprises users.

## How do we handle folder notes (`FolderName/FolderName.md` pattern)?

Some users (especially with the Folder Notes plugin) treat a folder and its eponymous note as one entity. Should tag→folder sync:

- Move the folder note along with the file into the new folder?
- Skip folder notes entirely?
- Treat the folder note as the tag-carrier for the whole folder?

**Current thinking:** Deferred to Phase 3. Opt-in `handleFolderNote: 'move' | 'skip'` when we get there.

## What about attachments?

If `moveToFolder` relocates `my-note.md`, what happens to `my-note attachments/` or `_attachments/my-note-image.png`?

**Options:**

- **Ignore** — Attachments stay put. User fixes links manually if they break.
- **Move together** — Detect attachment folder by Obsidian's `attachmentFolderPath` setting, move in lockstep.
- **Leave to the user** — Warn but don't touch.

**Current thinking:** Phase 3. Needs to read Obsidian's attachment settings and handle edge cases (shared attachment folders, external links).

## Should rule matching be case-sensitive?

Currently regex is case-sensitive by default. Users can add `i` flag manually. But most users probably want case-insensitive matching out of the box.

**Current thinking:** Add a `caseSensitive: boolean` option on each rule, defaulting to `false`. Users who need case-sensitive matching opt in.

## How do we handle vault-wide batch application?

"Apply all rules to every file in the vault" is a legitimate use case (e.g., migrating to the plugin from scratch). But with 10,000 files and 15 rules, this could be slow and hard to recover from mid-run.

**Options:**

- **Dry-run first, then confirm** — Preview all changes, show summary, commit or cancel.
- **Background job with progress bar** — Start, show status, allow cancel.
- **Scope by folder or tag** — "Apply rules to files in `/Projects/`" rather than the whole vault.

**Current thinking:** Phase 3 ships a "Batch apply rules" modal with dry-run + confirm + folder scope. Cancellable.

## API for other plugins?

Templater and QuickAdd users might want `getTargetFolder(tags)` as a helper.

**Current thinking:** Phase 3 adds `app.plugins.plugins['folder-tag-sync'].getTargetFolder(tags)` as a stable API. Document it. Don't guarantee internal rule engine stability.
