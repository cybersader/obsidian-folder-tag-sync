# Feature Roadmap

> **The canonical roadmap lives in the docs site:**
> [Roadmap — cybersader.github.io/obsidian-folder-tag-sync/about/roadmap/](https://cybersader.github.io/obsidian-folder-tag-sync/about/roadmap/)
>
> Source file: [`docs/src/content/docs/about/roadmap.md`](docs/src/content/docs/about/roadmap.md)

This file used to carry the full roadmap content. It now redirects to the published roadmap page so there's a single source of truth that's editable in markdown and renders in the docs site.

## Quick phase summary

- **Phase 1 — Core Functionality** ✅ Transformation engine, rule matching, basic UI, folder-to-tag and tag-to-folder sync (shipped).
- **Phase 2 — UI Polish & Usability** 🎯 Conditional form fields, default rule packs, rule testing/preview, field validation, better error messages.
- **Phase 2.5 — Resolution-engine refinement** 🎯 Refine `calculateMatchConfidence` (anchor-aware specificity), swap sort order so confidence is primary and priority is the override tiebreak, add `group?: string` field for cross-pack precedence (CSS `@layer`-style). See [Specificity + groups research](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) for the full design.
- **Phase 3 — Advanced Features** Template integration (API), batch processing, interactive conflict-resolution UI for ambiguous tag→folder cases, UI rule organization, path templates (Phase H from the regex-vs-templates research).
- **Phase 4 — Polish & Community** Rule pack marketplace, analytics, sync history, visual rule builder.

For the full per-feature breakdown, file paths to touch, prior-art surveys, and prioritization notes, see the linked roadmap page.

## Related research artifacts

These are the in-flight research entries that feed into the roadmap:

- [Path abstractions, part 1 — regex vs. path templates](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — forward-direction abstraction question
- [Path abstractions, part 2 — solutions in practice](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — concrete code, hybrid coexistence, communication primitives
- [Tag → folder resolution research](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — inverse-direction problem; six-candidate survey; recommends specificity-aware matching + rule groups
- [Specificity + groups research](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) — combined deep dive on Phase 2.5
- [Solution brainstorm (working draft)](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) — meta-shape framing; SEACOW context-as-disambiguator

## Open challenges (research questions that frame the work)

- [Challenge 01 — Rule priority stress test](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/01-rule-priority-stress-test/)
- [Challenge 02 — Pipeline reversibility](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/02-pipeline-reversibility/)
- [Challenge 03 — Performance at scale](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/03-performance-at-scale/)
- [Challenge 04 — Name collisions across hierarchy](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/)
- [Challenge 05 — Multi-entity namespace partitioning](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/05-multi-entity-namespace-partitioning/)
- [Challenge 06 — Compositional rule packs](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/06-compositional-rule-packs/)
