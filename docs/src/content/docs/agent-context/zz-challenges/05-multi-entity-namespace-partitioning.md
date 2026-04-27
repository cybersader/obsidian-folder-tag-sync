---
title: "Challenge 05: Multi-entity vaults and namespace partitioning"
description: A user with multiple SEACOW entities (Cybersader, Bob, ...) wants the same inner organizational system (PARA/JD/ZK) inside each, with tags correctly partitioned per entity. How does the rule abstraction avoid an N×M explosion?
tags: [research, architecture, first-principles, seacow, phase-h]
sidebar:
  label: "05 · Multi-entity"
  order: 5
---

## Assumption under test

The plugin's typed model includes the SEACOW `Entity` axis: a top-level partition of the vault by *who owns / authored / is the audience for* the content. The `seacow-cyberbase` rule pack hard-codes `Entity/Cybersader` as a literal prefix in its rule patterns; the `cyberbase-actual` pack has separate rules for `VaultUser1` and `VaultUser2` already.

This implicitly assumes that **entity expansion happens by hand**. If a vault has three entities, the user authors three sets of rules (or imports the SEACOW-cyberbase pack three times with hand-edited prefixes).

**Does that scale?** And — more importantly — **is it even the right mental model?** Entities in SEACOW are *structurally identical* — they share the same axes (capture, output, work, system) and the same inner organizational systems. Authoring per-entity rules treats them as if they were arbitrary distinct things, when the user's intent is "every entity gets the same internal structure, partitioned by name."

## Why it might not hold

### Concrete scenario

A user has a multi-author vault with three entities:

```
Entity/
  Cybersader/
    Capture/
    Output/
    Work/
      10 - Projects/
        Q4-roadmap/
  Bob/
    Capture/
    Output/
    Work/
      10 - Projects/
        thesis/
  Anya/
    Capture/
    Output/
    Work/
      10 - Projects/
        ml-paper/
```

The user wants:
- `Entity/Cybersader/Work/10 - Projects/Q4-roadmap` → `#--cybersader/10-projects/q4-roadmap`
- `Entity/Bob/Work/10 - Projects/thesis` → `#--bob/10-projects/thesis`
- `Entity/Anya/Work/10 - Projects/ml-paper` → `#--anya/10-projects/ml-paper`

The structure is identical per entity; the entity name is the *only* thing that varies. The expected output is *one rule pattern* with the entity name flowing through to the tag.

### Why the hand-authored approach explodes

If the user has E entities and each entity has M inner rules (PARA's 4 + JD's 1 + ZK's 1 + SEACOW's own 4 = 10), they need **E × M = 30 rules** for a 3-entity vault. Adding a fourth entity means duplicating 10 rules. Updating any rule means updating it E times.

The current `cyberbase-actual.json` already shows this pain: it has separate rules for `VaultUser1` and `VaultUser2`, identical except for the literal username. The rule list is double-length, and there's no sync — if the user edits the VaultUser1 rule, VaultUser2 silently drifts.

### Why this is structurally different from Challenge 04

Challenge 04 asks "can the same name at different positions mean different things?" — a *disambiguation* question.

This challenge asks "can one rule express `for every entity, do this`?" — a *quantification* question. They're related but distinct. Solving 04 doesn't automatically solve 05; you can have unambiguous per-entity rules and still face the N×M explosion.

## Where the abstraction leaks today

- **No quantifier in the rule language.** Rules are first-order: a rule names ONE pattern. There's no `forall entity in Entity/`-style construct.
- **Entity is treated as a literal, not a slot.** SEACOW's typed model says entity is an axis with semantic meaning, but at the rule-pattern level entities are just strings the user types out.
- **Pack composition is install-time, not runtime.** When you install the SEACOW-cyberbase pack, you get *its* rules. There's no "install JD pack, generating one anchored copy under each detected entity" pathway.
- **The detection layer knows entities exist.** `detectPacks` could in principle find all `Entity/*/` folders and report "3 entities detected: Cybersader, Bob, Anya." But there's no path from that detection to "auto-generate per-entity instances of the inner packs."

## Research brief

Hand to a fresh agent with the knowledge base mounted (`docs/src/content/docs/`). The agent should:

1. **Survey prior art for "this rule applies per-instance of a partition":**
   - **Kubernetes namespaces** — same Deployment manifest applied per-namespace; the namespace is the partition key. How is this expressed? (`metadata.namespace` field on resources; `kubectl apply -n <ns>`)
   - **Multi-tenant SaaS data models** — row-level tenancy via `tenant_id` column, schema-per-tenant, database-per-tenant. Each is a different N×M trade-off.
   - **Ansible / Puppet / Chef inventory + role assignment** — same role applied to multiple hosts; the inventory is the partition. How are templated/per-host configs expressed?
   - **Cron expressions vs systemd timers** — single config, multiple firing instances over time.
   - **Helm charts with `values.yaml` overrides** — a chart is a template; values are the per-instance partition.
   - **Datalog / Prolog rules with universal quantifiers** — `parent(X, Y)` says "for any X, Y" — the relational model has this for free.
   - **Spreadsheet array formulas** — one formula spans many rows; each row is an "instance."
   - **GitHub Actions matrix builds** — `strategy: matrix: { entity: [Cybersader, Bob, Anya] }` — explicit enumeration.
   - **TypeScript generic types** — `type Per<T> = { [E in T]: ... }` — type-level quantification.

2. **Evaluate three candidate generation strategies for folder-tag-sync:**

   **Strategy A — Pattern-level wildcards (entity as a captured slot):**
   - Rule pattern: `^Entity/{entityName}/Work/10 - Projects(?:/|$)`
   - Tag template: `#--{entityName | kebab}/10-projects/{rest}`
   - The slot is captured at match time and propagated to the tag side.
   - Maps onto Phase H's path-template work directly: `entityName` is just a slot.

   **Strategy B — Pack-multiplication at install/scan time:**
   - At scan time, detect entities (e.g., enumerate folders under `Entity/`).
   - When user installs an inner pack (PARA, JD, ZK), the loader asks "scope to which entities?" — checkbox list.
   - For each selected entity, emit a pre-anchored copy of the pack's rules.
   - Rule list grows but is mechanical.

   **Strategy C — Pack-level templating with explicit parameter:**
   - Pack JSON declares parameters: `"params": [{ "name": "entityName", "type": "string" }]`.
   - All rule patterns/templates use `{entityName}` as a slot.
   - User instantiates the pack once per entity at install time, providing the parameter value.
   - Closer to Helm chart values.

   **Strategy D — Implicit detection-driven entity expansion:**
   - The loader auto-detects entities (folders matching `Entity/*` shape).
   - Inner-pack rules with anchor `{ under: 'Entity/{entityName}' }` are auto-expanded at runtime — one effective rule per entity, but the user-visible rule list shows just one.
   - The engine fans out at evaluation time.

3. **Stress-test against the existing rule packs:**
   - Apply each strategy to `seacow-cyberbase.json` (which currently hard-codes `Entity/Cybersader`).
   - Apply each strategy to `cyberbase-actual.json` (which has VaultUser1/VaultUser2 hand-duplicated).
   - Count: rules-on-disk, effective-rules-at-runtime, lines-changed-when-a-new-entity-is-added.
   - Identify any rule shape that *can't* be expressed under each strategy.

4. **Examine the bidirectional consequence:**
   - When a tag `#--bob/10-projects/thesis` is created and synced back to a folder, the rule needs to recover the entity name from the tag and place the file under `Entity/Bob/Work/10 - Projects/thesis`.
   - Each strategy's reverse direction has different complexity. Score them.

5. **Examine the conflict story:**
   - Two entities both have a `10 - Projects` folder. With per-entity scoping, no conflict (`#--cybersader/...` ≠ `#--bob/...`).
   - But what if the user *wants* a "global projects view across all entities"? Is that a separate rule with non-entity-scoped tag output, or an aggregation of the per-entity rules?

6. **Examine the discoverability story:**
   - Does the guided modal make it obvious that a rule with a parameterized anchor will fan out to multiple entities?
   - Can the live-preview show samples from multiple entities at once, or just one?
   - When the user adds a new entity, what does the system do — auto-detect, prompt, silent?

## Candidate solution directions to evaluate

The four strategies above are the starting set. The agent should also consider:

- **Strategy E — Pure detection-time materialization with no runtime fan-out.**
  Loader generates real, materialized per-entity rules at pack-install time; engine sees a flat rule list. Closer to Strategy B but the user never sees the multiplication.

- **Strategy F — Entity-as-axis approach where entities are first-class citizens.**
  The rule abstraction treats `entity` as a typed-model field on the rule itself. Per-entity expansion is implicit at evaluation time. This requires the typed model to know about entity enumeration — the SEACOW axes already point in this direction.

- **Strategy G — Hybrid (pattern slot + opt-in materialization).**
  Use Strategy A by default for clean rules. Allow Strategy B/E for power users who want explicit per-entity tweaks (e.g., "Bob's work uses different transforms than Cybersader's").

For each candidate (A–G), report:
- Authoring intuitiveness — how easy is it for a non-programmer to express "JD per entity"?
- JSON-friendliness — what does the rule pack look like?
- Engine cost — does this require rewriting the matcher, or does it fit in the existing pipeline?
- Hybrid-with-regex — does the strategy coexist with raw-regex rules in the same pack?
- New-entity ergonomics — a user adds `Entity/Charlie/`. What does it take to make all the inner rules apply?

## Deliverable

Report at `zz-log/YYYY-MM-DD-challenge-05-findings.md`:

- The agent's own restatement of the problem
- Survey of the prior art (with concrete examples)
- For each strategy A–G: pros/cons, code sketches, fit assessment
- Recommendation: which strategy (or combination) for folder-tag-sync, and why
- Phase ordering: does this need to land with Phase H, or after?
- Open questions and edge cases the agent surfaced

## Hand-off note

This challenge sits adjacent to [Challenge 04 (name collisions)](/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/). Solving Challenge 04 (disambiguation by position) is necessary but not sufficient — Challenge 05 is about *quantification* (one rule, many instances). They likely share solution machinery (parameterized anchors), but the agent should treat each independently.

The [path templates research](/obsidian-folder-tag-sync/agent-context/zz-log/) (Parts 1+2) gives context on the slot/template direction the plugin is heading. This challenge asks: do those templates need to support *multi-instance* expansion, or is one-template-one-rule sufficient?
