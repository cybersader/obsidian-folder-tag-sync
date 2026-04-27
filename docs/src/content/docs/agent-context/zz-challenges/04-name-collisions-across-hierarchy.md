---
title: "Challenge 04: Same name, different layer, different meaning"
description: A folder named `10 - Projects` at vault root is NOT the same thing as `Entity/Cybersader/10 - Projects` — but the JD pack's pattern matches both. How should the system disambiguate semantically identical leaves at different hierarchy positions?
tags: [research, architecture, first-principles, phase-h]
sidebar:
  label: "04 · Name collisions"
  order: 4
---

## Assumption under test

Today, a rule's identity is its **pattern**. The JD pack ships with `folderPattern: '^\\d{2} - [^/]+(?:/|$)'` and (after Phase G) optional `folderAnchor`. The pattern says *what shape of folder name to match*. The anchor says *where in the path to match*. Both are static.

This implies that two folders with the same leaf name — say `10 - Projects` at vault root and `Entity/Cybersader/10 - Projects` deep in the tree — are matched by the same rule and produce the same tag (`#10-projects/...` either way).

**Is that the right semantics?**

## Why it might not be

A folder name is *syntactically* the same string but *semantically* different at different positions. Three concrete cases:

### Case 1 — Same name, different scope

```
10 - Projects/                     ← global JD: "the projects bucket"
  Q4-roadmap/

Entity/
  Cybersader/
    10 - Projects/                 ← Cybersader's private projects
      side-business/
  Bob/
    10 - Projects/                 ← Bob's private projects (different entity!)
      thesis/
```

The same JD numbering is being applied independently in three places. The user's mental model: the *content* of `Entity/Cybersader/10 - Projects/side-business` is *not* in the same Project bucket as `Entity/Bob/10 - Projects/thesis`. They share a *shape* but not a *namespace*.

If a single JD rule fires on all three, every project-named folder under any entity gets thrown into the same `#10-projects/*` tag namespace. That's data corruption from a knowledge-organization standpoint.

### Case 2 — Same name, different parent organizational system

```
Projects/                          ← PARA top-level
  Web/
    10 - Backend/                  ← JD-flavored sub-area inside PARA Web
      auth-rewrite/
  Mobile/
    10 - iOS/                      ← JD-flavored sub-area inside PARA Mobile
      onboarding/
```

Here the user has applied JD nested *inside* PARA buckets. The `10 - Backend` and `10 - iOS` folders share the JD shape but they're scoped differently — `#10-backend` should arguably live under `#projects/web/`, not at the root of the tag namespace.

### Case 3 — Recursive same-name nesting

```
Projects/
  Subprojects/
    Projects/                      ← user really did name this 'Projects' too
      this-thing/
```

Pathological but legal. Phase G's `any-segment` anchor matches *all three* `Projects` segments. Which tag does `Projects/Subprojects/Projects/this-thing` get?

## Where the abstraction leaks today

- **Phase G handles position partially.** `folderAnchor: 'root'` vs `'any-segment'` vs `{ under: 'X' }` controls *where* a rule fires, but the choice is fixed at rule-authoring time. A user applying JD to *both* root and per-entity can't express that with one rule.
- **Detection's `scopedUnder` is gating-only.** It tells the system "PARA only applies if SEACOW-outer is also present" — but it doesn't tell the rules to *automatically anchor under the parent pack's location*. The user still has to author that.
- **Tag side is unparameterized.** A rule's tag template is a fixed string. There's no slot for "whatever entity I matched under" to flow into the tag namespace.

## Research brief

Hand this challenge to a fresh agent with the knowledge base mounted (`docs/src/content/docs/`). The agent should:

1. **Survey prior art for "same name, different context" disambiguation:**
   - **Filesystem path resolution** — how do shells, file managers, IDEs distinguish `./foo/bar` from `/etc/foo/bar`? (Absolute vs relative, working directory, $PATH lookup precedence)
   - **CSS specificity** — selectors like `.card .title` vs `.modal .title` distinguish "title in card context" from "title in modal context". The cascading specificity algorithm is exactly this problem.
   - **XPath / JSONPath / XQuery** — `//div[@class='foo']` matches anywhere; `/root/div[@class='foo']` is rooted. The path-axis vocabulary (`descendant::`, `child::`, `parent::`) gives precise position addressing.
   - **ARIA roles + DOM hierarchy** — a `role="button"` inside `role="menubar"` is different from a top-level button. Accessibility tools navigate this routinely.
   - **Kubernetes resource names** — namespaced (`default/my-pod`, `kube-system/my-pod`) — same name, different namespace, different object.
   - **AWS ARN format** — `arn:aws:iam::123456:role/admin` vs `arn:aws:iam::789012:role/admin` — same role name, different account boundaries.
   - **Programming-language scoping** — how do nested namespaces / modules / classes resolve identifiers? (Lexical scoping, ADL, hoisting, etc.)
   - **Library Subject Headings (LCSH)** — `English literature -- 19th century -- History` vs `American literature -- 19th century -- History`. The `--` subdivision separator is an explicit context marker.

2. **Map each prior-art approach onto folder-tag-sync:**
   - For each, sketch what the corresponding rule abstraction would look like
   - What does the rule pack JSON shape become?
   - Concretely: how would the JD rule express "match `\d{2} - X` at root AND at `Entity/<entityname>/`, producing scope-correct tags in each case"?

3. **Stress-test the existing Phase G anchors against Case 1, Case 2, Case 3:**
   - For each case, write the minimal set of rules that gives semantically correct tags
   - Count: how many rules does the user have to hand-author per (org system × entity × position) combination?
   - Identify the explosion point — at what scale does manual rule authoring become untenable?

4. **Evaluate parameterized anchors as a candidate solution:**
   - Phase G has `{ under: 'Entity/Cybersader' }` (literal). Could it be `{ under: 'Entity/{entityName}' }` (parameterized)?
   - What's the syntax? `{ under: { template: 'Entity/{entityName}' } }` or just inline `{ under: 'Entity/{*}' }`?
   - How would `entityName` flow into the tag template? `#--{entityName}/10-projects/...`?
   - Does parameterized-under introduce a new ambiguity (multiple matches because the slot is polymorphic)?

5. **Evaluate scope-pinning as an alternative:**
   - Each rule explicitly declares its *scope* as a path prefix
   - Tags are auto-prefixed with a scope-derived namespace
   - Trade-off: more verbose rule authoring, but no ambiguity

6. **Evaluate pack-replication at install time:**
   - When the user "applies JD pack to this vault," the loader could detect N entities and emit N pre-anchored copies of the JD rules
   - Pros: no parameterization complexity in the rule abstraction itself
   - Cons: rule list bloat; user sees 4×N rules; updates have to ripple through copies

## Candidate solution directions to evaluate

The agent should weigh at least these:

**Solution A — Parameterized anchors with slot capture.**
Anchor becomes a template: `{ under: 'Entity/{entityName}' }`. The captured slot flows into the tag template: `#--{entityName | kebab}/10-projects/...`. One rule handles all entities. Cost: the `under` field becomes a mini-DSL of its own; pattern semantics get more complex.

**Solution B — Scoped rule packs (pack instance per scope).**
At install time, the user picks a "scope" (a path or path glob) for the pack. The loader generates one anchored copy of each rule per matched scope. Cost: rule count grows linearly with scope count; updates via re-install.

**Solution C — Tag-side namespace slots.**
Rules express the tag template with namespace slots: `#{scope-prefix}/10-projects/{rest}`. The scope prefix is computed from the matched folder path's prefix relative to the rule's anchor. Cost: requires anchor + path-relative computation in the engine.

**Solution D — Explicit context-aware rule pairs.**
Replace one rule with N — one per scope context. User authors `JD-at-root`, `JD-under-cybersader`, `JD-under-bob` separately. Cost: N×M explosion; user UX poor; no DRY.

**Solution E — Tree-pattern matching (XPath-flavored).**
Rules are tree patterns, not path regex: `Entity/*/10 - Projects/**` with explicit captures. Engine walks the tree, not the flat path string. Cost: bigger engine rewrite; new mental model.

For each candidate: rate authoring cost, expressive power, hybrid-coexistence with current regex rules, engine complexity, UX clarity. Pick a winner; explain why; sketch the migration.

## Deliverable

Short report (~1500-2500 words) at `zz-log/YYYY-MM-DD-challenge-04-findings.md`:

- The agent's own framing of the problem (does the original case the user posed cover all the variants? are there others worth naming?)
- For each prior-art approach: what would folder-tag-sync look like if it adopted that approach?
- Verdict on candidate solutions A–E (or sketch of a Solution F we missed)
- Recommendation for Phase H+ — should this be a same-phase concern or a future phase?
- Open questions left unresolved

## Hand-off note

This challenge sits adjacent to the [path templates research log entries](/obsidian-folder-tag-sync/agent-context/zz-log/) (Parts 1 + 2). The path-template work answers *how to author one bidirectional rule* — this challenge asks *how the system handles when one rule's matches mean different things at different positions*. They're orthogonal and both need answers before Phase H ships its UI.
