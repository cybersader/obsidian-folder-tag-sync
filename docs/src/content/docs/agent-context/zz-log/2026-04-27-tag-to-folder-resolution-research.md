---
title: Tag → folder resolution — priority, specificity, and the inverse-direction problem
description: Substantive research on what determines which folder a tag maps back to. Surveys the current priority+first-match approach against six alternatives. Companion to the regex-vs-templates research; together they cover both directions of the abstraction question.
tags: [research, architecture, abstraction, inverse-direction]
sidebar:
  label: "04-27 · Tag→folder resolution"
  order: -20260427001
date: 2026-04-27
---

## Why this entry exists

The regex-vs-templates research (Part 1, Part 2) framed the **forward** direction — folder → tag. The inverse direction got mentioned but never investigated. This entry investigates it.

The user surfaced the gap directly: *"I had a priority system — but this isn't fundamental enough."* The instinct is right. The current `priority: number` field on rules is a thin scalar that the engine uses to break ties when more than one rule matches. It's not built to answer the actual question — *which folder should this tag's file live in?* — when several plausible answers exist.

This research takes that question seriously. It documents what the engine does today, surfaces the cases where the priority abstraction starts to leak, and surveys six alternative approaches with a recommended path forward.

Companion artifact: [Challenge 01 — Rule priority stress test](/obsidian-folder-tag-sync/agent-context/zz-challenges/01-rule-priority-stress-test/) already named the limitation and proposed three sketches (most-specific-wins, all-matching-fire, rule-groups). This entry builds on that — wider survey, cross-link to the regex-vs-templates question, and a concrete recommendation.

## The inverse-direction problem, in one diagram

When a user adds the tag `#auth` to a file, the engine has to pick a folder. If zero rules match the tag, no move happens. If exactly one rule matches, that rule's inverse-direction logic produces the destination. **If multiple rules match — and they often do** — the engine has to choose.

<figure aria-label="A vault has three folders all named Auth at different depths: Projects/Auth, Mobile/Auth, and Backend/Services/Auth. A single rule with an any-segment Auth pattern fires on all three forward, collapsing them to the tag #auth. The inverse direction, when a user adds #auth to a file, has three plausible destinations and no obvious way to pick. Today's engine picks first-by-priority; the question is whether that's the right primitive." style="margin: 1.5em 0;">
<div style="border: 1.5px solid currentColor; border-color: rgba(125,125,125,0.4); border-radius: 12px; padding: 1em 1.25em;"><div style="font-size: 0.7em; font-weight: 700; opacity: 0.6; letter-spacing: 0.1em; margin-bottom: 0.6em;">SAME NAME, DIFFERENT DEPTH &middot; the inverse-direction ambiguity</div><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1em;"><div style="border: 1.5px solid rgba(125,125,125,0.4); border-radius: 8px; padding: 0.7em 0.9em;"><div style="font-size: 0.78em; font-weight: 700; letter-spacing: 0.06em; opacity: 0.75; margin-bottom: 0.4em;">FORWARD &middot; folder &rarr; tag</div><pre style="margin: 0; font-family: ui-monospace, monospace; font-size: 0.85em; line-height: 1.55; padding: 0.5em 0.6em; background: rgba(125,125,125,0.1); border-radius: 4px; overflow-x: auto;">Vault/
&#9500;&#9472; Projects/<strong style="color: #c14a3f;">Auth</strong>/notes.md
&#9500;&#9472; Mobile/<strong style="color: #c14a3f;">Auth</strong>/notes.md
&#9492;&#9472; Backend/Services/<strong style="color: #c14a3f;">Auth</strong>/notes.md
       &darr;
       all match a permissive rule
       &darr;
       <strong style="color: #b87333;">#auth</strong></pre><div style="font-size: 0.82em; opacity: 0.78; margin-top: 0.5em; font-style: italic;">Forward direction: three distinct folders all collapse to one tag. (This is also the collision problem from Part 1.)</div></div><div style="border: 1.5px solid #b87333; border-radius: 8px; padding: 0.7em 0.9em;"><div style="font-size: 0.78em; font-weight: 700; letter-spacing: 0.06em; color: #b87333; margin-bottom: 0.4em;">INVERSE &middot; tag &rarr; folder &middot; ambiguous</div><pre style="margin: 0; font-family: ui-monospace, monospace; font-size: 0.85em; line-height: 1.55; padding: 0.5em 0.6em; background: rgba(125,125,125,0.1); border-radius: 4px; overflow-x: auto;">user adds <strong style="color: #b87333;">#auth</strong> to file.md
       &darr;
       which destination?
       &darr;
&#9500;&#9472; Projects/Auth/    ?
&#9500;&#9472; Mobile/Auth/      ?
&#9492;&#9472; Backend/Services/Auth/  ?</pre><div style="font-size: 0.82em; opacity: 0.78; margin-top: 0.5em; font-style: italic;">Inverse direction: one tag has three plausible homes. Today's engine picks the first-by-priority match silently. Is that the right primitive?</div></div></div></div>
</figure>

This is the question. The rest of this entry is six attempts to answer it.

## What the engine does today

A walkthrough of the actual code path, with file:line references.

**The rule type** (`src/types/settings.ts:42`):

```ts
priority: number;  // Lower number = higher priority
```

Every rule carries one integer. There's no separate specificity field, no group, no scope — just this one scalar.

**Forward and inverse matching** both run through `findBestMatch` in `src/engine/ruleMatcher.ts:97-117`:

```ts
export function findBestMatch(input, rules, context): RuleMatch | null {
  const matches = findMatchingRules(input, rules, context);
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    if (a.rule.priority !== b.rule.priority) {
      return a.rule.priority - b.rule.priority;
    }
    return b.confidence - a.confidence;  // tiebreak only
  });
  return matches[0];
}
```

Priority is the primary sort key; `confidence` (a heuristic specificity score) is the tiebreak. The function returns one rule.

**Inverse direction** (`src/sync/TagToFolderSync.ts:154-195`) iterates the file's tags and dispatches:

```ts
private async determineTargetFolder(tags: string[]): Promise<string | null> {
  for (const tag of tags) {
    const tagWithoutHash = tag.startsWith('#') ? tag.slice(1) : tag;
    const matchingRules = findMatchingRules(tagWithoutHash, this.settings.rules, {
      input: tagWithoutHash,
      matchType: 'tag',
      direction: 'tag-to-folder'
    });
    if (matchingRules.length > 0) {
      const { rule } = matchingRules[0];   // FIRST MATCH WINS
      const folderPath = await this.transformTagToFolder(tag, rule);
      if (folderPath) return folderPath;
    }
  }
  return null;
}
```

Note `matchingRules[0]`. The engine takes the first match and ignores the rest. **There is no multi-rule firing, no conflict prompt, no specificity-aware sort.** Whichever rule the user authored at the lowest priority number wins, regardless of how well its pattern actually fits the input.

**Inverse application** (`src/engine/applyTransfer.ts:254-295`) is mechanical: strip the tag entry, split into segments, run the inverse `TransferOp` (`identity`, `truncation/drop`, etc.), prepend `folderAnchor.under` if present, return a folder path. This is deterministic given a chosen rule. The non-determinism (or rather, the *unprincipled* determinism) is in *which rule gets chosen*.

**The conflict-detection machinery is already there but unused at runtime.** `findConflicts` at `src/engine/ruleMatcher.ts:122-153` groups same-priority matches and returns the groups. Today it's only consumed by the preview UI as a warning surface; the sync engine never reads it. This is a load-bearing observation for several of the alternatives below.

**Cardinality and bijection metadata exist but the engine ignores them.** `Cardinality = '1:1' | '1:many' | 'many:1'` and `bijective: boolean` are derived from the typed-spec semantics during rule pack load (`src/types/typed.ts:171, 245-247`). At runtime the sync engines consume Layer 1 (regex + transforms) only. The richer typed information is not yet feeding into resolution.

## Where the priority abstraction starts to leak

Four concrete cases where the current model produces the wrong answer or hides a real choice.

### "Most specific should win" intuition

Challenge 01 already named this. A user authors:

```
Rule 1 (priority: 10): tagPattern = "^projects/(.+)$"   →  Projects/$1
Rule 2 (priority: 20): tagPattern = "^projects/web/(.+)$"  →  Work/Projects/Web/$1
```

Rule 2 is *more specific* — it matches a narrower set of tags. A user adding `#projects/web/auth` to a file will, in their mental model, land at `Work/Projects/Web/auth`. The engine fires Rule 1 (lower priority number), produces `Projects/web/auth`, and Rule 2 never gets a turn. The user has to manually swap priorities to get the obvious answer. That's the friction.

The engine doesn't know what "more specific" means here. The pattern shape encodes specificity (Rule 2 has more literal text); the priority field doesn't read that.

### Polyhierarchy genuinely points to multiple folders

Sometimes a tag *should* resolve to multiple folders by intent. A user has:

```
Projects/Web/Auth/         ← #auth
Projects/Mobile/Auth/      ← #auth
Backend/Services/Auth/     ← #auth
```

These are three distinct project ancestries that all happen to deal with authentication. The user's mental model: each project's `Auth/` subfolder is its own scope. The same tag `#auth` is reachable from three places — that's polyhierarchy (multi-parent reachability) working as intended on the tag side.

When the user adds `#auth` to a file, where should it go? The engine today picks one (whichever rule was authored first at lowest priority) and silently moves the file. The other two folders never get a chance. **The engine is making a choice the user didn't make.**

### Asymmetric direction underspecification

Forward direction (folder → tag) is mechanical: a folder path is a fully-specified string; the engine matches it against rules and runs the transfer op. The pattern either fits or it doesn't.

Inverse direction (tag → folder) is *not* fully specified: a tag fragment carries less information than the folder path it came from (especially under lossy ops). One `#auth` doesn't carry "which Auth folder you came from"; that information was thrown away on the forward path. The engine picking a single answer pretends the inverse is well-defined when structurally it isn't.

This is the same asymmetry the [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) page enumerates: only `identity` and `truncation/drop` round-trip cleanly. Every other transfer op is many-to-one in some direction, which means the inverse is *genuinely* one-to-many and a single-destination resolution is hiding a real choice.

### SEACOW context-as-disambiguator (from the brainstorming log)

The user's brainstorming log raises the deeper version: in real knowledge work, the right destination for `#auth` depends on *who* is working and *what activity* they're doing — `#auth` in Cybersader's project context and `#auth` in Bob's project context shouldn't end up in the same folder. The user's SEACOW framework (System / Entity / Activity / Context / Output / Work) names these axes. Priority can't represent any of them.

The engine doesn't know who is working. It doesn't know what mode the user is in. The inverse direction's resolution today is global; in the user's mental model it should be local to the active context. That's the hardest version of the problem and the one the [brainstorming log](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) explicitly flags as a research-frontier idea.

## Evaluation criteria

Six dimensions to score the candidate approaches against. Picked to capture what actually breaks today and what the alternatives would buy.

- **Determinism.** Given the same tag and the same rule set, does it always resolve to the same folder? (Today's first-match: yes. "All rules fire": no, unless further constrained.)
- **Predictability.** Can the user mentally simulate the resolution before running it? (Today: only if they've memorized priority order.)
- **Authoring cost.** What does the user have to specify to get the resolution they want? (Today: every rule needs a manually-assigned priority number.)
- **Visibility.** Is the resolution path inspectable / explainable when it produces a wrong answer? (Today: the user sees the result, not the reasoning.)
- **Composability.** Can two third-party rule packs (PARA + JD) coexist without their inverse-direction rules colliding silently? (Today: imported packs need their priorities re-tuned by hand.)
- **Lossy honesty.** When a tag genuinely maps to a many:1 op, does the resolution acknowledge the inverse-direction ambiguity? (Today: silently picks one without flagging.)

## Six candidate approaches

Each approach gets: a JSON / code-shape sketch, a short walk-through of how the four leaks above are handled, and a tradeoff note.

### A. Status quo — priority + first-match-wins

Today's engine. `priority: number` per rule; sort matches ascending; take the first.

```json
{ "id": "para-projects", "priority": 10, "folderPattern": "...", "tagPattern": "..." }
```

**Walk-through:**
- "Most specific" leak: user manually re-orders priority numbers. Friction-heavy.
- Polyhierarchy: silent pick. Other folders never considered.
- Asymmetric underspecification: hidden behind the deterministic answer.
- SEACOW context: not represented. Same answer regardless of who's working.

**Verdict:** trivially deterministic and fast, but every leak above is unaddressed. Authoring cost grows with rule-set size. Doesn't scale to imported packs. Predictability requires memorizing the user's own priority assignments.

### B. Specificity-aware matching

Make pattern specificity the primary sort key; priority becomes the tiebreak. Rough scoring: count literal segments (more literals = more specific), inverse of slot count (fewer slots = more specific). Tied scores fall through to priority.

```ts
function score(rule: MappingRule): number {
  const literals = countLiteralSegments(rule.tagPattern);
  const slots = countCaptureGroups(rule.tagPattern);
  return literals * 100 - slots * 10;  // higher = more specific
}
matches.sort((a, b) => score(b.rule) - score(a.rule)
                      || a.rule.priority - b.rule.priority);
```

**Walk-through:**
- "Most specific" leak: directly fixed. Rule 2 (`^projects/web/`) outscores Rule 1 (`^projects/`).
- Polyhierarchy: still picks one, but picks the most specifically-fitting one. Better than first-by-author-order.
- Asymmetric underspecification: not addressed. Specificity gives a *defensible* answer but not necessarily the right one.
- SEACOW context: not represented.

**Tradeoff:** specificity is a heuristic; "longer regex" doesn't always mean "more specific intent." A regex with a literal long suffix can outscore a more genuinely-specific shorter pattern. Authoring cost stays low — the user doesn't write specificity scores; the engine derives them. Predictability is decent for users with PARA-shaped intuition.

### C. Rule groups + within-group priority

Challenge 01's proposal. Every rule belongs to a group (`para-projects`, `jd-areas`, etc.). Groups have a precedence order; within a group, rules are priority-sorted. Inverse resolution dispatches first by group fit, then within group.

```json
{
  "id": "para-projects",
  "group": "para",
  "priority": 10,
  "folderPattern": "...",
  "tagPattern": "..."
}
```

**Walk-through:**
- "Most specific" leak: partially addressed within a group; still requires user-assigned within-group priority.
- Polyhierarchy: groups carve the rule space so different organizational systems don't collide. PARA's projects rule and JD's projects rule live in different groups and don't see each other.
- Asymmetric underspecification: not addressed.
- SEACOW context: closer — groups can be tagged with axes (this group is the "by-project" axis; that group is "by-owner") but it's not built in.

**Tradeoff:** introduces a new concept users have to understand. Rule packs declare their group(s); cross-group conflicts get a clean answer (group order). Composability is the big win — installing PARA doesn't break JD because they live in disjoint groups.

### D. All-matching-rules-fire + conflict-resolution UI

Forward direction unchanged. Inverse direction collects every rule that matches, presents the user with the candidates, asks them to pick. The engine never makes a silent choice.

```ts
async resolveInverse(tag: string): Promise<FolderChoice> {
  const matches = findAllMatchingRules(tag);
  if (matches.length === 0) return { kind: 'no-rule' };
  if (matches.length === 1) return { kind: 'single', folder: derive(matches[0]) };
  return { kind: 'multiple', candidates: matches.map(derive) };
}
// Caller shows a modal; user picks; engine remembers choice for this tag pattern.
```

**Walk-through:**
- "Most specific" leak: presented as a choice. User sees both candidates and picks.
- Polyhierarchy: presented honestly. The engine surfaces "this tag could go to three places; pick one."
- Asymmetric underspecification: presented honestly. The user is the missing information.
- SEACOW context: the user's choice *is* the context.

**Tradeoff:** every multi-match becomes an interactive prompt. Bad for batch operations (drag a tag onto 50 files; you'd be prompted 50 times). The fix is "remember last choice for this tag" — but that introduces hidden state. Authoring cost: zero. Visibility: maximal. Determinism: lower (depends on user input).

### E. Slot-overlap-based resolution (lens-style)

Composes naturally with the path-template work proposed in [Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/). When rules carry path templates, slots that appear on both folder and tag sides round-trip; slots only on the folder side are lossy forward; slots only on the tag side are unsourced (config error). The inverse direction picks the rule whose tag template captures the most slots from the input tag.

```json
{
  "id": "para-projects-deep",
  "folderTemplate": "Projects/{project}/{section}/{file}",
  "tagTemplate": "#projects/{project}/{section}"
}
{
  "id": "para-projects-shallow",
  "folderTemplate": "Projects/{project}",
  "tagTemplate": "#projects/{project}"
}
```

For input tag `#projects/web/auth`:
- `para-projects-deep` captures `project=web, section=auth` — two slots filled.
- `para-projects-shallow` captures `project=web/auth` (or fails if `{project}` is single-segment) — one slot or no match.

Pick the candidate with the most filled slots. Specificity falls out of slot count automatically.

**Walk-through:**
- "Most specific" leak: solved by construction. Slot count *is* specificity.
- Polyhierarchy: still picks one rule; the choice is principled (most-slots-filled wins).
- Asymmetric underspecification: somewhat addressed — the engine knows when no rule's tag template covers all slots and can flag the rule pair as incomplete.
- SEACOW context: not directly, but slots can be SEACOW axes (`{owner}/{system}/...`) which makes the framework expressible.

**Tradeoff:** requires path templates to land first (Phase H). Authoring cost: low — once templates exist, slot-counting is automatic. Composability: excellent (slot count works across rule packs). Determinism: yes. Predictability: very good — users can read the templates and predict.

### F. Type-system / capability matching

Each rule declares typed inputs ("this rule applies to project tags only," "this rule applies to capture tags only"). Inverse resolution dispatches on the tag's declared type.

```json
{
  "id": "para-projects",
  "tagAxis": "by-project",
  "tagPattern": "..."
}
{
  "id": "para-areas",
  "tagAxis": "by-area",
  "tagPattern": "..."
}
```

**Walk-through:**
- "Most specific" leak: solved if axes are well-designed. Tag carries axis information (via prefix marker, structure, or explicit declaration).
- Polyhierarchy: addressed *within an axis* — `#by-project/web/auth` only matches by-project rules.
- Asymmetric underspecification: still present within an axis.
- SEACOW context: directly representable. Axes are the SEACOW dimensions.

**Tradeoff:** the heaviest authoring cost. Users have to think about axes upfront and decide which rules belong to which axis. Composability is good *if* multiple packs agree on axis vocabulary; bad if they don't (which they won't, in practice). Predictability: very high once the axes are stable. Determinism: yes.

### G. Probabilistic / heuristic with user confirm

Engine ranks candidates by heuristic (specificity, recency of last-used resolution, frequency of past resolutions, possibly ML-driven). Top match auto-applies; user can override; engine learns from overrides.

**Walk-through:**
- All four leaks addressed in the "average case" but not in the "first-time" case (no history yet).
- Determinism: low. Same tag at different points in time can resolve differently.
- Visibility: low — heuristic is opaque.

**Tradeoff:** runs counter to the project's deterministic philosophy ("Deterministic over AI" from `CLAUDE.md`). Compelling for advanced users; hostile to users who want predictability. Rejected on philosophy grounds.

## Cross-cutting comparison matrix

| Dimension | A: status quo | B: specificity | C: rule groups | D: conflict UI | E: slot-overlap | F: type system | G: probabilistic |
|---|---|---|---|---|---|---|---|
| **Determinism** | ★★★ | ★★★ | ★★★ | ★ (depends on user) | ★★★ | ★★★ | ★ |
| **Predictability** | ★★ (memorize priority) | ★★★ | ★★★ | ★★★ (you saw the choice) | ★★★ | ★★★ | ★ |
| **Authoring cost** | ★ (manual priority) | ★★★ (automatic) | ★★ (declare group) | ★★★ (zero) | ★★★ (templates only) | ★ (axis upfront) | ★★★ (zero) |
| **Visibility** | ★ | ★★ | ★★ | ★★★ | ★★★ | ★★★ | ★ |
| **Composability** | ★ (clashes silently) | ★★ | ★★★ | ★★★ | ★★★ | ★★ | ★★ |
| **Lossy honesty** | ★ (silent) | ★ (silent) | ★★ (group flags) | ★★★ (interactive) | ★★ (slot warns) | ★★ (axis warns) | ★ |
| **Verdict** | replace as primary | adopt as default | layer on B | future UX layer | adopt with templates | defer | reject |

## Recommendation

**Adopt B + C as the new default.** Specificity-aware matching becomes the primary sort key (longest-pattern-wins via slot/literal scoring); rule groups become the composability story for third-party packs. Priority becomes the *manual override* — used only when the heuristic gets it wrong.

**Defer D (conflict-resolution UI) to Phase H+.** It's the right answer for genuinely ambiguous cases, but it's a UX feature on top of the resolution engine. Once B+C lands, the residual cases that need D become rarer and easier to scope.

**Defer E (slot-overlap) until path templates land.** It composes with B+C — when templates arrive, slot-count becomes the cleanest specificity heuristic. Until then, regex-shape-derived specificity is the bridge.

**Defer F (type system) indefinitely.** Too much authoring cost without proportionate user benefit; revisit if SEACOW axis-typing becomes a hard requirement.

**Reject G (probabilistic).** Determinism is a project value, not just a default.

## Why this confirms the user's "priority isn't fundamental enough"

Priority is a flat scalar that conflates two distinct concepts:

- **Specificity** — which rule's pattern best fits the input. This is computable from rule shape; the engine can derive it.
- **User override** — which rule should win when specificity is genuinely ambiguous. This is the user's domain; the engine can't derive it.

Today's `priority: number` smushes both into one knob. Splitting them — specificity becomes derived, priority becomes override — is the load-bearing change. The user's instinct that priority isn't fundamental enough was exactly this: the field is doing two jobs at once and doing both badly.

## Connection to the regex-vs-templates research

The forward direction (folder → tag) and the inverse direction (tag → folder) are *not symmetric problems*. Forward is well-defined: a folder path is fully specified, and the rule pattern either fits or doesn't. Inverse is structurally underspecified for any non-bijective transfer op.

The regex-vs-templates research focused on the forward direction's authoring abstraction — what shape should rules be authored in. This research focuses on the inverse direction's resolution abstraction — what should the engine do when several plausible answers exist.

These compose. The recommended path:

1. **Now**: implement specificity-aware matching (candidate B) using regex-shape scoring. This works without any change to the rule format and addresses Challenge 01's "most specific should win" case immediately.
2. **Phase H**: when path templates land, switch the specificity scoring to slot-count (candidate E). This is a strict improvement — slot count is a more honest specificity metric than regex-shape heuristics.
3. **Phase H+**: layer rule groups on top (candidate C) for composability across third-party packs.
4. **Future**: conflict-resolution UI (candidate D) for the residual ambiguous cases. This is the UX layer that makes lossy-honesty visible to the user.

## Open questions for follow-up

- **Specificity scoring formula.** Literal-segment count, slot-count inverse, or a hybrid? How do we score `^Projects/.+$` (one literal, anonymous capture) vs `^Projects/web/.+$` (two literals, anonymous capture) vs `Projects/{slug}` (one literal, named slot)? Worth a smaller exploration before committing.
- **Group declaration syntax.** New top-level `group` field per rule, inferred from rule pack ID (`para.json` → group `para`), or a separate `groups: [...]` block at the pack top? Ergonomics question.
- **Migration story.** Existing rules have priority numbers but no specificity data. Do we backfill specificity scores from current patterns and preserve priority as override? Or run priority-only for legacy rules and specificity for new?
- **When does "most specific" disagree with "user intent"?** A small audit of real-world rule packs (PARA, JD, SEACOW-cyberbase) to see if specificity-derived ordering matches the priority-numbers users authored manually. If yes, the migration is invisible. If no, we have a mismatch to surface.
- **The "remember last choice" question for candidate D.** If/when a conflict UI lands, is there hidden state? Per-tag remembered choice? Per-tag-pattern? Per-session? The simplest version (no memory, ask every time) is annoying; the most sophisticated (per-tag with global override) is hidden state.

## Related concepts

- [Challenge 01 — Rule priority stress test](/obsidian-folder-tag-sync/agent-context/zz-challenges/01-rule-priority-stress-test/) — the specific case this research generalizes
- [Challenge 04 — Name collisions across hierarchy](/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/) — the same-name-different-depth visualization the diagram above illustrates
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — *which* transfer ops produce inverse-direction ambiguity, and why
- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives that produce the lossy directions
- [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — the forward-direction abstraction question
- [Path abstractions, part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — concrete code, hybrid coexistence, slot semantics
- [Solution brainstorm](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) — the meta-shape of FTSync; SEACOW context-as-disambiguator
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
- [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — typed-model layers and why determinism is non-negotiable
