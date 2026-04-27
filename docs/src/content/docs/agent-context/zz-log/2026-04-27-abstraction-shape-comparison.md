---
title: Abstraction shape comparison — same 5 rules, four candidate shapes side-by-side
description: F2 decision-gate Q5 — "let's try the options and see what sticks." Path 1 of the try-then-pick approach. Five real-workflow rules drafted under four candidate abstraction shapes (regex / named-slot templates / JSON slot-objects / lens-flavored). User reads, reacts to authoring feel + readability, narrows to 1-2 finalists for Path 2 (sandbox).
tags: [research, architecture, abstraction, decision-gate, phase-h]
sidebar:
  label: "04-27 · Abstraction comparison"
  order: -20260427006
date: 2026-04-27
---

## Naming the abstraction — Path Lens

Going forward, the rule abstraction we're designing is called **Path Lens** (or **Folder-Tag Lens** in long form). The name is neutral about which *shape* the lens takes (template / slot-object / explicit get-put pair) — those are syntaxes; the lens is the meta-shape.

Why "lens": the academic lineage is Foster/Pierce's bidirectional lens calculus (Boomerang, BiGUL). A lens is a forward + inverse pair with round-trip laws — exactly what we're building. The name imports the formal vocabulary without forcing the academic syntax on users.

Why this matters: the abstraction *will* morph. The shape we ship next year may not be the shape we ship in three years; per-slot transforms, optional slots, frontmatter property bindings (F4) will all extend it. The name **Path Lens** survives those changes because it describes the *role* (a typed bidirectional path-mapping primitive), not the *syntax* of any particular implementation.

When you see "the lens" / "a lens" / "lens-shape" in the docs going forward, that's this abstraction. Specific syntaxes (template form, slot-object form, etc.) are *renderings* of the lens.

## What this is

Five real rules, four candidate abstraction shapes, drafted side-by-side. The user reads, reacts, narrows the field. Not picking yet — this is Path 1 of the *"try options in practice and see what sticks"* approach approved at F2 decision-gate Q5.

The four shapes evaluated (drawn from [Path abstractions Part 2](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/)):

- **A — Regex (status quo)** — today's `MappingRule` with `folderPattern` / `tagPattern` and `TransformConfig`
- **B — Named-slot path templates** — `folderTemplate: "Projects/{project}"` ↔ `tagTemplate: "#projects/{project}"` (slot name `{project}` describes the role; the canonical name varies per rule pack — see Q3)
- **C — JSON slot-objects** — `folderShape: { literal, slots: [...] }` (verbose; explicit per-slot config)
- **E — Lens-flavored explicit pair** — `lens: { get, put, iso }` (template-shape + bijectivity claim)

(D — OpenAPI-style — folded into C since they share the JSON-as-config shape. F — TS tagged literals — ruled out because rule packs are user-authored JSON. G — Mini-DSL — ruled out per Part 2.)

The five rules are drawn from the user's actual workflow shape, especially the cases where current regex has friction:

1. Emoji-prefixed JD area
2. Multi-entity SEACOW Output taxonomy
3. PARA inside a JD-numbered area
4. Marker-only Inbox
5. Truncation/aggregate Clips

## Templates don't replace transfer operations — they're an authoring surface for them

Before the per-rule comparison, the bridge that's been missing: **templates and the 8 transfer-op primitives are not in tension.** Templates are *how* you author a rule; transfer ops are *what the engine does* with the matched slots once a rule fires. The same eight ops still apply; templates just make their behavior visible at authoring time instead of asserting it via separate metadata.

Concretely, every transfer op has a template form. The slot syntax encodes the op's behavior directly:

| Transfer op | Template form (folder side ↔ tag side) | What the slot pattern says |
|---|---|---|
| `identity` | `Output/Public/{topic}/{deeper...}` ↔ `#publicTaxonomy/{topic}/{deeper...}` | Same slots both sides → bijective by construction |
| `truncation/drop` (depth=2) | `Capture/Clips/{section}/{subsection}` ↔ `#-clip/{section}/{subsection}` | No glob slot → engine rejects deeper paths (matches the rule's depth) |
| `truncation/aggregate` (depth=2) | `Capture/Clips/{section}/{subsection}/{deeper...}` ↔ `#-clip/{section}/{subsection}/{deeper \| join('-')}` | Glob slot with `\| join` filter → tail collapses with separator |
| `truncation/flatten` (depth=2) | `Capture/Clips/{section}/{subsection}/{discarded-middle...}/{leaf}` ↔ `#-clip/{section}/{subsection}/{leaf}` | Glob slot named-but-discarded; leaf survives → middle ancestry dropped |
| `promotion-to-root` | `Projects/{project}/{discarded-deeper...}` ↔ `#projects/{project}` | Glob slot only on folder side → deeper structure dropped |
| `flattening-to-leaf` | `Sources/{discarded-ancestry...}/{leaf}` ↔ `#via/{leaf}` | Multiple slots only on folder side → ancestry dropped, leaf survives |
| `post-coordination` | `Research/{axis-a}/{axis-b}` ↔ `[#{axis-a}, #{axis-b}]` | Tag template uses array form → multiple flat tags emitted |
| `aggregation` | `Capture/Clips/{path...}` ↔ `#-clip/{path \| join('-')}` | Whole tail joins with separator → one tag segment |
| `marker-only` | `Capture/Inbox/{discarded...}` ↔ `#-inbox` | Slot only on folder side, tag side is literal → fixed marker |
| `opaque` | `Attachments/{discarded...}` ↔ (no `tagTemplate`) | No tag emitted at all → clustering only |

Three patterns the table makes visible:

- **Slots present on both sides** → the round-trip preserves them (bijective for that slot)
- **Slots present only on the folder side** → matched-but-discarded (lossy forward)
- **Slots only on the tag side** → unsourced (config error; engine warns at load time)

The `cardinality` and `bijective` fields the typed model carries today (`'1:1' | '1:many' | 'many:1'`) become *derivable from slot overlap* rather than asserted as separate metadata. The engine still enforces them at runtime via the same eight ops; templates just make them visible at authoring time.

**The "naming the slot" problem** the user has flagged: the table above uses domain-meaningful names (`{topic}`, `{project}`, `{owner}`, `{leaf}`, `{section}`, `{deeper...}`) not URL-routing placeholders (`{slug}`, `{rest}`). The slot's name should describe *what role that piece plays in the rule's domain*, not be a generic variable label. The per-rule examples below follow this convention.

If a rule pack ships with `{topic}` slots, users authoring a similar rule will copy that name; if it ships with `{slug}`, they'll copy that. The community convention propagates from what the canonical packs use. Worth picking once and propagating — covered as a separate decision-gate question (Q3 — slot vocabulary).

## The majority case vs the minority case

Before the five complex rules: what does the **everyday 80%** look like under each shape, and where does each shape's power show?

**The everyday case: a simple identity rule** — `Projects/{topic}` folder maps directly to `#projects/{topic}` tag. This is what most shipped pack rules look like (PARA's projects/areas/resources/archive, JD's basic numbered area, SEACOW's `Capture/Inbox` marker, etc.). Same shape, four candidate forms:

```jsonc
// A — Regex (today)
{ "folderPattern": "^Projects/(.+)$", "tagPattern": "^projects/", "tagEntryPoint": "projects" }

// B — Templates
{ "folderTemplate": "Projects/{topic}", "tagTemplate": "#projects/{topic}" }

// C — JSON slot objects
{
  "folderShape": { "literal": "Projects/", "slots": [{ "name": "topic", "kind": "segment" }] },
  "tagShape": { "literal": "#projects/", "slots": [{ "name": "topic" }] }
}

// E — Lens-flavored
{ "lens": { "get": "Projects/{topic}", "put": "#projects/{topic}", "iso": true } }
```

The shapes' relative cost on the majority case:

- **A** still requires regex literacy even for the trivial case — `(.+)` is unnamed, `$` anchoring is implicit, the relationship between `(.+)` and the tag's `^projects/` is positional rather than visible.
- **B** is one line per side; reads like the path itself. The slot name `{topic}` describes the role; the template structure is the rule structure.
- **C** is 5+ lines for what B does in 1. Every literal segment requires a separate object entry; verbosity tax shows even when the rule is trivial.
- **E** is B plus a redundant `iso: true` claim. Engine could derive it from slot overlap; the explicit declaration buys nothing on the majority case.

**The power-user minority** is what the five rules below cover — emoji prefixes, multi-entity quantification, hierarchical composition, lossy transfer ops with explicit signaling. Different shapes have different ergonomics there:

- **A** scales by becoming progressively gnarlier regex (`^📁 \d+ - [^/]+/...`) plus separate metadata fields (`folderAnchor`, `transfer.op`)
- **B** scales via inline filter syntax (`{topic | kebab | num-prefix-strip}`) and named-but-discarded slots
- **C** scales by adding fields to slot objects (`{ "name": "topic", "transforms": [...], "match": "..." }`)
- **E** scales by adding explicit lens fields (`iso`, `cardinality`, `complement`)

**Distribution observation across shipped rule packs** (PARA + JD + SEACOW-outer + SEACOW-cyberbase + Zettelkasten + cyberbase-actual): roughly **75-85% of rules are the trivial-identity majority** (single folder pattern → single tag prefix, optional case transform). The remaining 15-25% involve emoji prefixes, multi-entity scoping, marker-only Inboxes, or truncation. The B/C/E differentiation on the *minority* matters less than the B/C/E differentiation on the *majority* — because most rules look like the majority.

**Implication for the abstraction choice**: B (templates) wins decisively on the majority case (1 line vs 7+ for A, 1 line vs 5 for C). C only earns its verbosity in advanced cases that require per-slot config. E only earns its `iso` field when formal bijection guarantees become a feature. **The majority case is where users spend their time; that's where ergonomics matter most.** The minority cases inform whether each shape can scale; the majority cases inform whether each shape is pleasant.

This isn't a vote for B alone (per the user's "start bulky, slim down" principle). But it does suggest: **if Path 2 (sandbox) only built one shape first, B would be the right starting point because its majority-case ergonomics are clearest.**

---

## Three architectural concerns the abstraction has to support (or leave room for)

User-surfaced during the comparison review. Each addresses a different layer of "what FTSync is doing for me," and each constrains the abstraction choice differently.

### 1. Rules within rules — how each abstraction handles composition

Composition shows up in three patterns the user has hit in practice:

- **Single rule scoped under a literal prefix** (e.g., PARA inside `Entity/Cybersader/`). Already handled today via [Phase G's](/obsidian-folder-tag-sync/concepts/folder-classifiers/) `folderAnchor: { under: 'Entity/Cybersader' }` field — works in regex (A) by adding the literal to `folderPattern`; works in templates (B) by including the literal in the template prefix.
- **Single rule absorbing outer context as a slot** (e.g., one rule captures any entity, not just Cybersader). Templates handle this naturally: `Entity/{owner}/Projects/{project}` quantifies over entities. Regex needs an unnamed `(.+)` plus separate metadata to label it. Slot-objects (C) handle it but verbosely.
- **Pack-level composition** (e.g., "install PARA inside JD inside SEACOW entity scope"). [Challenge 06](/obsidian-folder-tag-sync/agent-context/zz-challenges/06-compositional-rule-packs/) is the in-flight research. None of A/B/C/E *fully* solve it today; it's a layer above individual rules. But the chosen abstraction affects how cleanly it composes — templates' literal-prefix-as-anchor makes "this pack anchors under that pack's match" easier to compute than regex's positional capture groups.

**For the abstraction choice**: B and E shine on pattern-2 (slot capture for outer context). All four shapes can do pattern-1 today. Pattern-3 needs Challenge 06 to land regardless of which shape we pick — but B and C make the pack-composition primitive easier to design (pack's `anchorTemplate` field can be a template literal that other packs' rules absorb).

### 2. Coverage completeness — does every folder/tag have a rule?

Aspiration: no folder is silently untouched by FTSync; no tag namespace is unowned by some rule.

**Today**: not a feature. A folder that doesn't match any rule's pattern is invisible. A tag with no matching inverse rule sits inert. The plugin is *opt-in by rule*, not coverage-checking.

**Future feature, abstraction-independent**: a "completeness audit" that scans the vault, identifies folders matching no rule + tags matching no inverse rule, and surfaces them for the user. Could ship behind any abstraction (A through E). Doesn't constrain the choice.

**The closest thing today**: vault-scan rule-pack detection (`detectPacks.ts`) — surfaces packs that match the user's vault structure, but only suggests installation, doesn't audit coverage gaps.

**For this piece**: not a blocker. Coverage completeness is a layer on top of any abstraction.

### 3. The SEACOW meta-framework GUI vision — rule packs as compilation targets

The user's bigger picture: at a higher level (a GUI, possibly a separate plugin), users design their organizational *system* by declaring axes (SEACOW: System / Entity / Activity / Capture / Output / Work), naming conventions, structural rules — *then* deploy that system into a vault. The FTSync plugin (and possibly the design plugin) keeps the system in sync over time.

This makes rule packs the **compilation target** of a higher-level design tool, not the user's primary authoring surface. Direct implications for the abstraction choice:

- **The abstraction needs to be machine-generatable.** A future GUI that lets users design SEACOW axes graphically and exports a rule pack needs a target shape that's easy to emit programmatically.
- **A — Regex**: hardest to generate. Generators have to construct regex syntax, which is error-prone. User-friendly *to read* (sometimes); machine-friendly *to emit* — no.
- **B — Templates**: easiest to generate. String concatenation of literals + slot names. Trivial for any tool to emit.
- **C — Slot objects**: easiest to validate (explicit JSON schema), straightforward to generate. The verbosity tax is low when a generator emits it (no human typing).
- **E — Lens**: same as B for emission; explicit `iso` field is one extra attribute the generator computes.

**For the abstraction choice**: B and C are generator-friendly; A is hostile to generation. If the SEACOW GUI vision is ever pursued, the abstraction should not be regex-only. **B is most generator-friendly with reasonable hand-author ergonomics; C is most schema-validatable but verbose.** The hybrid path (B as primary, A as escape hatch) lets future tooling target B while preserving regex for cases B can't express.

**Out of scope for this piece**: actually building the SEACOW design GUI. That's a separate product (probably a separate Obsidian plugin or a standalone tool that exports JSON rule packs). The abstraction choice for FTSync's rule format is the one piece this comparison settles; the GUI is downstream work that the chosen abstraction supports or hinders.

### Summary — what this piece needs to account for

- ✅ **Composition pattern 1 + 2** (rule scoping, slot-capture for outer context): all four shapes handle pattern 1; B and E handle pattern 2 most cleanly; affects ergonomics of common multi-entity / hierarchical workflows.
- 🔄 **Composition pattern 3** (pack-level stacking): not solved by abstraction choice alone; lives in Challenge 06's pack-composition design. Abstraction *affects* how clean Challenge 06's design ends up.
- 🚫 **Coverage completeness**: orthogonal; not a constraint on the abstraction.
- 🔄 **System-design GUI as future product**: not built now, but the abstraction should be **generator-friendly**. Argues against regex-only; argues for B (templates) as the primary target, with A (regex) as escape hatch and C / E as alternatives the sandbox tries.

The user's "ideally everything on both sides has a rule" intuition aligns with the SEACOW-GUI vision: a higher-level designer authors the rules so the user doesn't have to think about coverage gaps. **That future is enabled by an abstraction the GUI can target — i.e., B, C, or E. Not A.**

---

## What slot names actually do — comment-like vs load-bearing

User question worth its own section: *"are the named-slot labels merely to help for readability similar to code comments?"*

The honest answer is **mixed** — slot names are partly comment-like and partly functional. Four cases distinguish where:

### 1. Within-rule consistent rename — comment-like

Renaming a slot consistently on *both sides* of a rule has zero engine impact:

```jsonc
// These two rules behave identically at runtime:
{ "folderTemplate": "Projects/{topic}", "tagTemplate": "#projects/{topic}" }
{ "folderTemplate": "Projects/{x}",     "tagTemplate": "#projects/{x}" }
```

The engine doesn't care whether you call the slot `topic`, `x`, or `apple-pie`. It cares about the *value* bound to that name flowing through both sides. Within a single rule, the name is documentation for human readers — same role as a variable name in a function.

### 2. Cross-side name match — load-bearing

Renaming a slot on *only one side* breaks the round-trip:

```jsonc
// This rule is broken — the engine has no way to know `{topic}` and `{section}` are the same value:
{ "folderTemplate": "Projects/{topic}", "tagTemplate": "#projects/{section}" }
```

The engine uses **name equality** to determine which slots round-trip. Folder-side `{topic}` matches tag-side `{topic}` → bidirectional binding. Folder-side `{topic}` and tag-side `{section}` → two unrelated slots; the tag-side `{section}` is *unsourced* (config error the engine flags at load time).

This is the load-bearing role of the name. It's also how the engine derives `cardinality` and `bijective` from the rule shape — slots present on both sides are bijective binds; slots only on one side are lossy directions.

### 3. Cross-rule naming conventions — comment-like for engine, load-bearing for humans + generators

Two different rule packs using *different* names for the same role:

```jsonc
// Pack A:  { "folderTemplate": "Projects/{topic}",   ... }
// Pack B:  { "folderTemplate": "Projects/{project}", ... }
// Pack C:  { "folderTemplate": "Projects/{x}",       ... }
```

The engine treats all three as equivalent — they each have one slot, captured into a folder→tag binding within their own rule. But:

- **Human readers** copy the name they see in canonical packs. If shipped PARA uses `{project}`, users authoring similar rules will use `{project}` too. The convention propagates.
- **Future generators** (the SEACOW GUI vision) need a canonical name to emit. A design tool that produces rule packs from higher-level structure will pick one name and stick with it.

So while the engine treats cross-rule names as comments, the broader ecosystem treats them as conventions worth picking once. That's why decision-gate Q3 (slot vocabulary for shipped packs) is a real decision, not just a stylistic preference.

### 4. F4 future — property-driven destination makes names load-bearing as bindings

When [F4 frontmatter-property-driven destination](/obsidian-folder-tag-sync/about/roadmap/) lands, slot names gain a third functional role: they bind to frontmatter properties on a file.

```jsonc
// Hypothetical F4 syntax:
{
  "folderTemplate": "Entity/{owner}/Projects/{project}",
  "tagTemplate": "#projects/{project}",
  "fromFrontmatter": ["owner"]  // {owner} sourced from file's frontmatter `owner:` field
}
```

Renaming `{owner}` to `{user}` in this rule would *re-bind* the slot to a different frontmatter property. The engine reads `frontmatter.user` instead of `frontmatter.owner`. This is functional, not comment-like — the name *is* the property reference.

### Summary

| Case | Engine cares about name? | Why |
|---|---|---|
| Within-rule consistent rename (both sides) | No | Engine binds value to name; specific name doesn't matter as long as both sides match |
| Cross-side name *mismatch* | Yes | Mismatch breaks round-trip — engine uses name equality to detect bidirectional slots |
| Per-slot transform reference (`{topic \| kebab}`) | Yes | The transform pipeline references the slot by name to apply the filter |
| Cross-rule naming conventions | No (engine) / Yes (humans + generators) | Engine treats different rules as independent; ecosystem benefits from canonical names |
| F4 property binding (future) | Yes | Slot name *is* the frontmatter property reference |

**One-line summary**: slot names are functional in three places (cross-side match, per-slot transform reference, future property binding) and comment-like in others (within-rule consistent rename, cross-rule convention). The names you choose for canonical rule packs become conventions the ecosystem inherits — that's why we'd pick `{topic}` over `{x}` even though the engine doesn't care, and why Q3 (slot vocabulary) is a real decision-gate question.

---

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
  "folderTemplate": "📁? {jd-area}/{topic}/{deeper...}",
  "tagTemplate": "#{jd-area | num-prefix-keep | kebab}/{topic | kebab}/{deeper | kebab}"
}
```

**Authoring**: `{jd-area}` captures `10 - Projects` (the JD-shaped folder); `{topic}` is the inner organizational unit (`Web Auth`); `{deeper...}` is the rest of the path (`oauth/notes.md`). Per-slot filters (`num-prefix-keep`, `kebab`) say what each slot does on the tag side. `📁?` makes the optional emoji prefix *visible* in syntax — no regex character-class voodoo. Names describe roles, not placeholders.

### C — JSON slot-objects

```jsonc
{
  "id": "jd-numbered-area",
  "priority": 10,
  "folderShape": {
    "literal": "📁? ",
    "slots": [
      { "name": "jd-area", "kind": "segment", "match": "\\d+ - [^/]+" },
      { "name": "topic", "kind": "segment" },
      { "name": "deeper", "kind": "glob" }
    ]
  },
  "tagShape": {
    "literal": "#",
    "slots": [
      { "name": "jd-area", "transforms": ["num-prefix-keep", "kebab"] },
      { "name": "topic", "transforms": ["kebab"] },
      { "name": "deeper", "transforms": ["kebab"] }
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
    "get": "📁? {jd-area}/{topic}/{deeper...}",
    "put": "#{jd-area | num-prefix-keep | kebab}/{topic | kebab}/{deeper | kebab}",
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
  "folderTemplate": "Entity/{owner}/Output/Public/{topic}/{deeper...}",
  "tagTemplate": "#--{owner | kebab}/_publicTaxonomy/{topic | kebab}/{deeper | kebab}"
}
```

**Authoring**: `{owner}` flows through both sides — same rule fires on `Entity/Bob/...`, `Entity/Alice/...`, and the tag carries the entity name. `{topic}` captures the top-level subject (`Security`); `{deeper...}` captures the rest (`Zero-Trust/principles.md`). Per-entity quantification falls out of slot reuse, no special syntax required.

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
      { "name": "deeper", "kind": "glob" }
    ]
  },
  "tagShape": {
    "literal": "#--",
    "slots": [
      { "name": "owner", "transforms": ["kebab"] },
      { "name": "_separator", "literal": "/_publicTaxonomy/" },
      { "name": "topic", "transforms": ["kebab"] },
      { "name": "deeper", "transforms": ["kebab"] }
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
    "get": "Entity/{owner}/Output/Public/{topic}/{deeper...}",
    "put": "#--{owner | kebab}/_publicTaxonomy/{topic | kebab}/{deeper | kebab}",
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
  "folderTemplate": "{jd-area:📁? \\d+ - [^/]+}/Projects/{topic}/{deeper...}",
  "tagTemplate": "#{topic | kebab}/{deeper | kebab}"
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
      { "name": "deeper", "kind": "glob" }
    ]
  },
  "tagShape": {
    "literal": "#",
    "slots": [
      { "name": "topic", "transforms": ["kebab"] },
      { "name": "deeper", "transforms": ["kebab"] }
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
    "get": "{jd-area:📁? \\d+ - [^/]+}/Projects/{topic}/{deeper...}",
    "put": "#{topic | kebab}/{deeper | kebab}",
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
      { "name": "_inbox-content", "kind": "glob", "discarded": true }
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
  "folderTemplate": "Capture/Clips/{section}/{subsection}/{deeper...}",
  "tagTemplate": "#-clip/{section | kebab}/{subsection | kebab}/{deeper | join('-') | kebab}"
}
```

**Authoring**: `{section}` and `{subsection}` are the two preserved levels; `{deeper...}` is the glob that aggregates with `| join('-')`. Truncation depth is *derivable* from how many literal slots come before `{deeper...}` (here, 2). The aggregation behavior is *visible* in the template via the `join` filter — no separate metadata field required.

### C — JSON slot-objects

```jsonc
{
  "id": "clip-truncate",
  "folderShape": {
    "literal": "Capture/Clips/",
    "slots": [
      { "name": "section", "kind": "segment" },
      { "name": "subsection", "kind": "segment" },
      { "name": "deeper", "kind": "glob" }
    ]
  },
  "tagShape": {
    "literal": "#-clip/",
    "slots": [
      { "name": "section", "transforms": ["kebab"] },
      { "name": "subsection", "transforms": ["kebab"] },
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
    "get": "Capture/Clips/{section}/{subsection}/{deeper...}",
    "put": "#-clip/{section | kebab}/{subsection | kebab}/{deeper | join('-') | kebab}",
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
