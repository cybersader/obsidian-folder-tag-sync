---
title: Decisions
description: Key technical decisions, with context and reasoning.
sidebar:
  order: 2
---

This is a running log of technical decisions. Each entry states **what** was decided, **why**, and **what was rejected**.

## Architecture

### Deterministic rule engine, not AI

**Decided:** Use regex patterns + transformation pipelines. Never use LLMs or embeddings for categorization.

**Why:**
- Output is predictable. Same input → same output, every time.
- Users can test rules without running a model.
- No network calls, no tokens, no cost.
- Works fully offline.

**Rejected:** AI-assisted "suggest a tag for this note" feature. Smart Connections and other plugins already do this well; mixing it in would blur the plugin's purpose.

---

### Four-stage transformation pipeline with fixed order

**Decided:** emoji handling → number prefix → case conversion → custom regex. Each step is optional.

**Why:**
- Most real-world naming has these four concerns in that order (`📁 01 - My Project` → strip emoji → strip number → snake_case).
- Fixed order keeps rules predictable.
- Custom regex at the end lets users add project-specific cleanup without affecting the pipeline shape.

**Rejected:** Arbitrary user-ordered pipeline. Too many ways to write subtly-broken rules.

---

### Specificity-aware matching is primary; priority is the manual override (F1)

**Decided:** When several rules match, a deterministic **specificity score** (`calculateMatchConfidence`) is the primary sort key — literal-character count, path-depth slashes, and an anchor-aware bonus, with greedy wildcards penalized heaviest. The user-set `priority: number` is demoted to a within-group tiebreak (the manual "override"). Across packs, [group precedence](/obsidian-folder-tag-sync/agent-context/glossary/) partitions rules first (CSS `@layer`-style).

**Why:**
- A more literal/anchored pattern is *genuinely* more specific; a raw priority number couldn't express that and forced users to hand-tune numbers.
- Still fully deterministic — same input → same winner, every time — so it satisfies the "no non-determinism" constraint that originally argued against score-based matching.
- Group precedence lets independently-authored packs coexist predictably.

**History:** This supersedes the original "rule priority is a number, first-match wins" decision. The earlier rejection of "score-based best-match" was about *non-deterministic* scoring; a deterministic specificity score is a different thing and is now the primary resolver. Shipped in F1 (`src/engine/ruleMatcher.ts`).

---

### Tags stored in frontmatter `tags:` array

**Decided:** Always use YAML frontmatter `tags:` array for folder→tag sync.

**Why:**
- Matches Obsidian's canonical tag storage.
- Interoperates with other plugins (Dataview, Templater).
- Preserves inline tags — folder sync never strips them.

**Rejected:** Inline tag writing (`#tag` in body). Too invasive; would conflict with user's own inline tags.

---

### Both sync directions share the same transformation pipeline

**Decided:** `folderTransforms` and `tagTransforms` are separate fields on a rule, but the transformation pipeline code is shared.

**Why:**
- Composability. A user can define one rule with both directions and different transforms for each side.
- Same pipeline code path = fewer bugs.

**Tradeoff:** The type system has to allow both fields even when only one direction is used. Worth it.

---

### Auto-sync is forward-only; the inverse direction stays manual

**Decided:** Folder→tag sync auto-fires on vault `create`/`rename` events (per each rule's `syncOnFileCreate`/`syncOnFileRename`/`syncOnFileMove` flags). Tag→folder sync — which *moves files* — never auto-fires; it requires explicit command invocation.

**Why:**
- Forward sync is purely additive: worst case is extra frontmatter tags the user can delete. Safe to automate.
- The inverse direction moves files and is potentially destructive — [lossy](/obsidian-folder-tag-sync/agent-context/glossary/) rules can't recover original folder names, so auto-firing moves on every file event is unsafe.
- Keeps the dangerous direction behind a deliberate, previewable action.

**History:** Supersedes the original "no automatic sync on file events (yet)" decision. Auto-sync shipped in 0.1.18 (`src/main.ts` registers `vault.on('create'/'rename')` → `autoSyncOnEvent`), but deliberately forward-only.

## Detection & application UX (the 0.1.22–0.1.27 arc)

These decisions came out of making the plugin usable on real, large vaults. Full narrative in the [2026-04-30 log](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-30-detection-ux-and-auto-scope/); terms in the [Glossary](/obsidian-folder-tag-sync/agent-context/glossary/).

### Packs are invisible plumbing — detection is hierarchy-first

**Decided:** The detection surface renders the user's own folder tree with per-folder detection chips, not a list of “packs found.” This interaction now lives in Workbench Scope; pack identity remains secondary plumbing rather than the primary navigation level.

**Why:** Users think in terms of their vault's folder tree, not which pack (PARA/JD/SEACOW) detected what. Surfacing packs as the primary level forced users to reverse-map pack names onto their own structure. Hierarchy-first makes the user's structure the navigation surface and lets the plugin handle pack plumbing underneath.

**Rejected:** Both per-pack cards and per-anchor cards — they still organize around packs. The interaction first shipped in 0.1.25 and now lives in `src/ui/workbench/WorkbenchScopePanel.ts`.

---

### Detection is anchored to instances, not just pack-presence

**Decided:** A vault scan groups a pack's hits into [anchored instances](/obsidian-folder-tag-sync/agent-context/glossary/) (clusters sharing a common parent), so the UI shows "JD at root AND at `Projects/Cybersader/`" rather than one ambiguous "JD detected."

**Why:** The same pattern recurs at multiple nesting points in real vaults (e.g. entity-scoped JD sub-hierarchies). Reporting only "pattern X detected" loses the *where*, which is exactly what the user needs to decide where to scope rules. Shipped 0.1.24 (`extractInstances`).

**Workbench refinement (2026-07-29):** Occurrences are now first-class detection output rather than a UI extraction pass. Evidence is scored locally by semantic roles or folder paths; support evidence attaches to the nearest member-seeded occurrence and cannot seed one alone. Actionability belongs to each occurrence, not to a pack-wide score.

---

### Organizational systems are lifecycle-shaped occurrence objects; installed Rule layers stay separate

**Decided:** The persistent Workbench shell keeps a compact occurrence summary available across Map, Scope, and Candidates. Full cards live in a responsive browser: a collapsible side column at wide Workbench widths and a temporary drawer at narrow widths. Folder rows carry typed member/support relations to every applicable occurrence. Candidate provenance is exact by `occurrenceKey`; installed rules remain grouped separately by runtime `MappingRule.group` as **Rule layers** inside a collapsed disclosure.

**Why:** A folder such as `Projects` is evidence for a PARA role, not independently “a PARA.” Users need to inspect and act on the coordinated group (`PARA at Work`) while still navigating through folders. Runtime rule precedence and system identity are related but not equivalent.

**Honesty boundary:** Installed rules do not yet carry durable deployment provenance. Associations from a Rule layer to occurrences are labelled **inferred** or **unknown**, never ownership. The deck is a current-snapshot read model, not a durable deployment registry.

**Interaction boundary:** Non-actionable occurrences remain available for inspection but cannot create Scope deployments or candidate plans. The novice-facing browser classifies them under collapsed **Organizational systems needing more folders** instead of asking users to manage an unexplained incomplete-visibility preference. Textual relation chips remain the semantic and visual relationship source; arbitrary pack-colour rails/tints and selected-only SVG connectors remain rejected.

**Responsive boundary:** “Persistent” means the summary, selection, and access remain available—not that the full card deck permanently consumes vertical height. Presentation is classified from the Workbench body's and active panel's measured width *and* height. The systems browser becomes a side column only when both dimensions can support it; otherwise it is an overlay. Crossing a layout tier never overwrites the user's explicit browser open/closed choice.

**Tree-first split refinement (2026-07-31, unreleased):** Map has one stable primary scroller: the hierarchy. The shell, active panel, and Map root do not scroll. Permanent explanatory copy and five diagnostic cards yield to a compact toolbar/summary as space tightens. Folder detail is a side inspector only when width and height permit; otherwise it overlays without reducing tree height. Expansion, relation disclosure, scroll offset, and focus-return path are view-local navigation state, not persisted detection/planning state.

**Relation-density boundary (2026-07-31, unreleased):** Exact occurrence relations remain keyed by `occurrenceKey`, but every row no longer renders every relation as a full multi-line card. Collapsed rows show one deterministic relation plus `+N systems`; deliberate expansion reveals all exact relations and anchors. The folder disclosure, folder inspection action, and occurrence focus action are separate controls with separate keyboard/propagation behavior.

**Semantic-legibility refinement (2026-07-30):** Every important Workbench object must answer four questions visibly: what is this, where is it in context, what state is it in, and what happens if I act on it? A shared semantic-path renderer separates muted parent context from the emphasized applicable segment while preserving a complete accessible label. Object labels distinguish System occurrence, Candidate rule, and Runtime layer; lifecycle/consequence copy distinguishes actionable from inspect-only; colour remains supporting rather than authoritative.

**Task-oriented refinement (2026-07-31, unreleased):** Visible navigation is **Explore your vault → Choose where rules apply → Review proposed rules** while internal `map | scope | candidates` values, command IDs, and routes remain stable. Card focus alone does not silently constrain planning; the explicit **Choose where this system applies** action seeds Scope from a Ready occurrence's exact anchor. Scope checkboxes remain the planning decision. Proposed rules remain selected by default because the preceding area choice is deliberate and persistence is still disabled/confirmed; **Save N draft rules** never arms sync.

**Same-day evidence correction:** The full browser is a global **Organizational systems in this vault** overview, not a selected-system detail pane. Selected evidence expands beneath the chosen card and scrolls with the card list. The earlier “sticky selected detail above the lists” description is superseded because it over-weighted the current selection and obscured the browser's vault-wide role.

**Interaction consequence boundary:** Focusing a system only coordinates that exact occurrence across surfaces. In Scope, focus is context—not a filter—and may be labelled **Current organizational system** or **Current focus**. A checked folder includes every Ready occurrence below it without replacing occurrence anchors or excluding unfocused occurrences. Focusing a proposed-rule group or exact conflict target does not check or uncheck rows. Only the separately confirmed save action persists checked proposals, still disabled.

**Occurrence-marker boundary (2026-07-31, unreleased):** Exact `occurrenceKey` values receive deterministic, render-order-independent markers so one occurrence can be followed across the summary, cards, hierarchy relations, Scope context, and deployment plan. The marker hashes the full occurrence key rather than the pack prefix, so repeated deployments of one pack need not share a marker. The palette is intentionally small and may repeat; markers are `aria-hidden` secondary cues. Text, exact paths, status, relation labels, and occurrence keys remain authoritative.

**Scope presentation boundary (2026-07-31, unreleased):** Scope owns two explicit scrollers—folder chooser and plan—joined by a focusable horizontal separator. Pointer drag, Arrow Up/Down, Shift+Arrow, Home/End, and double-click resizing are supported with separator ARIA values. Preferred plan height and both scroll offsets are view-local presentation state owned by the Workbench host; they are not persisted detection/planning state. Rows reserve rail, checkbox, and disclosure slots so changing topology or state does not horizontally shift the controls.

**Candidate explanation boundary (2026-07-31, unreleased):** Candidate reversibility is presented independently for **Folder → tag** and **Tag → folder**. A global lossy verdict must not be misreported as loss in both directions when template/typed evidence identifies only one side—or identifies neither. Conflict review names exact proposed and installed targets, lets proposed targets focus their exact row without changing selection, routes installed targets to the exact Settings row, and renders the exact predicted winner name.

**Publication boundary (2026-07-31):** This follow-up is local documentation and invented UX-lab evaluation only. It does not authorize a version bump, commit, push, tag, GitHub Release, docs deployment, BRAT publication, screenshot publication, or use of private production topology. Publication is a separate decision after complete verification.

**Freshness boundary:** The plugin increments a monotonic Workbench source revision after successful settings saves and folder create/delete/rename events. Open views mark snapshots stale immediately, pause candidate installation, debounce recollection, and recheck the revision before persistence.

---

### Auto-scope rewrites rule entry-points instead of installing vault-wide

**Decided:** Selecting a branch in the detection tree rewrites the applied rules so they only fire inside that branch — `folderPattern`/`folderTemplate`/`folderEntryPoint` get the scope path anchored in, and the rule `id` gets a scope-slug suffix so multiple scoped instances of the same pack don't collide. `minimalScopeCover` drops descendant selections so overlapping scopes don't double-fire.

**Why:** The hierarchy-first view *promises* that rules become local to the chosen detected instance rather than firing at every occurrence in the vault. Without rewriting entry-points, a pack's rules would fire wherever their original pattern matched. Shipped 0.1.27 (`src/engine/scopeRules.ts`).

**Workbench refinement (2026-07-28):** A selected Scope branch is now an inclusion boundary. Each detected hit cluster is deployed at its shared parent, preserving the actual instance anchor and preventing direct-signal choices from generating duplicated shapes such as `Projects/Projects`. Literal rule entry points are prepended, not replaced, so nested PARA emits `#projects/web` rather than `#projects/projects/web`.

---

### Vault-wide sync ships as an interactive hierarchical preview, not a flat dry-run list

**Decided:** Pending folder→tag changes render as a collapsible folder tree with a per-rule colour legend that doubles as a filter; the user checks/unchecks subtrees ([tri-state](/obsidian-folder-tag-sync/agent-context/glossary/)) and commits only the selected paths.

**Why:** A flat list of thousands of pending changes is unreviewable. A folder tree mirrors how users think about their vault and lets them approve/reject by branch; the legend makes "which rule is doing this" visible at a glance. Shipped 0.1.23 (`VaultSyncPreviewModal`).

---

### `removeOrphanedTags` (A6) is implemented using the F3 witness as the ownership discriminator

**Decided:** On forward sync, FTS-owned tags recorded in a file's `fts:` witness that are no longer emitted get removed; tags FTS never wrote are left alone.

**Why:** Naive orphan cleanup risks deleting user-authored tags that happen to match a rule's shape. The [frontmatter witness](/obsidian-folder-tag-sync/agent-context/glossary/) records exactly which tags FTS wrote, so cleanup removes only previously-FTS-written tags no rule still emits. This resolved the "A6 depends on F3" gap by shipping both together (0.1.18, `src/sync/FolderToTagSync.ts`).

---

### Normalize emoji/JD prefixes before matching, rather than forcing pack authors to enumerate variants

**Decided:** The detection scan and rule preview apply the same emoji-strip + whitespace + JD-prefix normalization the runtime pipeline does, *before* matching folder names against detection regexes / rule patterns.

**Why:** Real vaults use decorated folders (`📁 10 - Projects`). Pack regexes like `^\d{2} - ` failed to match these even though the runtime would strip the emoji. Per the principle "detect things without creating yet more schemas on the import side," the engine normalizes input before matching rather than making pack authors enumerate emoji variants. (`src/engine/detectPacks.ts` `matchesNormalized`.)

## Taxonomy Workbench consolidation (2026-07-28)

### One user-facing Workbench; modular engines underneath

**Decided:** Consolidate known-system detection, deployment scoping, proposed-rule review, and installation into one persistent Taxonomy Workbench. Internal surfaces remain `map`, `scope`, and `candidates` for compatibility; visible jobs are **Explore your vault**, **Choose where rules apply**, and **Review proposed rules**. Keep detection, hit collection, scope planning, candidate planning, state reconciliation, pack loading, and install reduction as independent pure/testable modules.

**Why:** The old Detect and Scan & Snap modals plus the Map were three implementations of one mental workflow. They duplicated vault scans, pack loading, UI chrome, and persistence behavior, and they made users decide which product to open before they could answer one question: “What systems are here, where should they apply, and what rules would that create?”

**Rejected:** (1) Keep all three product surfaces indefinitely; (2) collapse all domain logic into one ItemView monolith. The first preserves user confusion and drift; the second destroys testable seams.

---

### Only surfaced detections may become actions

**Decided:** A detection is actionable only when `score >= 1` and it is not suppressed by a missing required parent. Only this surfaced partition can create rails, selectable scope hits, deployments, exclusivity warnings, or candidates. Below-threshold and suppressed results may be shown as explanatory diagnostics only.

**Why:** Weak evidence is useful context but unsafe input to an install path. The boundary is centralized in `isSurfacedDetection` / `partitionDetectionResults` and enforced again by `collectCrossPackHits` so later callers cannot accidentally promote a weak match.

---

### Workbench drafts install disabled

**Decided:** Every newly added Workbench rule is persisted with `enabled: false`, regardless of the source pack's enabled state. Existing rules retain their enabled states. Selection means “add this draft,” not “arm sync.”

**Why:** Candidate preview intentionally analyzes enabled copies so coverage and conflicts are meaningful, but installation is a separate safety boundary. Adding drafts must not silently change current sync behavior, files, folders, tags, or frontmatter. Users review the rules in Settings and enable them deliberately.

**Rejected:** Candidates enabled by default (the earlier Scan & Snap design). That made one confirmation simultaneously authorize persistence and active automation.

---

### Inverse-only previews must say what is not known

**Decided:** Do not run `tag-to-folder` candidates through the folder→tag preview pipeline. Label folder coverage as not applicable and tag-side conflict analysis as unavailable unless a complete tag inventory exists.

**Why:** Applying the forward runtime to an inverse-only rule can default a missing folder pattern to `.*`, fabricating all-folder coverage and emissions. A zero-conflict badge would also be false reassurance because folder inventory cannot prove tag-side non-collision. Disabled installation remains allowed, but the uncertainty must be visible in the row and confirmation.

---

### Preserve command IDs as routes into one leaf

**Decided:** Keep `scan-vault-for-systems`, `scan-and-snap-draft-rules`, and `taxonomy-workbench-open-map` for compatibility, but reduce them into Workbench state and reuse an existing Workbench leaf when possible.

**Why:** Existing hotkeys and user habits keep working while duplicate modal implementations disappear. Reusing one ItemView also allows workspace persistence and avoids losing unrelated transient choices through detach/recreate routing.

---

### Embed built-in packs in `main.js`

**Decided:** Generate a validated full `rule-packs/catalog.json`, statically import it through `BundledRulePackRepository`, and bundle it into `main.js`. Runtime built-in detection/drafting/browsing must not depend on a `rule-packs/` directory.

**Why:** BRAT and Obsidian plugin releases conventionally ship `main.js`, `manifest.json`, and `styles.css`. Earlier E2E staging of pack JSON hid a production packaging gap. The embedded catalog makes the tested layout match the released layout.

---

### `.orgsys` composition remains preview-only

**Decided:** The consolidation does not make composed `.orgsys` definitions installable.

**Why:** Composed group precedence is not yet persisted. Installing composed rules before solving that boundary could change rule winners after restart, which violates deterministic and preview-honest behavior.

## Support and diagnostics

### Support bundles are preview-first, folders-only, and local

**Decided:** Production troubleshooting uses an explicit in-app preview that copies one local support bundle only after the user selects **Copy**. The default inventory includes the complete relative folder hierarchy but no note filenames, note contents, frontmatter values, vault name, absolute paths, or note-derived tag inventory.

**Why:** Folder Tag Sync behavior depends heavily on hierarchy and rule configuration, so a folder tree is useful evidence. Note-level data is rarely needed to diagnose the mapping engine and would create substantially more privacy risk. The user can test from a BRAT-installed production vault without granting filesystem access or uploading anything automatically.

**Scale boundary:** Aggregate detection/rule counts are computed across the complete folder inventory, but retained per-folder diagnostic rows are emitted only for rule-matched folders and capped at 2,000. Uncovered folders are reported through `uncoveredFolderCount` rather than one null row each — the first real production bundle (1,700 folders, no rules installed) was 70% empty rows, and dropping them cut it from 544 KB to 95 KB with no information lost. The complete folder tree is not capped. The modal's rule scan yields between chunks and cancels superseded/closed collection generations so a large production vault does not monopolize the UI or publish stale results.

**Rejected:** Automatic telemetry/upload, note-content sampling, a zip of the vault or plugin directory, and retaining unbounded per-folder rule-match arrays in memory.

---

### Readable names by default, deterministic anonymization on demand

**Decided:** The support modal opens in readable mode so relative folders and configuration can reproduce real behavior, but it displays the exact payload before copy and offers an **Anonymize names** toggle. Anonymization uses stable category aliases for folders, rules, groups, tags, patterns, templates, and custom literals while preserving hierarchy, repeated identity, enabled states, transforms, coverage, and conflicts.

**Why:** Always-raw output is easy to overshare; always-anonymized output can make concrete support examples harder to understand. Preview plus an optional structural anonymizer lets the user choose based on the sensitivity of the vault without rescanning or changing the underlying snapshot.

**Rejected:** Reversible alias maps and persistent cross-bundle aliases. Both would create a new sensitive artifact.

---

### Debug logs are structured, bounded, retained, and sanitized at export

**Decided:** Debug logging writes versioned JSONL under `.obsidian/plugins/folder-tag-sync/debug.log`, appends through a serialized queue, rotates at a fixed size with one backup, and is no longer cleared at startup. Support bundles include only a bounded recent tail and sanitize it again at the final serialization boundary.

**Why:** A persistent bounded timeline is much more useful for reproducing production failures than a log erased on every reload. Final-boundary sanitization prevents a new or overlooked log field from bypassing the bundle's privacy policy.

**Rejected:** Unbounded logs, read-and-rewrite appends, and copying the raw log file directly.

## Tooling

### Bun over npm

**Decided:** Bun is the primary package manager and test runner.

**Why:**
- ~10× faster install than npm on a cold start.
- Bun's test runner is drop-in compatible with Jest-style tests.
- Matches the workspace pattern (portaconv, portagenty, cyberbaser all use Bun).

### esbuild, not tsup or webpack

**Decided:** Stick with Obsidian's sample-plugin esbuild setup.

**Why:**
- Fast enough.
- Obsidian-sample-plugin convention; reviewers recognize it.
- Zero config needed for our needs.

### Astro + Starlight + Nova for docs

**Decided:** Match crosswalker's docs stack.

**Why:**
- Nova theme has the right density for a plugin reference site.
- Starlight has pagefind search, sidebar auto-generation, and a healthy plugin ecosystem.
- Astro 6 is stable and fast.

**Caveat:** Nova's Tailwind usage requires `@source` directives in `global.css` — see [zz-log 2026-04-23](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-23-docs-site-setup/) for the regression.
