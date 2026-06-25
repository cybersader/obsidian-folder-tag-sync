---
title: Agent context & exploration
description: Internal project knowledge — design decisions, tradeoffs, research, and exploration logs for contributors and AI agents.
sidebar:
  order: 0
---

This section contains internal project knowledge useful for contributors and AI coding assistants. It includes design decisions, prior art, open questions, and an exploration log.

Unlike the rest of the docs, this section is written for **contributors and AI agents** rather than end users. It provides the "why" behind design choices and captures institutional knowledge that would otherwise be lost between sessions.

## What's here

| Page | Purpose |
|---|---|
| [Current state](/obsidian-folder-tag-sync/agent-context/current-state/) | **Start here.** Where the project is right now, the live direction, the open wall |
| [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) | Plain-language definitions of every project term, with code locations |
| [Vision](/obsidian-folder-tag-sync/agent-context/vision/) | Short- and long-term goals; the problem this plugin solves |
| [Decisions](/obsidian-folder-tag-sync/agent-context/decisions/) | Key technical decisions and their rationale |
| [Tradeoffs](/obsidian-folder-tag-sync/agent-context/tradeoffs/) | Known tradeoffs and their justifications |
| [Open questions](/obsidian-folder-tag-sync/agent-context/open-questions/) | Unresolved design questions |
| [Prior art](/obsidian-folder-tag-sync/agent-context/prior-art/) | Existing plugins and related tools |
| [Exploration log](/obsidian-folder-tag-sync/agent-context/zz-log/) | Dated notes from development sessions |
| [Research challenges](/obsidian-folder-tag-sync/agent-context/zz-challenges/) | Adversarial briefs for fresh agents |

## For AI agents

If you're an AI coding assistant working on this project, start here to understand context that isn't obvious from the code alone. The `.claude/` folder in the repo contains source versions of these documents with agent-specific instructions.

Key reading order for a fresh session:

1. [Current state](/obsidian-folder-tag-sync/agent-context/current-state/) — where the project is *right now* and the live direction (orients you in two minutes)
2. [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) — every project term, plain-language; consult the moment a word is unfamiliar
3. [Vision](/obsidian-folder-tag-sync/agent-context/vision/) — what problem this solves
4. [Decisions](/obsidian-folder-tag-sync/agent-context/decisions/) — what's already been decided and why
5. [Open questions](/obsidian-folder-tag-sync/agent-context/open-questions/) — what's still up for debate
6. [Exploration log](/obsidian-folder-tag-sync/agent-context/zz-log/) — recent session history (newest first)
