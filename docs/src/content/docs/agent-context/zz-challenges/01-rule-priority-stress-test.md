---
title: "Challenge 01: Rule priority stress test"
description: Does first-match-wins priority resolution actually hold under real user rule stacks? Or will users hit "why didn't my rule fire" surprise?
tags: [research, architecture]
sidebar:
  label: "01 · Priority stress"
  order: 1
---

## Prompt for the dispatched agent

Open this challenge in a fresh-context Claude / LLM session, paste the URL, and say *"research this challenge."* The reading list below is layered for **progressive disclosure** — start at level 1 if you're new to the project, jump deeper if you already know the context.

**The question in one sentence:** does the engine's current `priority + first-match-wins` model actually match how users author rules, or do they expect "more specific wins" — and what's the right replacement primitive?

### Reading order (level 1 → level 4)

1. **Foundations** (orient first if new to the project):
   - [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary of every load-bearing term
   - [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — typed-model layers (Layer 1 regex, Layer 2 typed); why determinism is the project's non-negotiable
2. **Core concepts for this question**:
   - [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — `cardinality`, lossy vs lossless, collision-vs-lossy distinction (relevant because priority decides which rule fires when several plausibly match)
   - [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight library-science primitives the priority decision dispatches on
3. **Direct context** (the research that frames this challenge):
   - [Tag → folder resolution research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — the six-candidate survey of inverse-direction resolution; this challenge is the framing the survey expanded on
   - [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) — combined design for B+C; surfaces that `calculateMatchConfidence` is already partial implementation
4. **Reference (optional, code-level grounding)**:
   - [Rule schema](/obsidian-folder-tag-sync/reference/rule-schema/) — exact field definitions for `priority`, `confidence`
   - `src/engine/ruleMatcher.ts:97-185` — the actual `findBestMatch` and `calculateMatchConfidence` implementations (read on the GitHub repo)

### Deliverable

Short report at `agent-context/zz-log/YYYY-MM-DD-challenge-01-findings.md` (~1500–2500 words). Required sections: your framing of the problem (does priority-as-scalar genuinely fail in practice?), concrete failure cases drawn from real-world rule stacks, verdict on the alternatives (specificity-aware, rule groups, all-rules-fire, conflict-UI), recommended primitive replacement with migration sketch, open questions left unresolved.

### Tone

Treat existing recommendations as **hypotheses to test, not conclusions to defend.** If practical analysis says "actually, priority is fine and the recommendations are over-engineered," that's a more valuable finding than confirming the recommendation. Fresh-agent context-skepticism is the point.

---

## Assumption under test

Rules are ordered by integer priority (lower = higher precedence). The first rule whose regex pattern matches the incoming event "wins" and no other rules fire for that file.

This is simple, deterministic, and implemented.

**But is it the right model for users?**

## Why it might not be

### Specificity vs priority mismatch
A user sets Rule 1: `^Projects/(.*)$ → #projects/*` at priority 10. Then they add Rule 2: `^Projects/Archive/(.*)$ → #archive/*` at priority 20.

Rule 2 is **more specific** — it matches a narrower path — but **lower priority** (higher number). With first-match-wins, Rule 1 fires first and Rule 2 never gets a chance.

Users naturally expect "more specific wins." They'll write rules in the order they think of them and expect the system to figure out specificity.

### Multi-match-needed cases
A user has a file in `Projects/Archive/Q4-retrospective/`. They want it tagged both `#projects/q4-retrospective` AND `#archive/q4-retrospective`. First-match-wins can't express this.

The escape hatch today is: run the sync manually, one rule direction at a time. But that's a workflow, not a feature.

### Silent dead rules
If Rule 1 matches everything Rule 2 would, Rule 2 silently never fires. User has no way to see this. Settings UI treats it as "configured and enabled."

## Research brief

1. **Survey prior art.** How do similar tools handle this?
   - Auto Note Mover — first match wins (confirmed)
   - Obsidian Tasks' rule system — ?
   - CSS specificity algorithm — adapted to regex, would this make sense?
   - Firewall rule ordering (iptables, pf) — user-ordered, first-match-wins; has the same problem
   - Email filter systems (Gmail, Fastmail) — mix of approaches
2. **Stress-test with a 20-rule SEACOW pack.** Draft the full SEACOW rule set on paper. Identify every pairwise priority conflict. Is the priority number field expressive enough, or do users need "groups with inheritance"?
3. **Design alternatives.** Score each against the current first-match-wins baseline:
   - "Most specific wins" via regex-pattern-length heuristic
   - "All matching rules fire" with explicit conflict resolution
   - "Rule groups" with priority within group, all groups apply
   - Explicit `combine` flag per rule
4. **Consider observability.** If we keep first-match-wins, can we give users a "test this file path" preview in the rule editor that shows which rule would win?

## Deliverable

Short report:

- Recommendation: keep first-match-wins or switch
- If switch: which model and why
- If keep: what observability tools close the UX gap
- Migration path if we switch (existing user configs)

Log findings in `zz-log/` as `YYYY-MM-DD-challenge-01-findings.md`.
