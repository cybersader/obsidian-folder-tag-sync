---
title: Abstraction shape comparison — same 5 rules, four candidate shapes side-by-side
description: F2 decision-gate Q5 — "let's try the options and see what sticks." Path 1 of the try-then-pick approach. Five real-workflow rules drafted under four candidate abstraction shapes (regex / named-slot templates / JSON slot-objects / lens-flavored). User reads, reacts to authoring feel + readability, narrows to 1-2 finalists for Path 2 (sandbox).
tags: [research, architecture, abstraction, decision-gate, phase-h]
sidebar:
  label: "04-27 · Abstraction comparison"
  order: -20260427006
date: 2026-04-27
---

## What this is

Five real rules, four candidate abstraction shapes, drafted side-by-side. The user reads, reacts, narrows the field. Not picking yet — this is Path 1 of the *"try options in practice and see what sticks"* approach approved at F2 decision-gate Q5.

The four shapes evaluated (drawn from [Path abstractions Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/)):

- **A — Regex (status quo)** — today's `MappingRule` with `folderPattern` / `tagPattern` and `TransformConfig`
- **B — Named-slot path templates** — `folderTemplate: "Projects/{slug}"` ↔ `tagTemplate: "#projects/{slug}"`
- **C — JSON slot-objects** — `folderShape: { literal, slots: [...] }` (verbose; explicit per-slot config)
- **E — Lens-flavored explicit pair** — `lens: { get, put, iso }` (template-shape + bijectivity claim)

(D — OpenAPI-style — folded into C since they share the JSON-as-config shape. F — TS tagged literals — ruled out because rule packs are user-authored JSON. G — Mini-DSL — ruled out per Part 2.)

The five rules are drawn from the user's actual workflow shape, especially the cases where current regex has friction:

1. Emoji-prefixed JD area
2. Multi-entity SEACOW Output taxonomy
3. PARA inside a JD-numbered area
4. Marker-only Inbox
5. Truncation/aggregate Clips

## Rule 1 — Emoji-prefixed JD numbered area

The user's actual case. Folder: `📁 10 - Projects/Web Auth/oauth.md`. Target tag: `#10-projects/web-auth/oauth`.

Forward direction: kebab-case + emoji-strip + number-prefix-keep on tag side. Inverse: Title-Case + emoji-prepend (lossy — original emoji not recoverable).

### A — Regex

```jsonc
{
  "id": "jd-numbered-area",
  "priority": 10,
  "folderPattern": "^📁 \\d+ - [^/]+/(.+)$",
  "folderEntryPoint": "📁 ",
  "folderTransforms": {
    "emojiHandling": "strip",
    "caseTransform": "Title Case"
  },
  "tagPattern": "^\\d+-projects/",
  "tagEntryPoint": "10-projects",
  "tagTransforms": {
    "caseTransform": "kebab-case"
  }
}
```

**Authoring**: requires `^📁 \d+ - [^/]+/(.+)$` literacy. The emoji must be escaped/typed correctly; the depth quantifier requires reading. No way to express "emoji is optional" cleanly.

### B — Named-slot template

```jsonc
{
  "id": "jd-numbered-area",
  "priority": 10,
  "folderTemplate": "📁? {jd-area}/{slug}/{tail...}",
  "tagTemplate": "#{jd-area | num-prefix-keep | kebab}/{slug | kebab}/{tail | kebab}"
}
```

**Authoring**: a literate-flavored template. `{jd-area}` is the captured literal `10 - Projects`; the per-slot filters (`num-prefix-keep`, `kebab`) say what each slot does on the tag side. `📁?` makes the optional emoji prefix *visible* in the syntax — no regex character-class voodoo.

### C — JSON slot-objects

```jsonc
{
  "id": "jd-numbered-area",
  "priority": 10,
  "folderShape": {
    "literal": "📁? ",
    "slots": [
      { "name": "jd-area", "kind": "segment", "match": "\\d+ - [^/]+" },
      { "name": "slug", "kind": "segment" },
      { "name": "tail", "kind": "glob" }
    ]
  },
  "tagShape": {
    "literal": "#",
    "slots": [
      { "name": "jd-area", "transforms": ["num-prefix-keep", "kebab"] },
      { "name": "slug", "transforms": ["kebab"] },
      { "name": "tail", "transforms": ["kebab"] }
    ]
  }
}
```

**Authoring**: verbose. Slots are explicit JSON objects with their own metadata. Same expressiveness as B but ~4x more text.

### E — Lens-flavored

```jsonc
{
  "id": "jd-numbered-area",
  "priority": 10,
  "lens": {
    "get": "📁? {jd-area}/{slug}/{tail...}",
    "put": "#{jd-area | num-prefix-keep | kebab}/{slug | kebab}/{tail | kebab}",
    "iso": false
  }
}
```

**Authoring**: same template shape as B + an explicit `iso: false` (because emoji-strip is irreversible, the round-trip isn't bijective). The `iso` flag is the only practical difference from B.

---

## Rule 2 — Multi-entity SEACOW Output taxonomy

User has multi-author vault. Folder: `Entity/Cybersader/Output/Public/Security/Zero-Trust/principles.md`. Tag: `#--cybersader/_publicTaxonomy/security/zero-trust/principles`.

The `--` and `_` prefix markers come from SEACOW conventions (entity → `--`, output → `_`). Same rule should work for any entity (`Bob`, `Alice`).

### A — Regex

```jsonc
{
  "id": "seacow-entity-output",
  "priority": 10,
  "folderPattern": "^Entity/([^/]+)/Output/Public/(.+)$",
  "tagPattern": "^--([^/]+)/_publicTaxonomy/(.+)$",
  "folderTransforms": { "caseTransform": "Title Case" },
  "tagTransforms": { "caseTransform": "kebab-case" }
}
```

**Authoring**: anonymous capture groups. The connection between the folder's `(.+)` and the tag's `(.+)` is *positional*; no name. Would a user know `$1` from the folder fills in `$1` on the tag? Maybe. Today's engine handles this via the typed model but the regex doesn't show it.

### B — Named-slot template

```jsonc
{
  "id": "seacow-entity-output",
  "priority": 10,
  "folderTemplate": "Entity/{owner}/Output/Public/{topic}/{tail...}",
  "tagTemplate": "#--{owner | kebab}/_publicTaxonomy/{topic | kebab}/{tail | kebab}"
}
```

**Authoring**: `{owner}` flows through both sides. The per-entity quantification falls out naturally — same rule fires on `Entity/Bob/...`, `Entity/Alice/...`, etc., and the tag carries the entity name.

### C — JSON slot-objects

```jsonc
{
  "id": "seacow-entity-output",
  "priority": 10,
  "folderShape": {
    "literal": "Entity/",
    "slots": [
      { "name": "owner", "kind": "segment" },
      { "name": "_separator", "literal": "/Output/Public/" },
      { "name": "topic", "kind": "segment" },
      { "name": "tail", "kind": "glob" }
    ]
  },
  "tagShape": {
    "literal": "#--",
    "slots": [
      { "name": "owner", "transforms": ["kebab"] },
      { "name": "_separator", "literal": "/_publicTaxonomy/" },
      { "name": "topic", "transforms": ["kebab"] },
      { "name": "tail", "transforms": ["kebab"] }
    ]
  }
}
```

**Authoring**: double the line count of B. Literal segments mixed with slots makes the structure harder to skim.

### E — Lens-flavored

```jsonc
{
  "id": "seacow-entity-output",
  "lens": {
    "get": "Entity/{owner}/Output/Public/{topic}/{tail...}",
    "put": "#--{owner | kebab}/_publicTaxonomy/{topic | kebab}/{tail | kebab}",
    "iso": true
  }
}
```

**Authoring**: B plus `iso: true` (kebab-case is conditionally reversible; engine could mark this `true` or `conditional`). The `iso` claim is information the engine could derive from slot overlap.

---

## Rule 3 — PARA inside a JD-numbered area

The user's actual hierarchical workflow: JD outer (`📁 10 - Projects/`), PARA inner (`Projects/`, `Areas/`, etc.). Folder: `📁 10 - Projects/Web/auth.md`. Tag: `#projects/web/auth`.

This is the case where Phase G's `folderAnchor.under` shines today.

### A — Regex (with Phase G)

```jsonc
{
  "id": "para-inside-jd",
  "priority": 20,
  "folderPattern": "^Projects(?:/|$)",
  "folderEntryPoint": "Projects",
  "folderAnchor": { "under": "📁 10 - Projects" },
  "tagPattern": "^projects/",
  "tagEntryPoint": "projects"
}
```

**Authoring**: `folderAnchor.under` carries the parent prefix — but it's a *literal*, hardcoded. If the user wants PARA inside any JD-numbered area, they need a regex on the anchor (which Phase G doesn't support yet) or per-pack rule replication.

### B — Named-slot template

```jsonc
{
  "id": "para-inside-jd",
  "priority": 20,
  "folderTemplate": "{jd-area:📁? \\d+ - [^/]+}/Projects/{topic}/{tail...}",
  "tagTemplate": "#{topic | kebab}/{tail | kebab}"
}
```

**Authoring**: `{jd-area:📁? \d+ - [^/]+}` is a slot with an inline regex pattern. The slot has a name but no transform on the tag side — meaning "match this part but discard it from the tag." Implicit lossy-direction signal: `{jd-area}` doesn't appear in the tag template, so it's *matched but discarded*.

### C — JSON slot-objects

```jsonc
{
  "id": "para-inside-jd",
  "folderShape": {
    "slots": [
      { "name": "jd-area", "kind": "segment", "match": "📁? \\d+ - [^/]+" },
      { "name": "_separator", "literal": "/Projects/" },
      { "name": "topic", "kind": "segment" },
      { "name": "tail", "kind": "glob" }
    ]
  },
  "tagShape": {
    "literal": "#",
    "slots": [
      { "name": "topic", "transforms": ["kebab"] },
      { "name": "tail", "transforms": ["kebab"] }
    ]
  }
}
```

**Authoring**: most verbose. The omission of `jd-area` from `tagShape.slots` is the lossy-direction signal — but it's harder to spot than B's "slot name not present in the tag template."

### E — Lens-flavored

```jsonc
{
  "id": "para-inside-jd",
  "lens": {
    "get": "{jd-area:📁? \\d+ - [^/]+}/Projects/{topic}/{tail...}",
    "put": "#{topic | kebab}/{tail | kebab}",
    "iso": false
  }
}
```

**Authoring**: B plus `iso: false` (because `{jd-area}` is matched-but-discarded — inverse can't reconstruct it). Exposes the lossy direction more honestly than B.

---

## Rule 4 — Marker-only Inbox

Folder: `Capture/Inbox/2026/Q2/notes.md`. Tag: `#-inbox`. The folder hierarchy below `Capture/Inbox/` collapses to a single marker tag.

### A — Regex

```jsonc
{
  "id": "inbox-marker",
  "folderPattern": "^Capture/Inbox(?:/.*)?$",
  "folderEntryPoint": "Capture/Inbox",
  "tagPattern": "^-inbox$",
  "tagEntryPoint": "-inbox",
  "transfer": { "op": "marker-only", "marker": "-inbox" }
}
```

**Authoring**: requires the typed `transfer.op` field for engine-level marker-only handling. Today's regex pattern alone doesn't say "collapse everything beneath."

### B — Named-slot template

```jsonc
{
  "id": "inbox-marker",
  "folderTemplate": "Capture/Inbox/{discarded...}",
  "tagTemplate": "#-inbox"
}
```

**Authoring**: `{discarded...}` is a glob slot that doesn't appear in `tagTemplate` — explicit signal that the tail is matched-but-discarded. The engine can derive `transfer.op: 'marker-only'` from this asymmetry. Or the template syntax could have a special `*` for "match anything, ignore" — `Capture/Inbox/*` — even cleaner.

### C — JSON slot-objects

```jsonc
{
  "id": "inbox-marker",
  "folderShape": {
    "literal": "Capture/Inbox/",
    "slots": [
      { "name": "_tail", "kind": "glob", "discarded": true }
    ]
  },
  "tagShape": {
    "literal": "#-inbox"
  }
}
```

**Authoring**: explicit `discarded: true`. Verbose; the `discarded` flag is information the engine could infer from "slot doesn't appear on the other side."

### E — Lens-flavored

```jsonc
{
  "id": "inbox-marker",
  "lens": {
    "get": "Capture/Inbox/{discarded...}",
    "put": "#-inbox",
    "iso": false,
    "cardinality": "many:1"
  }
}
```

**Authoring**: B plus explicit `iso: false` and `cardinality: "many:1"`. The cardinality claim is derivable from "tag side has no captured slots."

---

## Rule 5 — Truncation/aggregate Clips

The hardest case for round-trip. Folder: `Capture/Clips/Web/Tutorials/React/Hooks/intro.md`. Tag: `#-clip/web/tutorials-react-hooks`.

Truncation depth 2; deeper segments aggregate with `-` separator.

### A — Regex

```jsonc
{
  "id": "clip-truncate",
  "folderPattern": "^Capture/Clips/(.+)$",
  "folderEntryPoint": "Capture/Clips",
  "tagPattern": "^-clip/",
  "tagEntryPoint": "-clip",
  "transfer": {
    "op": "truncation",
    "depth": 2,
    "tailHandling": "aggregate",
    "separator": "-"
  }
}
```

**Authoring**: relies on the typed `transfer.op` field. The regex itself only matches; the truncation behavior is in metadata.

### B — Named-slot template

```jsonc
{
  "id": "clip-truncate",
  "folderTemplate": "Capture/Clips/{level1}/{level2}/{tail...}",
  "tagTemplate": "#-clip/{level1 | kebab}/{level2 | kebab}/{tail | join('-') | kebab}"
}
```

**Authoring**: `{tail | join('-')}` filter says "aggregate the glob slot's segments with a `-` separator." Truncation depth is *derivable* from how many literal slots come before `{tail...}` (here, 2). The aggregation behavior is *visible* in the template via the `join` filter.

### C — JSON slot-objects

```jsonc
{
  "id": "clip-truncate",
  "folderShape": {
    "literal": "Capture/Clips/",
    "slots": [
      { "name": "level1", "kind": "segment" },
      { "name": "level2", "kind": "segment" },
      { "name": "tail", "kind": "glob" }
    ]
  },
  "tagShape": {
    "literal": "#-clip/",
    "slots": [
      { "name": "level1", "transforms": ["kebab"] },
      { "name": "level2", "transforms": ["kebab"] },
      { "name": "tail", "aggregateSeparator": "-", "transforms": ["kebab"] }
    ]
  }
}
```

**Authoring**: explicit `aggregateSeparator` field on the tail slot. Verbose but unambiguous.

### E — Lens-flavored

```jsonc
{
  "id": "clip-truncate",
  "lens": {
    "get": "Capture/Clips/{level1}/{level2}/{tail...}",
    "put": "#-clip/{level1 | kebab}/{level2 | kebab}/{tail | join('-') | kebab}",
    "iso": false
  }
}
```

**Authoring**: B plus explicit `iso: false` (separator-collision ambiguity makes round-trip non-bijective).

---

## Comparison summary

| Dimension | A: Regex | B: Templates | C: Slot objects | E: Lens |
|---|---|---|---|---|
| **Lines per rule** | 7-12 | 3-5 | 12-18 | 4-7 |
| **Author-time bijection visibility** | hidden (asserted via metadata) | visible (slot overlap on both sides) | visible (slot overlap) | most explicit (`iso: true/false` claim) |
| **Lossy-direction visibility** | hidden | implicit (slot only on one side) | explicit (`discarded: true`) | explicit (`iso: false`) |
| **Per-slot transforms** | none (rule-level only) | inline filters (`{slug \| kebab}`) | per-slot config object | inline filters (same as B) |
| **Anchor handling** | separate `folderAnchor` field | folded into literal prefix | separate `literal` field | folded into `get` literal prefix |
| **Multi-entity quantification** | hard (`(.+)` is positional) | natural (`{owner}` flows through) | natural (named slots) | natural (same as B) |
| **JSON-friendliness** | high (flat) | high (single string per side) | high (verbose object) | high (single string per side) |
| **Required regex literacy** | yes | optional (only for inline slot patterns) | optional | optional |

## Reactions to ground the next conversation

Reading these side-by-side, three observations — **kept bulky on purpose** per the user's "start bulky, slim down as we're confident we've gone the right path":

1. **A (regex) is the existing surface and stays available** as an escape hatch regardless of which higher-level shape lands. The decision isn't "regex vs X"; it's "what comes next *alongside* regex."
2. **B (templates) is the smallest delta from regex with the largest readability win.** Same expressiveness for the canonical PARA/JD/SEACOW shapes; shorter; bijection visibility built in.
3. **C (slot-objects) and E (lens) are still in the running.** C's verbosity is real, but per-slot config objects unlock things templates can't easily express (e.g., slot-level constraints, conditional matchers). E's `iso` claim is mostly derivable, but the explicit declaration could be a feature for users who want round-trip guarantees made visible without the engine having to infer them.

**Don't narrow yet.** Path 2 (sandbox) builds support for **at least B + E** so we can feel both in practice; possibly all four shapes if the parser cost stays low. The data we get from authoring real rules in each shape is what justifies any future deprecation.

The path-forward question after Path 1: **does Path 2 build B + E + C (all three non-regex shapes), or do we drop one before sandbox?** Default: build all three; drop only if maintenance cost in the sandbox itself becomes unwieldy.

## Open questions to resolve before Path 2

If B is the finalist (or B + a stripped-down E with auto-derived `iso`):

- **Slot syntax**: `{slug}` vs `{{slug}}` vs `<slug>` — covered in Q2 of the original decision-gate list.
- **Filter pipeline syntax**: `{slug | kebab | num-strip}` vs `{slug:kebab,num-strip}` vs `{slug | filter('kebab')}`.
- **Optional vs required slots**: `{slug?}` for optional, `{slug...}` for glob.
- **Inline regex within slots**: `{jd-area:📁? \d+ - [^/]+}` — supported or not?
- **Default-to-regex escape hatch**: when none of the template syntax fits, drop to A.

These become the decision-gate Q2-Q4 questions if the user picks B.

## What Path 2 (sandbox) would look like

Once the user reacts to this comparison and narrows to 1-2 finalists:

- A page in plugin's advanced settings (per the user's "hide it in advanced settings" suggestion) with input fields for the chosen shapes
- User types a folder path + the target tag they want
- Plugin compiles the rule in each shape and shows: the matched slots, the produced regex, the inverse direction's behavior on representative inputs
- Hands-on, no code changes needed in the plugin's core; the parsers run only when the user opens the sandbox

Lower commitment than full plugin integration; still gives real authoring feel.

## Related

- [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — the abstraction question framed
- [Path abstractions, part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — the seven-candidate survey this entry distills
- [Development plan — F2 decision gate](/obsidian-folder-tag-sync/about/development-plan/) — the decision-gate question list
- [Solution brainstorm](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) — meta-shape framing including the SEACOW entity-quantification case (Rule 2 above)
