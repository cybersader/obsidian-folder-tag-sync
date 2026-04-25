# Manual test plan — Phase 2.5 (typed-model runtime)

**Purpose**: prove that the typed-model runtime actually fires inside live
Obsidian, not just in unit tests. Targeted at ~10 minutes.

**Setup expected**: `folder-tag-sync-dev-vault/` is the dev vault. Both
plugins (folder-tag-sync + folder-tag-sync-test-fixtures) are installed
under `.obsidian/plugins/`. You've run `bun run build` in both. Open the
vault in Obsidian.

**What this verifies**: the eight transfer primitives produce the right
tags at runtime, the rule-pack picker works, and the `truncation(aggregate)`
compound case (preserve N levels and stack the rest) actually emits
`#-clip/web/tutorials/react-hooks` for a deeply-nested file.

If any step says **EXPECT** and what you see doesn't match, capture a
screenshot, note which step, and report back.

---

## 0 — Prereqs (30 seconds)

1. ✅ Both plugins enabled in **Settings → Community plugins**
2. ✅ Open the developer console: **Ctrl+Shift+I** (keep it open the whole
   time — sync errors land here, and `debug.log` in the vault root is
   the persistent record)
3. ✅ Optional: clear `debug.log` before starting so the trace is clean.

---

## 1 — Browse bundled rule packs (settings UI) — 1 min

1. Open **Settings → Folder Tag Sync**
2. Scroll to the **Import / export** section
3. **EXPECT**: a row labeled `Browse bundled rule packs` with a `Browse`
   button (CTA-styled, brighter background)
4. Click **Browse**
5. **EXPECT**: a fuzzy-suggest modal opens listing two packs:
   - `SEACOW(r) Cyberbase Structure — Rule pack for SEACOW(r) framework: System, Entity, Activities ... (6 rules)`
   - `Cyberbase Actual ... (N rules)` (only if `cyberbase-actual.json` is in `rule-packs/`)
6. Type `seacow` to filter; pick the SEACOW pack with Enter
7. **EXPECT**: a confirmation modal appears with title `Import SEACOW(r) Cyberbase Structure`, three buttons: `Append`, `Replace all` (red/warning), `Cancel`
8. Click **Append**
9. **EXPECT**: a notice `Imported SEACOW(r) Cyberbase Structure: 6 rules (append)`
10. Reopen Settings → Folder Tag Sync if it auto-closed; scroll to **Mapping rules**
11. **EXPECT**: 6 rules listed with names starting `CAPTURE: Clip…`,
    `CAPTURE: Inbox…`, `ENTITY: Cybersader…`, `OUTPUT: Public…`,
    `OUTPUT: Main…`, `SYSTEM: Templates…`

**If this fails**: rule-pack discovery is broken. Check console for
"No rule-packs/ folder found" or JSON parse errors.

---

## 2 — Inspect data.json typed fields (1 min)

1. From the vault, open `.obsidian/plugins/folder-tag-sync/data.json` in
   any text editor (or in Obsidian itself with **File → Open vault →**
   `.obsidian` exposed via developer mode + **Open with default app**)
2. Find the `entity-cybersader` rule
3. **EXPECT** the rule object contains these top-level keys:
   - `id`, `name`, `priority`, `direction`, `enabled` (the basics)
   - `folderPattern`, `tagPattern`, `folderEntryPoint`, `tagEntryPoint` (Layer 1)
   - `folder` (object with `axes: ["entity", "work"]`, `scheme: "authority-root"`)
   - `tag` (object with `axis: "entity"`, `prefixMarker: "--"`)
   - `transfer`, `inverseTransfer` (each `{op: "identity"}`)
4. **EXPECT**: NO `_typedModel` wrapper. Typed fields live at the top
   level. (If you see `_typedModel`, the fixtures plugin's old strip
   shim wasn't removed correctly.)

---

## 3 — The compound case: truncation aggregate (4 min)

This is the user's documented compound case. It exercises `truncation`
with `tailHandling: 'aggregate'` — the new Phase 2.5 runtime.

### 3a — Create a custom rule pack to load

In a text editor, save this file at
`.obsidian/plugins/folder-tag-sync/rule-packs/test-aggregate.json`:

```json
{
  "name": "Test: aggregate compound case",
  "description": "Preserve 2 deep, stack the rest into the 3rd tag segment",
  "version": "1.0.0",
  "author": "manual-test",
  "rules": [{
    "typedSpec": {
      "id": "test-aggregate",
      "name": "TEST: clips depth 2 with aggregated tail",
      "priority": 1,
      "direction": "folder-to-tag",
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
      "inverseTransfer": { "op": "identity" },
      "folderEntry": "Capture/Clips",
      "tagEntry": "-clip",
      "options": {
        "createFolders": true,
        "addTags": true,
        "removeOrphanedTags": false,
        "syncOnFileCreate": true,
        "syncOnFileMove": true,
        "syncOnFileRename": true
      }
    }
  }]
}
```

### 3b — Import it

1. Settings → Folder Tag Sync → **Browse bundled rule packs** → pick
   `Test: aggregate compound case` → **Append**
2. **EXPECT**: notice `Imported Test: aggregate compound case: 1 rules (append)`
3. The new rule appears in the rule list (priority 1, so at the top)

### 3c — Create the deep file structure

In the file explorer, create this path with a new note inside it:

```
Capture/Clips/Web/Tutorials/React/Hooks/intro.md
```

(easiest: create folders one at a time, then a new note in the deepest)

### 3d — Trigger sync

1. Open `intro.md`
2. **Cmd/Ctrl + P** → search `Sync folder to tags (current file)` → run

### 3e — Verify the tag

1. **EXPECT**: a notice appears: `Added 1 tag(s): #-clip/web/tutorials/react-hooks`
2. Open `intro.md` source view (`Ctrl + E` to toggle)
3. **EXPECT** the frontmatter includes:
   ```yaml
   tags:
     - "#-clip/web/tutorials/react-hooks"
   ```
   (or equivalent inline format — `tags: ["#-clip/web/tutorials/react-hooks"]`)

**This is the key proof.** The original folder path had **5** levels of
sub-hierarchy under `Capture/Clips/`. The tag has exactly **3** segments
(`web`, `tutorials`, `react-hooks`) — depth 2 preserved, tail aggregated.

**If this fails**: the runtime didn't apply `tailHandling: 'aggregate'`
(would emit `#-clip/web/tutorials/react/hooks` — full depth instead of
aggregated tail) or the regex didn't match (no notice at all).

---

## 4 — Marker-only — flat controlled vocabulary (1 min)

1. Create a file at `Capture/Inbox/today.md` (the seacow rule pack from
   step 1 covers this)
2. **Cmd/Ctrl + P** → `Sync folder to tags (current file)`
3. **EXPECT**: notice `Added 1 tag(s): #-inbox`
4. **EXPECT** frontmatter: `tags: ["#-inbox"]` — note the marker is
   **not re-cased**; it stays exactly `-inbox` despite any tag transforms

5. Now create a file directly under `Capture/Inbox/` itself (just
   `Capture/Inbox/another.md`, no subfolder)
6. Run sync
7. **EXPECT**: same `#-inbox` tag (the regex now matches the bare entry
   folder, not just paths under it — Phase 2.5 fix)

---

## 5 — Identity transfer — full depth preserved (1 min)

1. Create `Entity/Cybersader/10 - Projects/11 - Q4 Roadmap/kickoff.md`
2. Run `Sync folder to tags`
3. **EXPECT**: `Added 1 tag(s): #--cybersader/10-projects/11-q4-roadmap`
4. Note that:
   - The numeric prefix is **kept** (per the rule's
     `numberPrefixHandling: 'keep'`)
   - kebab-case is applied (`Q4 Roadmap` → `q4-roadmap`)
   - The full folder depth is preserved in the tag

---

## 6 — Tag → folder direction (1 min)

1. Create a file `untagged-note.md` at the vault root
2. Edit its frontmatter to add: `tags: ["#--cybersader/10-projects/11-q4-roadmap"]`
3. Save
4. **Cmd/Ctrl + P** → `Sync tags to folder (current file)`
5. **EXPECT**: notice `Moved to folder: Entity/Cybersader/10 - Projects/11 - Q4 Roadmap` (or similar — the file moved)
6. **EXPECT**: file now lives at that path

---

## 7 — Cleanup (30 sec, optional)

1. Delete the `Capture/Clips/Web/...` and `Entity/Cybersader/...` test
   folders
2. Settings → Folder Tag Sync → click each test rule's edit pencil →
   **Delete rule** (or just Restore Last Rules Backup via the fixtures
   plugin's `Restore last rules backup` command)
3. Optionally clear `debug.log` to keep the next session's trace clean

---

## What "passing" looks like

| Step | Expected key signal |
|---|---|
| 1 | Picker lists packs; Append populates 6 SEACOW rules |
| 2 | `data.json` has `folder/tag/transfer` at top level, no `_typedModel` |
| 3e | **`#-clip/web/tutorials/react-hooks`** lands on the deep file |
| 4 | `#-inbox` (verbatim, not re-cased); matches bare entry folder |
| 5 | `#--cybersader/10-projects/11-q4-roadmap` with kebab + numeric prefix |
| 6 | Tag → folder moves the file to the right path |

If all 6 pass: Phase 2.5 is verified live. The principles work end-to-end,
not just in unit tests.

If any fail: the failure mode itself tells us where to look:

- **Step 1 fails (picker)**: `browseRulePacks` discovery or
  `loadRulePackFromJSON` parsing
- **Step 2 fails (typed fields missing)**: fixtures plugin's strip shim
  removal didn't fully take, or `deriveRule` isn't preserving them
- **Step 3 fails (wrong tag)**: `applyTransfer` isn't being called, or
  `tailHandling: 'aggregate'` isn't taking effect — check
  `applyRuleForward` in console
- **Step 4 fails (marker re-cased)**: the marker bypass in
  `transformFolderToTag` wasn't applied
- **Step 5 fails (no kebab or no numeric prefix)**: transform pipeline
  not being called or transformOverrides ignored
- **Step 6 fails**: `applyRuleInverse` or sync engine path-creation
  broken

---

## Reporting back

If something fails, the most useful diagnostic is:

1. The exact step that failed
2. What you saw vs. what was expected
3. The relevant lines from `debug.log` (search for the rule's name or
   the file path)
4. A console snippet (Ctrl+Shift+I → Console tab)

That's enough for a targeted fix.
