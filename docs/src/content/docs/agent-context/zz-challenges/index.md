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

Each challenge page is **self-dispatchable** — open it in a fresh Claude / LLM session, paste the URL, and say *"research this challenge."* Every challenge has a "Prompt for the dispatched agent" section at the top that includes:

- The question in one sentence
- A **layered reading list** (level 1 foundations → level 4 references) following progressive disclosure — fresh agents start at level 1 and work up; agents with context jump deeper
- The deliverable format and target location
- The tone (treat recommendations as hypotheses to test, not conclusions to defend)

Step-by-step:

1. Pick a challenge URL from the list below
2. Open a fresh-context Claude / LLM session
3. Paste the URL and say "research this challenge"
4. The agent reads the prompt section, follows the layered reading list, and produces the deliverable
5. Log findings in [`zz-log/`](/obsidian-folder-tag-sync/agent-context/zz-log/) at the path the prompt specifies (typically `YYYY-MM-DD-challenge-NN-findings.md`)

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
- [Challenge 08: Orphan and relation-tag semantics — what should `removeOrphanedTags` and `keepRelationTags` actually do?](/obsidian-folder-tag-sync/agent-context/zz-challenges/08-orphan-and-relation-tag-semantics/)
- [Challenge 09: Per-transform reversibility profile — which transforms compose to a bijective whole?](/obsidian-folder-tag-sync/agent-context/zz-challenges/09-per-transform-reversibility-profile/)
- [Challenge 10: Plugin API for Templater / QuickAdd integration — what's the right surface?](/obsidian-folder-tag-sync/agent-context/zz-challenges/10-plugin-api-for-templater-and-quickadd/)
- [Challenge 11: Attachment and folder-note handling on tag→folder moves — what travels with note.md?](/obsidian-folder-tag-sync/agent-context/zz-challenges/11-attachment-and-folder-note-handling/)
- [Challenge 12: Cross-device coordination — Obsidian Sync, undo/redo, and the multi-event trap](/obsidian-folder-tag-sync/agent-context/zz-challenges/12-cross-device-coordination/)

## Challenge clusters

Challenges 04, 05, 06 form a connected cluster on the *layering and composition* family. They share solution machinery (parameterized anchors, slot capture, scope inheritance) but ask three distinct first-principles questions:

- **04 — Disambiguation** — same syntactic name, different semantic meaning at different positions
- **05 — Quantification** — one rule shape, many entity instances, no N×M explosion
- **06 — Composition** — multiple packs stacking at different layers, with the inner pack auto-anchoring to the outer's matched location

Recommended dispatch: hand each to a separate fresh agent in parallel; cross-reference findings when they all return.

Challenges 07, 08, 09 form a *runtime-semantics* cluster — what does the engine actually *do* with tags, transforms, and stored state at runtime? Recommended dispatch: 07 first (frontmatter memory validation), 08 and 09 after 07's findings inform their composition analysis.

Challenges 10, 11, 12 form an *external-boundary* cluster — what does FTSync expose to the rest of the Obsidian ecosystem (10), how does it interact with Obsidian's native file-handling settings (11), and how does it behave across multiple devices and undo (12)? These can dispatch in parallel, but composition with the runtime-semantics cluster (especially Challenge 07's frontmatter memory) is essential.

### Challenge type guide

- **Design-space challenges (01–06, 08–12)** — ask "what should the architecture be?"
- **Practical-validation challenges (07)** — ask "we have a proposed design — does it actually work?"

Both types follow the same dispatch pattern: paste the URL into a fresh-context agent and say "research this challenge." The agent reads the prompt section first, follows the layered reading list, and produces a `zz-log/YYYY-MM-DD-challenge-NN-findings.md` deliverable.
