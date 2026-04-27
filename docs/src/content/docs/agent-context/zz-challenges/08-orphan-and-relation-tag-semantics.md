---
title: "Challenge 08: Orphan and relation-tag semantics — what should `removeOrphanedTags` and `keepRelationTags` actually do?"
description: Two settings fields are declared in the codebase (`removeOrphanedTags`, `keepRelationTags`) but never implemented anywhere. The fields aren't just missing code — their semantics aren't defined either. When should the engine remove tags it derived from now-deleted folders? What counts as a "relation tag" the engine should never touch? This challenge designs the algorithm from first principles.
tags: [research, architecture, semantics, tag-management, phase-3]
sidebar:
  label: "08 · Orphan / relation tags"
  order: 8
---

## Prompt for the dispatched agent

Open this challenge in a fresh-context Claude / LLM session, paste the URL, and say *"research this challenge."* The reading list below is layered for **progressive disclosure** — start at level 1 if you're new to the project, jump deeper if you already know the context.

**The question in one sentence:** when should the engine remove tags it previously derived (because the source folder was deleted, the rule changed, or the user manually moved the file) — and how does it tell a "derived tag I own" from a "user-authored relation tag I should never touch"?

### Reading order (level 1 → level 4)

1. **Foundations** (orient first if new to the project):
   - [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary; especially `tag`, `tag namespace`, `polyhierarchy`, `bijection`, `cardinality`
   - [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — typed-model layers; `TagVocabulary.authority` field is load-bearing for this challenge
2. **Core concepts for this question**:
   - [SEACOW axes](/obsidian-folder-tag-sync/concepts/axes/) — the `relation` axis is one candidate definition of "relation tag" (flat cross-link keywords, post-coordinated, authored directly on notes)
   - [Tag vocabularies](/obsidian-folder-tag-sync/concepts/tag-vocabularies/) — `authority: 'folder-authoritative' | 'tag-authoritative' | 'mutual'` is the existing field that *should* drive orphan handling
   - [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — `cardinality` determines whether removing a tag should imply removing the folder or vice versa
   - [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — per-op semantics (especially `marker-only` and `post-coordination`) determine what "orphan" means
3. **Direct context** (the research that frames this challenge):
   - [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — origin metadata can mark "this tag was derived from this rule," which directly bears on orphan detection
   - [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — inverse direction's `cardinality` and `bijective` fields determine whether tag removal implies folder action
   - [Challenge 02 — Pipeline reversibility](/obsidian-folder-tag-sync/agent-context/zz-challenges/02-pipeline-reversibility/) — adjacent question (forward + inverse round-trip fidelity)
4. **Reference (optional, code-level grounding)**:
   - [Rule schema](/obsidian-folder-tag-sync/reference/rule-schema/) — exact `RuleOptions` field definitions
   - `src/types/settings.ts:114-126` (read on the GitHub repo) — the two declared-but-not-implemented fields with no consuming code anywhere

### Deliverable

Short report at `agent-context/zz-log/YYYY-MM-DD-challenge-08-findings.md` (~1500–2500 words). Required sections: defensible definitions of "orphaned tag" and "relation tag" (multiple plausible definitions exist; pick one per term and justify), the proposed algorithm for `removeOrphanedTags` (when does it fire, what's the trigger, what's the side-effect contract), the proposed algorithm for `keepRelationTags`, edge cases (rule changes after files were tagged; user-authored tag matching a rule pattern; multiple rules deriving overlapping tags), composition with frontmatter memory if shipped, recommended UX (silent, notice, confirm), open questions.

### Tone

Treat existing recommendations as **hypotheses to test, not conclusions to defend.** If your analysis says these two fields shouldn't be implemented as a single algorithm and should be split into more granular settings, that's a more valuable finding than confirming the field names. Fresh-agent context-skepticism is the point.

---

## Assumption under test

The plugin's settings type declares:

```typescript
// src/types/settings.ts
interface RuleOptions {
  // ... other fields ...
  removeOrphanedTags: boolean;       // line 114 — declared
  keepRelationTags?: boolean;        // line 126 — declared
}
```

Neither field is referenced anywhere else in the codebase. They appear in the settings UI as toggles, the user can flip them, but **the runtime engines do not consume them**. This isn't a "we forgot to wire up the code" situation — the *semantics* of what these fields should do haven't been pinned down.

The implicit assumption is that the names speak for themselves: "orphaned tags" should be removed; "relation tags" should be kept. **But neither term has a precise definition in the codebase or docs.**

## Why the simple reading might not hold

### What's a "relation tag"?

Three plausible definitions, each producing a different algorithm:

1. **A tag on the SEACOW `relation` axis** — `#topic/attention`, `#author/kahneman`, `#urgent`. The relation axis is documented as "flat cross-link keywords; post-coordinated; authored directly on notes, not derived from folder paths." Under this definition, `keepRelationTags` means "preserve tags whose vocabulary's `axis` field is `'relation'` when sync fires."

2. **Any tag the user authored manually**, regardless of axis. If a user types `#projects/something-i-thought-of` in frontmatter without a corresponding folder, the engine should not delete it on next sync. Under this definition, `keepRelationTags` means "preserve tags that don't have origin metadata or that don't match any rule's pattern."

3. **A tag with `vocabulary.authority: 'tag-authoritative'`** — the existing typed field that says "the tag is the source of truth, the folder follows." Under this definition, the engine never touches tag-authoritative tags during a folder→tag sync.

These three definitions don't align. A fresh agent should pick one (or argue for a hybrid) and explain why.

### What's an "orphaned tag"?

Three plausible definitions here too:

1. **A tag whose source folder no longer exists.** Files in `Projects/Old/` got `#projects/old`; the user deletes `Old/`; on next sync, `#projects/old` is now an orphan because nothing in the vault matches the rule's pattern at that path.

2. **A tag whose source rule has been changed or deleted.** The user had a rule `^Projects/(.+)` producing `#projects/$1`; they delete the rule; the existing `#projects/web` tags are orphaned because no current rule would derive them.

3. **A tag that was derived but is no longer reachable from any current rule + current folder structure.** The intersection of (1) and (2): a tag is an orphan if no current configuration would re-derive it for any current file.

Definition 3 is the strongest, but requires running the forward direction in dry-run mode against the entire vault to know which tags are "still reachable" — that's a non-trivial operation.

### Edge cases that break naive implementations

- **Multi-rule overlap**: two rules both produce `#projects/web` for different folders. One rule is deleted. Is `#projects/web` orphaned, or is it still derivable from the other rule? Today the engine doesn't track which rule produced which tag.
- **Manual-class tags** (the two-class problem from the [frontmatter-memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/)): if a user types `#projects/web` manually on a file in `Drafts/`, the tag is *not* orphaned (the user authored it intentionally) — but how does the engine know without origin metadata?
- **Rule-pattern changes**: a user edits a rule's `tagPattern` from `#projects/$1` to `#proj/$1`. Existing `#projects/web` tags now don't match the new pattern. Are they orphans (no current rule derives them) or stable (the user just renamed the namespace; we should rewrite, not remove)?
- **Lossy ops + cleanup**: a `marker-only` rule produces `#-inbox` for every file under `Capture/Inbox/`. The user deletes a single file. The other files still produce `#-inbox`. Is the deleted file's tag-removal a no-op, or does it require checking whether any other file still produces the same tag?

### Side effects on the inverse direction

If the engine starts removing tags, does removing a tag from a file imply moving the file? The current `tag-to-folder` direction says "yes — adding a tag moves the file; removing it un-moves it." But:

- For lossy ops (`marker-only`), removing the tag has no clean inverse target.
- For bijective ops (`identity`), the inverse is well-defined but might surprise the user (delete `#projects/web/auth` and the file moves out of `Projects/`).
- For `cardinality: 'many:1'` rules, the relationship is asymmetric — removing one of N tags doesn't necessarily mean moving the file.

Today the inverse direction does not fire on tag *removal* — only on tag *addition*. Is that the right asymmetry, or should it be configurable?

## Research brief

The agent should:

1. **Pin definitions.** For both "orphan" and "relation tag," pick a definition (or sketch a hybrid). Justify against the alternatives. Use the SEACOW relation axis, the `TagVocabulary.authority` field, and frontmatter origin metadata as inputs.

2. **Walk through five concrete scenarios end-to-end.** For each: write the rule definitions, the initial vault state, the user action (delete folder / change rule / manually tag / rule overlap), and the proposed engine response under the new algorithm. Show what `removeOrphanedTags: true` and `keepRelationTags: true` actually do in each case.

3. **Design the orphan-detection algorithm.** Triggers (when does it run — on-event, on-vault-scan, on-rule-change?), inputs (rule set, folder structure, frontmatter origin if available), output (a list of (file, tag) pairs to remove). Pseudocode is fine.

4. **Design the relation-tag-protection algorithm.** Same structure. Pseudocode.

5. **Identify the minimum viable shipping form.** Not every possible orphan case needs to be handled in v1. Pick the 80% case (e.g., "user-deleted-folder cleanup with explicit confirmation") and defer the harder cases (multi-rule overlap, rule-pattern renames) with reasoning.

6. **Compose with related features:**
   - **Frontmatter memory**: if a tag has `ftsync.origin` metadata pointing to a folder that no longer exists, is the tag automatically an orphan? Does the algorithm change when frontmatter memory is enabled?
   - **The two-class problem**: how does the algorithm distinguish FTSync-derived tags from user-authored tags when origin metadata is *not* present?
   - **Inverse direction asymmetry**: should removing a derived tag also fire the inverse-direction rule (move the file)? Or never? Or behind a per-rule setting?

7. **Recommend UX.** Silent (engine just acts), notice (toast: "Removed 3 orphaned tags"), confirm (modal: "Remove these tags? [Yes / No]"), or per-rule (rule-author chooses). Justify with reference to the project's "user control" principle from the philosophy page.

## Candidate solution directions to evaluate

The agent should weigh at least these:

**Solution A — Authority-driven dispatch.** Use the existing `TagVocabulary.authority` field as the discriminator. `folder-authoritative` tags are managed by the engine (subject to orphan removal); `tag-authoritative` tags are user-owned (never touched); `mutual` tags require user confirmation on conflict. Strengths: uses existing typed field. Weaknesses: not all rules carry vocabulary metadata.

**Solution B — Origin-metadata dispatch.** Use frontmatter origin (the `ftsync.origin` field from the frontmatter-memory proposal) as the discriminator. Tags with origin metadata are derived; tags without are user-authored. Strengths: per-file precision. Weaknesses: only works if frontmatter memory is enabled; doesn't help legacy vaults.

**Solution C — Pattern-matching dispatch.** Run all current rules against all current files in dry-run; any tag that's not derivable from current config is an orphan. Strengths: doesn't require new metadata. Weaknesses: O(N×M) scan cost; can't distinguish "user authored a tag matching the rule's output pattern by coincidence" from "engine derived this tag and would derive it again."

**Solution D — Tag-source registry.** Maintain a separate registry (`data.json` field) tracking which tags were derived from which rules for which files. Pros: explicit. Cons: parallel state to maintain; can drift from frontmatter ground truth.

**Solution E — User-confirmation always.** Don't auto-remove anything; surface "X tags appear orphaned; review and remove?" in a settings flow. Pros: zero risk. Cons: doesn't scale to large vaults; defeats "automatic" sync.

**Solution F — Don't implement these fields.** Argue that the fields shouldn't exist; the engine should never remove tags it didn't just write; user-authored cleanup is a manual operation. Pros: simplest semantics. Cons: leaks tags over time; doesn't match user expectations of "clean up after itself."

For each candidate: rate complexity, user-control surface, performance, composability with frontmatter memory, and migration cost. Pick a winner; explain why.

## Deliverable

Short report (~1500–2500 words) at `zz-log/YYYY-MM-DD-challenge-08-findings.md`:

- The agent's chosen definitions for "orphan" and "relation tag" with justification
- The orphan-detection algorithm pseudocode
- The relation-tag-protection algorithm pseudocode
- Five walked-through scenarios with proposed engine responses
- Verdict on candidate solutions A–F (or a Solution G we missed)
- Recommended minimum viable shipping form for v1
- Composition analysis (frontmatter memory, two-class problem, inverse direction)
- Recommended UX with reasoning
- Open questions left unresolved

## Hand-off note

This challenge sits in the *runtime semantics* family — it's about what the engine actually *does* with tags, not about how rules are authored or matched. It composes downstream of Challenge 02 (reversibility), Challenge 07 (frontmatter memory), and the typed model's `cardinality`/`bijective` fields, but doesn't depend on any of them being shipped.

The agent should treat the two declared-but-not-implemented fields as a *gift* — they're a signal that someone (probably the original author) thought there was a problem to solve here but didn't pin the design. The agent's job is to pin the design before someone implements the wrong algorithm.
