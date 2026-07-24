---
title: Current state
description: The "drop a fresh agent (or returning human) here and be oriented in two minutes" snapshot — where the project is, the live direction, and the open wall, as of v0.1.36.
sidebar:
  label: "Current state"
  order: 0.5
---

:::tip[Read this first]
This is the fast-orientation page. If you're a fresh agent or a human returning after time away, read this top-to-bottom, then skim the [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) for any unfamiliar term. It's kept current deliberately — if it's stale, fix it.
:::

**As of:** v0.1.36 released via BRAT with preview-first production support bundles and bounded structured debug logging · not yet in the Obsidian community catalog.

## What this plugin is, in one paragraph

Folders are a rigid single hierarchy; tags are a flexible overlapping (polyhierarchical) one. Folder Tag Sync bridges them with **deterministic, rule-based transformations** (regex + transform pipelines — never AI inference). A rule maps a folder shape to a tag shape and can run forward (folder → tag, additive: writes frontmatter tags) or inverse (tag → folder, moves files). Users get value without writing regex via **rule packs** (PARA, Johnny Decimal, SEACOW, …) they can detect in their vault or install from a catalog.

## Where we are right now

The engine is mature: two sync directions, a typed rule model, Path Lens templates, specificity-aware matching, frontmatter witness, bulk sync, known-system detection, `.orgsys` preview/composition, and the Taxonomy Workbench Map all ship. Tests use Bun plus real-Obsidian WebdriverIO coverage for settings, modals, context menus, clipboard behavior, and visual rendering.

The most recent campaign (v0.1.22 → 0.1.27) was one sustained push to solve the **"where do my rules apply / what will actually happen?" visibility problem** — the wall that made the plugin unusable on large real vaults. See the full arc in [zz-log 2026-04-30](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-detection-ux-and-auto-scope/). In short:

- **0.1.22** — interactive [hierarchical sync preview](/obsidian-folder-tag-sync/agent-context/glossary/) with selective apply (you see and pick the changes, by branch).
- **0.1.23** — [detection tree](/obsidian-folder-tag-sync/agent-context/glossary/): a scan now shows *where* in the vault each pattern fired.
- **0.1.24** — [anchored instances](/obsidian-folder-tag-sync/agent-context/glossary/): "JD at root AND inside Projects/X" reads as two distinct instances, not one blur.
- **0.1.25** — [hierarchy-first detection view](/obsidian-folder-tag-sync/agent-context/glossary/): packs become invisible plumbing; you navigate *your* folder tree.
- **0.1.27** — [auto-scope](/obsidian-folder-tag-sync/agent-context/glossary/) + [scope tint](/obsidian-folder-tag-sync/agent-context/glossary/): selecting a folder rewrites rules to fire only inside it, and the subtree visibly paints the reach before you apply.

## The active workstream — authoring at scale ("Scan & Snap")

**Visibility is solved end-to-end; rule _authoring_ at scale is the wall** — and as of 2026-04-30 we've **decided the approach** and started building it. Full design + decisions: [Authoring-at-scale design](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-authoring-at-scale-scan-and-snap-design/).

The design is **"Scan & Snap" (Vault Cartographer)** — a scan-first wizard that never opens blank: it walks your vault, narrates it back in SEACOW terms ("you're ~80% SEACOW-outer + JD; your Work axis is an open slot"), and hands you a populated, previewed, conflict-checked candidate-rule table composed from org-system Lego blocks snapped onto your real branches. It was the **unanimous** winner of a 3-judge design panel.

**Locked decisions:** ship the *safe* detection-driven path first (raw-structure synthesizer deferred to Phase 3); candidates **enabled by default** with junk sorted up; **read-only** (no folder creation in MVP); SEACOW axes presented as **labels**, not jargon dropdowns. A user insight to honor: an org-system block manifests two ways — *unfold at the current level* (map existing folders; MVP) or *create a container then unfold below* (Phase 4 `establish`).

**Build status through v0.1.35:** the Scan & Snap drafting flow shipped first (0.1.29), then the **Taxonomy Workbench** direction took over (the term "Scan & snap" was renamed; the command is now "Taxonomy Workbench: draft rules from detected systems"). Shipped since:

- **0.1.32 — `.orgsys` foundation + live preview.** A slot-based system-definition format (`orgsys.ts`) + `compileSystemDef` that lowers it to the existing rule-pack format (golden-tested). The **"Taxonomy Workbench: preview a system definition"** command (`OrgsysPreviewModal`) lets you edit an `.orgsys` and watch the compiled rules + emissions on your real folders update live. See [Taxonomy Workbench](/obsidian-folder-tag-sync/agent-context/zz-log/2026-06-25-taxonomy-workbench-orgsys/).
- **0.1.33 — composition (preview-only).** `mounts`/`at:`-glob/`extends`/`rebind` — nest a system inside another (JD under every entity's Output). An adversarial pass caught + fixed two criticals (literal-mount doubling, mount cycle) + the emoji/JD glob miss; install-time gaps (esp. H1: precedence not persisted) are **deferred + documented**. See [composition shipped](/obsidian-folder-tag-sync/agent-context/zz-log/2026-06-25-orgsys-composition-shipped/).
- **0.1.34 — the Map pane (first slice).** A dockable, full-height **`TaxonomyWorkbenchView`** (ItemView, ribbon icon + "Taxonomy Workbench: open the map" command) that renders the real vault folder hierarchy at scale with detected-system chips — the "big surface" the user repeatedly asked for. Read-only display; snap/manipulate gestures are the next slice. Shared renderer `annotatedTreeRender.ts`.

- **0.1.35 — Map sensing + the swimlane-rails appearance.** The Map now annotates each folder with what the user's *installed rules* do (`folderRuleView.ts`: winning rule, emitted tags, conflicts) via a Detected/My rules/Both toggle; click a folder for a drill-in detail; **right-click** context menu (show rules / open settings / preview sync); and a Map↔Settings round-trip (open-settings-and-scroll-to-rule, and an open-the-map button in Settings). Visual language (user's pick): systems render as **colored swimlane rails** in the left gutter, ordered outer→inner so nesting reads structurally (PARA-inside-JD), with a faint folder tint by the innermost system — replacing the confusing chip-stacking. `annotatedTreeRender.ts` + `analyzeSystemStacks`.

- **0.1.36 — Production support bundles.** A command/Settings entry opens an exact preview containing runtime/configuration JSON, derived detection + installed-rule diagnostics, a complete concise folder-only tree, and a bounded sanitized debug-log tail. Readable relative names are the default; **Anonymize names** deterministically aliases folders/rules/groups/tags/patterns/templates without changing relationships. Note filenames/content/frontmatter, vault name, absolute paths, and note-derived debug tag fields are excluded. Large-vault rule evaluation yields back to the UI in chunks; aggregate counts remain exact while retained per-folder detection/rule detail is capped at 2,000 rows. The debug logger now uses structured bounded JSONL at the correct plugin path, rotates, persists across reloads, and responds to the Settings toggle immediately.

**Verification status:** production build and Obsidian-community lint are clean; **1050 Bun unit tests pass**; all **9 real-Obsidian WDIO specs pass (60 tests total)**, including 7/7 support-bundle privacy/clipboard/refresh tests plus typed-model and Workbench regressions; and the docs build/content smoke is **33/33 green**. The performance suite includes a 10,000-folder vault with 25 simultaneously matching rules, exact aggregate assertions, and bounded retained diagnostics. Also unrelated: GitHub issue #1 (duplicate frontmatter tags) was fixed + shipped (0.1.31) via the adversarial loop. Hot Reload is installed in the dev vault so builds drop straight in.

**Awaiting user reaction** to the rails appearance (they care about it looking good — open to tuning rail width/tint/legibility). **Next slices** (all on existing seams): interaction on the Map (snap a system onto a branch → live coverage/conflict via `scanAndSnapPlan`); making composition INSTALLABLE (solve the deferred H1 precedence-persistence); then the wizard/WorkspaceConfig and export/establish. Full plan in the Taxonomy Workbench design entry.

## Community-plugin submission status

Not yet accepted into the Obsidian community catalog (a [submission PR stalled — see zz-log 2026-04-13](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-13-submission-pr-stalled/)). The reputation/grading system on community.obsidian.md is downstream of *acceptance*; the gate is passing Obsidian's automated review, which `eslint-plugin-obsidianmd` mirrors locally.

**Current `npm run lint` status:** clean. ESLint uses `eslint-plugin-obsidianmd` for submission-critical sentence case, settings-heading, forbidden-element, sample-name, and manifest checks; test/spec files are excluded from the production type-aware lint project. Continue running lint together with build, unit tests, and the real-Obsidian E2E suite before any community-submission retry.

## Reading order for a fresh session

1. **This page** — where we are + the live direction.
2. [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/) — every project term, plain-language, with code locations. Use it the moment a term is unfamiliar.
3. [Vision](/obsidian-folder-tag-sync/agent-context/vision/) — the problem and long-term goals.
4. [Decisions](/obsidian-folder-tag-sync/agent-context/decisions/) — what's settled and why.
5. [Open questions](/obsidian-folder-tag-sync/agent-context/open-questions/) — what's genuinely undecided.
6. [Exploration log](/obsidian-folder-tag-sync/agent-context/zz-log/) — dated session history, newest first.

:::note[Known-stale elsewhere]
Some `about/` pages still trail reality (e.g. `about/development-status.md` says "v0.1.7 beta"; the roadmap's "Rule Analytics" item lists shipped features as future). The `agent-context/` docs are the source of truth for internal state; treat `about/*` version/status claims with suspicion until reconciled.
:::
