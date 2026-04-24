---
title: Importing rule packs
description: Pick a bundled or custom rule pack and install its rules into your vault's settings.
sidebar:
  order: 1
---

A **rule pack** is a bundle of sync rules expressing one organizational method — PARA, Johnny Decimal, SEACOW, or a custom framework. Importing a pack installs its rules into your plugin settings in one step, so you don't have to author each rule by hand.

## Via the settings tab

1. Open Obsidian settings → community plugins → Folder Tag Sync.
2. Scroll to the **Import / export** section.
3. Click **Browse bundled rule packs**.
4. A picker opens listing every pack found in `.obsidian/plugins/folder-tag-sync/rule-packs/` inside your vault. Each line shows the pack name, description, and rule count.
5. Pick a pack. A confirmation modal asks whether to **Append** (add the pack's rules to your existing rules, skipping any IDs that already exist) or **Replace all** (discard existing rules and install only the pack's rules).
6. Click your choice. A notice confirms how many rules were imported.

## Via the command palette

Command: **Folder Tag Sync: Import rule pack from bundled packs** (`import-rule-pack`).

Same flow — the command fires the picker directly, skipping the settings tab.

## What happens on import

1. Every JSON file under `rule-packs/` is read and parsed by `loadRulePackFromJSON` — see [Writing a rule pack](/obsidian-folder-tag-sync/guides/writing-a-rule-pack/) for the format.
2. Each rule is validated. Legacy rules (Layer 1 only — regex + transforms) are accepted as-is and gain best-effort inferred typed metadata. Rules with a `typedSpec` field (Layer 2) are run through derivation to produce full Layer 1 + Layer 2.
3. The resulting `MappingRule[]` is merged into settings (append) or replaces settings (replace).
4. `data.json` is written. Sync engines pick up the new rules on their next invocation.

## Where rule packs live

The plugin looks in `.obsidian/plugins/folder-tag-sync/rule-packs/` relative to the active vault. Two packs ship with the plugin:

- `seacow-cyberbase.json` — the 6-rule SEACOW(r) canonical pack
- `cyberbase-actual.json` — the full Cybersader vault layout

You can drop additional `.json` files into the same folder. They'll appear in the picker on the next browse.

## Safety — backups

The fixtures plugin (`folder-tag-sync-test-fixtures`) always snapshots your existing main-plugin settings before calling `apply-rules`, so you can roll back with `restore-rules-<framework>`. The main plugin's settings-tab import (this flow) does **not** yet take automatic backups — before clicking Replace all, either export your current settings (Export button in the same section) or commit your vault so you can recover from git.

Automatic per-import backups are planned for Phase 2B.

## Troubleshooting

### "No rule-packs/ folder found"

The plugin looks inside its own folder for `rule-packs/`. If you installed via BRAT or copied the plugin manually, the folder may not exist. Create `.obsidian/plugins/folder-tag-sync/rule-packs/` in your vault, drop a pack JSON in, and retry.

### "No valid rule packs found. N parse errors."

One or more JSON files didn't parse or didn't match the pack schema. Enable debug mode in settings and check `debug.log` for the specific errors. Most common causes:

- Invalid JSON (trailing commas, missing quotes)
- Missing required fields (`name`, `description`, `version`, `author`, `rules`)
- A rule missing required fields for its direction (`folderPattern` for bidirectional rules, etc.)

### Rule IDs conflict on append

If a pack contains a rule with the same ID as an existing rule, **Append** skips it (leaves your existing rule unchanged). **Replace all** discards your existing rules entirely. If you want to update a specific rule without replacing everything, edit it directly in the settings tab rule list.
