---
title: Taxonomy Workbench — the .orgsys direction (evolved from Scan & Snap)
description: The authoring-at-scale vision sharpened into "Taxonomy Workbench" — a file-tree-shaped surface for snapping shareable organizational systems onto your real folders, powered by a slot-based .orgsys definition format that compiles down to the existing rule-pack JSON. Container deliberately open (a full pane, not a modal). The data layer (.orgsys + compiler) is the cheapest de-risking first slice.
tags: [session-log, design, taxonomy-workbench, orgsys, authoring, decided]
sidebar:
  label: "06-25 · Taxonomy Workbench (.orgsys)"
  order: -20260625001
date: 2026-06-25
---

## Where this picks up

Continues the [Scan & Snap design](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-authoring-at-scale-scan-and-snap-design/). After Scan & Snap (Phase 1) shipped, the user reframed the vision in a way that's sharper than the original modal framing. A concept-exploration workflow (3 sketches + synthesis) turned the fuzzy idea into a concrete, buildable model. This is now the active design direction.

## Locked decisions

- **Name: "Taxonomy Workbench."** The user wanted something library-science-flavored but approachable — which fits the plugin's DNA (its model is lifted from classification science). "Taxonomy" is the approachable LIS word; "Workbench" says you actively shape it. Replaces the working label "Scan & Snap." (One-line rename: command string + class.)
- **Surface: a big, full-pane view, NOT a modal.** The user repeatedly emphasized the surface must show the *real folder hierarchy at scale*. The current Scan & Snap modal (a flat candidate list) is a stepping stone. The target is a dedicated Obsidian leaf/pane you dwell in beside your notes. **Container is deliberately the least-important decision** — the value is in the data model + interaction loop, which are container-agnostic.

## The core idea: `.orgsys` — define the *system*, not the rules

The centerpiece (the user's "syntax for defining organizational systems you can share"): an organizational system becomes a small, shareable `.orgsys` file whose unit is the **slot**, not the hand-written rule. `para.json` is ~107 lines that restate "Projects" three times and copy-paste four near-identical blocks; `para.orgsys` is ~20 lines — four buckets from **one parametric slot**:

```yaml
system: para
axes: [work]
anchor: { default: any-segment, relocatable: true }
slots:
  - id: bucket
    folder: "{bucket}"
    tag:    "#{bucket}"
    transfer: identity
    deepen: true
    values: [Projects, Areas, Resources, Archive]
```

**Crucial architecture:** `.orgsys` is the *source*; the existing rule-pack JSON is the *compile target* ("bytecode"). `compileSystemDef(def)` lowers each slot through the existing `derive.ts` (literal slots) and `compileTemplate.ts` (parametric/pattern slots), and DERIVES `detection` + `establish` from the slot faces (no restating). Everything downstream — the planner, `scopeRules`, the modal, the sync engine — already consumes `MappingRule[]`, so **nothing downstream changes.** The same `.orgsys` file is both the palette you snap from AND what you export to share (one file type, closing the loop).

Composition (deferred to a later phase): `hosts` declares which systems can nest under a slot, and a composed arrangement (`mounts` with `at: Entity/*/Output` globs) is *also* an `.orgsys` file — what you share out is the same kind of thing you import.

## The loop (wizard → config → tree → rules → export)

One `WorkspaceConfig.mounts[]` object threads everything: the **wizard** asks what you use and writes the config (the allowlist/filter the plugin lacks today); the config seeds the **tree** (file-explorer-shaped, each node a live handle — snap, re-scope, rebind, evolve); gestures mutate mounts and re-run compile→scope→plan→re-annotate (live coverage/conflict/reversibility from the existing `buildScanAndSnapPlan`); on commit the rules merge into settings via the existing path; and you can **export** your arrangement as a new `.orgsys` someone else's wizard detects.

## Phased path (all on existing seams)

- **Phase 0 (in progress) — data layer, no UI:** the `.orgsys` format + `compileSystemDef` + re-author para/jd as `.orgsys` + a **golden behavioral-equivalence test** (compiled `.orgsys` emits the same tags as today's `.json` on sample paths). Proven by test only; NOT yet wired into the live loader (avoids duplicate-pack candidates). De-risks the new convention first — exactly what the user, unsure of the structure, needs to react to.
- **Phase 1 — composition:** `hosts`/`extends`/`mounts` + the `at: glob` anchor resolver (reusing `extractInstances`), lazily synthesizing nested rules at real detected anchors.
- **Phase 2 — WorkspaceConfig + wizard:** the persistent config (activeSystems allowlist + mounts) + the never-blank Survey wizard that writes it.
- **Phase 3 — the Workbench pane:** the full-scale file-explorer-shaped tree (sparse `buildAnnotatedTree` spine) with slot/system badges, live chips, and gestures (snap, drag-snap with pre-tint, re-scope, inline rebind/edit, promote). The "much bigger surface."
- **Phase 4 — export, lift, establish:** serialize an arrangement to a shareable `.orgsys`; `liftToSystemDef` to upgrade legacy packs; opt-in folder creation (mode-2 "create then unfold").

## Open decisions (deferred, not blocking Phase 0)

- **Parser**: minimal purpose-built (no dependency; user flagged bundle weight) vs `js-yaml`. Leaning purpose-built — the grammar is small + flat.
- **Where composition lives**: `hosts` baked into atomic systems (portable) vs only `mounts` from tree gestures (simpler) vs both. The biggest shape question.
- **Source of truth**: are `mounts[]` canonical (committed rules disposable) or are committed rules canonical (mounts are scaffold)? Decides whether hand-edits are first-class or "drift" against the `group: system@anchor` stamp.

## Biggest risk

Over-building the rich tree + DSL before validating the loop. Mitigation is the phasing: the artifact + compiler ship first (golden test), delivering a concrete thing to react to with zero new UI; the wizard and pane layer on as independently-shippable consumers, each gated on the prior feeling right.
