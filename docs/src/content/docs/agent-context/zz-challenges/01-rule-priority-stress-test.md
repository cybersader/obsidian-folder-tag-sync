---
title: "Challenge 01: Rule priority stress test"
description: Does first-match-wins priority resolution actually hold under real user rule stacks? Or will users hit "why didn't my rule fire" surprise?
tags: [research, architecture]
sidebar:
  label: "01 · Priority stress"
  order: 1
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
