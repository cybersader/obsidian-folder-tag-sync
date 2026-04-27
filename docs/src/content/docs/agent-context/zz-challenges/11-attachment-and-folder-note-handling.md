---
title: "Challenge 11: Attachment and folder-note handling on tag→folder moves — what travels with note.md?"
description: When a tag→folder rule moves note.md, what should happen to associated artifacts — note attachments/, _attachments/note.png, note.canvas, note.excalidraw, the surrounding folder note? Today's plugin has minimal handling. This challenge enumerates the artifact types, designs per-type policies, and works out the Obsidian-settings interactions.
tags: [research, architecture, attachments, folder-notes, phase-3]
sidebar:
  label: "11 · Attachments / folder notes"
  order: 11
---

## Prompt for the dispatched agent

Open this challenge in a fresh-context Claude / LLM session, paste the URL, and say *"research this challenge."* The reading list below is layered for **progressive disclosure** — start at level 1 if you're new to the project, jump deeper if you already know the context.

**The question in one sentence:** when a tag→folder rule moves `note.md` from one folder to another, what should happen to the non-`.md` artifacts associated with it (`note attachments/`, `_attachments/note.png`, `note.canvas`, `note.excalidraw`, `note.base`, the surrounding folder-note content) — and how does FTSync's policy interact with Obsidian's own "Files & Links: Default location for new attachments" setting?

### Reading order (level 1 → level 4)

1. **Foundations** (orient first if new to the project):
   - [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary; especially `vault path`, `tag namespace`, `folder path`
   - [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — typed-model layers; the engine's "deterministic, no destructive ops without confirm" principle is load-bearing here
2. **Core concepts for this question**:
   - [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives; only `tag-to-folder` direction triggers moves; understanding which ops produce moves is necessary
   - [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — relevant because attachment-handling decisions affect round-trip behavior (if attachments don't follow, tag→folder isn't fully reversible)
3. **Direct context** (the research that frames this challenge):
   - [Challenge 02 — Pipeline reversibility](/obsidian-folder-tag-sync/agent-context/zz-challenges/02-pipeline-reversibility/) — mentions attachment handling as one bullet; this challenge drills it
   - [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — the inverse-direction sync that triggers these moves; understanding the resolution algorithm is needed for designing policy
   - [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — origin metadata could include attachment associations
4. **Reference (optional, code-level grounding)**:
   - [Obsidian "Files & Links" settings docs](https://help.obsidian.md/Files+and+folders/Attachments) — the user-configurable attachment location settings
   - [Obsidian Plugin API: TFile, TFolder, FileManager](https://docs.obsidian.md/) — the file-move and link-update APIs FTSync would use
   - `src/sync/TagToFolderSync.ts:251` (`app.fileManager.renameFile`) (read on the GitHub repo) — the current move call; needs to grow into a multi-artifact move

### Deliverable

Short report at `agent-context/zz-log/YYYY-MM-DD-challenge-11-findings.md` (~1500–2500 words). Required sections: enumeration of all artifact types FTSync may interact with on a move (`.md`, `attachments/` siblings, `_attachments/` referenced, `.canvas`, `.excalidraw`, `.base`, folder notes, files with backlinks), per-type policy recommendation (move-with / leave / prompt-user), interaction with Obsidian's "Files & Links" settings (especially "Default location for new attachments"), folder-note edge cases (moving a folder note moves the folder?), backlink-update semantics (Obsidian's auto-update vs. manual), recommended UX for the user (silent / notice / per-rule config), composition with frontmatter memory.

### Tone

Treat existing recommendations as **hypotheses to test, not conclusions to defend.** If your analysis says FTSync should *not* attempt to handle attachments and should defer entirely to Obsidian's built-in mechanisms, that's a more valuable finding than a complex per-artifact policy matrix. Fresh-agent context-skepticism is the point.

---

## Assumption under test

The plugin's `TagToFolderSync.ts:251` calls `app.fileManager.renameFile(file, newPath)` to move a single `.md` file when its tags change. The implicit assumption is that **a tag→folder move is a single-file operation**.

That's true for the simplest case (a standalone note with no associated artifacts), but breaks for any file that has:

- An attachments folder (e.g., `note attachments/`, the Obsidian default for "subfolder under current folder")
- Attachments stored under a separate folder via `_attachments/` (the Obsidian default for "global attachment folder") or via a user-configured attachment subfolder
- Adjacent file types: `.canvas`, `.excalidraw`, `.base`, `.kanban`
- A folder-note relationship (the file *is* the folder note for its parent folder via plugins like Folder Notes)
- Backlinks from other files in the vault (Obsidian auto-updates these on move via `processFrontMatter`, but only for `.md` files)

Today's plugin handles **none of this**. A user with `Projects/Web Auth/note.md` + `Projects/Web Auth/note attachments/diagram.png` will see the `.md` move but the attachments stay behind, breaking the link.

## Why the simple reading might not hold

### Obsidian has multiple attachment-location modes

Obsidian's "Files & Links: Default location for new attachments" setting has at least three modes:

1. **Vault folder root** (default for new vaults)
2. **In the folder specified below** (a global path like `_attachments/`)
3. **Same folder as current file** (per-file colocation)
4. **Subfolder under current folder** (the per-file `note attachments/` convention; configurable via "Subfolder name")

The right policy for "move attachments with the note" depends on the mode:

- Mode 1 (vault root): attachments are vault-global; never move
- Mode 2 (global folder): attachments are at a fixed path; never move (they're already collocated)
- Mode 3 (same folder): attachments are siblings of `note.md`; **must move** with the note
- Mode 4 (subfolder under current): attachments are in `note.md`'s subfolder; **must move** with the note (the whole subfolder)

A naive "move all `.png` siblings with the `.md`" policy is wrong in modes 1 and 2 (would move things that aren't related to this note). A naive "don't move anything" policy is wrong in modes 3 and 4 (breaks links).

The engine has to read Obsidian's setting and dispatch.

### Adjacent file types follow the note

Files like `note.canvas`, `note.excalidraw`, `note.base`, `note.kanban` are *named* like the note (`<basename>.<ext>`). Some plugins treat them as note-companions (e.g., a canvas file with the same basename is "the canvas for this note"). Some plugins don't.

For the canvas/excalidraw/base case, the right policy is *probably* "move with the note" — but only if the user actually has the note + companion paired. A user who happens to have `notes.md` and `notes.canvas` as unrelated files in the same folder gets surprise-moved.

This is genuinely ambiguous without per-rule or per-vault configuration.

### Folder notes and the folder-rename question

If `Projects/Web Auth/Web Auth.md` is the folder note for `Projects/Web Auth/`, what does it mean to "move the folder note"? Three plausible behaviors:

1. **Move just the file**: leaves the folder behind, breaks the folder-note relationship
2. **Move the whole folder**: the folder follows the note, all sibling files come along (this is the Folder Notes plugin's native behavior on rename)
3. **Reject the move**: folder notes can't move via tag→folder because they *are* the folder

FTSync would need to detect folder notes (via plugin presence + naming convention + index-file detection) and dispatch.

### Backlinks update only for `.md` moves

Obsidian's `app.fileManager.renameFile` automatically updates backlinks (wikilinks `[[note]]`, markdown links `[text](note.md)`) when an `.md` file moves. This is *not* automatic for `.png`, `.canvas`, etc. — those have to be moved via `vault.rename` (which doesn't update references) or with manual link-update.

If FTSync moves an attachment, it has to either:

- Use `fileManager.renameFile` (which may not handle non-`.md`)
- Use `vault.rename` and then manually scan the vault for `![[diagram.png]]` and update each reference
- Skip the attachment and require the user to fix links manually
- Use the `.md` move's automatic backlink update (which won't catch attachment references in body content)

### The cost of getting it wrong

This is a *destructive* operation. A bad policy permanently breaks user data:

- Moving the wrong files = data loss (user can't find their content)
- Not moving the right files = broken links, manual cleanup
- Surprise moves = user trust loss

The cost asymmetry argues for: **default policy = conservative; explicit user opt-in for aggressive moves.**

## Research brief

The agent should:

### 1. Enumerate the artifact types

Build a complete table of Obsidian artifact types FTSync might interact with:

| Type | Convention | Default policy | Edge cases |
|---|---|---|---|
| `.md` (the note itself) | The primary artifact | Move (always) | n/a |
| `note attachments/` (subfolder) | Obsidian "subfolder under current folder" mode | Move with note | Mode-dependent |
| `_attachments/note-prefix.png` | Obsidian "global folder" mode | Don't move | Need to check the prefix |
| `note.canvas`, `note.excalidraw`, `note.base` | Plugin-specific companions | Move (probably) | Ambiguous when names coincide |
| Folder notes | Folder Notes plugin convention | Conditional | Depends on whether folder is being moved |
| Backlink references in other files | Obsidian-managed for `.md` | Auto-handled | Manual for non-`.md` |
| ... | ... | ... | ... |

For each type, recommend a default policy and identify the configuration knobs.

### 2. Map Obsidian's "Files & Links" modes

For each of Obsidian's attachment-location modes (vault root, global folder, same folder, subfolder), specify:

- What FTSync's behavior should be
- What detection logic FTSync needs
- What edge cases exist

### 3. Walk through five concrete move scenarios

For each scenario: write the rule, the initial vault state with all relevant files, the user action (add tag), the expected engine behavior under the new policy, the resulting vault state.

- **Scenario A (clean move)**: `Inbox/note.md` → `Projects/Web Auth/note.md` with attachments in `_attachments/note-diagram.png` and Obsidian's default "vault root" attachment mode. Walk through.
- **Scenario B (subfolder attachments)**: same move but Obsidian's "Subfolder under current folder" mode with `note attachments/` containing 5 images. Walk through.
- **Scenario C (canvas companion)**: file is `meeting.md` with adjacent `meeting.canvas`. Walk through.
- **Scenario D (folder note)**: file is `Web Auth/Web Auth.md` (the folder note for its containing folder). The user adds `#projects/auth` to it. The rule wants to move it to `Projects/Auth/`. Walk through; reject the move? Move the folder?
- **Scenario E (backlinks broken)**: file is `note.md` referenced from 10 other files via `![[diagram.png]]`. Move fires; the `.md` link auto-updates but the `![[diagram.png]]` does not. Walk through; recommend handling.

### 4. Recommend per-rule configuration

A single global policy is unlikely to fit every rule. Sketch a per-rule config (e.g., `RuleOptions.attachmentHandling: 'move-all' | 'move-subfolder-only' | 'leave' | 'prompt'`) and the user-facing UX in the rule editor.

### 5. Compose with frontmatter memory (Challenge 07)

If the engine stores origin metadata, can it also store attachment-association metadata? E.g., `ftsync.attachments: ['_attachments/diagram.png', 'meeting.canvas']` — explicit list of files that should follow this note. Pros: precise; cons: rapid frontmatter growth.

### 6. Recommend the v1 minimum viable form

Most of the above is too much for v1. Pick the 80% case (probably "subfolder-mode attachments + canvas companions, move-with-note, with explicit confirmation prompt for any other artifact") and defer the rest.

## Candidate policies to evaluate

The agent should weigh at least:

**Policy α — Conservative (default).** Move only the `.md` file; never touch attachments, companions, or folder notes. Document the limitation. User must manually move attachments.

**Policy β — Mode-aware (attachment-only).** Read Obsidian's "Files & Links" mode; move attachments per the mode. Don't touch canvas/excalidraw/folder notes.

**Policy γ — Convention-following.** Move `.md` + attachments (per mode) + adjacent canvas/excalidraw/base files with matching basename. Don't touch folder notes (reject those moves).

**Policy δ — Aggressive with confirmation.** Detect everything; prompt the user "this move affects 5 files: note.md, note attachments/diagram.png, ...; continue?" Each move is a confirmation dialog.

**Policy ε — Per-rule configurable.** The rule author chooses; defaults to one of α–δ.

**Policy ζ — Defer to Obsidian.** Don't handle moves at all; surface "you would need to move this file to X" in a notice; let the user move it themselves via Obsidian's native rename, which handles backlinks correctly.

For each: rate user-control surface, data-loss risk, complexity, composability with other plugins (Folder Notes, Templater, Dataview).

## Deliverable

Short report (~1500–2500 words) at `zz-log/YYYY-MM-DD-challenge-11-findings.md`:

- Artifact-type enumeration with default policy per type
- Obsidian "Files & Links" mode dispatch table
- Five walked-through move scenarios with proposed engine behavior
- Per-rule configuration recommendation
- Composition with frontmatter memory + folder-notes plugins
- Verdict on candidate policies α–ζ
- Recommended v1 minimum viable form
- Open questions left unresolved

## Hand-off note

This is the most *destructive* of the open challenges — getting the policy wrong loses user data. The agent should weight conservatism heavily.

That said, "do nothing" is also a real failure: it leaves users with broken links and a plugin that's only useful for the simplest single-file workflows. The right answer is somewhere between "deeply integrated with Obsidian's attachment modes" and "do nothing and document the limitation."

Cross-link findings to Challenge 02 (broader reversibility) when complete.
