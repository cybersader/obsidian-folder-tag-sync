---
title: "Challenge 12: Cross-device coordination — Obsidian Sync, undo/redo, and the multi-event trap"
description: When two devices both have FTSync running and Obsidian Sync is active, file events fire on both; with frontmatter memory the writes are no longer commutative; what's the conflict resolution? Adjacent question — when the user undoes a manual move that triggered an FTSync sync, what happens to the tags FTSync added? This challenge designs the multi-device coordination semantics from first principles.
tags: [research, architecture, sync, multi-device, undo, phase-3]
sidebar:
  label: "12 · Cross-device sync"
  order: 12
---

## Prompt for the dispatched agent

Open this challenge in a fresh-context Claude / LLM session, paste the URL, and say *"research this challenge."* The reading list below is layered for **progressive disclosure** — start at level 1 if you're new to the project, jump deeper if you already know the context.

**The question in one sentence:** when FTSync runs on multiple devices simultaneously (via Obsidian Sync) or the user undoes an action that triggered an FTSync sync, what's the conflict-resolution algorithm — especially given that frontmatter memory (if shipped) makes writes non-commutative across devices?

### Reading order (level 1 → level 4)

1. **Foundations** (orient first if new to the project):
   - [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
   - [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — the typed-model layers; why determinism is non-negotiable
2. **Core concepts for this question**:
   - [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — relevant because non-commutative writes break round-trip in subtle ways
   - [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — per-op behavior under double-fire (when both devices fire the same forward sync, do we get one tag or two? duplicate tags or idempotent?)
3. **Direct context** (the research that frames this challenge):
   - [Frontmatter as bijection memory research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-frontmatter-as-bijection-memory-research/) — the philosophy shift from stateless engine to per-file stateful engine; this challenge asks what that means for multi-device
   - [Challenge 07](/obsidian-folder-tag-sync/agent-context/zz-challenges/07-frontmatter-as-bijection-memory-validation/) — the practical-validation challenge for frontmatter memory; this challenge composes with that
   - [Solution brainstorm (working draft)](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) — names "cross-vault sync conflict resolution" as an open question; this challenge is the place to design it
4. **Reference (optional, code-level grounding)**:
   - [Obsidian Sync overview](https://obsidian.md/sync) — the official sync product; what its conflict resolution does today
   - [Capacitor.js file system docs](https://capacitorjs.com/docs/apis/filesystem) — mobile event semantics differ from Electron; relevant for understanding what file events fire on mobile
   - `src/main.ts` (read on the GitHub repo) — the event listeners FTSync registers; understanding the entry points for the sync engines is needed

### Deliverable

Short report at `agent-context/zz-log/YYYY-MM-DD-challenge-12-findings.md` (~1500–2500 words). Required sections: failure-mode enumeration (double-fire, write-after-undo, frontmatter-non-commutativity, mobile-event-semantics-divergence, partial-sync-on-network-loss), evaluation of conflict-resolution strategies (last-write-wins, hash-based detection, user-prompt-on-conflict, Obsidian-Sync-passthrough, disable-multi-device), recommended algorithm, integration with Obsidian Sync's existing file-conflict resolution, undo/redo coordination policy, recommended UX for the user when conflicts surface.

### Tone

Treat existing recommendations as **hypotheses to test, not conclusions to defend.** If your analysis says cross-device coordination is best handled by simply *disabling* FTSync's auto-sync on devices other than a designated "primary" device, that's a more valuable finding than a CRDT-style merge algorithm. Fresh-agent context-skepticism is the point.

---

## Assumption under test

The plugin is currently designed to run on a single device. The sync engines fire on file events (`vault.on('create' | 'modify' | 'rename' | 'delete')`), and the engine writes the result to the file (frontmatter for `folder-to-tag`, file move for `tag-to-folder`). The implicit assumption: **only one engine instance writes to a file at a time.**

That assumption is incorrect when:

1. **Obsidian Sync is active**. Two devices have FTSync running. Device A writes a tag to `note.md`; the change syncs to Device B; Device B's vault sees `vault.on('modify')` for `note.md` and runs FTSync's forward sync against the new content.
2. **A second user opens the vault.** Same case as Obsidian Sync, but with a different conflict-resolution profile.
3. **The user undoes an action**. Obsidian's undo reverts the file change but doesn't know about FTSync's reaction (the tags FTSync added are still there).
4. **Mobile + desktop simultaneously**. Mobile and desktop have different file-event timing (Capacitor.js vs Electron); race conditions can occur.

For most use cases, the *current* engines are accidentally idempotent enough to survive this — adding the same tag twice is a no-op; running the same sync twice produces the same result. But several proposed features break that idempotency:

- **Frontmatter memory (Challenge 07)**: writes timestamped origin metadata. Device A writes at T0; Device B writes at T1; the resulting frontmatter has *some* timestamp (last-write-wins) but the engine state is divergent.
- **Conflict-resolution UI**: prompts the user. If both devices prompt simultaneously, what happens?
- **Specificity-aware matching with rule changes**: if Device A's rule list differs from Device B's (the user edited rules on A but the change hasn't synced to B), forward sync produces *different* tags on the two devices for the same file.

This challenge designs the multi-device semantics before they become an emergency fix.

## Why the simple reading might not hold

### Idempotency isn't enough when state is timestamped

For pure-tag-add-or-remove operations, FTSync is roughly idempotent: adding `#projects/web` twice produces one tag. But the moment the engine writes timestamped metadata (frontmatter origin's `synced_at`), the writes are no longer commutative — the order matters.

Concrete:

- Device A at T0: writes `tags: [#-inbox]` + `ftsync.synced_at: T0`
- Device B at T1: sees the modification, but its rule pattern produces the same tag, so Device B *also* writes `ftsync.synced_at: T1`
- Result: every file's `synced_at` updates twice per cross-device operation, doubling the git diff churn

This isn't a *correctness* failure but it's a *quality* failure. The engine should detect "this file already has the right tags and origin; don't re-write."

### Undo creates orphan tags

Concrete:

1. User manually moves `note.md` from `Drafts/` to `Projects/Web Auth/`
2. FTSync's `vault.on('rename')` fires; `FolderToTagSync.applyToFile()` adds `#projects/web-auth` to the file
3. User notices they made a mistake; presses Ctrl+Z to undo
4. Obsidian's undo reverses the move; file is back in `Drafts/`
5. **But the tag is still there.** Obsidian's undo doesn't know about FTSync's frontmatter modification, only about the file rename.

The user now has `#projects/web-auth` on a file in `Drafts/`, which doesn't match the rule's pattern. On next sync, depending on `removeOrphanedTags` semantics (Challenge 08), the tag might be silently removed, kept forever, or surface as an orphan warning.

### Mobile event semantics differ from desktop

Obsidian's mobile app uses Capacitor.js (web-view based) instead of Electron. File events behave differently:

- Some file changes on mobile don't trigger `vault.on('modify')` immediately
- File-system access is sandboxed; some operations require user permission flows
- Background sync may or may not run FTSync depending on Obsidian's lifecycle

A user with mobile + desktop sees different behaviors on each. Today the plugin's behavior on mobile is unverified.

### Network partitions and partial syncs

Obsidian Sync syncs files asynchronously over the network. If a sync fires partway through (some files synced, some not), the FTSync rules see an inconsistent vault state:

- File A is at the new location (synced)
- File B is at the old location (not yet synced)
- A rule that depends on both files (e.g., a rule that fires on a folder containing A and B) sees different state than either device

This is rare but real on slow connections.

### Conflict-resolution UI is single-device

If FTSync ships an interactive conflict-resolution UI (candidate D from the [tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/)), what happens when both devices simultaneously fire the conflict prompt?

- Device A prompts; user picks Folder X
- Device B prompts at roughly the same time; user (the same user, on a different device) picks Folder Y
- Both devices write their choice
- Obsidian Sync resolves the file-content conflict, but the two `tags`/`ftsync.origin` choices may or may not be reconcilable

The conflict UI itself becomes a sync target.

## Research brief

The agent should:

### 1. Enumerate failure modes

Map every plausible failure mode in a structured table:

| Failure mode | Trigger | Today's behavior | Severity |
|---|---|---|---|
| Double-fire (both devices write same tag) | Obsidian Sync replicates a file modification | Idempotent (fortunate accident) | Low |
| Frontmatter timestamp churn | Both devices update `synced_at` | Diff churn doubles | Medium (cosmetic) |
| Undo leaves orphan tag | User undoes after FTSync fired | Tag persists at wrong location | Medium |
| Rule-list divergence | User edits rules on one device, hasn't synced | Devices produce different tags | High (correctness) |
| Conflict UI race | Both devices prompt simultaneously | Undefined | Medium |
| Mobile event missed | Capacitor doesn't fire `modify` | Tag never gets added on mobile | High (silent failure) |
| Partial-sync inconsistency | Network partition mid-sync | Rules see inconsistent vault | Medium |
| ... | ... | ... | ... |

### 2. Walk through three concrete multi-device scenarios

For each: device timing, file event sequence, expected outcome, current outcome, recommended fix.

- **Scenario A (the easy case)**: Desktop adds a tag at T0; Mobile syncs at T1 and fires its own forward sync; the tag is already there; no-op. Walk through; verify idempotency.
- **Scenario B (the undo case)**: Desktop user manually moves file at T0; FTSync adds tag at T1; user presses Ctrl+Z at T2; Obsidian reverts the rename but not the tag. Walk through; recommend handling.
- **Scenario C (rule divergence)**: User edits a rule on Mobile at T0 (changes the tag entry); Mobile fires forward sync producing the new tag; Mobile's data syncs to Desktop at T1 (file change); but Desktop's rule list hasn't synced yet (`data.json` lag); Desktop fires forward sync against the new content using the *old* rule, producing a *different* tag. Walk through; recommend handling.

### 3. Design the conflict-resolution algorithm

Pseudocode for the engine's response when it detects:

- Pre-sync state in frontmatter doesn't match expected (drift)
- Frontmatter `ftsync.synced_at` is "recent" (configurable threshold) — likely a double-fire from cross-device sync
- File hash has changed but FTSync's rule output for the new content is unchanged — no-op the write

Recommend a strategy. Options:

- **Last-write-wins**: simplest, accepts cosmetic churn; requires nothing
- **Hash-based detection**: compute a hash of (current tags + current frontmatter origin); skip the write if it matches expected
- **User-prompt on conflict**: surface a dialog when state diverges
- **Obsidian-Sync-passthrough**: defer to Obsidian Sync's own file-content conflict resolution; FTSync just writes its result and lets Obsidian handle merge
- **Disable-multi-device**: explicitly require the user to designate one device as "FTSync-active"; other devices are read-only

### 4. Design the undo/redo coordination

Pseudocode for handling the undo case:

- Hook into Obsidian's undo stack? (May not be exposed.)
- Detect the mismatch on next sync (frontmatter origin doesn't match current location → orphan)
- Use `vault.on('rename')` to detect rapid back-and-forth and roll back FTSync's reaction
- Don't try to coordinate; just rely on the orphan-detection from Challenge 08

Recommend a strategy.

### 5. Mobile compatibility plan

What's the minimum testing FTSync needs to do before claiming mobile support? List:

- Required test scenarios (forward sync, inverse sync, manual move, batch sync)
- Known Capacitor.js gotchas to verify against
- Whether the proposal in this challenge changes per-platform

### 6. Recommend the v1 multi-device policy

Most of the above is too much for v1. Pick the 80% case (probably "idempotent forward sync + skip-if-no-change + designate-one-primary-device for the inverse direction") and defer the rest with reasoning.

### 7. Compose with related features

- **Frontmatter memory (Challenge 07)**: the `synced_at` timestamp is a coordination signal; how does the algorithm use it?
- **Orphan handling (Challenge 08)**: undo-induced orphans are a clean test case; does Challenge 08's algorithm handle this?
- **Plugin API (Challenge 10)**: should the API expose "this engine is currently mid-sync" so consumers can avoid double-firing?

## Candidate strategies to evaluate

The agent should weigh at least:

**Strategy α — Stateless idempotency only.** Make every write idempotent (skip if no-change-needed). Don't track timestamps. Don't try to detect conflicts. Rely on Obsidian Sync's file-merge for everything else. Pros: simplest. Cons: doesn't handle rule-divergence; doesn't help with undo.

**Strategy β — Hash-based skip-write.** Compute a hash before writing; skip if it matches. Pros: avoids cosmetic churn; idempotent; simple. Cons: doesn't help with frontmatter origin (timestamps will always differ).

**Strategy γ — Designated primary device.** The user picks one device as "FTSync-active"; other devices are read-only (no auto-sync). Pros: zero conflicts. Cons: defeats the purpose of mobile sync; requires user discipline.

**Strategy δ — Conflict UI on cross-device divergence.** When the engine detects state-divergence (frontmatter origin doesn't match current rule output), surface a dialog. Pros: user always in control. Cons: adds a UI surface that fires unpredictably.

**Strategy ε — CRDT-style merge.** Treat tag set + frontmatter origin as commutative writes; merge on conflict using union semantics. Pros: works for any combo. Cons: significant complexity; not obviously a fit for non-commutative operations like file moves.

**Strategy ζ — Defer to Obsidian Sync entirely.** Don't add any FTSync-side coordination; let Obsidian Sync's existing conflict resolution handle file content; accept that some FTSync-derived state may be inconsistent across devices. Pros: zero added complexity. Cons: may produce wrong results.

For each: rate complexity, conflict-frequency, user-control surface, integration with Obsidian Sync, mobile compatibility.

## Deliverable

Short report (~1500–2500 words) at `zz-log/YYYY-MM-DD-challenge-12-findings.md`:

- Failure-mode enumeration table
- Three walked-through multi-device scenarios with current vs recommended behavior
- Conflict-resolution algorithm recommendation
- Undo/redo coordination policy
- Mobile-compatibility minimum testing plan
- Recommended v1 multi-device policy
- Composition analysis (frontmatter memory, orphan handling, plugin API)
- Verdict on candidate strategies α–ζ
- Open questions left unresolved

## Hand-off note

This is the trickiest challenge in the suite because it intersects with Obsidian's own sync product (which has its own conflict resolution and its own caveats), with mobile platform constraints, and with the proposed frontmatter-memory feature (which makes everything more complex). The agent shouldn't try to design a CRDT.

The strongest possible outcome is a *minimum sufficient* policy — what's the least that FTSync needs to do to not silently corrupt user data when running across devices? "Don't auto-sync on the second device" is a valid answer. So is "make all writes idempotent and accept some cosmetic churn." Bias toward simple-and-correct over clever-and-fast.
