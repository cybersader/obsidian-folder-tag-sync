---
title: The bidirectional/bijective solution — brainstorming the shape of FTSync
description: Working draft. Brainstorming the meta-shape of what FTSync actually is, beneath the abstractions. Folder-side constraints, tag-side constraints, the sync-engine philosophy, where templating challenges bijectivity, and what a smart context-aware system might look like (SEACOW). Companion to the regex-vs-templates and tag→folder research entries.
tags: [research, brainstorm, draft, working]
sidebar:
  label: "04-27 · Solution brainstorm (draft)"
  order: -20260427002
date: 2026-04-27
---

> **This is a working draft.** Parts of this page will change. The title may change. Some of the threads below will get pulled into proper concept pages once they stabilize; others will get rejected as "this isn't quite right." This is the thinking-out-loud stage, not the closed answer.
>
> If you're an agent reading this for context: the load-bearing claims are in the [tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) and the regex-vs-templates research entries. This page is the meta-frame above all of them — the *why are we even building this* layer.

## What FTSync actually is, beneath the abstractions

The plugin is **simple in its components but complex in the philosophical and data-shape primitives it has to account for.** A short list of components: rules, transforms, a folder-side regex, a tag-side regex, a sync engine that fires on file events. None of those are individually hard.

What's hard is everything *under* the components — the mismatch between filesystem hierarchies (strict, one-parent-per-child) and tag namespaces (polyhierarchical — multi-parent reachability, the same item under several broader categories at once). The plugin's whole reason to exist is to bridge those two structurally different things, deterministically, without storing any new information of its own. The bridge has to be honest about where the bridge can't fully connect (lossy ops, ambiguous inverses), and it has to communicate those gaps to the user without overwhelming them.

The components are simple. The constraints those components have to honor are not.

## What the outsider sees

When someone unfamiliar with library science or formal optics looks at this tool, they see two surfaces and a sync engine.

**Folder side:**

- Defined by structure (where the file sits in the tree) and filename (the leaf name itself).
- Constrained by the operating system (forbidden characters, length limits, case-sensitivity quirks across platforms).
- Each file has *exactly one* path from root — strict hierarchy. There's no way to put a file in two folders simultaneously.

**Tag side:**

- Defined inside frontmatter or inline tags.
- Constrained by Obsidian's tag syntax (no spaces, no certain characters, slashes mean nested-tags) — *not* the same constraint set as filenames.
- Can represent overlapping branches in a hierarchy. The same file can carry multiple tags simultaneously, and those tags can describe the file from different angles (`#projects/web` AND `#topic/oauth` AND `#owner/cybersader` — all three pointing to the same file).
- Where you instantiate the tag matters. A tag rooted at `#projects/...` versus a tag rooted at `#by-project/...` describes the same file differently.

**Sync engine:**

- Doesn't store useful information of its own. It's a transformer, not a database.
- Keeps the two surfaces aligned. Typically losslessly (every change round-trips), sometimes lossy by intent (the user authored a `marker-only` rule that collapses many folders to one tag).
- Has to *reach into the user's flow at the right time* with easy decision-making — not silently make choices the user wouldn't have made.

That last bullet is the load-bearing one. The sync engine isn't infrastructure; it's a collaborator. When it has to make a choice (the inverse-direction ambiguity from the [tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/)), it should surface the choice rather than hide it.

## Where the philosophical primitives are

A short list of the constraints that don't go away regardless of which solution we ship:

- **Filenames are the most-constrained surface.** The OS rules are the floor; you can't go below them. Tags can carry information filenames can't.
- **Tag syntax is its own constraint set.** Different from filename syntax. Doesn't allow arbitrary characters in arbitrary places. Frontmatter parsing imposes additional constraints (YAML quoting, escaping).
- **Folder hierarchy is strict.** One parent per file. This is non-negotiable on a filesystem.
- **Tag hierarchy is polyhierarchical.** Multi-parent reachability is the *point* of tags. The same item being reachable through three different tag paths is feature, not bug.
- **The mismatch between strict and polyhierarchical** is what the engine has to bridge. Some bridges are bijective (round-trip cleanly). Some are deliberately many-to-one. The engine has to be honest about which.

These primitives are invariant across solution choices. Whether we go with regex, path templates, or some future abstraction, these constraints are still there. The solution shape is downstream of the constraints; the constraints are upstream of all of them.

## The SEACOW-as-disambiguator instinct

In the user's mental model, *who is working* and *what activity they're doing* are part of how a tag should be interpreted. `#auth` in Cybersader's project context means something different from `#auth` in Bob's project context. They shouldn't share a folder. But the engine doesn't know who is working.

The user's framing for the dimensions of this context: **SEACOW** — System / Entity / Activity / Context / Output / Work. These are the axes that, in an ideal world, would drive a *context-aware view* of the rendered hierarchy. Different active context, different rendered folder structure, different active tag namespace.

This is genuinely a research-frontier idea. No current knowledge tool does this — context-aware view-switching across hierarchies is hard because you have to:

1. Infer the active context (who, what activity) without making it the user's job to declare it constantly.
2. Re-render the rendered hierarchy without breaking links, transclusions, attachments.
3. Keep the underlying file system stable — the rendered view is a *projection* of the underlying state, not a mutation.
4. Communicate to the user *which view they're in* without making the UI overwhelming.

The plugin doesn't try to solve this today. The brainstorming version: **SEACOW lives in the rule-pack design space**. Rule packs are organized by axis (one pack per SEACOW dimension); the rules within carry their axis as metadata; resolution can dispatch on axis. That's a partial answer — it gives axes a representation in the data model — without committing to context-aware view-switching as a runtime feature.

The full version is aspirational. The partial version is implementable. **Locating which is which** is part of what this brainstorming page is for.

## Where templating challenges bijectivity

The Phase H proposal (path templates with named slots) gets one half of the bijection question right: slots that appear on both sides round-trip, slots that appear on only one side don't, the engine can detect this at authoring time. Solid.

The other half is **transforms on slots**. When a slot carries a transform (`{project | kebab}`, `{name | strip-emoji}`, `{number | strip-prefix}`), the round-trip is bijective only if the transform is reversible *for the data the user actually has*.

Concretely:

- `kebab-case` is reversible for input that's already a single line of word characters. But `"Web Auth"` becomes `"web-auth"` — and the inverse needs `"Web Auth"` back, which means it has to know "first letter of each space-separated word is upper-cased on the inverse." That's a lossy assumption. If the original was `"web auth"` (already lowercase), the round-trip lands on `"Web Auth"` instead — different string.
- `strip-emoji` is irreversible. The forward direction throws emojis away; the inverse can't put them back without knowing where they were.
- `strip-number-prefix` (the `numberPrefixHandling: 'strip'` primitive) is irreversible in the same way. `10 - Projects` becomes `Projects`; the inverse can't recover the `10`.

So the slot-overlap bijection guarantee is *conditional on the transform pipeline being reversible*. The engine can flag transforms that are known-irreversible (emoji-strip, number-prefix-strip) and warn the user; transforms that are conditionally-reversible (case transforms) are harder to flag honestly.

This is a tension in the templating proposal that the [Part 2 research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) names but doesn't fully resolve. The brainstorming version: **the bijection claim is per-slot-per-transform, not per-rule.** A rule's overall bijection status is the conjunction of its slots' bijection statuses, and the engine has to track this granularity. Phase H's surface area for this isn't fully scoped yet.

## The communication problem

A redirect from earlier in the session: *"regex would potentially be fine if our tool can account for that, account for if someone uses multiple types of rules, how the system would communicate the issues with choices."*

The framing matters. The abstraction question (regex vs templates vs lenses) is *downstream* of the communication question (does the user understand what their rule does?). A perfectly-crafted lens-based rule that the user can't read is worse than a regex rule with a clear status indicator.

What the tool needs to communicate (already named in [Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/#what-the-tool-needs-to-communicate)):

- Per-rule status indicator: "this rule round-trips cleanly," "this rule's forward is lossy by design," "this rule's bijection is asserted by typed metadata, not visible from the regex pattern."
- Pack-load summary: "imported 4 rules: 2 templates, 1 regex, 1 marker-only" — visibility, not alarm.
- Convert action where safe: "convert to template" / "convert to regex" — one-click for round-trippable cases.
- Conflict resolution dialog: when multiple rules genuinely match the same input, surface the candidates rather than silently picking one.

These are the communication primitives. The abstraction shape is downstream. **Solving the communication problem makes regex acceptable. Not solving it makes templates barely better than regex.**

## The "limiting surface" observation

Tags can carry information that the filesystem can't (multi-parent reachability, axis crossings, free-form annotation). The filesystem is the *limiting* surface because it's the most-constrained.

Implication: the engine's job is to be honest when the inverse direction can't fully reconstruct. A many:1 transfer op going forward means the inverse direction is structurally one-to-many — there are *many* folder paths that could have produced any given tag. The engine can't pick the right one without out-of-band information (user choice, SEACOW context, rule-pack precedence).

The "right time" to reach into the user's flow is exactly the moment where the engine would otherwise silently pick. That's where candidate D (conflict resolution UI) from the tag → folder resolution research lives. The brainstorming version: **the engine should default to honesty** — if it can't pick, it asks. The cost is an extra UX surface; the benefit is the user always knows what their structure looks like.

## What we still don't know

A list of explicit unknowns that this page captures so they don't get lost:

- **Does context-aware hierarchy switching need a new abstraction layer, or does it fall out of axis-typed rules?** The hopeful answer is the second — if rule packs are axis-typed, the engine can dispatch on the active axis without a separate context system. The realistic answer is "we don't know yet."
- **When a single tag genuinely should resolve to N folders by intent**, what's the right UX? Is it "create a multi-link" (the file ends up referenced from N folders without actually moving)? Is it "pick one as canonical, others as see-also"? Is it a setting per rule? The brainstorming hasn't picked.
- **Where does the SEACOW lens live in the rule-pack format?** Is it a separate top-level field on rule packs? Does it emerge from existing folder-classifier and tag-vocabulary axes? Both? Worth a small experiment.
- **What's the smallest demo that proves "context-aware hierarchy" is useful** before we commit to building it? A two-axis vault with the same content viewed under SEACOW=Cybersader-projects vs SEACOW=Cybersader-research — does the rendered structure feel meaningfully different? If the demo doesn't move the needle, the feature isn't worth the complexity.
- **How much of this is FTSync's job vs. Obsidian's job vs. a separate tool's job?** The plugin's scope is "keep folders and tags synced." Context-aware hierarchy switching might be outside that scope — a different plugin entirely. Worth being honest about the boundary.

## Out of scope for this draft

Explicit non-goals:

- **Implementation work.** This is brainstorming, not a Phase H spec.
- **Concrete UI mockups.** Those belong in proper feature pages once the shape settles.
- **A final name for the abstract solution.** "Bidirectional/Bijective Engine," "FTSync Templating Engine," "FTSync Solution Layer" — none of these feel right yet. The right name will emerge once the shape is settled enough to deserve one. Forcing a name now anchors the design prematurely.
- **The full SEACOW context-switching system.** Aspiration, not commitment. The brainstorming locates it as a research-frontier idea worth keeping in mind, not as a roadmap item.

## Related work

- [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — the inverse-direction problem in detail; six candidate approaches; recommends specificity-aware matching + rule groups
- [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — the forward-direction abstraction question; regex vs path templates
- [Path abstractions, part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — concrete code, hybrid coexistence, communication primitives
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge from primitives to round-trip behavior
- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight library-science primitives all of this composes against
- [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — the typed-model layers and SEACOW axes
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
