---
title: Research challenges
description: Adversarial/exploratory research briefs for fresh agents to stress-test project assumptions.
sidebar:
  label: "Challenges"
  order: 200
---

## What this is

Focused research briefs that can be handed to a fresh agent (one with no prior conversation context about this project). Each challenge:

- Targets a specific architectural assumption, decision, or design
- Asks the agent to critically assess, stress-test, or find alternatives
- Thinks long-term — not just "does this work today" but "does this hold at 100K notes, 50 rules, 10 years from now"

## How to use

1. Pick a challenge from the list below
2. Hand it to a fresh agent (fresh Claude Code session, no prior context)
3. Point the agent at the KB (`docs/src/content/docs/`) for background
4. Let it research, critique, and report
5. Log findings in [`zz-log/`](/obsidian-folder-tag-sync/agent-context/zz-log/) if decisions or insights surface

## Why fresh agents

Every agent that works on a project accumulates context bias — it starts agreeing with past decisions because it helped make them. A fresh agent given only the KB and a challenge brief can find blind spots that embedded agents can't.

## Active challenges

- [Challenge 01: Does first-match-wins hold under real-world rule stacks?](/obsidian-folder-tag-sync/agent-context/zz-challenges/01-rule-priority-stress-test/)
- [Challenge 02: Transformation pipeline fidelity under bidirectional round-trips](/obsidian-folder-tag-sync/agent-context/zz-challenges/02-pipeline-reversibility/)
- [Challenge 03: Performance on a 10K-file vault with 50 rules](/obsidian-folder-tag-sync/agent-context/zz-challenges/03-performance-at-scale/)
- [Challenge 04: Same name, different layer, different meaning](/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/)
- [Challenge 05: Multi-entity vaults and namespace partitioning](/obsidian-folder-tag-sync/agent-context/zz-challenges/05-multi-entity-namespace-partitioning/)
- [Challenge 06: Compositional rule packs and the layering primitive](/obsidian-folder-tag-sync/agent-context/zz-challenges/06-compositional-rule-packs/)
- [Challenge 07: Frontmatter as bijection memory — does the design work in practice?](/obsidian-folder-tag-sync/agent-context/zz-challenges/07-frontmatter-as-bijection-memory-validation/)

## Challenge clusters

Challenges 04, 05, 06 form a connected cluster on the *layering and composition* family. They share solution machinery (parameterized anchors, slot capture, scope inheritance) but ask three distinct first-principles questions:

- **04 — Disambiguation** — same syntactic name, different semantic meaning at different positions
- **05 — Quantification** — one rule shape, many entity instances, no N×M explosion
- **06 — Composition** — multiple packs stacking at different layers, with the inner pack auto-anchoring to the outer's matched location

Recommended dispatch: hand each to a separate fresh agent in parallel; cross-reference findings when they all return.

Challenge 07 is a **practical-validation challenge** rather than a design-space challenge. Where 01–06 ask "what should the architecture be?", 07 asks "we have a proposed design — does it actually work when you walk it through?" Recommended dispatch: pair 07 with the [frontmatter-as-bijection-memory research entry](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) so the agent has the full design to validate.
