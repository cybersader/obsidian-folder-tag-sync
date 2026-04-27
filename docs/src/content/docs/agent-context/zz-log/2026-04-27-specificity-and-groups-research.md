---
title: Specificity-aware matching + rule groups — the deep dive
description: Combined research on candidates B (specificity-aware matching) and C (rule groups) from the tag → folder resolution research. Surveys prior art (CSS specificity, web framework route precedence, Kubernetes namespaces, CSS @layer, AWS IAM), evaluates scoring formulas and group-declaration shapes, walks the combined algorithm against Challenge 01 and Challenge 04, and lays out the migration + implementation surface.
tags: [research, architecture, specificity, groups, phase-h]
sidebar:
  label: "04-27 · Specificity + groups"
  order: -20260427003
date: 2026-04-27
---

## Where this entry picks up

The [tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) surveyed six approaches to picking a folder when a tag could resolve to several. The recommendation was **B + C combined**: specificity-aware matching as the default sort key, with rule groups as the composability story for third-party packs. Priority becomes the manual override.

This entry is the deep dive on that combined recommendation. Same shape as Part 1 / Part 2 / the tag → folder research. The recommendation isn't open here — we know we want B+C — so the work is mapping concrete shapes (scoring formulas, group syntax) against well-explored prior art and producing a defensible implementation plan.

## What's already in the codebase

The audit that landed in the previous entry's follow-up surfaced one important fact: **specificity scoring is already partially implemented.**

`calculateMatchConfidence` at `src/engine/ruleMatcher.ts:156-185` produces a `0..1` score from a regex pattern. It accounts for:

- Wildcard count (`.*` and `.+`): each reduces confidence by 0.1
- Question-mark count (`?`): each reduces by 0.05
- Length ratio of input-to-pattern: contributes up to +0.2
- Slash count: contributes +0.05 per `/`
- Exact-match shortcut: full string match short-circuits to maximum confidence

The score is used as the **tiebreaker after priority** in `findBestMatch` (`ruleMatcher.ts:108-114`). When two rules have identical priority, the higher-confidence rule wins. When priorities differ, confidence is ignored.

This means **landing candidate B is potentially a one-line change** — flip the sort order in `findBestMatch` so confidence is the primary key and priority is the tiebreak. The scoring math doesn't need to be rewritten; it needs to be *promoted*.

Also worth noting from the audit:

- First-match-wins is symmetric. `FolderToTagSync.ts:55` and `TagToFolderSync.ts:154-195` both take `matchingRules[0]`. The same priority machinery runs in both directions.
- `findConflicts` (`ruleMatcher.ts:122-153`) already groups same-priority matches but is only consumed by the preview UI as a warning. It's not used to *resolve* conflicts at sync time.
- A `rule.priority < 0` special case at `ruleMatcher.ts:238` exists in the validation path. Negative priority signals "this is a system-emitted internal rule," not user-authored — the loader exempts it from some validations. Worth respecting in the new algorithm.

The recommendation throughout the rest of this entry is "promote and refine what exists, then add groups," not "build from scratch."

## Part B — Specificity-aware matching, deep dive

### What `calculateMatchConfidence` does well

The current heuristic is more sophisticated than a plain literal-character count. It explicitly accounts for:

- **Wildcards weaken specificity.** A pattern with three `.*`s scores lower than one with no wildcards. Aligns with intuition.
- **Length ratio captures "how much of the input the pattern accounts for."** A pattern that fully covers the input scores higher than one that matches a small slice.
- **Slash count captures path-segment depth.** A pattern with three slashes (matching three-deep paths) scores higher than one matching a single segment.

For canonical PARA / JD shapes, the heuristic produces sensible orderings.

### What it doesn't do well

The breakage cases:

- **"Longer regex" doesn't always mean "more specific intent."** A regex with a long alternation `(foo|bar|baz|qux|...)` scores high on length but is *less* specific than a single literal segment. The current formula doesn't penalize alternation.
- **Anchor awareness is implicit at best.** Two patterns differing only in anchor (`^foo` vs `(?:^|/)foo` vs `^prefix/foo`) score similarly under the current formula, but their actual specificity is wildly different. Phase G's anchor types should feed in explicitly.
- **Slot-count proxy is missing.** When path templates land (Phase H), slot count *is* specificity in a clean way — `{slug}` is one slot wide; `{rest...}` is N slots. Today's regex-shape heuristic can't see slots.
- **Tied scores are common.** Two rules with the same wildcard count, similar slash count, similar length will tie on confidence and fall back to priority anyway. The tie rate is high enough that priority still ends up doing real work — which means the heuristic isn't doing as much disambiguation as it could.

### Prior art — how other systems score specificity

Specificity is a solved problem in several domains. Each has a different shape relevant here.

**CSS selector specificity** (the most-cited specificity algorithm anywhere). Selectors get a tuple `(a, b, c, d)` where `a` = inline-style flag, `b` = ID-selector count, `c` = class/attribute/pseudo-class count, `d` = element-selector count. Selectors compare lexicographically: `a` first, then `b`, etc. This is a *layered* specificity — different kinds of selectors live in different categories and the categories have a fixed precedence. The cascade further uses (origin, @layer, specificity, source-order) as the resolution algorithm. Worth borrowing: separating *kinds* of pattern features into categories with hard precedence, rather than collapsing everything to one scalar.

**Express.js routing** (the canonical "order matters" framework). No specificity scoring; routes match in declaration order. First match wins. This is what FTSync looks like today (priority is just a way to declare order without rewriting the rule list). The Express ecosystem has whole libraries (path-to-regexp, route-parser) for parsing routes but no built-in specificity scoring.

**Next.js routing** (file-system-derived precedence). Static segments (`/users`) > dynamic segments (`/[id]`) > catch-all segments (`/[...slug]`) > optional catch-all (`/[[...slug]]`). The categories are baked in; within a category, source order applies. Borrowed insight: a small number of *kinds of segment* with hard precedence is cleaner than a continuous score.

**TanStack Router** (explicit specificity score). Routes get a numeric score derived from segment kinds (literal: high, parameter: medium, splat: low) and segment count. Higher score wins. Borrowed insight: a single integer is fine if the formula is honest about what dominates (literal beats dynamic; depth matters within a kind).

**FastAPI / Starlette** (declaration order, with explicit warnings). Like Express. The framework's docs explicitly call out the gotcha: declare more-specific paths first or you get the wrong handler. The fact that they *document this as a gotcha* is informative — it's a usability problem.

**React Router v6** (weighted scoring). Routes get scored using a formula that weights literal segments (worth +10), dynamic segments (+3), splats (+1), and a small adjustment for index routes. The router sorts by score. Cleaner than Express's order-based approach; closer to TanStack's scoring.

**OpenAPI 3 path matching** (specifications without implementations). The spec says paths should be matched "by specificity" without defining the algorithm; in practice, gRPC-HTTP-transcoding and other implementations use literal-prefix-length + segment-count.

**HTTP frameworks generally** converge on this principle: literal segments dominate dynamic segments; longer matches dominate shorter; ties fall back to source order. Most differ only in the exact numeric weights.

### Scoring formula proposals

Given the prior art, three candidate refinements to `calculateMatchConfidence`. All preserve the existing 0..1 output range so the migration doesn't break the tiebreaker contract.

**Formula 1 — Literal-segment count (Next.js-style category precedence).**

Tokenize the regex into segments by splitting on `/`. For each segment:

- Pure literal (no special chars): contributes 100 points
- Literal with character class (e.g. `[a-z]+`): 50 points
- Single-segment slot (`[^/]+`, `(?<name>[^/]+)`): 10 points
- Multi-segment glob (`.+`, `.*`): 1 point

Sum, normalize by max-possible-for-pattern-length, clamp to 0..1. **Strengths**: matches Next.js intuition; ties are rare. **Weaknesses**: requires regex tokenization that's robust to user-authored patterns; alternations and lookaheads need handling.

**Formula 2 — Tuple-based categorical score (CSS-style).**

Compute three counts per pattern:

- `(literals, slots, wildcards)` — number of each kind of segment
- Anchor flag: `+10` for root-anchored, `+5` for under-prefix, `+0` for any-segment

Compare lexicographically: literal count first, then slot count (more = less specific, so subtract from a max), then wildcards. **Strengths**: clearest mental model; mirrors CSS specificity. **Weaknesses**: doesn't squash to a 0..1 scalar without lossy collapse; sort comparator needs to handle tuples.

**Formula 3 — Hybrid weighted (the practical default).**

Refine the existing formula:

```ts
function calculateMatchConfidence(input: string, pattern: string, anchor?: FolderAnchor): number {
  let confidence = 0.5;

  const literalChars = countLiteralChars(pattern);
  const wildcards = (pattern.match(/\.[*+]/g) ?? []).length;
  const namedSlots = (pattern.match(/\(\?\<\w+\>/g) ?? []).length;
  const segments = pattern.split('/').length;

  // Heavier penalties for wildcards (was 0.1; bump to 0.15)
  confidence -= wildcards * 0.15;
  // Lighter penalty for slots (named or anonymous)
  confidence -= namedSlots * 0.05;
  // Length-of-literal bonus (was already there; refine)
  confidence += Math.min(literalChars / 50, 0.3);
  // Slash count (was already there; preserve)
  confidence += segments * 0.04;
  // Anchor bonus — root-anchored is more specific
  if (anchor === 'root') confidence += 0.1;
  if (typeof anchor === 'object' && anchor.under) confidence += 0.08;

  return Math.max(0, Math.min(1, confidence));
}
```

**Strengths**: smallest delta from existing code; preserves the tiebreaker semantics; anchor-aware. **Weaknesses**: still a single scalar with continuous values, so ties remain possible.

**Recommendation**: start with Formula 3 (smallest migration), audit it against shipped rule packs, and consider Formula 1 or 2 if Formula 3's tie rate is too high in practice.

### Walk-through against Challenge 01

Challenge 01's stress case:

```
Rule 1 (priority: 10): tagPattern = "^projects/(.+)$"
Rule 2 (priority: 20): tagPattern = "^projects/web/(.+)$"
```

User adds `#projects/web/auth` to a file.

**Today** (priority sort, confidence tiebreak): Rule 1 fires (priority 10 < 20). User has to manually swap priorities.

**Under candidate B with Formula 3** (confidence sort, priority tiebreak):

- Rule 1 score: ~0.65 (one literal segment "projects", one wildcard, root-anchored, 2 slashes)
- Rule 2 score: ~0.78 (two literal segments "projects/web", one wildcard, root-anchored, 3 slashes)

Rule 2 wins. Matches user intuition. Priority is no longer needed for this case.

If the user *does* want Rule 1 to fire even though Rule 2 is more specific (rare, but possible — maybe Rule 1 is a temporary migration override), they can set Rule 1's priority lower than Rule 2's, and the priority tiebreak keeps Rule 1 winning.

## Part C — Rule groups, deep dive

### What problem groups solve

Specificity-aware matching (B) handles within-pack rule disambiguation. But it doesn't handle cross-pack collisions. Concretely: install a third-party PARA pack and a third-party JD pack, and their rules will silently compete. PARA's `^Projects(?:/|$)` and JD's `^\d{2} - [^/]+(?:/|$)` won't match the same paths usually — but they could, and the user has no clean way to declare "PARA owns the Work axis; JD owns the enumerative-numbering axis."

Groups are the partition mechanism. Each rule belongs to a group; resolution dispatches first by group fit, then within group.

### Prior art — how other systems handle namespace / layer / group precedence

**CSS `@layer`** (added in CSS Cascade Level 5). Authors declare layer order:

```css
@layer base, components, utilities;

@layer base { ... }
@layer components { ... }
@layer utilities { ... }
```

The cascade resolves (origin, layer, specificity, order) in that priority. *Layers fully precede specificity* — a low-specificity rule in a later layer beats a high-specificity rule in an earlier layer. This is the cleanest precedent: the precedence is a hard partition, not a heuristic.

**Kubernetes namespaces.** Hard partition: `default/my-pod` and `kube-system/my-pod` are entirely separate objects. Cross-namespace access requires explicit FQDN. There's no "fall back to the other namespace if this one doesn't have it" — namespaces are walls, not layers. Strong precedent for "groups are walls" if we want full isolation.

**AWS IAM policy evaluation.** Multiple policy types (identity-based, resource-based, SCP, permissions boundaries) compose with explicit precedence: explicit DENY beats explicit ALLOW beats implicit DENY. The precedence is documented, the categories are fixed, but the resolution is *combinatorial* — every applicable policy is evaluated, and the result is the combination. This is more like candidate D (all-rules-fire with conflict resolution) than C (group precedence). Worth knowing about, not directly portable.

**Tailwind CSS layer system.** Three layers: `base`, `components`, `utilities`. Each has documented purpose. Users can author in any layer with `@layer` directives. Resolution: utilities beats components beats base (in the cascade). This is CSS `@layer` applied as design discipline.

**npm scoped packages** (`@org/pkg`). Naming convention partitions into namespace + name. No precedence rule between scopes — they're partitions, not layers. Useful precedent for the *naming* convention but not for the *precedence* algorithm.

**ESLint configuration cascade.** Configs cascade through `extends`, with later configs overriding earlier. Within a config, `overrides` blocks scope rules to file patterns. Resolution is order-based with explicit override declarations. Closer to today's FTSync priority than to layered precedence; useful as a "what not to do" example for the migration story.

**dbt schemas / dbt packages.** Schemas partition data by source; packages partition macros. Resolution within a schema is by name; cross-schema access requires explicit qualification. Like Kubernetes namespaces — partitions, not layers.

### Synthesizing the prior art

Two clean models for what groups should be:

- **Layers (CSS @layer style)**: groups are ordered; rules in a later group beat rules in an earlier group regardless of specificity within. *Hard precedence, no fall-through.*
- **Namespaces (Kubernetes / dbt style)**: groups are walls; rules in different groups don't compete. Resolution requires the input to declare which namespace it's in. *No precedence; requires explicit dispatch.*

For FTSync, **layers** are the better fit because:

- Tags don't carry an explicit "namespace" declaration. A user adding `#projects/web/auth` doesn't say "evaluate this against the PARA namespace specifically."
- The PARA / JD / SEACOW packs *do* have implicit precedence: SEACOW outer beats PARA when both match. Layered precedence captures this directly.
- Cross-pack composition without layered precedence requires the user to manually order rules — same problem as priority today.

So: **groups are layers, not namespaces.**

### JSON shape options

Three candidates for declaring groups in rule-pack JSON:

**Option α — Flat field per rule:**

```json
{
  "id": "para-projects",
  "group": "para",
  "priority": 10,
  "folderPattern": "...",
  "tagPattern": "..."
}
```

Strengths: minimal addition; easy to migrate (every rule gets one new field); rule-pack authors see the group on every rule. Weaknesses: each pack has to declare its group on every rule; loader has to validate that all rules in a pack have the same group.

**Option β — Pack-level declaration:**

```json
{
  "packId": "para",
  "group": "para",
  "groupPrecedence": 10,
  "rules": [
    { "id": "para-projects", "priority": 10, "..." },
    { "id": "para-areas", "priority": 20, "..." }
  ]
}
```

Strengths: declared once per pack; group + precedence travel together; layer ordering is visible at the pack level. Weaknesses: requires the pack-level structure to carry through to in-memory rules; users importing rules into the typed editor see implicit groups.

**Option γ — Inferred from pack ID:**

The loader uses the pack's filename or ID as the group; no explicit field needed. `para.json` → group `para`; `seacow-cyberbase.json` → group `seacow-cyberbase`.

Strengths: zero authoring cost; existing packs work immediately. Weaknesses: pack authors who want to override the inferred group can't; group precedence still needs explicit declaration somewhere.

**Recommendation**: **β + γ combined.** Default groups come from pack ID (γ). Pack-level declaration (β) is optional for explicit override and required when the user wants a custom precedence. Per-rule `group` field is supported but discouraged as authoring convention (only used when one pack has rules that genuinely belong to different groups).

### Cross-group precedence — how the layer ordering gets defined

Three candidates for *who decides* the layer order:

**Sub-option 1 — User-defined.** A settings-level config: `groupPrecedence: ['seacow', 'para', 'jd']`. The user re-orders this list in the settings UI. Hardest authoring cost; most flexibility.

**Sub-option 2 — Pack-declared.** Each pack declares its own precedence number. Loader sums or sorts. *Tradeoff*: packs from different authors may not agree; precedence collisions need resolution.

**Sub-option 3 — Axis-derived.** Groups are tied to SEACOW axes; the axis ordering (`system > entity > capture > work > output > relation`?) drives precedence. Zero authoring cost; constrained but principled.

**Recommendation**: **sub-option 1 + sub-option 3 combined.** Default group precedence comes from SEACOW axes when packs declare an axis (sub-option 3). User can override the order in settings (sub-option 1). Pack-declared precedence is supported but *not* the default — too easy for third-party packs to fight each other.

### How groups compose with SEACOW axes

The brainstorming log raises this question explicitly. Two stances:

- **Groups are axes.** Every group corresponds to one SEACOW dimension. Group precedence = axis precedence. *Pro*: makes the SEACOW-as-disambiguator instinct concrete. *Con*: locks the group abstraction to SEACOW; non-SEACOW packs need a workaround.
- **Groups are orthogonal to axes.** A group can carry an axis as metadata (most do), but groups can also be "PARA" or "JD" or "MyCustomPack" without being any single axis. *Pro*: SEACOW remains optional. *Con*: precedence becomes harder to derive without explicit user config.

**Recommendation**: groups are orthogonal to axes (the second stance). Axis metadata on a group enables axis-derived precedence (sub-option 3 above) when present, but isn't required. This gives the simplest path forward without committing to SEACOW as the universal axis system.

## The combined B+C resolution algorithm

Pseudocode for the new `findBestMatch`:

```ts
function findBestMatch(input, rules, context): RuleMatch | null {
  const matches = findMatchingRules(input, rules, context);
  if (matches.length === 0) return null;

  // 1. Group by group; sort groups by precedence (highest first).
  const byGroup = groupBy(matches, m => m.rule.group ?? '__default__');
  const groupsInOrder = Array.from(byGroup.keys()).sort(
    (a, b) => groupPrecedence(b) - groupPrecedence(a)
  );

  // 2. Within the highest-precedence non-empty group:
  for (const groupName of groupsInOrder) {
    const groupMatches = byGroup.get(groupName)!;

    // 3. Sort by specificity (descending), then by priority (ascending), then by source order.
    groupMatches.sort((a, b) => {
      if (a.confidence !== b.confidence) return b.confidence - a.confidence;
      if (a.rule.priority !== b.rule.priority) return a.rule.priority - b.rule.priority;
      return a.sourceOrder - b.sourceOrder;
    });

    return groupMatches[0];
  }

  return null;
}
```

The algorithm:

1. **Partition matches by group.** Highest-precedence group wins outright.
2. **Within the winning group**, sort by confidence (specificity-aware), then priority (manual override), then source order (tiebreak of last resort).
3. **The first match in the sorted list is the answer.**

Priority is now a tertiary signal — only meaningful when (a) two rules tied on confidence, AND (b) the user explicitly assigned different priorities. Most rules will leave priority at the default and let confidence drive the answer.

### Walk-through — Challenge 01 stress test

The case from above. Two PARA rules in the same group:

- Rule 1: `^projects/(.+)$`, priority 10, group `para`, confidence ~0.65
- Rule 2: `^projects/web/(.+)$`, priority 20, group `para`, confidence ~0.78

User adds `#projects/web/auth`. Both match. Group sort: only `para` group. Within group: confidence sort puts Rule 2 first. **Rule 2 wins.** Priority of 20 is ignored because confidence already disambiguated.

### Walk-through — Challenge 04 same-name-different-depth

Three folders all named `Auth/` at different depths. Rules:

- Rule X: `^Projects/Auth(?:/|$)`, group `para`, confidence ~0.85
- Rule Y: `(?:^|/)Auth(?:/|$)`, group `legacy`, confidence ~0.45
- Rule Z: `^Backend/Services/Auth(?:/|$)`, group `backend`, confidence ~0.92

User adds `#auth` to a file. All three rules match the tag.

Group sort assumes `backend` and `para` and `legacy` have a precedence — say `backend > para > legacy` because backend is more specific in the user's mental model. The algorithm picks the highest-precedence group with matches: `backend`. Within: only Rule Z. **Rule Z wins.**

If `backend` had no matches, the algorithm falls through to `para`, then `legacy`. The user's group ordering is the wall; specificity refines within.

## Edge cases

The algorithm has to handle gracefully:

- **All matches in same group.** Most common case. Confidence + priority + source order resolves it. ✓
- **Matches in multiple groups, all with same precedence.** Tiebreak on group name (alphabetical), then within-group confidence. Rare but possible. ✓
- **No matches in any group.** Return `null`, same as today.
- **Ungrouped legacy rules.** Default group `__default__` with lowest precedence, so ungrouped rules only fire when no grouped rule matches. Migration-friendly.
- **Negative-priority rules** (the `rule.priority < 0` system-emitted case). Honored as today; the new algorithm uses priority as a tiebreak, so negative values still work the same. ✓
- **Specificity-tied matches across groups.** Group precedence wins. The within-group score is irrelevant when crossing group boundaries.
- **Future template rules in a regex pack** (Phase H coexistence). Templates compute slot count as the natural specificity score; regex rules use `calculateMatchConfidence`. Both produce 0..1 numbers; comparison works across shapes.

## Migration story

How shipped rule packs and existing user configs migrate without breaking.

**Existing rules without `group` field**: assigned to `__default__` group with lowest precedence. They continue to fire when nothing else matches; behavior unchanged for users who don't install grouped packs.

**Shipped rule packs (PARA, JD, SEACOW-cyberbase)**: get explicit groups in their JSON (`group: "para"`, `group: "jd"`, `group: "seacow"`). Default precedence derived from SEACOW axis declarations; user can override.

**Per-rule priority**: preserved as the manual-override tiebreak. No migration UI needed; existing priority numbers continue to work, they just have less load to bear.

**Settings UI**: the rule editor's priority field gets a label change from "Priority" to "Priority (override)" with a tooltip explaining "specificity is the default; use priority to manually override." Existing priority values stay valid.

**Audit step before landing**: run the new specificity formula against shipped packs and compare the implied ordering to the user-authored priorities. If the orderings agree on >80% of within-group rules, the migration is invisible. If they disagree, surface the disagreements to the pack authors and let them decide whether to swap to specificity-derived order or keep priority.

## Implementation surface — file-by-file

What actually changes in `src/`:

- **`src/types/settings.ts`** — add `group?: string` to `MappingRule` (optional; backwards-compatible).
- **`src/types/typed.ts`** — add group field to `TypedRuleSpec` for derivation. Add `groupPrecedence` config (probably in settings, not per-rule).
- **`src/engine/ruleMatcher.ts`** — `findBestMatch` reorders to group-by + within-group-sort. `calculateMatchConfidence` refined per Formula 3 (anchor-aware bonuses). Probably ~50 LOC of changes.
- **`src/engine/rulePackLoader.ts`** — validate `group` field; default group from pack ID if missing.
- **`src/sync/FolderToTagSync.ts`, `src/sync/TagToFolderSync.ts`** — no change; both already call `findBestMatch` (or first-match equivalent), so the new resolution is transparent.
- **`src/ui/SettingsTab.ts`** — new section for group precedence; drag-to-reorder list of declared groups.
- **`src/ui/RuleEditorModal.ts`, `src/ui/GuidedRuleEditorModal.ts`** — add group dropdown (defaults to pack-derived group). Priority field gets the override-tooltip rename.
- **`rule-packs/*.json`** — add `group` field to each rule (or pack-level group declaration). One commit per pack.
- **Tests**: extend `ruleMatcher.test.ts` with the Challenge 01 and Challenge 04 walk-throughs; verify backwards compatibility of ungrouped rules.

Estimated scope: ~150 LOC of new + edited code; ~30 LOC of tests; small touches in 6 UI files. Substantially smaller than Phase H.

## Open questions

- **Specificity formula audit.** Formula 3 is the recommendation, but the *real* question is whether its derived ordering matches user-authored priorities on shipped packs. Worth a small audit script before committing to the formula.
- **Tied confidence + tied priority — does source order work as the deepest tiebreak?** Today's engine doesn't have a stable source-order concept (rule order in settings is the closest thing). Adding it as a tiebreak is straightforward but worth being explicit.
- **Cross-group precedence config UI.** Drag-to-reorder in settings is the obvious UX, but there's a question of whether it's per-vault config or per-pack-author config. The recommendation is per-vault; pack authors suggest defaults, users override.
- **Template + regex coexistence in same group.** When templates land (Phase H), a group might mix shapes. The specificity formula has to handle both. Slot-count for templates, `calculateMatchConfidence` for regex; both produce 0..1; the rest of the algorithm doesn't care.
- **Negative priority semantics.** Today's `rule.priority < 0` gates some validations but doesn't change resolution. Should it also gate the override behavior — i.e., negative-priority rules are *always* tiebreak-only, never primary-sort? Probably yes, but worth pinning.
- **Where does the recommendation diverge from CSS @layer?** CSS @layer is order-defined-once-per-document; FTSync's group precedence is config-defined per-vault. The CSS analogy holds for the *concept* (layer beats specificity) but not the *config story*. Worth being explicit about this so future agents don't import CSS-cascade folklore where it doesn't apply.

## Order of operations

Recommended phasing for implementation:

1. **Refine `calculateMatchConfidence`** with anchor-awareness (Formula 3). Pure refactor; no behavior change because the score is still only the tiebreak. Lands first; gives confidence the formula is sane.
2. **Audit shipped rule packs.** Run the new formula against PARA, JD, SEACOW-cyberbase; compare to user-authored priorities. Surface any disagreements.
3. **Swap sort order in `findBestMatch`** (confidence becomes primary, priority becomes tiebreak). This is the candidate B landing. Tests cover Challenge 01 and the inverse-direction cases.
4. **Add `group` field to types.** Optional; defaults to `__default__`; loader-validated.
5. **Backfill `group` on shipped rule packs.** PARA → `para`, JD → `jd`, SEACOW → `seacow`. One commit per pack.
6. **Add group-precedence config + settings UI.** Drag-to-reorder; default order derived from SEACOW axes when groups declare axes.
7. **Promote priority to "override" framing in UI.** Tooltip change + minor relabeling. No code-path change.
8. **Documentation sweep.** Concept page on rule groups; update philosophy / terminology / when-to-use-regex; cross-link from this research entry to the new concept page once it lands.

Phase 1–3 lands the candidate-B improvement without any user-visible change in rule-pack format. Phase 4–7 is candidate C; users see the group field but ungrouped rules still work. Phase 8 is documentation. Each phase is a separate commit (or small commit series) with passing tests before merge.

## Related concepts

- [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — the broader survey this entry is the deep dive on
- [Challenge 01 — Rule priority stress test](/obsidian-folder-tag-sync/agent-context/zz-challenges/01-rule-priority-stress-test/) — the specific case the algorithm handles
- [Challenge 04 — Name collisions across hierarchy](/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/) — the same-name-different-depth case
- [Solution brainstorm](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) — SEACOW context-as-disambiguator framing; informs the group-precedence story
- [Path abstractions, part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — hybrid coexistence; informs the regex+template-in-same-group edge case
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — what determinism, lossy/lossless, and round-trip mean per transfer-op
- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives the algorithm composes against
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
