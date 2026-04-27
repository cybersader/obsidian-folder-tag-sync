---
title: "Challenge 10: Plugin API for Templater / QuickAdd integration — what's the right surface?"
description: The roadmap calls plugin-API integration "high priority" but there's no design framing. What read-only surface should other plugins consume (getTagsForFolder, getFolderForTag)? What write surface (apply rules to a file, create a tag rule)? What's the eventing model? When another plugin reads tags during an FTSync mid-sync, what's the consistency contract? This challenge designs the API from first principles and produces a usable spec.
tags: [research, architecture, api, integration, phase-3]
sidebar:
  label: "10 · Plugin API"
  order: 10
---

## Prompt for the dispatched agent

Open this challenge in a fresh-context Claude / LLM session, paste the URL, and say *"research this challenge."* The reading list below is layered for **progressive disclosure** — start at level 1 if you're new to the project, jump deeper if you already know the context.

**The question in one sentence:** what does the public API surface for FTSync look like — what calls do Templater, QuickAdd, Dataview, and other Obsidian plugins need from us, what guarantees do we offer per call, and what's the eventing model for plugins that want to react to sync events?

### Reading order (level 1 → level 4)

1. **Foundations** (orient first if new to the project):
   - [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
   - [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — typed-model layers; what consumers of the API need to understand
2. **Core concepts for this question**:
   - [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — what guarantees can the API actually offer per-call (especially `getFolderForTag` returning *what* — entry folder? best-guess? nothing?)
   - [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight primitives consumers will see
3. **Direct context** (the research that frames this challenge):
   - [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — directly defines the inverse function other plugins want to call; the six candidates determine what the API can actually return for ambiguous tags
   - [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — when frontmatter memory is enabled, the API can offer stronger guarantees on `getFolderForTag`
   - [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) — the resolution-engine refinement; the API has to handle "this tag matched multiple rules, which one's result do you want?"
4. **Reference (optional, code-level grounding)**:
   - [Rule schema](/obsidian-folder-tag-sync/reference/rule-schema/) — the data shape consumers will see
   - [Obsidian Plugin API docs](https://docs.obsidian.md/) — for plugin-to-plugin communication patterns
   - `src/sync/FolderToTagSync.ts`, `src/sync/TagToFolderSync.ts`, `src/engine/ruleMatcher.ts`, `src/engine/applyTransfer.ts` (read on the GitHub repo) — the existing internal API the public API will sit on top of

### Deliverable

Short report at `agent-context/zz-log/YYYY-MM-DD-challenge-10-findings.md` (~1500–2500 words). Required sections: enumeration of consumer use cases (Templater, QuickAdd, Dataview, custom user plugins), proposed read-only API surface with signatures + return types + guarantees per call, proposed write API surface (if any) with capability gating, eventing model (what events fire, when, what payload), mid-sync consistency contract (when is the API observable as "in-flight"?), versioning + backwards-compat policy, security considerations, integration examples in concrete pseudocode for at least Templater + QuickAdd.

### Tone

Treat existing recommendations as **hypotheses to test, not conclusions to defend.** If your analysis says "the API should be read-only and minimal — most use cases want to read, not write," that's a valid outcome. Fresh-agent context-skepticism is the point.

---

## Assumption under test

The roadmap (item #9: "Template Integration") names "API for Templater/QuickAdd" with helper functions like `getTargetFolder(tags)` and `getTargetTags(folder)`. The implicit assumption is that two pure functions are enough — the API is a thin wrapper around the internal sync engines.

That's almost certainly insufficient. Consider what real consumers actually need:

- **Templater**: invokes a script when a new note is created. The script wants to know "what tags should this file get based on its target folder?" — a read-only call. But Templater's invocation is *synchronous* during note creation; FTSync's sync engines may be asynchronous. Is `getTargetTags(folder)` synchronous? Does it return a stable answer or one that depends on plugin state?
- **QuickAdd**: macros that create files at programmatic locations. May want both directions — "place this file at the right folder for this tag set" *and* "what tag should I add to this file at this folder."
- **Dataview**: queries that filter by FTSync-derived tags. May want to know "is this tag derived or user-authored?" (the orphan-vs-relation distinction from Challenge 08).
- **Custom user plugins** (or community plugins like Periodic Notes, Calendar): need to know about file moves so they can update their own indexes.
- **Other FTSync-adjacent plugins**: may want to *write* rules programmatically (e.g., a rule-pack editor plugin that's not part of FTSync core).

A two-function API doesn't cover the eventing, the consistency contracts, or the write surface.

## Why the simple reading might not hold

### The inverse function is not a function

`getFolderForTag(tag)` looks like a pure function but isn't. As Challenge 04 + the [tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) document, a tag can match multiple rules (yielding multiple plausible folders); a tag can match no rules; a tag can match a rule whose forward direction is many:1 (yielding *the entry folder + best guess*).

The API has to commit to a return type:

- `string` — pick one (which one?)
- `string[]` — return all candidates (what order?)
- `string | null` — pick one or fail
- `{ folder: string; confidence: number }` — return ranked candidates

Each choice forces a contract on consumers.

### Mid-sync state visibility

When FTSync's `FolderToTagSync.applyToFile()` is mid-execution, the file's frontmatter is in a transient state — old tags removed, new tags not yet written, or vice versa depending on implementation. If Templater's script reads tags during this window, what does it see?

Three plausible policies:

- **Read-through**: API readers see the in-flight state (potentially partial)
- **Read-old**: API readers see the pre-sync state until the sync commits
- **Read-blocked**: API readers wait for sync to complete

The current code has no commitment. Whatever the engine happens to do is what consumers get.

### Eventing without subscriptions

Plugins that want to react to FTSync events (e.g., update an index when a file is moved by a tag→folder rule) need an eventing surface. Today there's none — consumers would have to poll metadata cache or rely on Obsidian's built-in `vault.on('rename')` events, which fire for *any* rename, not just FTSync ones.

A real API needs at least:

- `ftsync.on('forward-sync', (file, oldTags, newTags) => ...)` — folder→tag fired
- `ftsync.on('inverse-sync', (file, oldPath, newPath) => ...)` — tag→folder fired
- `ftsync.on('rule-change', (rule, op) => ...)` — a rule was added/edited/removed
- `ftsync.on('vault-scan-complete', (results) => ...)` — vault-wide operation finished

What's the unsubscribe mechanism? What if an event handler throws? What if multiple handlers register?

### The write surface — capability gating

Some consumers want to *write*: programmatically add rules, programmatically apply rules to a file, programmatically modify rule packs. This is a bigger surface than reading, with security implications:

- A plugin with rule-write capability could break the user's vault by authoring a destructive rule
- A plugin that programmatically applies rules to a file could move data unexpectedly
- A plugin that programmatically reads frontmatter origin (if Challenge 07 ships) is exposing user folder structure

Should the write API exist at all? If yes, should it be capability-gated (user opts into "this plugin can author FTSync rules")? Should it be more restrictive than read?

### Versioning + backwards-compat policy

Once an API is published, breaking changes hurt every consuming plugin. Three policies:

- **Strict semver**: any breaking change bumps a major version; old clients keep working until they re-pin
- **Stable subset**: a small core surface is "stable forever"; the rest is "experimental, may break"
- **Versioned namespace**: `ftsync.v1.getTags(...)`, `ftsync.v2.getTags(...)` coexist for migration

This is a long-term commitment and worth getting right before publishing.

### Templater-specific gotcha — sync vs async

Templater scripts run synchronously during note creation. FTSync's `applyRuleForward` involves regex matching + transforms + frontmatter writes — which the sync engines do asynchronously today. Templater's `getTargetTags(folder)` call may need a synchronous read-only path that doesn't trigger sync.

The API has to expose:

- A *pure* read-only path that's synchronous (just runs the rule's regex against the input; no file I/O)
- A *full* sync path that's async (commits results to the vault)

The two paths must agree on the output for the same input.

## Research brief

The agent should:

### 1. Enumerate consumer use cases

For each consumer type (Templater, QuickAdd, Dataview, custom user plugins, future plugins), list:

- The 3–5 most likely API calls they'd want
- Sync vs. async tolerance
- Required vs. desired guarantees per call
- Read vs. write needs

Use real-world examples from each plugin's existing patterns.

### 2. Design the read-only surface

Enumerate functions, signatures, return types, guarantees. At minimum:

- `getTagsForFolder(path: string, options?: { mode: 'derive' | 'cached' }): Tag[]`
- `getFolderForTag(tag: string, options?: { mode: 'first-match' | 'all-candidates' | 'with-frontmatter' }): FolderResult`
- `listRules(): MappingRule[]` (read-only view of the rule list)
- `previewRuleApplication(rule: MappingRule, input: string): PreviewResult`

For each call, specify:

- Synchronous or asynchronous
- Idempotent
- Return type when no rules match
- Behavior when multiple rules match (use Challenge 04 / spec+groups research findings)
- Whether it triggers any side effects (reads only, no writes)

### 3. Design the write surface (or argue against it)

Enumerate write calls, gate them by capability, specify error semantics.

- `applyRulesToFile(file: TFile, options?: { direction: Direction, dryRun: boolean }): SyncResult`
- `addRule(rule: MappingRule): RuleId` (with capability gate)
- `updateRule(ruleId: RuleId, patch: Partial<MappingRule>): void`
- `removeRule(ruleId: RuleId): void`

Or argue: don't ship a write surface. Reason about why or why not.

### 4. Design the eventing model

What events fire, when, with what payload, what happens to throwing handlers, what's the unsubscribe semantics. Pseudocode for `ftsync.on(...)` and `ftsync.off(...)`.

### 5. Design the consistency contract

When can callers observe in-flight state? Explicit answer for each call:

- `getTagsForFolder` — reads what?
- `getFolderForTag` — reads what?
- During an active `applyRulesToFile`, what do readers see?

Recommend a policy (read-through / read-old / read-blocked); argue for it.

### 6. Versioning + backwards-compat

Pick a policy. Justify against the alternatives.

### 7. Walk through two integration examples

Templater and QuickAdd integration in concrete pseudocode. Show:

- The user-facing template / macro
- The FTSync API call(s) the script makes
- The expected return values
- Error handling

### 8. Compose with related features

- **Frontmatter memory (Challenge 07)**: how does `getFolderForTag` change when frontmatter memory is enabled? Does the API expose origin metadata to consumers (privacy implications)?
- **Specificity + groups (research)**: the API has to commit to whether `getFolderForTag` uses specificity-aware matching or first-match-wins
- **Conflict UI (Challenge from tag→folder resolution research)**: when the engine would normally surface a UI prompt, what does the API call do? Block? Throw? Return a typed "ambiguous" result?

## Candidate API shapes to evaluate

The agent should weigh at least:

**Shape α — Minimal read-only.** Just `getTagsForFolder` and `getFolderForTag`, plus a read-only `listRules`. Pure functions. No eventing, no writes. Consumers poll metadata cache for changes.

**Shape β — Read + minimal events.** Above plus an `ftsync.on('sync', ...)` event. Still no writes; eventing solves the polling problem but doesn't open the write surface.

**Shape γ — Full read/write/events.** Everything above plus `applyRulesToFile`, `addRule`, `updateRule`, `removeRule`. Capability-gated writes. Heavyweight but full-featured.

**Shape δ — Layered: stable core + experimental extensions.** A small `ftsync.v1.*` core that's stable forever, plus `ftsync.experimental.*` that may break. Lets the core ship sooner while the write surface evolves.

For each shape: rate consumer-power, FTSync-team maintenance burden, security risk, versioning complexity, integration patterns it enables.

## Deliverable

Short report (~1500–2500 words) at `zz-log/YYYY-MM-DD-challenge-10-findings.md`:

- Consumer-use-case enumeration
- Proposed read-only surface with full type signatures
- Verdict on the write surface (ship it / defer it / never ship it)
- Eventing model design
- Consistency-contract recommendation
- Versioning policy with justification
- Two integration examples (Templater + QuickAdd) in pseudocode
- Composition with frontmatter memory + specificity + conflict UI
- Recommended Shape (α / β / γ / δ) with reasoning
- Open questions left unresolved

## Hand-off note

This challenge sits at the *external boundary* of the plugin — what does FTSync expose to the rest of the Obsidian ecosystem? It's distinct from the internal architecture work (Challenges 01–09) which all describe what happens *inside* FTSync. The API design should respect those internals (it doesn't get to break the typed model, frontmatter memory, etc.) but its job is to figure out *what to expose, in what shape, with what guarantees*.

The agent should treat the existing roadmap mention ("`getTargetFolder(tags)`, `getTargetTags(folder)`") as a starting hypothesis, not a conclusion. The real API will be richer — but maybe not in the obvious ways.
