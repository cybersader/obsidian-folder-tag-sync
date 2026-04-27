---
title: "Challenge 03: Performance at scale"
description: How does this plugin behave on a 10K-file vault with 50 rules? What breaks first?
tags: [research, performance]
sidebar:
  label: "03 · Performance at scale"
  order: 3
---

## Prompt for the dispatched agent

Open this challenge in a fresh-context Claude / LLM session, paste the URL, and say *"research this challenge."* The reading list below is layered for **progressive disclosure** — start at level 1 if you're new to the project, jump deeper if you already know the context.

**The question in one sentence:** how does the plugin behave on a 10K+ file vault with 50 rules across realistic event traffic — what breaks first, where are the optimization targets, and is the documented "10K+ files supported" claim actually true?

### Reading order (level 1 → level 4)

1. **Foundations** (orient first if new to the project):
   - [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
   - [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — the typed-model layers; relevant because Layer 1 (regex + transforms) is what runs on every file event, and the engine's hot path is regex evaluation
2. **Core concepts for this question**:
   - [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives; pipeline shape (`match → extract → recoordinate → transform → emit`)
   - [Wildcard matching](/obsidian-folder-tag-sync/concepts/wildcard-matching/) — pattern-shape considerations
3. **Direct context** (constraints + related research):
   - [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) — relevant because the proposed B+C resolution-engine refinement adds work to `findBestMatch`; this challenge should evaluate whether that refinement scales
   - [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — relevant because per-file frontmatter writes increase per-event I/O
4. **Reference (optional)**:
   - [Rule schema](/obsidian-folder-tag-sync/reference/rule-schema/) — exact rule format; `MappingRule` shape determines memory footprint per rule
   - `src/engine/ruleMatcher.ts:97-117` (`findBestMatch`), `src/sync/FolderToTagSync.ts`, `src/sync/TagToFolderSync.ts` (read on the GitHub repo) — the hot-path code the analysis should target

### Deliverable

Short report at `agent-context/zz-log/YYYY-MM-DD-challenge-03-findings.md` (~1500–2500 words). Required sections: profiling estimates for the documented hot paths (rule matching per file event, tag→folder bulk sync, vault-scan rule-pack detection), identification of which path breaks first under stress, optimization targets ordered by impact, the verdict on the "10K+ files supported" claim (is it true today, marginal, or aspirational), and concrete recommendations (algorithmic vs. caching vs. async/throttle vs. worker-thread).

### Tone

Treat existing recommendations as **hypotheses to test, not conclusions to defend.** If your analysis says the plugin is fine at scale and the optimization concerns are premature, that's a more valuable finding than confirming the warnings.

---

## Assumption under test

The plugin is documented as supporting vaults with 10,000+ files. In practice, nothing in the current implementation has been stress-tested at that scale.

Real Obsidian users run vaults from ~100 files (casual) to ~50,000+ files (heavy knowledge workers). Performance regressions land *the worst* on users with the largest vaults — they're also the most likely to write a public complaint.

## Expected pressure points

### Rule matching per file event
When a file event fires, the plugin:

1. Reads the file's current tag list (via `metadataCache`)
2. Iterates through every rule
3. Runs each rule's regex against the file path / tags
4. Applies transformations
5. Writes the result

At ~10K files × 50 rules × some number of file events per second (e.g., a bulk sync or external vault sync), that's a lot of regex operations.

### Tag→folder bulk sync
"Apply all rules to every file in the vault" means for each of N files, run up to M rules. Naive = O(N×M). On 10K files × 50 rules = 500K regex evaluations. Feasible but may block the UI if done on main thread.

### Frontmatter writes
Each sync operation writes frontmatter via `app.fileManager.processFrontMatter`. That's a file write. 10K files × 1 operation = 10K writes. Obsidian may serialize these.

### Debug logging
`DebugLog.log()` does `vault.read` + `vault.modify` to append. Linear in log size. A vault-wide sync could grow the log to megabytes in minutes.

## Research brief

1. **Measure.**
   - Write a benchmark script that generates a synthetic vault (10K files, 4 folder hierarchies deep, varied names).
   - Load the plugin with 10, 50, and 100 rules.
   - Time: single-file sync, vault-wide sync, rule editor save-with-preview.
   - Measure memory: peak heap during vault-wide sync.

2. **Identify the binding constraint.**
   - Is it regex evaluation?
   - Frontmatter parsing?
   - File I/O?
   - Something unexpected like metadata cache invalidation?

3. **Design optimizations, ordered by payoff.**
   - Rule short-circuit: exit early on first match (already implemented — verify).
   - Path trie: bucket rules by first folder segment to avoid evaluating irrelevant regexes.
   - Worker threads: Obsidian allows web workers. Push vault-wide sync off the main thread.
   - Batch frontmatter writes: group writes into a single transaction per Nth file.
   - Debug log rotation: cap log at 10MB, rotate.

4. **Define regression guards.**
   - Add perf benchmarks to the test suite.
   - Flag any PR that slows single-file sync by >10% or vault-wide sync by >25%.

## Deliverable

- Benchmark results table (ms per operation at 1K / 5K / 10K files)
- Identified binding constraint
- Prioritized optimization list with estimated payoff
- Test-suite perf guards

Log findings in `zz-log/`.

## Why this matters early

Users write reviews when the plugin is slow on their vault. Once that review is up, it's hard to un-publish. Better to know the scaling limits before we ship Phase 2's automatic sync feature, which multiplies the frequency of every operation.
