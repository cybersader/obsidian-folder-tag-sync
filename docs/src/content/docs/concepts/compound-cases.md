---
title: Compound cases — primitives stacked
description: How common real-world rules that feel like two primitives are actually one primitive with a mode flag.
sidebar:
  order: 6
---

Most real-world mappings aren't one pure primitive — they're **two primitives composed** (two of the eight transfer ops working in sequence on different parts of the same path). Folder Tag Sync handles this by keeping the primitive set small and letting each primitive carry options that absorb its common compound behaviors.

The test: *"would a second primitive with a mode flag be clearer than a composition users have to author?"*. If yes → mode flag. If no → author as two rules with priorities.

## Cases absorbed into single primitives (with mode flags)

### "Preserve N levels, stack the rest" → `truncation(tailHandling: 'aggregate')`

Truncation/aggregate (cap to N segments, then join everything deeper with a separator into one term) feels like two ops stacked: `truncation(depth: N)` ∘ `aggregation(separator)` on the tail.

Actually: one primitive.

```ts
{ op: 'truncation', depth: 2, tailHandling: 'aggregate', separator: '-' }
```

**Worked example.** File on disk:
```
Capture/Clips/Web/Tutorials/React/Hooks/intro.md
```

Derivation:
- Level 1 (entry): `Capture/Clips` → `-clip`
- Level 2 preserved: `Web` → `web`
- Level 3+ aggregated: `Tutorials/React/Hooks` → `tutorials-react-hooks`
- Resulting tag: `#-clip/web/tutorials-react-hooks`

The tag has exactly depth 2 (the user's declared hierarchy budget); everything deeper packs into the (N+1)th tag segment. Lossy (the aggregated hyphen is ambiguous on unpack), but single-primitive.

### "Preserve N, drop the rest" → `truncation(tailHandling: 'drop')`

Feels like: `truncation(depth: N)` ∘ `opaque` on the tail.

Actually: one primitive — the derived regex REJECTS paths deeper than N, so they don't participate in the rule at all.

### "Preserve N, use only the leaf for the (N+1)th segment" → `truncation(tailHandling: 'flatten')`

Feels like: `truncation(depth: N)` ∘ `flattening-to-leaf` on the tail.

Actually: one primitive.

### "Entity workspace that scopes a Work taxonomy" → `FolderClassifier.axes: [entity, work]`

Feels like: entity rule ∘ work rule, authored as two rules.

Actually: **one folder genuinely participates in two axes**. The classifier carries `axes: [entity, work]` and one identity-transfer rule handles the whole sub-path. The "Work" layer is expressed in the pre-coordinated tag, not in a second rule:

```
Entity/Cybersader/10 - Projects/11 - Q4 Roadmap/ → #--cybersader/10-projects/11-q4-roadmap
```

One rule. Two axes on the folder classifier. Identity transfer. No composition.

### "Container at level 1, 2-deep taxonomy below" → one rule of each kind

This is where primitives genuinely **do** stack as two rules. The outer folder is a container; the inner subtree is a hierarchical taxonomy. You author:

```ts
// Rule A — the container, priority 10
{ folder: {scheme: 'container-only', axes: ['capture']}, ...
  transfer: {op: 'marker-only', marker: '-clip'}, folderEntry: 'Capture/Clips' }

// Rule B — the inner taxonomy, priority 20
{ folder: {scheme: 'hierarchical', axes: ['capture'], subdivisionDepth: 2}, ...
  transfer: {op: 'truncation', depth: 2, tailHandling: 'drop'}, folderEntry: 'Capture/Clips' }
```

Files under `Capture/Clips/Web/React/` match **both** rules: rule A emits `#-clip`; rule B emits `#-clip/web/react`. The note ends up with both tags. Priority + pattern specificity decide sort order in the tag pane.

This is the shape where two rules is legitimately the answer — the outer classifier is container-only, the inner is hierarchical. They're two different surfaces on the same folder tree. Keep them separate.

## The principle

**Keep primitives small. Add mode flags when a composition collapses into one semantic operation on one surface. Keep it as two rules when the two primitives describe two genuinely distinct surfaces.**

If you're ever tempted to chain primitives manually — e.g. "transform this tag first as marker-only, then as identity" — stop. That's either:

- A signal that your current primitive should get a mode flag (open an issue), or
- A sign that you actually have two rules with different priorities, and the tag pane should show both tags simultaneously.

## Future compound cases (likely mode-flag candidates)

These are on the Phase 2+ watchlist — if they show up in real packs often enough, they become mode flags:

- **`aggregation(joinWith: array-style)`** — emit a tag for each `N`-length sliding window over the path
- **`identity` with `unicode-normalize`** — optional NFC/NFKC normalization for tags
- **`marker-only` with multiple markers** — one container folder emitting two markers

If a compound case you've hit isn't covered, that's useful signal. The typed model is meant to grow by adding options, not by adding primitives.
