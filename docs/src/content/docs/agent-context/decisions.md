---
title: Decisions
description: Key technical decisions, with context and reasoning.
sidebar:
  order: 2
---

This is a running log of technical decisions. Each entry states **what** was decided, **why**, and **what was rejected**.

## Architecture

### Deterministic rule engine, not AI

**Decided:** Use regex patterns + transformation pipelines. Never use LLMs or embeddings for categorization.

**Why:**
- Output is predictable. Same input → same output, every time.
- Users can test rules without running a model.
- No network calls, no tokens, no cost.
- Works fully offline.

**Rejected:** AI-assisted "suggest a tag for this note" feature. Smart Connections and other plugins already do this well; mixing it in would blur the plugin's purpose.

---

### Four-stage transformation pipeline with fixed order

**Decided:** emoji handling → number prefix → case conversion → custom regex. Each step is optional.

**Why:**
- Most real-world naming has these four concerns in that order (`📁 01 - My Project` → strip emoji → strip number → snake_case).
- Fixed order keeps rules predictable.
- Custom regex at the end lets users add project-specific cleanup without affecting the pipeline shape.

**Rejected:** Arbitrary user-ordered pipeline. Too many ways to write subtly-broken rules.

---

### Rule priority is a number, first-match wins

**Decided:** Rules have a `priority: number` field. Lower = higher precedence. First matching rule resolves the sync.

**Why:**
- Simple mental model. Users understand "more specific rules get lower numbers."
- Makes conflict resolution explicit via ordering.
- Matches Auto Note Mover's pattern, which users are already familiar with.

**Rejected:** Score-based best-match. Non-deterministic in corner cases and hard to debug.

---

### Tags stored in frontmatter `tags:` array

**Decided:** Always use YAML frontmatter `tags:` array for folder→tag sync.

**Why:**
- Matches Obsidian's canonical tag storage.
- Interoperates with other plugins (Dataview, Templater).
- Preserves inline tags — folder sync never strips them.

**Rejected:** Inline tag writing (`#tag` in body). Too invasive; would conflict with user's own inline tags.

---

### Both sync directions share the same transformation pipeline

**Decided:** `folderTransforms` and `tagTransforms` are separate fields on a rule, but the transformation pipeline code is shared.

**Why:**
- Composability. A user can define one rule with both directions and different transforms for each side.
- Same pipeline code path = fewer bugs.

**Tradeoff:** The type system has to allow both fields even when only one direction is used. Worth it.

---

### No automatic sync on file events (yet)

**Decided:** Phase 1 ships with manual sync commands only. No event handlers on create/modify/rename.

**Why:**
- Safer. Users can preview and undo manually before committing to automatic behavior.
- Debouncing file events is non-trivial (external sync, bulk operations).
- Gives time to validate rule correctness before unleashing it on vault events.

**Planned:** Phase 2 adds opt-in `syncOnFileCreate`, `syncOnFileMove`, `syncOnFileRename` per rule.

## Tooling

### Bun over npm

**Decided:** Bun is the primary package manager and test runner.

**Why:**
- ~10× faster install than npm on a cold start.
- Bun's test runner is drop-in compatible with Jest-style tests.
- Matches the workspace pattern (portaconv, portagenty, cyberbaser all use Bun).

### esbuild, not tsup or webpack

**Decided:** Stick with Obsidian's sample-plugin esbuild setup.

**Why:**
- Fast enough.
- Obsidian-sample-plugin convention; reviewers recognize it.
- Zero config needed for our needs.

### Astro + Starlight + Nova for docs

**Decided:** Match crosswalker's docs stack.

**Why:**
- Nova theme has the right density for a plugin reference site.
- Starlight has pagefind search, sidebar auto-generation, and a healthy plugin ecosystem.
- Astro 6 is stable and fast.

**Caveat:** Nova's Tailwind usage requires `@source` directives in `global.css` — see [zz-log 2026-04-23](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-23-docs-site-setup/) for the regression.
