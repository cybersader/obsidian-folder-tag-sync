---
title: "Challenge 06: Compositional rule packs and the layering primitive"
description: SEACOW-outer is the structural shell; PARA, JD, ZK fill the inner axes. Today's pack model treats them as independent imports. How does the system express "stack these packs at this layer," and what are the bidirectional consequences?
tags: [research, architecture, first-principles, seacow, phase-h]
sidebar:
  label: "06 · Pack composition"
  order: 6
---

## Assumption under test

A rule pack is a unit of import. The user picks a pack from the catalog, the loader adds its rules to the settings, the rules apply to the vault. Packs are flat and mostly independent.

This works for "I have a vault, I want PARA" — single pack, applies at vault root, done.

It breaks down for any of the more interesting structures the SEACOW framework was designed to express:

- "I want SEACOW-outer for the structural shell, PARA for Work content, ZK for Capture/Inbox" — three packs that need to *compose*, with each one anchored to a different layer.
- "I want SEACOW-outer with one PARA per entity" — pack stacking *and* multi-instance (Challenge 05).
- "I want PARA, but applied under `personal/` because my vault has both work and personal at the top level" — a single pack, but anchored somewhere other than vault root.

The pack-as-flat-list model assumes vault root is the anchor for every pack. The layer/anchor work of Phase G partially addresses this for *individual rules* (`folderAnchor: { under: 'X' }`). But pack-level composition — *"this whole pack lives under that whole pack's matched location"* — has no first-class expression.

## Why it might not hold

### Concrete scenario A — SEACOW outer + PARA inner at root

```
Capture/                           ← from SEACOW-outer pack
  Inbox/                           ← from SEACOW-outer pack (or ZK pack scoped here)
Output/                            ← from SEACOW-outer pack
Work/                              ← from SEACOW-outer pack
  Projects/                        ← from PARA pack — but anchored under 'Work/' !!!
    Q4-roadmap/
  Areas/                           ← also from PARA pack, also under 'Work/'
  Resources/
  Archive/
Entity/                            ← from SEACOW-outer pack
  Cybersader/
System/                            ← from SEACOW-outer pack
```

The user wants:
- SEACOW-outer rules at vault root (fires on `Capture`, `Output`, `Work`, `Entity`, `System`)
- PARA rules **anchored under `Work/`**, not at root (fires on `Work/Projects`, `Work/Areas`, etc.)

Today, importing both packs gives you SEACOW rules at root *and* PARA rules at root. The PARA rules try to match `Projects/`, `Areas/` at vault root and fail (because in this layout, those folders are nested under `Work/`).

The user's only escape is hand-editing each PARA rule's pattern to prepend `Work/` — which works, but defeats the point of importing a pack.

### Concrete scenario B — SEACOW outer with per-entity inner systems

Building on Challenge 05's example:

```
Entity/
  Cybersader/
    Work/                          ← per-entity Work bucket
      10 - Projects/               ← JD applied per-entity
  Bob/
    Work/
      10 - Projects/
```

The user wants:
- SEACOW-outer at root (recognizes the `Entity/` shell)
- JD inner pack scoped under `Entity/{entity}/Work/` — one logical install, multiple effective anchors

### Concrete scenario C — Independent packs at root with overlapping shapes

```
Projects/                          ← PARA Work
10 - Projects/                     ← JD numbered area
```

Both packs ship rules that match similar shapes. Without composition awareness, both rules could fire on the same folder if their patterns overlap. The user has to manually resolve.

## Where the abstraction leaks today

- **`detection.scopedUnder` is a gating field, not an anchoring directive.** It says "PARA is suggested when SEACOW-outer is detected" — but it doesn't say "anchor PARA's rules under SEACOW-outer's matched location."
- **Packs ship root-anchored.** Every shipped pack assumes its rules apply at vault root. There's no field saying "this pack is intended to compose under another pack."
- **Pack catalog UI doesn't distinguish "outer-shell packs" from "inner-content packs."** SEACOW-outer is a structural pack; PARA is a content pack. They're listed as siblings.
- **Bidirectional consequence is murky.** When a tag like `#10-projects/foo` is reverse-synced, which folder layout does the inverse pick? Vault root `10 - Projects/foo`, or `Entity/Cybersader/Work/10 - Projects/foo`, or `Work/10 - Projects/foo`? Composition affects which one.

## Research brief

Hand to a fresh agent with the knowledge base mounted (`docs/src/content/docs/`). The agent should:

1. **Survey prior art for compositional package systems:**
   - **NixOS modules** — `imports = [ ./hardware.nix ./networking.nix ];` — modules compose, can override each other, configuration is structurally merged.
   - **Helm subcharts** — a chart can declare `dependencies` (other charts); the parent's `values.yaml` controls how the subchart instantiates. This is *exactly* parametric pack composition.
   - **Docker Compose `extends`** — service definitions inherit from / compose with other services.
   - **Tailwind CSS plugins** — plugins extend / scope-prefix the utility classes; composition is by import order and scope qualifiers.
   - **CSS `@layer`** — explicit ordered layers for cascade, allowing later layers to override earlier without specificity wars.
   - **Maven / Gradle dependency scoping** — `compile`, `test`, `runtime`, `provided` — packages compose with semantic scopes.
   - **TypeScript module augmentation / declaration merging** — a library extends another's types without forking.
   - **Linux file-system unioning (OverlayFS, AUFS)** — layered filesystems where each layer can override or extend the lower.
   - **Library subject heading composition** — a heading like `English literature -- 19th century -- Criticism` is a *composed* descriptor; each `--` segment is a layer of subdivision from a different controlled vocabulary.

2. **Map prior-art mechanisms onto folder-tag-sync's pack model:**
   - For each, sketch what the pack JSON / manifest would look like
   - How does the user express "install PARA under Work, but JD under each Entity/*/Work"?
   - What does the catalog UI show — flat list, tree, dependency graph?

3. **Stress-test three compositional scenarios:**

   Scenario A (SEACOW + PARA at Work):
   - User installs SEACOW-outer, then PARA scoped under `Work/`
   - Required: PARA's rule patterns must compile to `Work/Projects(?:/|$)` etc, not `Projects(?:/|$)`
   - Bidirectional: tag `#projects/q4` should reconstruct as `Work/Projects/q4`, not `Projects/q4`
   - What does the rule pack JSON declaration look like to express this composition?

   Scenario B (SEACOW + per-entity PARA):
   - User installs SEACOW-outer, then PARA scoped under each detected `Entity/*/Work`
   - Composes Challenge 05's quantification with Challenge 06's anchoring
   - Required: PARA rules fire under `Entity/Cybersader/Work/Projects`, `Entity/Bob/Work/Projects`, etc.
   - Tag side: `#--cybersader/projects/q4` vs `#--bob/projects/q4`

   Scenario C (PARA at vault root, no SEACOW):
   - User installs only PARA — original simple case
   - Pack should compile to root-anchored rules, same as today
   - No regression vs current behavior

4. **Evaluate four candidate composition mechanisms:**

   **Mechanism A — Pack-level anchor declaration at install time.**
   When the user installs a pack, they pick the anchor (vault root / under `X` / under each `Y`). The loader rewrites the pack's rules with that anchor before adding them to settings. Same rules in the pack file; different output rules in the settings.

   **Mechanism B — Pack manifest declares composition slots.**
   A pack JSON has a top-level field: `"installAt": "{?anchor}"` where `?anchor` is replaced at install time. SEACOW-outer's manifest declares it provides anchors (`Work/`, `Entity/*/`, etc.); PARA's manifest declares it consumes one (`installs at: Work/`).

   **Mechanism C — Auto-composition via the existing `scopedUnder` + `detection` fields.**
   When SEACOW-outer is detected and the user installs PARA, the loader checks PARA's `scopedUnder: 'seacow-outer'` and finds where SEACOW-outer's signal hit (e.g., `Work/`). It auto-anchors PARA's rules there.

   **Mechanism D — Explicit pack-stacking syntax in settings.**
   Settings has a `packStack: [{ pack: 'seacow-outer' }, { pack: 'para', under: 'Work' }, { pack: 'jd', under: 'Entity/*/Work' }]`. The loader resolves the stack into a flat rule list at runtime.

5. **Examine the bidirectional consequence per mechanism:**
   - For each, what does the inverse direction require? (Reconstructing the right anchored folder from a tag)
   - Does the composition affect cardinality / bijection guarantees?
   - Could two packs at different anchors produce the same tag for different folders? (Conflict.)

6. **Examine discoverability and UX:**
   - Catalog: does it show structural packs separately from content packs?
   - Detection results: when scan finds SEACOW + PARA shapes, does it offer the composition explicitly?
   - Settings list: do composed packs appear as a unit, or do their rules flatten into the main list?
   - Updates: when SEACOW-outer is updated, do composed PARAs need to re-anchor?

## Candidate solution directions to evaluate

Beyond the four mechanisms above:

- **Mechanism E — Detection-driven recipe templates.**
  When a vault scan finds shape `Entity/*/Work/Projects`, the system suggests installing a *recipe* that bundles SEACOW-outer + PARA-under-Entity-Work in one click. Recipes encode common compositions; users pick from recipes rather than authoring composition manually.

- **Mechanism F — Pack-level "installation receipt" with re-anchor capability.**
  Settings stores not just the resolved rules but a *receipt* — which packs are installed, at what anchors, with what parameters. Re-anchoring (e.g., the user moves PARA from root to `Work/`) is a settings operation, not a re-install.

For each (A–F):
- Authoring cost
- Engine complexity
- Catalog UX impact
- Compatibility with Phase H's slot templates
- New-pack-author-burden — what does a pack author have to specify to make their pack composable?

## Deliverable

Report at `zz-log/YYYY-MM-DD-challenge-06-findings.md`:

- The agent's reframing of the problem
- Survey of compositional package systems with concrete examples
- Per-mechanism analysis (A–F or more)
- Recommendation for folder-tag-sync's pack composition mechanic
- Phase ordering — does this land with Phase H or after?
- Open questions

## Hand-off note

This challenge depends on understanding [Challenge 04 (name collisions)](/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/) and [Challenge 05 (multi-entity)](/obsidian-folder-tag-sync/agent-context/zz-challenges/05-multi-entity-namespace-partitioning/). Skim those briefs before tackling 06 — they share solution machinery (parameterized anchors, slot capture) but address different facets of the underlying problem.

The [path templates research](/obsidian-folder-tag-sync/agent-context/zz-log/) (Parts 1+2) gives context for the slot/template direction. This challenge asks: how do *packs of templates* compose, and how does the user express that intent?
