---
title: Tradeoffs
description: Known tradeoffs and their justifications.
sidebar:
  order: 3
---

Every decision costs something. These are the ones worth naming.

## Fixed transformation pipeline order vs flexibility

**Chosen:** Fixed order (emoji → number → case → regex).

**Cost:** Users can't do something like "apply case transform before stripping the emoji." They have to use `customRegex` at the end, which is less ergonomic.

**Benefit:** Rule behavior is predictable across all users. Support is simpler — every rule has the same shape.

## Regex over glob patterns

**Chosen:** Raw JavaScript regex with named capture groups.

**Cost:** Steeper learning curve for non-technical users. `^Projects/(.*)$` is less approachable than `Projects/*`.

**Benefit:** Full expressive power when users need it. Named groups make rule output debuggable. Avoids building a custom pattern DSL.

**Mitigation:** Phase 2 ships pre-made rule packs so most users never write regex.

## First-match-wins vs all-matches-apply

**Chosen:** First matching rule wins.

**Cost:** A file can't pick up tags from multiple rule hierarchies. If a file lives in both `Projects/Archive/` and matches a `Projects/*` rule, only the more specific one fires.

**Benefit:** Conflict resolution is explicit via priority ordering. Sync output is deterministic.

**Future:** A `combine` directive on rules could opt into multi-match. Not in Phase 1.

## Manual sync commands vs automatic file-event hooks

**Chosen:** Manual commands only in Phase 1.

**Cost:** Users have to invoke sync deliberately. Friction.

**Benefit:** Safe. No "my vault sync fired during external file sync and turned my tags into a mess" class of bug.

**Future:** Per-rule opt-in auto-sync with debouncing in Phase 2.

## Frontmatter tags only, not inline tags

**Chosen:** Write to `tags:` in frontmatter.

**Cost:** Users who prefer inline tags (`#foo` in body) don't get folder→tag sync.

**Benefit:** Non-invasive. Inline tags the user already wrote are preserved. Interop with Dataview, Templater, Obsidian's own tag system.

## Bundled rule packs vs fetched-from-URL

**Chosen (planned Phase 2):** Bundle 3-5 rule packs directly in `main.js`.

**Cost:** Adding a new pack requires a new plugin release.

**Benefit:** Works offline. No third-party URL trust issues. Plugin review is straightforward.

**Future:** Phase 3 could add user-imported JSON packs from the vault.

## Deterministic regex vs AI inference

**Chosen:** Hard-coded regex rules.

**Cost:** Users can't say "make up reasonable tags for this note." They have to write rules.

**Benefit:** Reliable. Free. Offline. Predictable. No "the AI got it wrong" debugging sessions.

**Mitigation:** Other plugins (Smart Connections) handle AI tagging; this plugin deliberately stays out of that space.

## Bi-directional sync with reversible transforms vs one-way

**Chosen:** Bidirectional. Tag→folder runs the same pipeline in reverse.

**Cost:** Some transforms aren't perfectly reversible (e.g., stripping emojis loses information). Users need separate `folderTransforms` and `tagTransforms` for round-trip fidelity.

**Benefit:** One rule definition covers both sync directions. Users don't need to maintain two copies.

**Caveat:** "Bidirectional" in the same rule should be opt-in. Default new rules to single direction until the user explicitly enables bidirectional.
