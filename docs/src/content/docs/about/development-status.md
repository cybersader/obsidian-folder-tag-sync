---
title: Development status
description: Current release status, AI-assisted development disclosure, and alternate plugin names.
sidebar:
  order: 5
---

## Current release

This plugin is in **active development** (v0.1.7 beta). Core features are working, with advanced features in progress. See the [roadmap](/obsidian-folder-tag-sync/about/roadmap/) for what's coming.

## Also known as

This plugin goes by several names that describe the same concept:

- **Folder Tag Sync** — official name
- **Dynamic Tags & Folders**
- **Tag and Folder Mapper**
- **Polyhierarchy Plugin** — conceptual nickname

All refer to the same plugin for bidirectional folder-tag synchronization.

## AI-assisted development disclosure

**Full transparency:** Most of this plugin's code was written by AI (Claude Code) with the author deeply involved in testing, design decisions, and quality control. The author's background is primarily Python and tabular data work, not JavaScript/TypeScript or Obsidian plugin development.

### What this means

- ✅ Rapid development with comprehensive testing (156+ automated tests)
- ✅ Well-documented, modern codebase
- ✅ Thorough design decisions documented in [agent-context](/obsidian-folder-tag-sync/agent-context/)
- ⚠ Ongoing learning curve for traditional Obsidian plugin patterns
- 💡 Committed to maintenance and user feedback

If you find issues or have suggestions, please [open an issue](https://github.com/cybersader/obsidian-folder-tag-sync/issues).

## Tech stack

| Layer | Tech |
|---|---|
| Language | TypeScript (strict mode) |
| Package manager | Bun |
| Build | esbuild |
| Test runner | Bun |
| Lint | ESLint + `eslint-plugin-obsidianmd` |
| Plugin API | Obsidian 0.15.0+ |
| Docs site | Astro 6 + Starlight + Nova theme |

## Community plugin submission status

Submission to Obsidian's community plugin directory is in progress. See [zz-log: submission PR stalled](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-13-submission-pr-stalled/) for the current status.

In the meantime, install via:

- [Manual install](/obsidian-folder-tag-sync/getting-started/installation/#manual-installation) from the GitHub releases page
- [BRAT](/obsidian-folder-tag-sync/getting-started/installation/#via-brat) for auto-updating beta installs

## Acknowledgments

Inspired heavily by [Auto Note Mover](https://github.com/farux/obsidian-auto-note-mover) — see [prior art](/obsidian-folder-tag-sync/agent-context/prior-art/) for the fuller context.
