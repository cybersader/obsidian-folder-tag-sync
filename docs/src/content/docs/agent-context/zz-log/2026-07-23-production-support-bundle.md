---
title: Production support bundle and bounded debug logging
description: The preview-first diagnostic bundle for sharing real BRAT-vault configuration, hierarchy, and sanitized runtime evidence.
tags: [session-log, support, diagnostics, privacy, brat, testing]
sidebar:
  label: "07-23 · Production support bundle"
  order: -20260723001
date: 2026-07-23
---

## Prompt

The user is not always at the local development machine and tests releases through BRAT. They asked for a debug-log system that could copy configuration and other useful information, especially a concise representation of a production vault's full hierarchy, so concrete examples could be shared during development.

The product requirement became:

> Build one local, in-app support bundle that a user can inspect, optionally anonymize, and copy from a production vault without exposing note-level content.

## User decisions

- The default inventory is **folders only**. Note filenames and contents are not collected.
- The modal is **preview-first**. Readable relative names are the default because they make examples concrete.
- An **Anonymize names** toggle is available for sensitive cases.
- Delivery remains through versioned GitHub Releases and BRAT; a local Hot Reload build is not enough for user feedback.

## Architecture

The implementation separates collection, transformation, and UI:

- `utils/vaultFolders.ts` collects a deterministic, complete relative folder list shared with the Taxonomy Workbench Map.
- `support/collectSupportSnapshot.ts` collects runtime metadata, a cloned configuration, folder/file counts, detection results, and installed-rule coverage/conflicts without reading note bodies, frontmatter, or note-derived tags. The UI path yields during large rule scans, preserves exact aggregate counts, and retains at most 2,000 per-folder detection/rule detail rows.
- `support/supportBundle.ts` builds a versioned plain-text document with JSON sections plus a compact Unicode folder tree rooted at `<vault-root>`.
- `support/anonymize.ts` applies deterministic category aliases while preserving hierarchy, repeated identity, transforms, enabled state, coverage, and conflicts.
- `ui/SupportBundleModal.ts` displays the exact copied payload, mode/size/count metadata, and explicit privacy boundaries.
- `utils/clipboard.ts` awaits the real clipboard result and falls back safely rather than showing false success.

## Bundle format

The copied document contains stable sections:

1. Privacy declaration.
2. Runtime JSON.
3. Complete configuration JSON.
4. Detection and installed-rule diagnostics JSON.
5. Complete folder-only hierarchy.
6. Sanitized structured debug JSONL.

The bundle is capped at approximately 2 MiB. Debug entries are omitted first, then detailed per-folder diagnostics. The folder tree is never silently truncated while described as complete; Copy is disabled if the required core still exceeds the limit.

## Privacy boundary

Both readable and anonymized modes exclude:

- vault name;
- absolute Windows, WSL, Linux, or macOS paths;
- `file://` URLs;
- note filenames;
- note contents;
- frontmatter payloads;
- stack traces;
- note-derived tag inventory.

Readable mode intentionally includes relative folder names and rule configuration. Anonymized mode replaces folders, rules, groups, tags, patterns, templates, custom replacements, and descriptions with stable per-category aliases. No alias legend is emitted, and the transformed configuration is diagnostic-only rather than importable.

Privacy scrubbing occurs at the final serialization boundary as well as in structured log processing, so a future field cannot bypass the policy simply by being added to a different section.

## Debug logger repair

The previous logger had four production problems: it used the obsolete `dynamic-tags-folders` plugin path, cleared the log on startup, read and rewrote the entire file for every entry, and did not react to the live Settings toggle.

The replacement:

- writes versioned one-line JSON entries to `.obsidian/plugins/folder-tag-sync/debug.log`;
- serializes append operations;
- safely bounds circular/hostile data;
- rotates around 512 KiB and retains one backup;
- preserves logs across plugin reloads;
- exposes a bounded recent-entry reader for support collection;
- changes enablement immediately from Settings;
- reports clipboard success only after the copy actually succeeds.

## Verification

The final gate after all independent-review fixes is green:

- Production build and TypeScript check: clean.
- Obsidian-community lint: clean.
- Bun unit suite: **1050 passing, 0 failing** across 41 files.
- Real-Obsidian WDIO: **all 9 specs pass, 60 tests total** on Obsidian 1.12.7.
- Focused support-bundle E2E: **7/7 passing**, including readable/anonymized identity, delayed-refresh stale-state protection, exact clipboard equality, Settings entry, and live debug enablement.
- Docs production build and route/content smoke: **33/33 passing**.
- The 10,000-folder/25-matching-rule regression preserves exact coverage/conflict totals while retaining only the documented bounded detail rows.
- Privacy regressions cover note filename/body/frontmatter, vault name, absolute paths, realistic note-derived debug tag fields, and transfer separators.
- Screenshots were inspected at 1024×768; an initial layout issue that hid action buttons below the viewport was corrected by allowing the preview area to shrink inside a bounded flex modal.

## 0.1.37 — the first production bundle found the flaw

The first bundle from the user's real vault (1,700 folders, 3,212 notes, **zero installed rules**) was 544 KB, of which **379 KB was 1,700 byte-identical null rows** — one per uncovered folder:

```json
{ "conflict": false, "emittedTags": [], "folderPath": "…",
  "matchingRuleIds": [], "winnerRuleId": null, "winnerRuleName": null }
```

Every test had exercised vaults where rules *matched*, so the all-null path was never scrutinized. `accumulateFolderRule` now skips folders with no winner and no matches, and the summary splits the old single `folderDetailsOmitted` counter into `folderDetailsOmittedUncovered` and `folderDetailsOmittedByLimit` so a reader can tell "nothing applies here" from "the cap truncated this".

Replaying the user's own tree through the fixed collector: **544,252 → 94,578 bytes (83% smaller)**, tree intact. A regression test now asserts a 1,700-folder rule-free vault emits zero rule rows and stays under 120 KB.

## Delivery state

The implementation was fully verified locally and released through GitHub/BRAT as `0.1.36`, with `main.js`, `manifest.json`, and `styles.css` attached to the release.
