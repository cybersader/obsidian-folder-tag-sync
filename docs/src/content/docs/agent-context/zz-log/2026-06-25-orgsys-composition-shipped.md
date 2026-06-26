---
title: .orgsys composition shipped (preview-only, v0.1.33) — and the adversarial holes it had
description: Composition (mounts / at-glob / extends / rebind) lets a .orgsys system nest another system inside it, e.g. JD under every entity's Output. Shipped preview-only. The adversarial pass caught two critical defects and a high-severity install-time gap the golden test could not see — all patched or explicitly deferred.
tags: [session-log, composition, orgsys, taxonomy-workbench, adversarial, shipped, known-gaps]
sidebar:
  label: "06-25 · Composition shipped (0.1.33)"
  order: -20260625002
date: 2026-06-25
---

## What shipped

Phase 1 composition for the [Taxonomy Workbench](/obsidian-folder-tag-sync/agent-context/glossary/), v0.1.33. A `.orgsys` definition can now compose other systems:

```yaml
mounts:
  - snap: jd
    at: Entity/*/Output     # one anchor per entity → JD numbering inside each
```

- `mounts: [{ snap, at, rebind?, disable? }]` — snap a registered system onto an anchor.
- `at:` resolves literal paths (one anchor) or `*`-globs against the vault folder list (one anchor per match), reusing anchored-instance logic.
- `extends` inherits axes/defaults from a base; `rebind`/`disable` adjust a mounted system's slots.
- A mounted system's tags get the host's namespace via `scopeRule`'s `tagScope` — JD under `Entity/Cybersader/Output` emits `#--cybersader/01-projects`, matching the rule `seacow-templates.json` hand-writes today.

**Preview-only:** composition is shown in `OrgsysPreviewModal` (the "Load composed example" preset). It is NOT yet installed into settings or synced — that scoping is load-bearing (see deferred gaps).

## The adversarial pass earned its keep (again)

The implement agent's golden test passed — but it only mounted JD (template-shaped) on a *clean* vault. Two independent adversaries found that composition would break silently on real vaults:

- **Critical — glob bypassed emoji/JD normalization.** `resolveMountAnchors` matched the raw path, so `Entity/*/Output` silently missed `Entity/Cybersader/📁 01 - Output` → the whole mounted sub-system vanished with no error. The plugin's own audience uses decorated folders. **Fixed**: per-segment match through `folderNormalize` (`normalizeSegments`), returning the raw path as the anchor; tag-scope also normalizes the host path so the namespace isn't garbled.
- **Critical — literal/enumerative mounts doubled tags.** Mounting PARA emitted `#projects/projects` and broke inverse, because `scopeRule` replaced the bucket entry point. **Fixed**: `ScopeOptions.entryPointMode: 'replace' | 'prepend'` (default `replace` keeps the 19 existing scope tests green; composition uses `prepend`).
- **Critical — mount cycles stack-overflowed.** No visited-guard. **Fixed**: a visited-set threaded along the compile path; cycles skip + warn.
- Plus: anchor/id dedup, group stamp now `host@snap@anchor`, multi-level `extends`, and a `warnings[]` channel surfaced in the modal.

Verified: golden test, an independent re-run of all three critical cases (decorated-vault mount, PARA round-trip, cycle), 995 unit tests, and a real-Obsidian E2E (the composed example expands the mount in-app).

## DEFERRED — known gaps for the "install composition into sync" phase

These do NOT bite in preview-only mode but MUST be solved before composed rules are installed/synced (documented in `compileSystemDef.ts`'s header):

- **H1 (high) — deeper-wins isn't persisted.** Nested rules out-rank the host only because the preview passes `composedGroupPrecedence(pack)`. The precedence uses dynamically-named groups (`host@snap@anchor`) that aren't carried with the rules; the live sync engines read `settings.groupPrecedence`, which won't contain them. **Before install:** bake precedence into rule priorities, or persist the groups. Without this, a synced composed pack lets the shallow host rule wrongly win.
- **M1** — two entities that kebab to the same namespace (`Cyber Sader` / `Cyber-Sader`) collide forward + mis-file inverse.
- **M6** — a glob whose last `*` doesn't align with a host slot → empty namespace (now warned).
- Parser flow-*mapping* `{a: b}` is silently dropped (only flow *sequences* `[...]` parse); `rebind: ""`; snapped tag face without `#`.

## Lesson

A golden test on the canonical happy path is necessary but not sufficient — it proved JD-on-clean-vault and would have shipped a feature that silently corrupts on decorated and literal-system vaults. The two-adversary "try to break it" pass is what made composition actually correct. Keep it on every non-trivial engine feature.
