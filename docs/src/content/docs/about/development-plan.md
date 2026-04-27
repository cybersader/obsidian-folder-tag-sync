---
title: Development plan — UX-first sequencing
description: A user-journey-driven development plan covering all the in-flight architectural improvements (specificity-aware matching, path templates, hybrid frontmatter witness, conflict-resolution UI, plugin API, orphan/relation-tag semantics). Sequences the work by what users actually experience as each ships. Companion to the roadmap (which is the feature inventory); this is the path through them.
sidebar:
  order: 2
---

This page is the **execution sequence** through the work items inventoried in the [roadmap](/obsidian-folder-tag-sync/about/roadmap/). The roadmap lists *what* could ship; this plan orders the work by *what users experience as each piece lands*.

Source material: [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/), [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/), [Path abstractions Part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) + [Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/), [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/), Challenge 07 findings, and the brainstorming log. The plan doesn't introduce new design — it sequences what's already been designed.

## Design principles

These three principles thread every increment below. They're not negotiable; they're the contract.

### 1. Progressive system — easy to start, powerful as you align it

The plugin's UX target is *progressive disclosure*: a novice user installs the plugin, picks a default rule pack from the catalog (PARA / JD / Zettelkasten / SEACOW-cyberbase), and sees their folders and tags stay in sync without ever touching regex, templates, anchors, transfer ops, frontmatter memory, or group precedence. The defaults work. The novice gets value on day one without learning a vocabulary.

As the user *aligns the system to themselves* — a custom organizational scheme, a multi-entity vault, a mixed regex-and-template pack, opt-in per-file recovery for lossy ops — the powerful authoring surfaces become available *progressively*. Each increment in this plan respects this contract: a novice never has to encounter advanced controls; an advanced user is never blocked by simplifications.

Concrete commitments:

- **Settings UI** uses progressive disclosure (advanced sections collapsed by default; "Show advanced" reveals templates / frontmatter memory / group precedence)
- **Rule editor** defaults to template mode (when Increment 2 lands); regex is one click away
- **Default rule packs** come pre-configured with sensible options (no opt-in flags required for common workflows)
- **Status indicators** explain what a rule does in plain English alongside the technical chip ("This rule preserves folder structure" rather than just "identity")

### 2. Testing partnership — the user is the validation partner per-increment

Every increment ends with a **User testing checkpoint** — concrete scenarios run against the test vault that confirm the increment behaves as designed. The user (the project owner) is the validation partner: each increment ships only after the checkpoint passes.

Findings from each checkpoint (audit reports, decision logs, behavior surprises) get logged to `agent-context/zz-log/` as we go, so the design history is recoverable and so future agents see the validation trail.

This isn't optional. An increment that "passes tests" but fails the user-testing checkpoint isn't shipped — it's revised. The unit test suite catches mechanical regressions; the user-testing checkpoint catches "this works in code but feels wrong" issues that mechanical tests miss.

### 3. Honest positioning — docs reflect what the plugin actually does

The plugin started as "regex-based folder ↔ tag sync." Today, with the typed model (Phase 2), layer-aware anchors (Phase G), eight library-science transfer primitives, and four shipped rule packs, "regex" is one option among many — not the headline. As Phase H (templates) and Increment 3 (frontmatter memory) ship, "regex" becomes one escape hatch in a typed system that most users will never directly touch.

The positioning has to keep up. README tagline, docs hero text, philosophy intro, and roadmap framing should reflect the plugin's *current* shape, not its founding shape. Repositioning is a planned milestone (mid-Increment 2 when templates land), not an afterthought.

The validation: a fresh reader (someone with no context) reads the README and describes what the plugin does. Their description should match the actual behavior. When the description and behavior diverge, the docs are out of date.

## The user journey, end-to-end

### Today's experience

A user installs the plugin, opens settings, and sees a list of rules. To author a rule, they choose between:

1. **The guided modal**: typed-field editor (folder entry, tag entry, transfer-op tile, transformation pipeline). Reasonably accessible if you've read the philosophy page; mysterious otherwise.
2. **The advanced modal**: raw regex pattern fields (`folderPattern`, `tagPattern`). Power-user surface; effectively gated behind regex literacy.

Once authored:

- **Forward direction** (folder → tag) fires when files move via Obsidian. Tags are added to frontmatter. Quietly works.
- **Inverse direction** (tag → folder) fires when tags are added in frontmatter. Files move. Often works, but for ambiguous cases (e.g. a tag that could match three rules, or a tag from a `marker-only` rule whose forward direction collapsed several folders) the engine silently picks the first-match-by-priority and the user finds out by noticing the file ended up somewhere they didn't expect.

The user also experiences subtle friction the engine doesn't explain:

- **"Why didn't my more-specific rule fire?"** — because priority is a flat scalar, not a specificity-aware sort.
- **"Why did this tag end up on a file in a folder that doesn't match the rule?"** — because no state remembers what FTSync wrote vs. what the user authored manually.
- **"What happens to this file's old tag if I delete the rule?"** — undefined; `removeOrphanedTags` is a checkbox in settings that doesn't do anything.
- **"Can other plugins read FTSync's mappings?"** — no documented API; consumers have to scrape `metadataCache` directly.

The mental model the user has to maintain is rich (rules + transforms + transfer ops + priority + direction + entry points) and the engine's behavior is mostly invisible, occasionally wrong, and not introspectable.

### Target experience (after all increments land)

A user opens settings and sees:

1. A **rule list** that surfaces, per rule: which abstraction it uses (regex / template / marker-only), its bijection status (round-trips / lossy-by-design / lossy-with-frontmatter-recovery), how many files it touches.
2. A **guided authoring flow** that's templates-first — the rule shape is a path-pattern with named slots; regex is the escape hatch, surfaced when no template fits.
3. A **conflict prompt** when the inverse direction is ambiguous — "this tag could go to three places; pick one (and remember this choice)."
4. **Per-rule frontmatter memory** as an opt-in toggle — for lossy ops where the user wants exact recovery on inverse, frontmatter origin is recorded per-file and the inverse round-trips.
5. **A "where does this tag live?" inspector** — clicking a tag shows which rule produced it, when it was last synced, what folder it would map back to.
6. **A documented plugin API** so Templater, QuickAdd, Dataview, and others can integrate cleanly.

The mental model the user maintains is the same — rules + slots + transforms — but the engine *explains itself* at every decision point. Surprises shrink toward zero.

## How to read the increments below — Foundation / Application / Polish

The increments are organized into **three tracks** that run somewhat in parallel:

- **Foundation track (F1—F4)**: load-bearing architectural primitives — what FTSync *is*. The user has been researching these because they affect the core abstraction. **Sequential by dependency** — each item names what it depends on; some pieces can ship in parallel (notably F2 and F3).
- **Application track (A1—A4)**: UX surfaces built on top of the foundation. Once their dependencies land, these can ship in parallel with each other and with later Foundation work.
- **Polish track**: long-tail nice-to-haves (rule pack marketplace, analytics, sync history, visual builder). After Foundation + Application stabilize.

Within each track, items are sequenced by **what users notice first**:

- **Invisible-positive** (rules just work better; user notices nothing changed but everything fits intuition more) — cheapest UX shift, lowest risk
- **Opt-in additive** (a new authoring surface coexists with the old; users adopt at their own pace)
- **Per-file state** (visible YAML changes; user has to consciously enable per rule)
- **Interactive UX** (modals fire when ambiguity arises; users learn by doing)
- **External boundary** (other plugins integrate; mostly invisible to end users)

**Mapping increments to F/A/P labels** (used in the [roadmap](/obsidian-folder-tag-sync/about/roadmap/)):

| Increment in this plan | Track label | What it is |
|---|---|---|
| Increment 1 | **F1** | Specificity-aware matching + rule groups |
| Increment 2 | **F2** | Bidirectional path templates |
| Increment 3 | **F3** | Hybrid frontmatter witness |
| (was item #15) | **F4** | Frontmatter-property-driven destination |
| Increment 4 | **A1** | Interactive conflict-resolution UI |
| Increment 5 | **A2** | Plugin API for Templater / QuickAdd / Dataview |
| Cross-cutting | **A3** | Attachment + folder-note handling |
| Cross-cutting | **A4** | Cross-device coordination + Obsidian Sync |

**Parallelism in practice**: F2 and F3 can ship concurrently (different code layers). F1 Step 3 (group field) can ship in parallel with F2 or F3. A1 (conflict UI) needs F1 stable but can ship in parallel with F3. A3 (attachments) is essentially independent — can ship anytime. The "order" below is the *recommended sequence for review*; actual implementation order depends on what's ready and what surfaces blockers.

---

## Increment 1 / F1 — Resolution-engine refinement (Foundation, invisible-positive)

**What users see**: nothing changes about how they author rules. Their existing rule lists keep working. But behind the scenes, when several rules could match the same input, the engine picks the *most specific* one rather than the *first by priority number*. Users with PARA-shaped intuition ("more specific should win") stop having to manually re-order priorities.

**What ships**:

- Refine `calculateMatchConfidence` (`src/engine/ruleMatcher.ts:156-185`) with anchor-aware specificity (Formula 3 from the [specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/)). Pure refactor; no behavior change because the score is still tiebreak-only.
- **Audit step**: run the new formula against shipped rule packs (PARA, JD, SEACOW-cyberbase, Zettelkasten); compare implied ordering to user-authored priorities. If they agree on >80% of within-pack rules, the next step is invisible.
- Swap sort order in `findBestMatch` (`src/engine/ruleMatcher.ts:97-117`): confidence becomes primary, priority becomes tiebreak override. **This is the candidate B landing.**
- Add tests for the [Challenge 01](/obsidian-folder-tag-sync/agent-context/zz-challenges/01-rule-priority-stress-test/) stress case.

**Then add rule groups (candidate C)**:

- New optional `group?: string` field on `MappingRule` (`src/types/settings.ts`). Default group derived from pack ID (e.g., `para.json` → `para`).
- Group precedence config in vault settings (drag-to-reorder list); default order derived from SEACOW axes when groups declare axes.
- `findBestMatch` partitions matches by group, sorts groups by precedence, applies specificity sort within the winning group.
- Settings UI: rename "Priority" field to "Priority (override)" with a tooltip; add group dropdown to rule editor.
- Backfill `group` field on shipped rule packs.

**Estimated scope**: ~150 LOC production + ~30 LOC tests. **2–3 commits.**

**UX checkpoint**: a user with rules `^Projects/(.+)$` (priority 10) and `^Projects/Web/(.+)$` (priority 20) finds that `#projects/web/auth` fires the second rule (more specific) without having to swap priority numbers. Imported rule packs no longer collide with each other.

**User testing checkpoint** (run before promoting Increment 1 Step 2):

1. **Audit-report review** — the agent runs the audit script after the formula refinement; user reads the markdown report comparing new-formula ordering vs. existing user-authored priorities on shipped packs. Go/no-go: do >80% of within-pack rules agree? If yes, proceed to sort-order swap. If no, surface specific disagreements and iterate the formula before promoting.
2. **Challenge 01 stress case** — in the test vault, install rules `^Projects/(.+)$` priority 10 + `^Projects/Web/(.+)$` priority 20; create a file under `Projects/Web/auth/`; verify the second rule fires (the specific one) without manual priority swap. Tag side: `#projects/web/auth`.
3. **Cross-pack composability** — install both PARA and JD rule packs into the same vault; create files under both naming conventions; verify they don't silently collide. Within each pack, verify the ordering still respects user-authored priorities for ties.
4. **Group precedence drag-reorder** (after Step 3 lands) — in settings, drag SEACOW group above PARA; create a file under `Entity/Cybersader/10-Projects/`; verify SEACOW's rules win the resolution.

**Composes with**: nothing required as prerequisite. Path templates (Increment 2) will benefit from this when slot-overlap becomes the natural specificity metric.

**Where to read more**: [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) for the algorithm design, [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) for the broader inverse-direction problem.

---

## Decision gate before Increment 2 — abstraction choice (templates / lens / hybrid)

Increment 2 commits to a specific authoring abstraction (path templates with named slots), but the broader question — **is this the right abstraction, or should we ship something closer to a lens calculus, or stay regex-first with better tooling** — has been researched but not finally settled. Before any code lands, surface the open questions to the user and discuss; don't just adopt the research's leaning recommendation.

**Questions to bring before starting Increment 2 implementation**:

1. **Templates vs. lens vs. hybrid**: the [Path abstractions Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) research surveyed seven candidates (regex / templates / slot-objects / OpenAPI-style / lens-flavored / TS-tagged literals / mini-DSL) and recommended templates as a peer to regex (hybrid coexistence). Confirm with the user that templates are the chosen abstraction shape — or pivot to a lens-flavored design if that's preferred.
2. **Slot syntax**: `{slug}` and `{rest...}` are URL-routing conventions. Alternatives: TypeScript-shaped (`<slug>`), Mustache-shaped (`{{slug}}`), explicit-typed (`{slug: string}`). Which feels right for an Obsidian plugin?
3. **Slot vocabulary**: pick canonical slot names for shipped rule packs (PARA `{project}`, JD `{number}`+`{topic}`, SEACOW `{owner}`, etc.). The [intuition pass](/obsidian-folder-tag-sync/concepts/terminology/) added some plain-English aliases; confirm or refine.
4. **Per-slot transforms** (`{slug | kebab-case}`): adopt Jinja-style filter syntax, or use a separate transforms map keyed by slot name? Affects authoring ergonomics significantly.
5. **Hybrid coexistence depth**: in v1 of templates, do we ship the loader normalizer that handles regex + templates in the same pack, or wait until v2? The Part 2 research says hybrid-from-the-start is feasible; confirm.
6. **Default mode**: when a user opens the rule editor, does the new mode toggle default to **template** (the new authoring surface) or **regex** (don't disrupt existing users)? Affects the rollout UX significantly.

**Process**: I bring these questions to the user *before* any Increment 2 code work. We discuss; the user picks; the development plan gets updated to reflect the choice; *then* implementation starts. No silent adoption of research recommendations.

---

## Increment 2 / F2 — Path templates as a peer to regex (Foundation, opt-in additive)

**Can run in parallel with**: F3 (frontmatter witness) — different code layers, no shared paths.

**What users see**: the rule editor gets a new top-of-pane mode toggle: **"Template" / "Regex"**. Template mode shows a single-line input with named slots (`Projects/{slug}` ↔ `#projects/{slug}`). Regex mode is the existing power-user surface, unchanged. New rules default to Template mode; existing regex rules stay regex.

A status indicator per rule shows its bijection state — *"This rule round-trips: both sides share slots [`slug`]"* (templates) or *"This rule's bijection is asserted from typed metadata"* (regex).

**What ships**:

- New `PathTemplate`, `SlotDef`, `CompiledTemplate` types (`src/types/typed.ts`). Optional `folderTemplate?` and `tagTemplate?` fields on `TypedRuleSpec` and `MappingRule`.
- Pure compiler in `src/engine/compileTemplate.ts`: parses `{name}` and `{name...}` slots, emits named-capture regex, exports `extractSlots` and `instantiateTemplate`. ~50 LOC + ~30 unit tests.
- `derive.ts` extension: when `spec.folderTemplate` is set, compile to `folderPattern` + slot metadata. `folderEntry` and `folderAnchor` derived from the template's literal prefix as back-compat surface.
- `applyTransfer.ts` extension: template-driven slot extraction; inverse via `instantiateTemplate`. Anchor-aware strip remains for legacy `folderEntry` + `folderAnchor` rules.
- Loader validation (`rulePackLoader.ts`) for template syntax.
- **Hybrid coexistence story** ships at the same time: regex rules and template rules in the same pack are both valid; the loader normalizes both to `MappingRule` so the sync engine sees one type.

**Then add the per-rule status indicator**:

- Computed at rule-load time from slot overlap (templates) or from typed-spec semantics (regex).
- Surfaced in the rule list and rule editor: a small chip with hover-explainer.
- Composes with Increment 1's specificity scoring — slot count becomes the cleanest specificity metric for template rules.

**Estimated scope**: ~250 LOC production + ~80 LOC tests. **4–5 commits.**

**UX checkpoint**: a user authors `Projects/{slug}` ↔ `#projects/{slug}` in the Template tab. Sees the green "round-trips" chip. Adds `#projects/web-auth` to a file → file moves to `Projects/Web Auth/` (with case transform reversibility for clean inputs). For lossy cases (e.g., a `marker-only` template), sees an orange "lossy forward" chip explaining what won't reverse.

**User testing checkpoint**:

1. **End-to-end template authoring** — user authors a new rule using template mode; types `Projects/{slug}` for folder side and `#projects/{slug}` for tag side; verifies the rule editor's status indicator turns green ("round-trips: shared slots [`slug`]"); no regex literacy required to author.
2. **Hybrid coexistence** — in the same rule pack JSON, mix one regex-shaped rule and one template-shaped rule; verify the loader normalizes both; verify the rule list shows the per-rule abstraction shape (chip "regex" vs. "template"); verify both run identically on matching inputs.
3. **Slot extraction round-trip** — author `Projects/{slug}/{tail...}` template; create a file at `Projects/Web Auth/oauth/notes.md`; verify forward sync produces `#projects/web-auth/oauth`; remove the tag and re-add it; verify inverse direction reconstructs the file's location.
4. **Lossy-template warning** — author a template with a slot only on one side (e.g., `{owner}` on folder side, missing on tag side); verify the editor shows the orange "matched but discarded" warning; verify the rule still saves but the bijection-status chip reflects the asymmetry.
5. **Repositioning sanity check** — alongside this increment, the README + roadmap + philosophy positioning gets updated. Fresh-reader test: have someone unfamiliar describe what the plugin does after reading the README. Their description should mention "templates with slot capture" as the primary mode; "regex" should be mentioned as an escape hatch, not the headline.

**Composes with**: Increment 1 (slot count is the natural specificity score; replaces regex-shape heuristics for template rules); Increment 3 (templates make slot-level frontmatter origin tracking trivially structured).

**Where to read more**: [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) (the framing), [Path abstractions, part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) (the hybrid coexistence story and per-rule communication).

---

## Decision gate before Increment 3 — frontmatter property approach for stateful

The [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) and the [Challenge 07 findings](/obsidian-folder-tag-sync/agent-context/zz-challenges/07-frontmatter-as-bijection-memory-validation/) recommend a hybrid design with a top-level `fts:` namespaced object. But **before any code lands**, surface the design choices to the user — the property structure and the philosophy shift are user-visible; getting them wrong creates migrations later.

**Questions to bring before starting Increment 3 implementation**:

1. **Namespace shape**: top-level `fts:` object (Challenge 07 recommendation) vs. `folder-tag-sync:` (more explicit) vs. underscore-prefixed `_fts:` (Obsidian convention for internal frontmatter)? Each has tradeoffs (verbosity, Obsidian Properties UI rendering, third-party plugin discoverability).
2. **Field set in v1**: minimum is `sig` (hash) + `rule` (rule ID). Do we ship `pv` (pipeline version) and `synced_at` (timestamp) from day one, or defer? `synced_at` breaks commutative writes for cross-device sync (Challenge 12 question); maybe wait.
3. **Hash function**: SHA-256 truncated to 8 hex chars (~32 bits, 1-in-4-billion collisions)? Or shorter (more readable, more collisions)? Or longer (more robust, more YAML noise)?
4. **Field-name conventions for slot-extracted origin** (when templates land in Increment 2): does the witness store the raw original folder path, or the extracted slot values (`fts.slots: { project: "Web Auth", tail: "oauth-flow" }`)? Affects what's recoverable on inverse and how the format evolves.
5. **Default behavior on existing tagged files** when a user enables frontmatter memory on a rule retroactively: backfill on enable (sweep + populate from current location), or stay empty until next sync? The migration UX is genuinely uncertain.
6. **Strip-on-export tooling**: ship a separate `fts:strip` command in v1, or defer to Phase 4? Some users will want to publish notes without the witness; others won't care.
7. **Cross-device sync (Challenge 12)**: should we wait for Challenge 12's findings (multi-device coordination) before shipping write-side, or ship behind feature flag and iterate? The Challenge-07 recommendation is "ship behind opt-in flag, idempotent writes only, no `synced_at`."

**Process**: same as Increment 2 — questions to user *first*, then implementation. The frontmatter property structure especially benefits from user input because it's user-visible YAML they'll see in their files for years.

---

## Increment 3 / F3 — Hybrid frontmatter witness (Foundation, per-file state, opt-in)

**Can run in parallel with**: F2 (path templates) — different code layers, no shared paths. F3 doesn't depend on templates landing.

**What users see**: a new toggle in the rule editor — *"Remember origin in frontmatter for bidirectional recovery"*. Off by default. When enabled on a lossy rule, files synced via that rule gain a small `fts:` block in their frontmatter:

```yaml
---
tags:
  - "-inbox"
fts:
  sig: "a3f2c1"
  rule: "inbox-marker"
  pv: 1
---
```

The inverse direction then reads this and moves the file back to its *exact* origin instead of falling back to the rule's entry folder. Lossy ops become bijective on a per-file basis.

A migration command surfaces: *"Backfill origin metadata for existing tagged files? [Yes / Skip]"*.

**What ships** — phased per the Challenge 07 findings:

### 3a. Passive witness (v0.2 in the findings doc)

- Write `fts.sig` and `fts.rule` whenever the engine acts on a file. Don't read it yet. No behavior change.
- Add the optional `frontmatterMemory: { enabled: boolean }` field to `RuleOptions` (`src/types/settings.ts`), default `false` for new and existing rules.
- Settings UI: per-rule toggle with explainer copy; warning callout when enabled on already-bijective ops (`identity`, `truncation/drop`).
- Tests for write-side determinism: same input → same `fts.sig`.

### 3b. Active disambiguator (v0.3 in the findings doc)

- Read `fts.*` in `TagToFolderSync.determineTargetFolder` (`src/sync/TagToFolderSync.ts:154-195`); if present and rule has `frontmatterMemory.enabled`, return the stored folder.
- Three-way diff per Unison: `(last_known_state, current_state, rules_say_state)`. The engine recognizes plugin-authored vs. user-authored tags via `fts.rule` presence.
- Composes with the orphan-handling design from [Challenge 08](/obsidian-folder-tag-sync/agent-context/zz-challenges/08-orphan-and-relation-tag-semantics/) — the witness directly answers "did FTSync write this tag?"
- Add `cache.json` reconstructible index alongside (`.obsidian/plugins/folder-tag-sync/cache.json`); not synced; rebuildable from frontmatter on plugin load.
- Migration command: backfill `fts.*` for existing tagged files where current location matches rule.

### 3c. Recovery + safety nets

- On `fts.*` mismatch with no current rule: treat as user-authored, leave alone, log warning.
- On `fts.rule` referencing a deleted rule: offer one-click cleanup (composes with Challenge 08 deliverables).
- On vault root rename / restore-from-backup: detect via stored `vaultUUID` + folder count delta; drop into "first run" mode if mismatch is large; show preview-diff before any writes.

**Estimated scope**: ~200 LOC production + ~50 LOC tests for 3a; another ~150 LOC + ~30 tests for 3b; ~50 LOC for 3c. **6–8 commits across three sub-phases.**

**UX checkpoint**: a user with a `marker-only` `Capture/Inbox/` rule enables frontmatter memory. Tags 5 files in inbox via FTSync forward sync; each gets `fts.sig` + `fts.rule`. Three weeks later, removes `#-inbox` from one file → the inverse direction reads the recorded origin and moves the file back to `Capture/Inbox/2026/Q2/notes.md` exactly. The user manually adds `#-inbox` to a file in `Drafts/` → no `fts.*` is present → inverse direction falls back to the rule's entry folder (today's behavior). The two-class problem is acknowledged honestly.

**User testing checkpoint** (per sub-phase):

After **3a (passive witness)**:

1. **Write-side determinism** — enable frontmatter memory on a `marker-only` rule; sync 5 files; verify each file's frontmatter gains `fts.sig` (deterministic — same input produces same hash) and `fts.rule`. No behavior change otherwise.
2. **Off-by-default safety** — verify that rules without `frontmatterMemory.enabled` produce no `fts.*` field. New users see no YAML pollution unless they opt in.
3. **Already-bijective warning** — try to enable frontmatter memory on an `identity` rule; verify the editor shows the warning callout ("This rule is already bijective; frontmatter memory provides no recovery benefit.").

After **3b (active disambiguator)**:

4. **Bijective inverse on lossy op** — with frontmatter memory enabled on a `marker-only` Inbox rule, sync 5 files (each gets `fts.origin`); remove the tag from one file; verify it moves back to its exact origin (not the rule's entry folder).
5. **Two-class behavior** — manually add `#-inbox` to a file in `Drafts/` (no `fts.*` present); remove the tag; verify inverse falls back to entry folder per existing behavior. Verify the orphan-handling distinguishes the two classes.
6. **Cache rebuild** — delete `.obsidian/plugins/folder-tag-sync/cache.json`; reload Obsidian; verify the cache rebuilds from frontmatter without prompts; verify behavior matches pre-deletion state.

After **3c (recovery)**:

7. **Stale-rule cleanup** — delete a rule that wrote `fts.rule: "old-rule"` to N files; verify the engine surfaces "N tags from removed rule; clean up?" rather than silent removal.
8. **Vault-root rename safeguard** — rename the vault root folder; verify the engine drops into "first run" mode rather than treating every file as an orphan; verify a preview-diff surfaces before any writes.

**Composes with**: Increment 1 (specificity + groups don't change the witness algorithm but determine which rule's witness gets read on multi-match); Increment 2 (slot capture from templates can populate richer witness fields); Increment 4 (when ambiguity surfaces and witness disagrees with current state, conflict UI fires).

**Where to read more**: [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) for the design space; [Challenge 07 findings](/obsidian-folder-tag-sync/agent-context/zz-challenges/07-frontmatter-as-bijection-memory-validation/) for the Unison/Syncthing-grounded validation.

---

## Increment 4 / A1 — Conflict-resolution UI (Application, interactive UX)

**Depends on**: F1 (need specificity scoring stable before defining "genuinely close" matches that warrant a prompt). **Composes with**: F3 (witness can show "this candidate has stored origin from previous syncs"). **Can run in parallel with**: F2, F3, A2, A3 once dependency satisfied.

**What users see**: when adding a tag where the inverse direction is genuinely ambiguous (multiple rules match, or a `marker-only` rule with no frontmatter origin and the user wants intentional placement), a modal fires:

> The tag `#projects/web-auth` could place this file in:
>
> - `Projects/Web Auth/` (PARA, root-anchored, full match) ★ recommended
> - `Entity/Cybersader/Projects/Web Auth/` (SEACOW + PARA composition)
> - `Archive/2026/Projects/Web Auth/` (Archive rule, low specificity)
>
> Pick one. Remember this choice for similar tags? [Yes / Just this once]

The modal is silent for unambiguous cases (single match, or specificity-clear winner). It surfaces only when the engine genuinely doesn't have enough information to pick.

**What ships**:

- Use the existing `findConflicts` machinery (`src/engine/ruleMatcher.ts:122-153`) — already detects same-priority collisions but is currently consumed only by preview UI. Promote it to runtime use.
- New conflict-resolution modal in `src/ui/`. Renders candidates with their bijection status, recommended choice, and "remember this choice" option.
- Per-tag remembered-choice persistence: a small `data.json` field mapping tag patterns → chosen rule ID. Cleared on rule-list changes.
- Configurable threshold: when does the modal fire vs. silently first-match? Default: fire when more than one candidate has within-10% confidence.

**Estimated scope**: ~100 LOC production + ~50 LOC tests + ~150 LOC UI (modal). **3 commits.**

**UX checkpoint**: a user with overlapping rule packs (PARA + SEACOW-cyberbase) adds an ambiguous tag; sees the modal; picks; the choice is remembered for similar tags going forward. No more silent surprise placements.

**User testing checkpoint**:

1. **Genuine ambiguity surfaces the modal** — install PARA + SEACOW-cyberbase + JD packs; create a tag whose pattern matches in multiple groups within ~10% confidence; verify the modal fires with all candidates listed; verify each candidate shows its bijection-status chip + recommended/not-recommended ranking.
2. **Unambiguous case stays silent** — create a tag that clearly matches one rule (high specificity, single group); verify no modal fires; the engine acts immediately as before.
3. **Choice memory** — pick a candidate in the modal; check "Remember this choice for similar tags"; create another file with the same tag pattern; verify the modal does not re-fire (the prior choice applies).
4. **Choice invalidation on rule change** — modify the rules underlying a remembered choice; verify the choice is invalidated; modal fires next time the tag pattern is encountered.
5. **Cancel / dismiss path** — open the modal, dismiss it without picking; verify no destructive action happens (file stays where it was; tag is added to frontmatter without movement).

**Composes with**: Increment 3 (the modal can show "this candidate has a stored origin from previous syncs" as a recommendation factor).

**Where to read more**: [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) candidate D.

---

## Increment 5 / A2 — Plugin API for external integration (Application, mostly invisible)

**Depends on**: F1, F2, F3 should all be reasonably stable so the API can commit to behavior it exposes. **Can run in parallel with**: A1, A3, A4 once dependency satisfied.

**What users see**: nothing visible in the FTSync UI. But Templater, QuickAdd, and Dataview plugin integrations gain documented hooks — *"You can call `app.plugins.plugins['folder-tag-sync'].api.getTagsForFolder(path)` from your Templater script."* Third-party plugin developers can build on top.

**What ships**:

- Read-only API surface: `getTagsForFolder`, `getFolderForTag`, `listRules`, `previewRuleApplication`. Synchronous variants where possible.
- Eventing: `ftsync.on('forward-sync' | 'inverse-sync' | 'rule-change' | 'vault-scan-complete')`.
- Consistency contract: documented mid-sync visibility (read-old default; configurable).
- Versioning policy: `ftsync.v1.*` namespace stable forever.
- **Defer** the write API and capability-gating to Phase 4+ pending real consumer demand.

**Estimated scope**: ~100 LOC production + ~30 LOC tests + documentation page. **2 commits.**

**UX checkpoint**: a Templater script that creates a new note can ask FTSync "what tags should this file get based on its folder?" and get the answer synchronously; reciprocally, a Templater "create note with this tag" macro can ask "what folder would this tag map to?" and place the file accordingly.

**User testing checkpoint**:

1. **Templater integration smoke test** — install Templater alongside FTSync; author a Templater script that calls `app.plugins.plugins['folder-tag-sync'].api.getTagsForFolder(tp.file.folder())`; verify the script runs synchronously, returns the expected tags, and Templater can use them to populate frontmatter at file-creation time.
2. **QuickAdd integration** — author a QuickAdd macro that uses `getFolderForTag(...)` to place new files at FTSync-determined folders based on user-selected tags; verify the round-trip works (forward direction in Templater, inverse direction in QuickAdd).
3. **Eventing subscription** — write a tiny test plugin that subscribes to `ftsync.on('forward-sync', ...)`; trigger a forward sync; verify the event fires with the correct payload (file, oldTags, newTags); verify unsubscribe works.
4. **Mid-sync visibility** — call `getTagsForFolder` during an active forward sync (use a long-running batch operation); verify the consistency contract is honored (default: read-old behavior; documented).
5. **API documentation page exists** — a new `docs/src/content/docs/reference/plugin-api.md` page is shipped alongside the API; consumers can find it without trial-and-error.

**Composes with**: all prior increments (the API exposes their behavior). Should ship *after* Increments 1–3 because the API has to commit to behavior the implementation supports.

**Where to read more**: [Challenge 10](/obsidian-folder-tag-sync/agent-context/zz-challenges/10-plugin-api-for-templater-and-quickadd/) — when an outside agent runs this challenge, the findings inform the exact API shape.

---

## F4 — Frontmatter-property-driven destination resolution (Foundation, future)

**The fourth foundation iteration.** Not in the original increment list because it depends on F2 (templates) landing first — slots are the natural carrier for property-sourced values. Worth its own research challenge dispatch before scope is fully settled.

**What the user experiences**: a rule's template can pull slot values from the file's frontmatter properties. A user with multi-entity work has files with `entity: cybersader` and others with `entity: bob`; the same tag `#projects/web-auth` routes to `Entity/Cybersader/Projects/Web Auth/` for the first and `Entity/Bob/Projects/Web Auth/` for the second — without authoring two separate rules. The rule editor exposes "this slot reads from frontmatter property X"; missing-property fallback is configurable per rule (default folder, prompt, refuse).

**Depends on**: F2 (templates as the slot carrier). Strongly benefits from F3 (the witness can record which properties were used to populate slots).

**Unlocks**: SEACOW context-as-disambiguator becomes a first-class part of the rule format; per-file destination resolution via arbitrary frontmatter properties beyond what the tag pattern alone can decide. Resolves the "smart context-aware system" thread from the [solution brainstorm](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) at a tractable scope.

**Open questions** (need a research entry before implementation):

- Schema: new `frontmatterConditions` field per rule, or extend slot syntax with property-source markers (`{entity:fromProperty}`)?
- Behavior on missing property: fall back to default-folder rule? Use a configured default value? Refuse to match? Prompt?
- Property-value normalization: case-sensitive match? Prefix match? Regex match? Per-rule choice?
- Composition with templates' filter syntax: does `{entity | kebab}` apply when `entity` is sourced from frontmatter rather than the tag?
- Composition with the witness (F3): when a file is forward-synced, is the property-value-at-time-of-sync recorded, or only the resulting folder?
- UX: rule editor surface for declaring property dependencies — per-slot toggle, separate "uses these properties" section, or inline notation?

**User testing checkpoint** (when this lands):

1. **Single-entity workflow** — author a rule with `{owner}` as a frontmatter-sourced slot; create a file with `entity: cybersader` in frontmatter; add the trigger tag; verify the file routes to the entity-scoped folder.
2. **Multi-entity coexistence** — same rule, files with three different `entity:` values; verify each routes correctly.
3. **Missing-property fallback** — a file with the tag but no `entity:` property; verify the configured fallback applies (default-folder / prompt / refuse).
4. **Property edit triggers re-route** — change a file's `entity:` value from `cybersader` to `bob`; verify the file moves to the new entity scope automatically (or stays put, depending on configured behavior).
5. **Composition with witness** (F3 enabled) — verify the witness records the property values used; subsequent inverse syncs use the recorded values, not current file properties (avoids spurious moves when properties change).

**Estimated scope**: ~150 LOC + UI surface + ~30 LOC tests. Comparable to F2 in size; smaller than F2+F3 combined.

**Cross-cutting**: this is genuinely a research-frontier-adjacent feature (no current tool does context-aware destination resolution at file granularity). Treating it carefully — explicit research entry, decision gate, user testing partnership at every step.

---

## Cross-cutting work: orphan and relation-tag semantics

Not a separate increment because it threads through Increments 3 and 4 — but worth naming separately because the design has to be settled *before* shipping the active-disambiguator part of Increment 3.

**The question**: when a rule is deleted, when a file is manually moved, when a tag's source folder is gone — what should the engine remove and what should it leave alone?

**The dependency**: the algorithm depends on knowing which tags FTSync derived. With frontmatter witness (Increment 3), this is trivially answered (`fts.rule` is present → derived; absent → user-authored). Without the witness, the question is hard (Challenge 08 enumerates six candidate answers).

**Recommendation**: dispatch [Challenge 08](/obsidian-folder-tag-sync/agent-context/zz-challenges/08-orphan-and-relation-tag-semantics/) to a fresh agent during Increment 1 or 2. The findings inform Increment 3b's three-way-diff algorithm. If the agent's answer aligns with "use frontmatter witness as the discriminator," Increment 3b implements both at once. If the agent recommends a different approach (authority-driven dispatch, pattern-matching dispatch), Increment 3b plus a smaller Increment 3.5 may be needed.

## Cross-cutting work: per-transform reversibility (Challenge 09)

Similar status: a question that should be settled by Increment 2 (where templates expose per-slot transforms like `{slug | kebab}`) but doesn't fully block.

**The question**: which transform combinations actually round-trip cleanly? When the user authors a bidirectional rule with `stripEmoji: true`, should the engine warn? Refuse? Silently rely on frontmatter memory to compensate?

**Recommendation**: dispatch [Challenge 09](/obsidian-folder-tag-sync/agent-context/zz-challenges/09-per-transform-reversibility-profile/) during Increment 2. Findings inform the per-rule status indicator's bijection-status copy.

## Cross-cutting work: attachment + folder-note handling (Challenge 11)

A specific concrete subset of "what happens when files move." The current engine's `tag-to-folder` direction calls `app.fileManager.renameFile` for the single `.md`; doesn't touch attachments, canvas files, folder notes.

**Recommendation**: dispatch [Challenge 11](/obsidian-folder-tag-sync/agent-context/zz-challenges/11-attachment-and-folder-note-handling/) before Increment 4 (conflict-resolution UI). Findings inform the modal's "this move affects N files" disclosure. Implementation can fold into Increment 3c (recovery + safety nets) or ship as a small standalone increment.

## Cross-cutting work: cross-device coordination (Challenge 12)

The non-commutative-write problem with frontmatter memory + Obsidian Sync.

**Recommendation**: dispatch [Challenge 12](/obsidian-folder-tag-sync/agent-context/zz-challenges/12-cross-device-coordination/) *during* Increment 3a (passive witness). The witness writes are commutative when only `fts.sig` is hash-based and rules are deterministic — but timestamps (`fts.synced_at` if added) break commutativity. The Challenge 12 findings should pin whether to ship `fts.synced_at` or omit it from v1.

## Cross-cutting work: positioning + tagline updates

The plugin's headline framing — README tagline, docs hero text, philosophy intro — needs to evolve as the increments ship. This isn't cosmetic; it's the contract between what users *think* they're getting and what they *are* getting. Mismatched framing erodes trust faster than missing features.

### What changes when

- **Today (pre-Increment 1)**: framing is "Bidirectional sync between folder paths and Obsidian tags using regex patterns and transformations." Honest about the implementation; doesn't reflect the typed model that's already there. *Light touch now*: add the "easy to start, powerful as you align it" framing as a stated design principle (Phase B of the current plan iteration). Don't fully reposition yet.
- **Mid-Increment 2 (templates land)**: this is the trigger. Once template authoring is the default rule-editor mode, "regex" stops being the headline. *Full repositioning*: tagline shifts to something like "A typed model for folder ↔ tag synchronization. Templates as the new authoring surface; regex as the escape hatch." Hero text, README intro, philosophy.md intro, terminology.md, and the Astro homepage all align.
- **Post-Increment 3 (frontmatter memory ships)**: another smaller repositioning — the "stateless deterministic" claim becomes "conditionally per-file stateful where the user opts in." Add this nuance to the design-principles section without changing the headline.

### Where positioning lives

The same framing should appear consistently in:

- `README.md` — tagline (under the title), "Why this plugin?" section, "Unlike other plugins" comparison table
- `docs/src/content/docs/about/roadmap.md` — intro paragraph
- `docs/src/content/docs/about/development-plan.md` — the design-principles section above
- `docs/src/content/docs/about/project-brief.md` — high-level project framing
- `docs/src/content/docs/concepts/philosophy.md` — opens with "the plugin runs on regex" today; should evolve to lead with the typed model
- `docs/src/content/docs/concepts/terminology.md` — the glossary intro
- `docs/src/content/docs/index.mdx` (the Astro homepage hero) if/when present
- The plugin's `manifest.json` description — also the Obsidian community-plugins listing

### How to validate

A **fresh-reader test**: a person (or fresh-context agent) with no prior knowledge reads the README. They describe what the plugin does in their own words. Their description is compared to the actual current behavior. When they diverge, the docs are out of date.

The fresh-reader test should run after each repositioning edit. If their description still matches old framing ("a regex-based plugin") when the current behavior is "templates with regex escape hatch," the repositioning didn't go deep enough.

### Why it matters

A novice user installing the plugin reads the README first. If the README says "regex" they expect to learn regex; if the rule editor's default mode is templates, they're confused for the first 5 minutes. Honest framing prevents that 5-minute friction. Conversely, if the README oversells (claims templates exist when they don't yet), users feel duped.

The principle: **lead with what users see today; flag what's coming tomorrow as a roadmap link, not as the headline.**

---

## Implementation phasing summary

| Increment | Effort | Risk | Visible? | Depends on |
|---|---|---|---|---|
| **1** — Specificity + groups | ~150 LOC | Low | Invisible-positive | Nothing |
| **2** — Path templates (peer to regex) | ~250 LOC + UI | Medium | Opt-in additive | Nothing required; benefits from 1 |
| **3a** — Passive frontmatter witness | ~200 LOC | Low (write-only) | Visible YAML on synced files | Nothing |
| **3b** — Active disambiguator | ~150 LOC | Medium | Reads + acts on witness | 3a; informed by Challenge 08 |
| **3c** — Recovery + safety nets | ~50 LOC | Medium | Surfaces preview/warnings | 3b |
| **4** — Conflict-resolution UI | ~250 LOC + UI | Medium | Interactive modal | Composes with 3 |
| **5** — Plugin API | ~100 LOC + docs | Low | Invisible to end users | 1, 2, 3 should land first |

Total estimated scope: ~1100 LOC production + ~250 LOC tests + ~400 LOC UI + documentation. Roughly 6–10 weeks of focused work depending on whether each increment lands as one or several commits and how much UX iteration each surface requires.

## What to start with

**Recommendation: Increment 1 (specificity + groups), starting with Step 1 — refining `calculateMatchConfidence`.**

Why this is the right first piece:

- **Smallest scope** that produces user-visible improvement. ~50 LOC for the formula refinement itself.
- **Pure refactor**: confidence is still tiebreak-only at this step, so behavior doesn't change yet. The audit step happens before the sort-order swap; we get to see whether the new formula's implied ordering matches what users have authored.
- **No dependencies**: doesn't require any other increment to land first.
- **Validates the research**: the [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) recommended this exact phasing.
- **Low risk**: failure mode is "the new formula is no better than the old"; we just don't promote it.
- **Composable**: when Increment 2 (templates) lands, the slot count becomes the natural specificity score and the formula adapts cleanly.

**Concrete first work item**:

1. Read current `calculateMatchConfidence` at `src/engine/ruleMatcher.ts:156-185`
2. Write the refined Formula 3 from the research (anchor-aware bonuses; alternation penalty; slot-count handling for future template rules)
3. Add tests covering Challenge 01's stress cases
4. Run the audit script: compute new vs. old confidence for every rule in shipped packs (`para.json`, `johnny-decimal.json`, `seacow-cyberbase.json`, `zettelkasten.json`); compare to user-authored priority ordering
5. Report the audit findings (do new and old order agree on >80% of rules?)
6. **If agree**: ship the formula refinement (still tiebreak-only); next commit swaps the sort order
7. **If disagree**: surface the disagreements; discuss with the user; potentially refine the formula before promoting

After Step 1 settles, Increment 1's remaining steps (sort-order swap, group field, group-precedence config) follow as separate commits.

## Cross-references

- **Roadmap** (the feature inventory): [/about/roadmap/](/obsidian-folder-tag-sync/about/roadmap/)
- **Active research challenges**: [/agent-context/zz-challenges/](/obsidian-folder-tag-sync/agent-context/zz-challenges/)
- **Research log entries**: [/agent-context/zz-log/](/obsidian-folder-tag-sync/agent-context/zz-log/)
- **Concept pillars** (referenced throughout each increment): [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/), [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/), [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/), [Terminology](/obsidian-folder-tag-sync/concepts/terminology/)
