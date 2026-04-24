---
title: "Challenge 03: Performance at scale"
description: How does this plugin behave on a 10K-file vault with 50 rules? What breaks first?
tags: [research, performance]
sidebar:
  label: "03 · Performance at scale"
  order: 3
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
