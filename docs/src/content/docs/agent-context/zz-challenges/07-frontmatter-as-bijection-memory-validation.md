---
title: "Challenge 07: Frontmatter as bijection memory — does the design work in practice?"
description: A research log entry proposed an opt-in feature where per-file frontmatter properties remember origin information, making lossy transfer ops bijective on a per-file basis. The design space is mapped; what's missing is concrete walked-through validation that the design actually works in representative scenarios. This challenge asks a fresh agent to take the proposal and stress-test it against real round-trip scenarios.
tags: [research, architecture, frontmatter, bijection, validation, phase-3]
sidebar:
  label: "07 · Frontmatter memory validation"
  order: 7
---

## Prompt for the dispatched agent

Open this challenge in a fresh-context Claude / LLM session, paste the URL, and say *"research this challenge."* The reading list below is layered for **progressive disclosure** — start at level 1 if you're new to the project, jump deeper if you already know the context.

**The question in one sentence:** does the proposed frontmatter-as-bijection-memory feature actually work in practice when walked through representative scenarios — or does the design under-specify behavior in ways the research entry missed?

### Reading order (level 1 → level 4)

1. **Foundations** (orient first if new to the project):
   - [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary; especially `bijection`, `lossy`, `lossless`, `cardinality`
   - [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — the typed-model layers; why determinism is non-negotiable
2. **Core concepts for this question**:
   - [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge page; per-op lossy/lossless behavior; collision-vs-lossy distinction
   - [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives with per-op forward + inverse worked examples; the per-op claim validation in this challenge will trace each op
3. **Direct context** (the design to validate):
   - [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — **the primary source.** Read this in full; the design space is mapped; this challenge tests it
   - [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — the broader inverse-direction problem this feature partially addresses
   - [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) — Phase 2.5 design; needed for the composition-with-related-work analysis in this challenge
   - [Path abstractions, part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — hybrid coexistence; needed for the templates-vs-frontmatter composition question
   - [Challenge 02 — Pipeline reversibility](/obsidian-folder-tag-sync/agent-context/zz-challenges/02-pipeline-reversibility/) — adjacent question (transform-pipeline reversibility independent of the storage mechanism)
4. **Reference (optional)**:
   - [Rule schema](/obsidian-folder-tag-sync/reference/rule-schema/) — current rule structure; the proposed `frontmatterMemory` config would slot in here
   - `src/sync/FolderToTagSync.ts:236-257` (`updateTags`), `src/sync/TagToFolderSync.ts:154-195` (`determineTargetFolder`), `src/engine/applyTransfer.ts:254-295` (`applyRuleInverse`) (read on the GitHub repo) — exact code paths the proposal would touch

### Deliverable

Short report at `agent-context/zz-log/YYYY-MM-DD-challenge-07-findings.md` (~1500–2500 words). Required sections: your framing of the practical-validation question, walked-through traces for at least 4 of the 6 scenarios in the challenge body (with actual before/after YAML snippets at each step), a small simulation or pseudocode of the round-trip algorithm, risk validation against the 6 named risks, per-op claim validation (especially the partially-recoverable `marker-only` and `post-coordination` cases), vault-scale cost estimates (frontmatter bytes, git diff size, backfill time, plugin-compatibility surface), composition analysis (Phase 2.5 + Phase H + conflict UI), and the go/no-go recommendation with the most-important reason in the first paragraph.

### Tone

Treat existing recommendations as **hypotheses to test, not conclusions to defend.** If the practical validation surfaces problems the research entry missed, that's the most valuable possible outcome — fresh-agent context-skepticism is exactly what's needed here.

---

## Assumption under test

The [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) proposes an opt-in feature where, when a forward sync fires (folder → tag), the engine writes origin information to the file's frontmatter:

```yaml
---
tags:
  - "-inbox"
ftsync:
  schema: 1
  origin: "Capture/Inbox/2026/Q2"
  rule: "inbox-marker"
  synced_at: "2026-04-27T18:30:00Z"
---
```

The inverse direction (tag → folder), when it fires, reads the frontmatter origin and moves the file back to the *exact* recorded folder rather than falling back to the rule's entry folder. The claim is that this makes lossy transfer ops (`marker-only`, `truncation/aggregate`, `truncation/flatten`, `promotion-to-root`, `flattening-to-leaf`, `aggregation`) bijective on a *per-file basis* — even though they remain lossy *per-rule*.

The research entry mapped the design space (per-op information-theoretic analysis, prior-art survey, codebase impact, recommended phasing). What it did **not** do:

- Walk concretely through forward + inverse sync for representative scenarios with actual before/after YAML snippets
- Stress-test edge cases against the design (manual file move, rule change, drift, frontmatter corruption, collaborative vaults)
- Validate the per-op claims with worked examples (especially the partial-recovery cases for `marker-only` and `post-coordination`)
- Build a small simulation or prototype to confirm the algorithm actually works end-to-end

This challenge fills those gaps. The deliverable is a focused report that confirms (or refutes) the proposal works in practice for the cases the design says it should, identifies any cases the research missed, and gives a concrete go/no-go recommendation for Phase 3 prioritization.

## Why it might not work

The research entry named several risk areas. The challenge should test each of them concretely:

### Risk 1 — The two-class problem creates user confusion

Files that FTSync forward-synced have origin metadata; files where the user manually added the tag don't. The inverse direction has different behavior for each class:

- **FTSync-class** (origin field present): exact recovery
- **Manual-class** (no origin field): fall back to the rule's entry folder

A user who mixes both modes (forward-sync some files, manually tag others) lives in a regime where `#-inbox`-tagged files have *different* inverse behaviors that aren't visible from the tag alone. Does this cognitive load actually break in practice, or is it manageable? The challenge should walk through a mixed-mode scenario and judge.

### Risk 2 — Drift between frontmatter and current location

What happens when a user manually moves a file (without FTSync firing)? The frontmatter still points to the old location. The next sync sees:

- File at `New/Folder/note.md`
- Frontmatter origin: `Capture/Inbox/2026/Q2`
- Rule pattern matches `New/Folder/note.md` (or doesn't)

What's the right behavior? Update frontmatter? Warn? Treat the move as authoritative? The research entry punts this to "open questions"; the challenge should evaluate at least three resolution strategies.

### Risk 3 — Rule changes after files were tagged

A user tags 100 files via a `marker-only` rule, then later edits the rule (changes the marker, changes the entry folder, changes the cardinality, switches to a different transfer op). The frontmatter origin survives the rule change but no longer corresponds to current rule behavior. Does the schema-versioning idea (`ftsync.schema: 1`) actually help, or does it just kick the can?

### Risk 4 — Cross-vault sync conflicts

User A on desktop, User B on mobile, both with FTSync installed and the same vault. User A forward-syncs a file at 10:00; frontmatter is written. User B's vault syncs from disk at 10:05 with a different rule definition. The frontmatter origin from A's sync may not match what B's rule would produce. What's the resolution? Last-write-wins (lose A's recovery anchor)? User prompt? Hash-based detection? The research entry mentions this as an open question; the challenge should design a concrete resolution algorithm.

### Risk 5 — Frontmatter pollution at scale

The research estimated ~80 bytes/file × 10,000 files ≈ 1 MB of new YAML. Is that actually negligible, or does it matter for:

- Git diff size in real commits
- Obsidian load time on large vaults
- Plugins that scan all frontmatter (Dataview, Templater)
- Sharing via static-site generators that don't tolerate unknown YAML keys

The challenge should pick a real-vault scenario and measure (or estimate) the actual costs.

### Risk 6 — The `marker-only` two-class case is the dominant use case

Marker-only rules are common (inboxes, attachment folders, template markers). They're also the case where the two-class problem is most visible. If the feature feels broken specifically for marker-only, the whole proposal weakens — even if it works perfectly for the four "fully recoverable" ops.

The challenge should weight `marker-only` heavily in the validation.

## Concrete scenarios to walk through

The agent should pick **at least four** representative scenarios from the list below and walk each one fully. For each: write the rule definition, the initial vault state, the action the user takes, the engine's response (forward or inverse), the resulting frontmatter and folder state, and the next action (if any). Show the YAML at each step.

### Scenario A — `marker-only` round-trip with frontmatter memory

A user has `Capture/Inbox/2026/Q2/notes.md`. Rule: `marker-only` with marker `-inbox`, frontmatter memory enabled.

1. Forward sync fires: file is in `Capture/Inbox/2026/Q2/`; engine writes `tags: [-inbox]` and `ftsync.origin: "Capture/Inbox/2026/Q2"` to frontmatter
2. User decides to move the file via `#-inbox` removal: removes the tag in frontmatter
3. Inverse sync fires (or doesn't?): does removing the tag move the file? To where?
4. Now consider the alternative: user adds `#-inbox` to a *different* file in `Drafts/wip.md`
5. Inverse sync fires: where does this file go? It has no origin metadata.

Walk through every step; show the YAML; show the folder state; identify any place the engine has to make a choice not specified by the design.

### Scenario B — `truncation/aggregate` round-trip with separator collision

User has two files:

```
Capture/Clips/Web/Tutorials/React-Hooks/intro.md   (folder name has hyphen)
Capture/Clips/Web/Tutorials/React/Hooks/intro.md   (no hyphen, deeper nesting)
```

Rule: `truncation` with `depth: 2`, `tailHandling: 'aggregate'`, `separator: '-'`. Frontmatter memory enabled.

1. Forward sync produces what tag for each? Should be the same: `#-clip/web/tutorials-react-hooks`
2. Frontmatter origin is written for each
3. User manually adds `#-clip/web/tutorials-react-hooks` to a third file in `Drafts/foo.md`
4. Inverse sync fires for the third file — where does it go?

Walk through; identify the ambiguity resolution; show the YAML.

### Scenario C — Rule change after files are tagged

User has 50 files tagged via a `flattening-to-leaf` rule with `folderEntry: "Sources"`, `tagEntry: "via"`. Frontmatter memory enabled. All files have `ftsync.origin` recorded.

1. User edits the rule to change `tagEntry` from `"via"` to `"source"`
2. Some files have stale tag (`#via/...`); some new files would get `#source/...`
3. Inverse sync fires on a stale-tagged file: does the engine read the old origin, the new rule, both?
4. What if the user edits the rule's transfer op too (from `flattening-to-leaf` to `truncation/drop` with `depth: 2`)?

Walk through; show what schema versioning does and doesn't catch.

### Scenario D — Manual file move (drift)

User has `Projects/Web Auth/oauth-flow.md` synced via a `promotion-to-root` rule. Frontmatter origin: `Projects/Web Auth/oauth-flow`.

1. User manually drags the file to `Archive/2026/Web Auth/oauth-flow.md`
2. FTSync wasn't running during the move
3. Next forward sync fires: what does the engine do?
   - The file's current folder doesn't match the rule (rule was `^Projects/...`)
   - The frontmatter origin says it used to be in `Projects/Web Auth/`
   - The current `tags` field still has `#projects/web-auth`
4. Three plausible behaviors: (a) treat the move as authoritative — update frontmatter, possibly remove tag; (b) warn the user about drift, do nothing; (c) treat frontmatter as authoritative — move the file back

Walk through each behavior; recommend one.

### Scenario E — `marker-only` with mixed-mode workflow (the two-class problem in practice)

User has 10 files in `Capture/Inbox/`, all forward-synced via `marker-only` (marker `-inbox`). All have `ftsync.origin` recorded.

User then manually adds `#-inbox` to 5 files in various other folders (without moving them). These don't have origin metadata.

Now the user wants to "process the inbox" — for each `#-inbox`-tagged file, decide what to do:

1. For the 10 forward-synced files: inverse can move them back to their exact origins
2. For the 5 manually-tagged files: inverse falls back to rule entry (or what?)

How does the user know which files are which? Does the UI surface the two classes? Does it matter to the user, or just to the engine?

Walk through; assess whether the cognitive load is acceptable.

### Scenario F — Cross-vault sync conflict

(Optional but recommended.) Two FTSync installs (desktop + mobile). User edits a file on mobile (manually adds a tag, frontmatter doesn't change). Desktop syncs from cloud storage, sees the new tag, fires inverse. Mobile then re-syncs and sees the move.

Walk through the timing; identify where conflicts can arise; recommend a resolution.

## Research brief

The agent should:

### 1. Walk through scenarios A–F (or at least 4 of them)

For each chosen scenario, produce a concrete trace with:

- Rule JSON (typed model + frontmatter-memory config)
- Initial vault state (folder tree + relevant frontmatter)
- Each user action and the engine's response
- The final state after the trace completes
- A list of choices the engine had to make that aren't fully specified by the design

Identify gaps where the design under-specifies behavior. Propose default behaviors for each gap.

### 2. Build a small simulation

Pseudocode (or actual JS / TS) that simulates the round-trip for one chosen scenario. Doesn't need to integrate with Obsidian — just a function that takes (rule, vault, file_path, action) and returns the new state. Verify the simulation matches the design's intent by running it against scenarios A and B at minimum.

### 3. Stress-test the design against Risks 1–6

For each risk named in this challenge:

- Walk through a concrete failure case (fabricate one if needed)
- Judge whether the proposed mitigations from the research entry actually mitigate
- Identify any new risks the research entry missed

### 4. Validate the per-op claims

The research entry made specific claims:

- 5 ops are fully recoverable with frontmatter memory: `truncation/aggregate`, `truncation/flatten`, `promotion-to-root`, `flattening-to-leaf`, `aggregation`
- 2 ops are partially recoverable: `marker-only`, `post-coordination`
- 2 ops are already bijective (frontmatter is defensive only): `identity`, `truncation/drop`
- 1 op is n/a: `opaque`

For each of the 5 "fully recoverable" claims: walk through a forward + inverse round-trip and confirm or refute. For each of the 2 "partially recoverable" claims: characterize precisely what *is* and *isn't* recoverable, and quantify how much of the use case is covered.

### 5. Estimate concrete costs at vault scale

Pick a hypothetical large vault (10K files, 50 rules, of which 10 use frontmatter memory). Estimate:

- Total bytes added to frontmatter
- Approximate git diff size for a vault-wide re-sync
- Time to perform a backfill migration sweep
- User-visible impact (Obsidian load time, plugin compatibility, sharing surface)

Use real numbers where possible; flag estimates clearly.

### 6. Compose with related work

The frontmatter-memory proposal sits alongside three other in-flight design directions:

- **Phase 2.5** specificity-aware matching + rule groups ([Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/))
- **Phase H** path templates ([Path abstractions Part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) + [Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/))
- **Inverse-direction conflict UI** (candidate D from [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/))

For each: does frontmatter memory compose cleanly, conflict, or change the design of the related feature? Specifically:

- When a tag matches multiple rules under specificity-aware matching, *which rule's frontmatter origin* gets read on the inverse?
- When path templates land, do slot values get stored in frontmatter alongside the origin path? Or does the slot capture make the origin redundant?
- Does the conflict-resolution UI need a "show origin metadata" surface? Does it change the UX of the conflict prompt?

### 7. Recommendation: ship, adjust, or defer

After the validation work above, recommend one of:

- **Ship as designed** — research entry got it right; the practical scenarios confirm the design works
- **Ship with adjustments** — list specific design changes that emerged from the validation
- **Defer** — the practical issues are too significant; the research entry's tradeoff analysis was too optimistic
- **Reject** — the philosophy shift creates more problems than it solves

For whichever recommendation, surface the *one most important reason* in the first paragraph.

## Deliverable

Short report (~1500–2500 words) at `zz-log/YYYY-MM-DD-challenge-07-findings.md`:

- The agent's framing of the practical-validation question (does the original challenge cover the right cases?)
- For each chosen scenario (4 of A–F): the concrete trace + identified gaps
- The simulation or pseudocode
- Risk validation (Risks 1–6) with concrete failure cases or honest "no, this risk doesn't materialize" findings
- Per-op claim validation (5 fully recoverable, 2 partial, 2 already bijective, 1 n/a)
- Vault-scale cost estimates
- Composition analysis (Phase 2.5, Phase H, conflict UI)
- The go/no-go recommendation with reasoning
- Open questions left unresolved

## Hand-off note

This challenge sits at the practical-validation layer below the [research entry](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/). The research entry mapped the design space; this challenge asks "does the design actually work when you walk it through?" Both are needed before the feature can be confidently scoped for Phase 3 implementation.

The agent should treat the research entry's recommendations as *hypotheses to test*, not as conclusions to defend. If the practical validation surfaces problems the research entry missed, that's the most valuable possible outcome — it's what fresh-agent context-skepticism is for.

Read these before starting:

- The [research entry itself](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — primary source
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge from primitives to bijection vocabulary
- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight ops with worked forward + inverse examples
- [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — the broader inverse-direction problem this feature partially addresses
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary if any vocabulary is unfamiliar

Cross-link to related challenges:

- [Challenge 02: Pipeline reversibility](/obsidian-folder-tag-sync/agent-context/zz-challenges/02-pipeline-reversibility/) — adjacent question (transform pipeline reversibility independent of the storage mechanism)
- [Challenge 04: Same name, different layer](/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/) — frontmatter memory directly resolves this for forward-synced files
- [Challenge 05: Multi-entity namespace partitioning](/obsidian-folder-tag-sync/agent-context/zz-challenges/05-multi-entity-namespace-partitioning/) — frontmatter memory could be one component of the answer
