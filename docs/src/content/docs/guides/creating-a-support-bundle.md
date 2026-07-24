---
title: Create a support bundle
description: Preview and copy a privacy-bounded troubleshooting snapshot from a production or BRAT-installed vault.
sidebar:
  order: 5
---

A support bundle packages the information needed to reproduce Folder Tag Sync behavior without requiring access to your vault. It is created locally inside Obsidian and is never uploaded automatically.

## Open the preview

Use either entry point:

- Run **Folder Tag Sync: Open support bundle preview** from the command palette.
- Open **Settings → Folder Tag Sync → Import / export → Create support bundle**, then select **Preview**.

The plugin collects one snapshot and shows the exact text that will be copied. Nothing leaves Obsidian until you select **Copy**.

## What is included

The readable bundle contains:

- Folder Tag Sync and Obsidian version information.
- Coarse platform information, such as desktop/mobile and operating-system family.
- The complete Folder Tag Sync configuration and mapping rules.
- Detection, installed-rule coverage, winner, and conflict diagnostics.
- A concise, complete tree of **folders only**, rooted at the neutral label `<vault-root>`.
- A bounded, sanitized tail of the structured debug log, when available.

The folder tree uses a compact format:

```text
<vault-root>
├── Projects
│   ├── Active
│   └── Archive
└── Resources
```

## What is excluded

The bundle does not collect:

- Note filenames.
- Note contents or excerpts.
- Frontmatter values.
- A tag inventory read from notes.
- The vault name.
- Absolute filesystem paths.
- Screenshots or attachments.

Debug entries are sanitized before they enter the preview. Note-like file leaves, absolute paths, vault context, stack traces, note content, and frontmatter payloads are redacted.

> [!warning] Readable mode still contains private structure
> Relative folder names and the complete Folder Tag Sync rule configuration are intentionally readable so a support example can reproduce real behavior. Review the preview before sharing it.

## Anonymize names

Enable **Anonymize names** to replace user-authored identifiers with stable aliases while preserving the relationships that matter for debugging:

- Folders become aliases such as `folder-001`.
- Rules become aliases such as `rule-001`.
- Tags, groups, patterns, templates, and custom literals receive their own alias namespaces.
- Hierarchy, repeated-value identity, enabled states, directions, transforms, counts, coverage, and conflicts remain intact.

The anonymized bundle is diagnostic-only. It cannot be imported as configuration.

Toggling anonymization does not rescan the vault. The preview is rebuilt from the same captured snapshot, so switching back to readable mode restores the same payload.

## Debug logging

Enable **Debug mode** in Folder Tag Sync settings when reproducing a problem. Logging takes effect immediately; a plugin reload is not required.

The structured log is stored in:

```text
.obsidian/plugins/folder-tag-sync/debug.log
```

Logging is bounded and rotated rather than cleared on every startup. The support bundle includes only a recent sanitized tail, not the entire log history.

A practical troubleshooting sequence is:

1. Enable **Debug mode**.
2. Reproduce the Folder Tag Sync behavior.
3. Open the support bundle preview.
4. Review readable mode or enable anonymization.
5. Select **Copy**.
6. Paste the bundle into the issue or support conversation.

## Size limits

The support bundle prioritizes the complete configuration and full folder tree. Aggregate detection and rule counts are always exact, but per-folder diagnostic rows are only emitted for folders an installed rule actually matches, and are bounded to 2,000 rows. Folders no rule touches are represented by the summary's `uncoveredFolderCount` instead of one empty row each — on a vault with no rules installed, the per-folder section is empty. Rule evaluation yields back to Obsidian's UI between chunks rather than holding one long uninterrupted scan.

If the serialized payload is still large, it omits the debug-log section first and detailed diagnostics second. The folder tree is never silently truncated while described as complete. If the configuration and complete tree still exceed the copy limit, copying is disabled and the preview explains the required size.
