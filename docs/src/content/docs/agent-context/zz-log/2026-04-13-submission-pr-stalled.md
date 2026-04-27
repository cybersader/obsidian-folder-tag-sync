---
title: Submission PR stalled
description: PR #8796 in obsidianmd/obsidian-releases is blocked on bot rescan + human review. Multiple close/reopen cycles attempted.
tags: [submission, process]
sidebar:
  label: "04-13 · PR stalled"
  order: -20260413000
date: 2026-04-13
---

## What happened

PR #8796 (Add plugin: Folder Tag Sync) to `obsidianmd/obsidian-releases` has been open since 2025-12-01. It's gone through:

- 7 bot scans, progressively narrowing the required fixes
- Final sentence-case violations fixed in commit `ffe01d5` (2025-12-07)
- Close/reopen performed on 2025-12-08 and again on 2026-01-14 to force rescan
- User comment "Not stale, just waiting" on 2026-01-14
- User comment "Still waiting" on 2026-03-13

**As of today (2026-04-13):** Bot's last scan is still from 2025-12-06 on commit `e1b1d2f` — which is **before** the fix commit. The bot has never rescanned the fixed code despite multiple close/reopens.

Stale-bot warnings on 2026-01-12, 2026-02-26, 2026-04-13. Next auto-close ~2026-04-28.

## Why it matters

The plugin is code-complete and published to GitHub with the 0.1.7 release. Users can install via BRAT. But without community plugin listing, discoverability is basically zero.

All the remaining bot-flagged issues are fixed and verified locally with `eslint-plugin-obsidianmd`. We're not blocked on code — we're blocked on:

1. The ObsidianReviewBot actually rescanning the latest code
2. A human reviewer from the Obsidian team approving

Neither is something we can force.

## What to try next

### Keep the PR alive
Bump it before each 30-day staleness warning (comment or close/reopen). Loses nothing.

### Fresh PR
Close this one and submit a new PR. Might skip the queue, or might land in the same queue further back. Risk.

### Tag a reviewer
Reluctantly. The team actively discourages this. Last resort.

### Nothing
Let auto-close happen, resubmit when we have more features or screenshots. Least friction, longest timeline.

## What we learned

- ObsidianReviewBot is unreliable — claimed "6-hour rescan" never happened in our case
- Close/reopen is documented as a rescan trigger but doesn't always work
- The plugin review queue is measured in months, not weeks
- Stale-bot auto-close at 30 days creates a reminder cadence — use it
- Local `eslint-plugin-obsidianmd` catches everything the bot catches. Run it before every push.

## Related work

- Plugin code is done. Phase 2 (conditional form fields, rule packs) is on hold pending acceptance.
- Docs site (this very KB) built today as a way to make the plugin look more polished when a reviewer eventually looks.
