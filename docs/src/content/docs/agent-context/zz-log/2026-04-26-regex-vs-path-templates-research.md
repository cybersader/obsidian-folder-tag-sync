---
title: Regex vs. path templates — abstraction research
description: Session-log capture of the architectural question that surfaced during Phase G — is regex the right primitive for bidirectional folder ↔ tag mappings, and what would a path-template-based evolution look like?
tags: [research, architecture, abstraction, phase-g, phase-h]
sidebar:
  label: "04-26 · Regex vs. templates"
  order: -20260426000
date: 2026-04-26
---

## Frame: what's actually being mapped

The plugin sits between two structurally different namespaces. A clean picture of the bidirectional problem before any technical depth:

<figure aria-label="The same folder path under one PARA Projects rule, decomposed under two abstractions. Both views see the same path segments. Regex labels them by position (group 1, group 2, ...). Templates label them by name (project, tail). The named labels are handles the engine can use for per-slot transforms, inverse instantiation, and bijection checks; positional groups carry no such handles." style="margin: 2em 0;">
<div style="text-align: center; margin-bottom: 1.25em;"><div style="font-size: 1.4em; font-weight: 700; letter-spacing: 0.04em;">THE ABSTRACTION CHOICE</div><div style="font-size: 0.9em; opacity: 0.7; font-style: italic; margin-top: 0.4em;">Same input, same matching outcome. What does each view <strong style="font-style: normal;">tell the engine</strong> about its structure?</div></div>
<div style="border: 1.5px solid currentColor; border-color: rgba(125,125,125,0.4); border-radius: 12px; padding: 0.9em 1.25em; margin-bottom: 0.5em;"><div style="font-size: 0.7em; font-weight: 700; opacity: 0.6; letter-spacing: 0.1em; margin-bottom: 0.4em;">SETUP &middot; one rule, one path</div><div style="font-size: 0.85em; opacity: 0.85; margin-bottom: 0.6em;"><strong>Rule (PARA Projects, identity transfer):</strong> &nbsp;<code>folderEntryPoint = "Projects"</code> &middot; <code>folderAnchor = 'root'</code> &middot; <code>transfer.op = 'identity'</code></div><div style="font-size: 0.7em; font-weight: 700; opacity: 0.6; letter-spacing: 0.1em; margin-bottom: 0.3em;">INPUT FOLDER PATH</div><code style="display: block; font-size: 1.05em; word-break: break-word; padding: 0;"><span style="opacity: 0.6;">Projects/</span><strong style="color: #c14a3f;">Web Auth</strong><span style="opacity: 0.6;">/</span><strong style="color: #c14a3f;">oauth-flow</strong><span style="opacity: 0.6;">/</span><strong style="color: #c14a3f;">notes.md</strong></code></div>
<div style="text-align: center; opacity: 0.55; font-style: italic; font-size: 0.8em; margin: 0.4em 0;">two views &darr;</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.25em;">
<div style="border: 1.5px solid #b87333; border-radius: 12px; padding: 0.9em 1.25em;"><div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 0.5em; margin-bottom: 0.6em;"><strong style="color: #b87333; letter-spacing: 0.05em; font-size: 0.95em;">REGEX VIEW &mdash; TODAY</strong><em style="opacity: 0.55; font-size: 0.78em;">positional</em></div><div style="font-size: 0.7em; font-weight: 700; opacity: 0.6; letter-spacing: 0.06em; margin-bottom: 0.25em;">DERIVED PATTERN</div><code style="display: block; padding: 0.5em 0.65em; background: rgba(125,125,125,0.1); border-radius: 4px; word-break: break-all; font-size: 0.85em; margin-bottom: 0.9em;">^Projects/([^/]+)/([^/]+)/([^/]+)$</code><div style="font-size: 0.78em; font-weight: 700; color: #4f8a4a; letter-spacing: 0.05em; margin: 0.6em 0 0.3em;">&#x2713; WHAT IT GIVES US</div><ul style="margin: 0; padding-left: 1.2em; font-size: 0.92em; line-height: 1.5;"><li>match? <strong>yes</strong></li><li>3 positional capture groups: <code style="color: #b87333;">"Web Auth"</code>, <code style="color: #b87333;">"oauth-flow"</code>, <code style="color: #b87333;">"notes.md"</code></li></ul><div style="font-size: 0.78em; font-weight: 700; color: #b87333; letter-spacing: 0.05em; margin: 1em 0 0.3em;">&#x2717; WHAT'S MISSING</div><ul style="margin: 0; padding-left: 1.2em; font-size: 0.92em; line-height: 1.5;"><li>what role does each group play? <em style="opacity: 0.6;">unnamed</em></li><li>per-slot transform handle? <em style="opacity: 0.6;">none</em></li><li>how to invert? <em style="opacity: 0.6;">hand-rolled string surgery</em></li><li>bijection visible from pattern alone? <em style="opacity: 0.6;">no &mdash; asserted via <code>cardinality</code> + <code>bijective</code> metadata</em></li></ul></div>
<div style="border: 1.5px solid #4f8a4a; border-radius: 12px; padding: 0.9em 1.25em;"><div style="display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 0.5em; margin-bottom: 0.6em;"><strong style="color: #4f8a4a; letter-spacing: 0.05em; font-size: 0.95em;">TEMPLATE VIEW &mdash; PROPOSED</strong><em style="opacity: 0.55; font-size: 0.78em;">named</em></div><div style="font-size: 0.7em; font-weight: 700; opacity: 0.6; letter-spacing: 0.06em; margin-bottom: 0.25em;">TEMPLATE</div><code style="display: block; padding: 0.5em 0.65em; background: rgba(125,125,125,0.1); border-radius: 4px; word-break: break-all; font-size: 0.95em; margin-bottom: 0.9em;"><span style="opacity: 0.6;">Projects/</span><strong style="color: #4f8a4a;">&#123;project&#125;</strong><span style="opacity: 0.6;">/</span><strong style="color: #4f8a4a;">&#123;tail...&#125;</strong></code><div style="font-size: 0.78em; font-weight: 700; color: #4f8a4a; letter-spacing: 0.05em; margin: 0.6em 0 0.3em;">&#x2713; WHAT IT GIVES US</div><ul style="margin: 0; padding-left: 1.2em; font-size: 0.92em; line-height: 1.5;"><li>match? <strong>yes</strong></li><li><code style="color: #4f8a4a;">project</code> = <code style="color: #c14a3f;">"Web Auth"</code> &nbsp;<em style="opacity: 0.6;">&larr; one project entry under PARA</em></li><li><code style="color: #4f8a4a;">tail</code> = <code style="color: #c14a3f;">"oauth-flow/notes.md"</code> &nbsp;<em style="opacity: 0.6;">&larr; everything deeper, glob</em></li></ul><div style="font-size: 0.78em; font-weight: 700; color: #4f8a4a; letter-spacing: 0.05em; margin: 1em 0 0.3em;">&#x2713; ALSO BUILT-IN</div><ul style="margin: 0; padding-left: 1.2em; font-size: 0.92em; line-height: 1.5;"><li>layer = literal prefix <strong>Projects/</strong> (no separate <code>folderAnchor</code> needed)</li><li>per-slot transform handle: <code>{project | kebab}</code> kebab-cases just the project name</li><li>inverse = template instantiation with slot values</li><li>bijection: visible &mdash; both sides share <code>{project}</code> and <code>{tail...}</code> = round-trips</li></ul></div>
</div>
<div style="margin-top: 1em; padding: 0.75em 1em; border-left: 3px solid rgba(125,125,125,0.5); background: rgba(125,125,125,0.06); font-size: 0.88em;"><strong>Slot names are labels, not domain claims.</strong> <code>{project}</code> here just means "the single path segment that comes immediately after the <code>Projects/</code> entry." It doesn't try to be the user's vocabulary &mdash; it labels what role that segment plays in <em>this rule</em>. The same template applied to a different vault would still call it <code>{project}</code>; the slot is named for its position relative to the literal prefix, not for what it semantically represents on disk.</div>
</figure>

> **Aside &mdash; "what about Johnny Decimal's `10 - Projects`?"** Both abstractions agree: `10 - Projects` is *one* composite path segment on disk. The regex captures it via `([^/]+)` as one group; a template captures it via one slot like `{jdEntry}`. Neither view splits the `10 - ` prefix from the rest &mdash; that's not what either pattern is doing. The prefix is sort-order metadata baked into the folder name; turning `10 - Projects` into the tag-side `projects` is the job of an existing transform primitive: `numberPrefixHandling: 'strip'`. That runs *after* match/extract, in the transform pipeline. Both regex rules and template rules are agnostic to it &mdash; the transform primitive does the work either way. So the pattern abstraction question (regex vs. template) and the prefix-stripping question (number-prefix transform) are *orthogonal*. Templates don't change what `numberPrefixHandling` does; they change what the *engine knows* about the slot it's applied to.
<figure aria-label="One file in the filesystem reaches three tag addresses via three rules. Rule A is bijective (forward and inverse round-trip). Rules B and C are lossy in the inverse direction by design — marker-only and any-segment patterns drop information that the inverse cannot reconstruct." style="margin: 2.5em 0 1.5em;">
  <svg viewBox="0 0 760 380" preserveAspectRatio="xMidYMid meet" role="img" style="width: 100%; height: auto; max-width: 800px;">
    <defs>
      <marker id="rt-ok-end" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L10,5 L0,9 Z" fill="#4f8a4a" /></marker>
      <marker id="rt-ok-start" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M10,1 L0,5 L10,9 Z" fill="#4f8a4a" /></marker>
      <marker id="rt-warn-end" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1 L10,5 L0,9 Z" fill="#b87333" /></marker>
    </defs>
    <text x="380" y="32" font-size="18" font-weight="700" fill="currentColor" text-anchor="middle" letter-spacing="0.04em">ONE FILE → MANY ADDRESSES</text>
    <text x="380" y="56" font-size="13" fill="currentColor" opacity="0.7" text-anchor="middle" font-style="italic">strict hierarchy on the filesystem; polyhierarchy in the tag namespace</text>
    <g transform="translate(40, 110)">
      <text x="0" y="0" font-size="13" font-weight="700" fill="currentColor" letter-spacing="0.06em">FILESYSTEM</text>
      <text x="0" y="20" font-size="11" fill="currentColor" opacity="0.65">one path · one parent</text>
      <g transform="translate(0, 44)" font-family="ui-monospace, monospace" font-size="14">
        <text x="0" y="0" fill="currentColor">Projects/Web/auth/</text>
        <text x="20" y="22" fill="#c14a3f" font-weight="700">note.md</text>
        <circle cx="14" cy="18" r="5" fill="#c14a3f" />
      </g>
    </g>
    <g transform="translate(440, 110)">
      <text x="280" y="0" font-size="13" font-weight="700" fill="currentColor" text-anchor="end" letter-spacing="0.06em">TAG NAMESPACE</text>
      <text x="280" y="20" font-size="11" fill="currentColor" opacity="0.65" text-anchor="end">many addresses · many parents</text>
      <g transform="translate(0, 36)">
        <rect x="0" y="0" width="280" height="44" rx="8" fill="currentColor" fill-opacity="0.03" stroke="#4f8a4a" stroke-width="2" />
        <text x="140" y="20" font-size="13" font-weight="700" fill="#4f8a4a" text-anchor="middle">#projects/web/auth</text>
        <text x="140" y="36" font-size="10" fill="currentColor" opacity="0.6" text-anchor="middle">rule A · bijective ↔</text>
      </g>
      <g transform="translate(0, 96)">
        <rect x="0" y="0" width="280" height="44" rx="8" fill="currentColor" fill-opacity="0.03" stroke="#b87333" stroke-width="2" stroke-dasharray="6 4" />
        <text x="140" y="20" font-size="13" font-weight="700" fill="#b87333" text-anchor="middle">#ritual/auth</text>
        <text x="140" y="36" font-size="10" fill="currentColor" opacity="0.6" text-anchor="middle">rule B · lossy inverse →</text>
      </g>
      <g transform="translate(0, 156)">
        <rect x="0" y="0" width="280" height="44" rx="8" fill="currentColor" fill-opacity="0.03" stroke="#b87333" stroke-width="2" stroke-dasharray="6 4" />
        <text x="140" y="20" font-size="13" font-weight="700" fill="#b87333" text-anchor="middle">#q4-2026</text>
        <text x="140" y="36" font-size="10" fill="currentColor" opacity="0.6" text-anchor="middle">rule C · marker-only →</text>
      </g>
    </g>
    <path d="M 250 168 C 320 168, 380 168, 440 168" fill="none" stroke="#4f8a4a" stroke-width="2.5" marker-end="url(#rt-ok-end)" marker-start="url(#rt-ok-start)" />
    <path d="M 250 168 C 320 200, 380 240, 440 228" fill="none" stroke="#b87333" stroke-width="2.5" stroke-dasharray="7 4" marker-end="url(#rt-warn-end)" />
    <path d="M 250 168 C 320 220, 380 290, 440 288" fill="none" stroke="#b87333" stroke-width="2.5" stroke-dasharray="7 4" marker-end="url(#rt-warn-end)" />
    <g transform="translate(380, 350)" text-anchor="middle">
      <text font-size="11" fill="currentColor" opacity="0.75"><tspan fill="#4f8a4a" font-weight="700">━━━ bijective</tspan>: forward(inverse(t)) === t<tspan dx="20" fill="#b87333" font-weight="700">━ ━ lossy</tspan>: inverse cannot recover dropped structure</text>
    </g>
  </svg>
</figure>

Three components, three asymmetries:

- **Filesystem** is a *strict hierarchy* — every file has exactly one path, exactly one parent folder. The OS enforces this; we don't get to negotiate it.
- **Tag namespace** is a *polyhierarchy* — the same file can be reachable via many tag paths (`#projects/web`, `#ritual/auth`, `#q4-2026` all addressing the same `note.md`). Tags compose freely; the same nested term (`#projects/web`) can sit under multiple roots without contradiction.
- **Sync engine** mediates: each rule is a (folder pattern, tag pattern, transfer-op) triple that describes a *correspondence*. Whether that correspondence is *invertible* — i.e. whether `forward(inverse(t)) === t` for every tag `t` the rule produces — is the question at the heart of this document.

**Direct answer to "is full bidirectional determinism always achievable?"**: no, and that's by design. Identity-style rules (PARA's `Projects/{slug}` ↔ `#projects/{slug}`) round-trip perfectly. Lossy operations — truncation-with-drop, marker-only, promotion-to-root — *deliberately throw information away* in one direction; the inverse can't reconstruct what was dropped. The abstraction we want isn't one that *forces* determinism (that would just disallow useful rules), but one that **makes the per-rule determinism status visible at authoring time, instead of being asserted as metadata afterward**. That's the criterion path templates with typed slots satisfy and bare regex doesn't.

## Vocabulary borrowed from prior fields

These terms are load-bearing for the rest of this document. They're pulled from information science (classification theory, knowledge organization), formal language theory, and bidirectional programming research — established terms, not invented for this plugin.

### Strict hierarchy vs. polyhierarchy

Classification-theory terms. A **strict hierarchy** enforces single parentage at every level (a tree). A **polyhierarchy** permits multi-parent structure (a directed acyclic graph) — the same node can sit under several broader categories without ambiguity. Library Subject Heading systems (LCSH, MeSH) are explicitly polyhierarchical for exactly the reasons Obsidian tags are: real-world concepts don't fit into one parent category. Folder-tag-sync's reason-to-exist is bridging a strict-hierarchy primitive (filesystem) to a polyhierarchical addressing system (tags).

### Pre-coordination vs. post-coordination

Already covered in [philosophy](/obsidian-folder-tag-sync/concepts/philosophy/). Briefly: a **pre-coordinated** descriptor fuses concepts into a single hierarchical token (`#projects/q4-roadmap` is one term carrying two concepts joined by subordination). A **post-coordinated** descriptor splits concepts into independent tags applied together (`#projects` AND `#q4` AND `#roadmap`). Folder paths are inherently pre-coordinated; tag systems can be either.

### Syntax vs. semantics

Regex captures **syntax**: does this character sequence satisfy this pattern? It says nothing about **semantics**: which part of the matched sequence is the *layer* (where in the tree the rule fires), which part is a *variable* (capturable, recoordinable content), what *name* the variable carries, what *role* it plays in the rule. Phase G's `folderAnchor` field exists because the syntactic representation hid the semantic question "where does this rule anchor?" Path templates with named slots are the more direct encoding: the literal segments are syntax, the `{name}` slots carry semantics, and the conversion between them is mechanical rather than interpretive.

> **Plain-English version:** regex tells the engine "does this string look right?" Templates tell the engine "what role does each piece of this string play?" Both produce the same yes/no match answer. The difference is what the system can do *after* the match — generate the inverse, surface a slot to the user, run a per-slot transform, prove bijection — because templates know which piece is which.

### Lossy vs. lossless transformation

Information-theoretic. A transformation is **lossless** when the input can be perfectly reconstructed from the output; **lossy** when it can't. Identity rules are lossless in both directions (folder ↔ tag preserves content). `truncation` with `tailHandling: 'drop'` is lossy folder-to-tag (segments past the depth cap are erased) and partial tag-to-folder (the inverse can only restore the depth-capped prefix). `marker-only` collapses any folder under the entry into a single fixed tag — maximally lossy in the folder→tag direction.

<figure aria-label="Three concrete folder-to-tag transformations showing what survives and what's dropped. Identity is lossless both ways. Truncation-with-drop discards segments past the depth cap; the inverse can only recover the depth-capped prefix. Marker-only collapses many folder paths to one tag; the inverse can recover only the entry folder, not the specific path." style="margin: 1.5em 0;">
<div style="display: grid; grid-template-columns: 1fr; gap: 1em;">
<div style="border: 1.5px solid #4f8a4a; border-radius: 10px; padding: 1em 1.25em;"><div style="font-size: 0.78em; font-weight: 700; color: #4f8a4a; letter-spacing: 0.06em; margin-bottom: 0.5em;">IDENTITY · lossless both ways</div><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.5em 1em; align-items: center; font-family: ui-monospace, monospace; font-size: 0.95em;"><div><strong>Projects/Web</strong></div><div style="text-align: center; opacity: 0.55;">→ forward →</div><div><strong style="color: #4f8a4a;">#projects/web</strong></div><div style="grid-column: 1 / -1; opacity: 0.7; font-size: 0.85em; font-style: italic; font-family: inherit;">every character round-trips · forward and inverse are perfect inverses</div></div></div>
<div style="border: 1.5px solid #b87333; border-radius: 10px; padding: 1em 1.25em;"><div style="font-size: 0.78em; font-weight: 700; color: #b87333; letter-spacing: 0.06em; margin-bottom: 0.5em;">TRUNCATION (depth=3, tailHandling: drop) · lossy forward</div><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.5em 1em; align-items: center; font-family: ui-monospace, monospace; font-size: 0.95em;"><div><strong>Projects/Web/Auth</strong><span style="opacity: 0.4; text-decoration: line-through;">/Backend/details</span></div><div style="text-align: center; opacity: 0.55;">→ forward →</div><div><strong style="color: #b87333;">#projects/web/auth</strong></div><div style="grid-column: 1 / -1; opacity: 0.7; font-size: 0.85em; font-style: italic; font-family: inherit;">"Backend/details" dropped · inverse can recover Projects/Web/Auth, not the discarded segments</div></div></div>
<div style="border: 1.5px solid #b87333; border-radius: 10px; padding: 1em 1.25em;"><div style="font-size: 0.78em; font-weight: 700; color: #b87333; letter-spacing: 0.06em; margin-bottom: 0.5em;">MARKER-ONLY · maximally lossy forward</div><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.5em 1em; align-items: center; font-family: ui-monospace, monospace; font-size: 0.95em;"><div><strong>Inbox/today.md</strong><br><strong>Inbox/yesterday.md</strong><br><strong>Inbox/2024/Q4/note.md</strong></div><div style="text-align: center; opacity: 0.55;">→ all forward →</div><div><strong style="color: #b87333;">#inbox</strong><br><span style="opacity: 0.55;">(one tag for all)</span></div><div style="grid-column: 1 / -1; opacity: 0.7; font-size: 0.85em; font-style: italic; font-family: inherit;">many-to-one by design · inverse can only recover the entry folder Inbox/, not the specific path that produced any given tagged file</div></div></div>
</div>
</figure>

### Collision vs. lossy — distinct failure modes

These two terms describe *different* problems that both look like "the abstraction is letting me down":

- **Collision** is a *forward-direction* problem: two distinct inputs accidentally produce the same output because the rule's pattern was too permissive.
- **Lossy** is an *inverse-direction* problem: one output could map back to many inputs by design — the forward transformation deliberately dropped information.

Solving one doesn't automatically solve the other. A rule can be perfectly bijective on its matched domain (no lossy) but still cause collisions if its pattern over-matches (`Entity/Cybersader/10 - Projects/foo` and `Entity/Bob/10 - Projects/foo` both match a root-anchored `^10 - Projects` rule). Conversely, a marker-only rule is *defined* to be lossy, but never collides — every match goes to the same tag intentionally.

<figure aria-label="Collision and lossy transformations are distinct failure modes. Collision is a forward-direction problem where two different inputs produce the same output by accident. Lossy is an inverse-direction problem where one output corresponds to many possible inputs by design." style="margin: 1.5em 0;">
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1em;">
<div style="border: 1.5px solid #b87333; border-radius: 10px; padding: 1em 1.25em;"><div style="font-size: 0.78em; font-weight: 700; color: #b87333; letter-spacing: 0.06em; margin-bottom: 0.5em;">COLLISION (forward problem)</div><div style="font-size: 0.85em; opacity: 0.85; margin-bottom: 0.7em;">Two distinct folders &rarr; same tag <strong>by accident</strong>. Pattern too permissive.</div><div style="font-family: ui-monospace, monospace; font-size: 0.88em; line-height: 1.6; padding: 0.6em 0.75em; background: rgba(125,125,125,0.1); border-radius: 4px;">Entity/<strong style="color: #c14a3f;">Cybersader</strong>/10 - Projects/foo<br>Entity/<strong style="color: #c14a3f;">Bob</strong>/10 - Projects/foo<br><span style="opacity: 0.55;">↓ same root-anchored ^10 - Projects rule fires on both</span><br><strong style="color: #b87333;">#10-projects/foo</strong> &nbsp;&nbsp;<span style="opacity: 0.55;">← same tag for both</span></div><div style="font-size: 0.8em; opacity: 0.7; margin-top: 0.6em; font-style: italic;">Different intended meanings collapse to the same output. The user's mental model said "Cybersader's projects" and "Bob's projects" should be distinct namespaces. The rule didn't capture that.</div></div>
<div style="border: 1.5px solid #b87333; border-radius: 10px; padding: 1em 1.25em;"><div style="font-size: 0.78em; font-weight: 700; color: #b87333; letter-spacing: 0.06em; margin-bottom: 0.5em;">LOSSY (inverse problem)</div><div style="font-size: 0.85em; opacity: 0.85; margin-bottom: 0.7em;">One tag &rarr; many possible folders <strong>by design</strong>. Forward transformation dropped info.</div><div style="font-family: ui-monospace, monospace; font-size: 0.88em; line-height: 1.6; padding: 0.6em 0.75em; background: rgba(125,125,125,0.1); border-radius: 4px;"><strong style="color: #b87333;">#inbox</strong> &nbsp;&nbsp;<span style="opacity: 0.55;">← any of these produced it</span><br><span style="opacity: 0.55;">↓ inverse cannot uniquely reconstruct</span><br>Inbox/<br>Inbox/today.md<br>Inbox/2024/Q4/note.md</div><div style="font-size: 0.8em; opacity: 0.7; margin-top: 0.6em; font-style: italic;">marker-only rules deliberately collapse many sources to one tag. The inverse direction is many-to-one — there's no unique folder to reconstruct.</div></div>
</div>
</figure>

> **Plain-English version:** Collision is when the abstraction lets two things look the same that shouldn't. Lossy is when the abstraction deliberately throws information away. Different failure modes; different fixes. The fix for collision is usually a more specific pattern (or capturing the disambiguator into the tag). The fix for lossy is to accept that the rule is many-to-one and design the user experience around that.

### Surjection, injection, bijection

Function-theoretic terms that formalize what "lossless in both directions" means. Given a function `f: A → B`:

- **Injective** (one-to-one) — distinct inputs go to distinct outputs. Folder→tag of an identity rule is injective: two different folder paths produce two different tags.
- **Surjective** (onto) — every output is reachable from some input. Tag→folder of a marker-only rule is surjective on its (tiny) image — every tag the rule produces (just one, the marker) corresponds to *many* folders.
- **Bijective** — both injective and surjective. Perfect 1-to-1 correspondence; the function has a true inverse. Identity rules with no destructive transforms are bijective.

The plugin's `bijective: boolean` field on rules is asking exactly this question. Today it's *asserted* by the typed-spec semantics. The point of Phase H is to make it *computable* from the (folder template, tag template) pair — slots that appear on both sides round-trip; slots only on one side document a lossy direction.

### Homomorphism, isomorphism

Abstract-algebra terms. A **homomorphism** is a structure-preserving map in one direction (e.g., the function preserves "this thing is a sub-part of that thing"). An **isomorphism** is a homomorphism with a structure-preserving inverse — the two structures are formally interchangeable. A perfectly bidirectional rule is asking to be an isomorphism between a folder shape and a tag shape. The lens calculus's three round-trip laws (GetPut, PutGet, PutPut) are the formal version of "this rule defines an isomorphism on its domain."

### Putting them together: regex vs. templates, in vocabulary

| Question | Regex view | Template view |
|---|---|---|
| Where does the rule anchor? | Buried in pattern syntax (`^X` vs `(?:^|/)X` vs `^P/X`) — semantics inferred from syntax shape | Explicit: literal prefix in the template |
| What part is variable? | Unnamed capture group `(.+)` — positional, no role | Named slot `{slug}` — role visible at authoring time |
| Is the rule bijective? | Asserted via separate `bijective` metadata field | Computable from slot overlap on both sides |
| Is one direction lossy? | Asserted via `cardinality` metadata | Computable from which slots appear in which template |
| Forward composition (folder → tag) | Compile regex, match, position-extract, transform | Compile template, slot-extract, instantiate target template |
| Inverse composition (tag → folder) | Hand-rolled string surgery (entry-strip, anchor prepend) | Same as forward, with templates swapped |

The tradeoff is summarized: regex hides semantics inside syntax; templates surface them. Both compile to the same runtime regex, but at *authoring time* the template view answers the questions the regex view forces us to compute via metadata.

## What surfaced

Phase G made *layer* a first-class concept on rules — every rule now declares whether it anchors at vault root, at any path-segment boundary, or under a specific parent prefix. The motivating bug was concrete: the user's dev vault has Johnny Decimal folders nested under `fixtures/10 - Projects`, but the JD pack's `^\d{2} - X` pattern requires path-start. Preview showed 0 matches; the rule was correctly imported but anchored to a layer the vault didn't use.

Adding the `folderAnchor` field fixed the immediate bug. But while writing it, several pieces of code felt like they were doing the wrong job:

- `src/engine/inferTyped.ts:inferEntryFromPattern` is hand-rolled regex parsing — it strips known suffixes (`(?:/|$)`, `(?:/.*)?$`), checks for leftover metacharacters, returns a string. We're parsing our own emitted regex back into structure.
- `src/engine/applyTransfer.ts:buildEntryStripPattern` builds *another* regex to strip the entry portion from a matched path. Three branches, one per anchor mode.
- The `cardinality` and `bijective` fields on `MappingRule` are computed from typed-spec semantics — not derivable from the regex pair. The regex doesn't know whether the rule is bidirectional.

The pattern is the same in each case: regex captures *syntax* (this string matches that regex), not *semantics* (this rule lives at this layer, has these named parts, round-trips to that target). The semantic information that makes folder-tag-sync interesting — entry points, anchors, slot extraction, transform composition — has been re-encoded around the regex rather than expressed in the regex itself.

This entry is the research that follows from noticing that.

## The tension — where regex leaks

Regex does two distinct jobs in the plugin today, and we're conflating them:

1. **Membership predicate** — does this folder path satisfy the rule? (a gate)
2. **Structural extractor** — given a matching path, what are its parts? (a parser)

For (1), regex is fine. `RegExp.test()` is fast, well-understood, escapeable. For (2) the seams show:

| Job | Current implementation | Why it's awkward |
|---|---|---|
| Strip the entry-point prefix from a matched path so the remainder can be recoordinated | `folderPath.replace(new RegExp(\`^${entry}/?\`), '')` — anchor-aware variant added in Phase G | The pattern matched the path, but we run a *different* regex to extract structure. Two passes, two sources of truth. |
| Recover the entry literal from a derived rule, so the guided modal can show it as a form field | `inferEntryFromPattern(rule.folderPattern)` — pattern-shape parsing | We emit `(?:/|$)` from `derive.ts`, then immediately strip it back off in `inferTyped.ts`. The marker has no semantic content; it's a side effect of how we anchor. |
| Decide whether two rules round-trip without information loss | `cardinality` + `bijective` fields, computed from `TransferOp` shape | The regex pair `(folderPattern, tagPattern)` doesn't tell you. We compute it from the typed-spec semantics, then attach as metadata. |

The third one is the deepest leak: **bijection is asserted, not proven**. We *say* a rule is bijective because the typed model says identity-transfer + entry-points-on-both-sides ⇒ round-trip. But there's no automated check that the regex pair is consistent with that claim. If a rule pack author writes `folderPattern: '^Projects(?:/|$)'` and `tagPattern: '^archive/'`, the metadata might still claim `bijective: true` if the typed fields say so.

For PARA / JD / SEACOW, the typed model is enough — these rules are simple enough that semantics + heuristics gets us there. But the abstraction is leaking, and Phase G's `folderAnchor` field is the most recent leak made visible.

## Evaluation criteria

What does "the right abstraction" need to satisfy here?

- **Bijectivity by construction.** Forward + inverse pairs that compose, with round-trip consistency provable (or at least checkable) from the rule's structure alone — not from a separate metadata field.
- **User authoring cost.** The guided-modal must remain learnable for non-regex users; the abstraction can't require knowing recursion schemes or category theory.
- **Performance.** 10k+ file vault scans must stay fast. The abstraction should compile to something close to a regex (or be one) at runtime.
- **Composability.** Rule packs that nest. SEACOW outer wrapping PARA wrapping individual projects. The abstraction should support a rule pack that says "I live inside whatever pack scopes me."
- **Power graceful-degradation.** When a rule shape is too complex for the abstraction, raw regex stays available as an escape hatch. The advanced editor remains the power-user surface.
- **Reversibility limits.** Some rules are intentionally lossy (marker-only, promotion-to-root). The abstraction must let lossy be a first-class property — not a bug to design around.

## Prior art

### Lenses & bidirectional programming

[*Combinators for Bi-Directional Tree Transformations: A Linguistic Approach to the View-Update Problem*](https://www.cis.upenn.edu/~bcpierce/papers/lenses-toplas-final.pdf) (Foster, Greenwald, Moore, Pierce, Schmitt — POPL 2005, TOPLAS 2007). The seminal academic work. A **lens** is a forward + backward pair `(get, put)` satisfying three round-trip laws (GetPut, PutGet, PutPut) that guarantee consistency. Lenses compose — a complex bidirectional transformation is built from primitive lenses combined with sequencing, mapping, conditional, etc.

Implementations:

- [Boomerang](https://www.seas.upenn.edu/~harmony/) — the canonical bidirectional language built on the lens calculus
- [Haskell `lens`](https://hackage.haskell.org/package/lens) (Kmett) — gold-standard functional optics
- [`monocle-ts`](https://github.com/gcanti/monocle-ts) (Giulio Canti) — TypeScript Profunctor lenses; closest fit if we wanted to vendor an existing JS-ecosystem library
- [`partial-lenses`](https://github.com/calmm-js/partial-lenses) — JS lenses with first-class handling for missing fields (relevant to optional slots)

```ts
// monocle-ts shape — what a lens-based PARA rule could look like:
import { Lens } from 'monocle-ts';

const projectsPrefix = Lens.fromProp<FolderPath>()('prefix');  // get/set 'Projects/'
const slugLens       = Lens.fromProp<FolderPath>()('slug');    // captured part
const tagPrefix      = Lens.fromProp<TagSpec>()('namespace');  // '#projects/'

// Compose forward (folder → tag); inverse falls out automatically:
const paraProjects = projectsPrefix.composeLens(slugLens).composeLens(tagPrefix);
```

Folder-tag-sync's `transfer` and `inverseTransfer` fields are an *informal* lens. Making them formal would mean: each rule is literally a lens; sync is `lens.get`; reverse-sync is `lens.set`; the laws guarantee bidirectional consistency.

**Production lens implementations worth studying:**

- [**Augeas**](http://augeas.net/) — a C library that edits Linux config files via lenses. Each config-file format (`/etc/hosts`, `/etc/sshd_config`, etc.) has a hand-written lens that round-trips between the on-disk text format and a structured tree. **The most production-tested lens implementation in real-world software.** Read source at `github.com/hercules-team/augeas`. Lens definitions live in `lenses/*.aug` files — DSL syntax like `let lns = (record . eol)*` that compiles to bidirectional get/put pairs. Closest precedent to "we have on-disk artifacts (config files / vault folders) and want a structured edit/query interface."

- [**Unison file synchronizer**](https://www.cis.upenn.edu/~bcpierce/unison/) — Benjamin Pierce's earlier project (1995+), the system that *motivated* the original lens research. Bidirectional file synchronization: edits from either side propagate, conflicts are surfaced, the sync runs to fixpoint. Same author who later wrote the lens papers. Folder-tag-sync's bidirectional sync sits in nearly the same problem space — user edits in either world (filesystem vs. tag namespace), system propagates.

### Refinements & follow-up academic work

The lens calculus has been extended in several useful directions:

- **Quotient lenses** ([Foster, Pilkiewicz, Pierce — POPL 2008](https://www.cis.upenn.edu/~bcpierce/papers/quotient-lenses.pdf)) — lenses up to equivalence. Useful for transformations that should be insensitive to whitespace, ordering, or case differences (which the plugin's `caseTransform` is exactly).
- **Edit lenses** ([Hofmann, Pierce, Wagner — ICFP 2012](https://www.cis.upenn.edu/~bcpierce/papers/edit-lenses-icfp.pdf)) — propagate *edits* rather than complete states. Maps well onto folder-tag-sync's sync model: don't recompute everything when one folder moves; propagate the move as a delta.
- **Putback-based bidirectional programming** ([Hu, Mu, Takeichi — JFP 2014](https://www.preferred-soft.co.jp/~hu/pub/journal/jfp14.pdf)) — start from the *put* (inverse) direction; the get falls out. Often more intuitive for non-academics; matches how rule pack authors actually think ("I want the tag side to look like this; what folder produces it?").
- [**Bidirectional Transformations Workshop**](http://bx-community.wikidot.com/) (BX) — annual academic venue. Living bibliography of bx research; useful for finding more recent papers.
- **Triple Graph Grammars (TGG)** — bidirectional graph transformation, mostly used in model-driven engineering. Heavier-weight than what folder-tag-sync needs but worth noting as a parallel lineage.

```ts
// Hand-written sketch (no library):
const paraProjectsLens: Lens<FolderPath, Tag> = compose(
  prefixLens('Projects'),       // get: strip 'Projects/' ; put: prepend 'Projects/'
  caseLens('Title', 'kebab'),   // get: kebab-ize    ; put: title-ize
  tagPrefixLens('projects'),    // get: prepend '#projects/' ; put: strip
);
```

### Asymmetric and symmetric lenses

[Hofmann, Pierce, Wagner — *Symmetric Lenses*](https://www.cis.upenn.edu/~bcpierce/papers/symmetric-lenses.pdf) (POPL 2011); also *Asymmetric Lenses*. Relaxes the symmetry assumption — one direction can be lossy if the structure is correctly accounted for. Maps directly onto our `cardinality` field: lossy direction = `many:1`, lossless = `1:1`.

This is the most directly relevant academic frame for folder-tag-sync. Folders → tags is sometimes lossy (truncation drops segments below the cap; marker-only collapses any structure under the entry to a fixed term). Tags → folders is correspondingly partial (you can't recover what truncation dropped). Asymmetric lenses formalize that exactly.

### BiYacc / BiGUL

[BiGUL](https://hub.darcs.net/zhenjiang/BiGUL) (Hu, Ko, Trippel — *bidirectional grammar update language*). Write the grammar once, get parse + print for free with consistency guarantees. More tractable for implementation than full lenses; pattern-matches into how rule packs already feel (declarative, structural).

If we replaced regex with a tiny grammar — `Projects/` *segment* `/` *rest* with `segment` and `rest` as named bindings — we'd get parse + print symmetrically.

### Path templates with named slots

The "least surprising" evolution, and probably the right *first* step. URL routing systems have used this for decades — same primitive, well-defined limits, familiar to power users.

```ts
// Express / Fastify / NestJS — all use path-to-regexp underneath
app.get('/users/:userId/posts/:postId', (req, res) => {
  // req.params.userId, req.params.postId
});
```

```python
# FastAPI — slots typed at the function signature
@app.get('/users/{user_id}/posts/{post_id}')
async def read_post(user_id: int, post_id: int): ...
```

```ts
// URL Pattern Standard (browser-native in Chromium; polyfill exists)
const pattern = new URLPattern({ pathname: '/users/:userId/posts/:postId' });
const result = pattern.exec({ pathname: '/users/42/posts/100' });
//   → { pathname: { groups: { userId: '42', postId: '100' } } }
```

```
# Next.js / SvelteKit / Astro — file-system as syntax
pages/users/[userId]/posts/[postId].tsx
pages/blog/[...slug].tsx              ← glob: catches arbitrary depth
pages/shop/[[...filters]].tsx          ← optional glob
```

```yaml
# OpenAPI 3 — language-neutral path-templating standard
paths:
  /pets/{petId}:
    parameters:
      - name: petId
        in: path
        required: true
        schema: { type: string }
```

```yaml
# gRPC HTTP transcoding — path templates as the REST↔RPC bridge
rpc GetBook(GetBookRequest) returns (Book) {
  option (google.api.http) = {
    get: "/v1/{name=publishers/*/books/*}"
  };
}
```

```ruby
# Rails — :name slots, *splat for multi-segment
get '/users/:user_id/posts/:post_id', to: 'posts#show'
get '/files/*path', to: 'files#serve'                  # *path captures rest
```

```php
// Symfony — {name} braces with constraint syntax
#[Route('/users/{userId}/posts/{postId}', requirements: ['userId' => '\d+'])]
public function show(int $userId, int $postId) { ... }
```

```java
// Spring Boot — {name} braces with PathVariable annotation
@GetMapping("/users/{userId}/posts/{postId}")
public Post show(@PathVariable Long userId, @PathVariable Long postId) { ... }
```

```elixir
# Phoenix — :name colons, route definitions in compile-time DSL
scope "/api", AppWeb do
  get "/users/:user_id/posts/:post_id", PostController, :show
end
```

```ts
// Tanstack Router — typed slots, file-system + code-defined routes
const postRoute = createRoute({
  path: '/users/$userId/posts/$postId',  // $name slot syntax
  parseParams: (params) => ({ userId: Number(params.userId), postId: Number(params.postId) }),
});
```

```ts
// Hono — :name slots, ergonomic for edge runtimes
app.get('/users/:userId/posts/:postId', (c) => {
  const { userId, postId } = c.req.param();
});
```

Weaker than full lenses (no formal laws, composition is informal), but covers the vast majority of folder-tag-sync use cases. The semantic information that regex hides — what part is the layer, what part is the variable, what name does it carry — becomes explicit in the syntax. The set of primitives is small enough to fit on one card: literal segments, single-segment slots `{name}`, glob slots `{name...}`, optional slots `{name?}`.

**Syntax convergence.** Looking across the dozen+ frameworks above, two slot conventions dominate:

| Convention | Used by | Pros | Cons |
|---|---|---|---|
| `{name}` braces | OpenAPI, FastAPI, Spring, Symfony, gRPC | Reads as "data shape" — intuitive for non-developers | Conflict with template-string interpolation in some langs (Bash, JS) |
| `:name` colons | Express, NestJS, React Router, Phoenix, Hono, Rails | Less escape-character pressure, idiomatic in URL conventions | Looks like a CSS pseudo-class or YAML key to outsiders |

`$name` (Tanstack), `[name]` (Next.js, Astro), `*name` (Rails splat) are minority dialects. **For folder-tag-sync, `{name}` braces feel right** — our user is a knowledge-worker authoring rule packs, not a backend engineer; the data-shape framing of `{slug}` and `{rest...}` is closer to the typed model already in place.

### Template engines (forward / instantiation half)

Path-template *matching* (the "get" half) is well-explored above. The *instantiation* half (the "put") has its own decades-deep prior art under "template engines" — same primitive applied to text generation rather than path matching. Most relevant for folder-tag-sync: when a rule's tag template is `#projects/{slug}/{rest...}` and we have slot values `{ slug: 'Web', rest: 'auth' }`, instantiation is exactly what these engines do.

- [**Mustache**](https://mustache.github.io/) / [**Handlebars**](https://handlebarsjs.com/) — `{{name}}` syntax, deliberately logic-less, implementations in 40+ languages. Pure substitution model.
- [**Go `text/template`**](https://pkg.go.dev/text/template) — `{{.UserId}}` syntax, action grammar. Used in Helm charts, Kubernetes manifests, Hugo. Production-grade compile-once-execute-many.
- [**Jinja2**](https://jinja.palletsprojects.com/) (Python) — `{{ name }}` braces with filter pipeline (`{{ name|upper }}`). Closest analog to "slot value with per-slot transform" — exactly what Phase H's per-slot transform composition would need.
- [**Liquid**](https://shopify.github.io/liquid/) (Shopify) — `{{ name }}` with safe-by-default rendering, used in Jekyll, Eleventy. Same shape as Jinja2.
- [**ERB**](https://docs.ruby-lang.org/en/3.4/ERB.html) / [**EJS**](https://ejs.co/) — `<%= name %>` block syntax. Less aligned with our needs (we want declarative templates, not embedded code).

The pattern across these: **`{{name}}` for slot-with-transforms, `{name}` for slot-only**. If we adopt the Jinja-style filter syntax for per-slot transforms in Phase H+ (`{slug|kebab}`), there's decades of user familiarity to lean on.

```jinja
{# Jinja-style per-slot transform — what folder-tag-sync's tag template
   could look like if we extend slots with transform pipelines: #}
folder: 'Projects/{slug}/{rest...}'
tag:    '#projects/{slug|kebab}/{rest|kebab}'
```

### Knowledge-management adjacent tools

How do other note-taking and file-organization tools handle the same problem (declaring how files map to a different addressable namespace)? Useful comparison points:

- [**TagSpaces**](https://www.tagspaces.org/) — embeds tags in filenames: `note[tag1 tag2].md`. Effectively a path template `note[{tags...}].md` where the slot lives in the *filename* rather than the *folder path*. Same primitive, different placement. The bidirectional sync is implicit (rename the file, tags update; edit tags, filename updates).

- [**Hazel (macOS)**](https://www.noodlesoft.com/) — rule-based filing tool. Rules are if-then chains: "if filename matches X, move to folder Y". Forward-only (no inverse), but the *condition language* is regex-on-paths — exactly the primitive folder-tag-sync uses, applied to a different domain.

- [**Logseq**](https://logseq.com/) and [**Roam Research**](https://roamresearch.com/) — block-based knowledge-graph tools. Block references (`((block-id))`) are a different primitive than path templates, but the design tension is the same: how does the underlying file/block layout connect to the user-facing knowledge graph?

- [**DEVONthink**](https://www.devontechnologies.com/apps/devonthink) — rule-based document filing with regex conditions and AI-assisted classification. A useful reminder that "deterministic regex rules" *and* "AI suggestions" can coexist — DEVONthink layers them cleanly.

- [**Tinderbox**](https://www.eastgate.com/Tinderbox/) — "smart adornments" that auto-tag notes based on declarative pattern conditions. Mark Bernstein has been refining this since 2002. Worth studying as a long-evolved design point.

- [**Obsidian Templater**](https://github.com/SilentVoid13/Templater) plugin — `<% tp.file.title %>` syntax for note templating. Forward-only (a template renders into a new note); not bidirectional. But the *syntax* convention sits adjacent to where folder-tag-sync's tag templates would land if we wanted in-vault discoverability.

- [**Maggie Appleton's research notes**](https://maggieappleton.com/) on note-taking systems — not a tool, but a thoughtful set of design observations on the folder/tag/link tension that informs the same problem space.

The pattern across these tools: **forward-only is the norm; bidirectional is rare and a real differentiator.** Folder-tag-sync's commitment to bidirectional sync is itself a design choice worth highlighting in the docs (and Phase H makes it more rigorous).

### Glob patterns and pathspec

Adjacent prior art worth mentioning: shell-style globs are the *de facto* path-pattern language across the Unix ecosystem. Less expressive than templates with named slots (no captures, position-only), but the syntax conventions are deeply familiar:

- [`micromatch`](https://github.com/micromatch/micromatch) / [`minimatch`](https://github.com/isaacs/minimatch) — the npm-ecosystem matchers behind ESLint, Prettier, file-glob libraries. Support `**` (globstar — multi-segment), `*` (single-segment), `?` (single char), `{a,b}` (alternation), `!(...)` (negation).
- [Git pathspec](https://git-scm.com/docs/gitignore) — anchored with leading `/`, recursive with `**`, exclusion with `!`. The mental model that's already in users' heads when they author `.gitignore`.
- [rsync include/exclude](https://download.samba.org/pub/rsync/rsync.1#include_exclude_matching_rules) — anchored, ordered rule lists with `+`/`-` prefixes. Production-tested for "select these files, skip those" matching at scale.

Glob doesn't give us bijection. But the syntax conventions (`**` for multi-segment globstar, anchoring with `/`, alternation with `{a,b}`) are reusable lexicon when we design template syntax — borrow what's familiar.

### Tree pattern languages

[XPath](https://www.w3.org/TR/xpath-31/), [JSONPath](https://goessner.net/articles/JsonPath/), [JsonLogic](https://jsonlogic.com/). The vault folder structure IS a tree. Tree pattern languages match on tree shape rather than serialized path strings. Useful if the abstraction needs to handle structural queries beyond linear paths ("all leaf folders under X", "any folder whose parent matches Y"). Worth holding in reserve; not the immediate target.

### Datalog & logic programming

[Datalog](https://en.wikipedia.org/wiki/Datalog), [Soufflé](https://souffle-lang.github.io/), or any logic-based bidirectional rules engine. Maximum expressiveness — bidirectional reasoning falls out of the relational model essentially for free. Almost certainly overkill for an Obsidian plugin. Useful as a north-star ("what would the *most* powerful version look like?"), not a near-term implementation target.

## Proposed evolution — bidirectional path templates with typed slots

What would folder-tag-sync's rule data model look like if templates replaced regex as the user-facing primitive?

### Today (Phase G):

```ts
{
  folderEntry: 'Projects',
  folderAnchor: { under: 'fixtures' },
  // ... derived: folderPattern: '^fixtures/Projects(?:/|$)'
  tagEntry: 'projects',
  // ... derived: tagPattern: '^projects/'
  transfer: { op: 'identity' },
}
```

### Phase H sketch:

```ts
{
  folderTemplate: 'fixtures/Projects/{rest...}',
  tagTemplate:    '#projects/{rest...}',
  // bijection automatic from slot overlap
}
```

Slots are written as `{name}` (single segment) or `{name...}` (one or more — glob). Both templates compile to regex internally; sync engines still consume the compiled `folderPattern` for matching speed. The slot data flows in both directions:

```
Forward (folder → tag):
  fixtures/Projects/Web/auth-rewrite
  ───────  ──────── ─────────────────
  literal  literal  {rest...}
                        │
                        ▼ slot extraction
                    rest = "Web/auth-rewrite"
                        │
                        ▼ instantiate tag template
                    #projects/Web/auth-rewrite
                                 ─────────────
                                 {rest...} filled

Inverse (tag → folder):
  #projects/Web/auth-rewrite
   ──────── ─────────────────
   literal  {rest...}
              │
              ▼ slot extraction
          rest = "Web/auth-rewrite"
              │
              ▼ instantiate folder template
          fixtures/Projects/Web/auth-rewrite
                            ─────────────────
                            {rest...} filled
```

### What this gets us

- **Bijection visible at authoring time.** Slots that appear on both sides round-trip. Slots only on one side are derivation-only or capture-only — the structure tells you. No more separate `bijective: boolean` field.
- **Anchor concept disappears.** The template's literal prefix IS the anchor. `'Projects/{slug}'` is root-anchored; `'{base}/Projects/{slug}'` is any-segment with the parent captured into `base`; `'fixtures/Projects/{slug}'` is the under-prefix case spelled out literally.
- **Inference becomes parsing instead of regex pattern-matching.** No more `inferEntryFromPattern` hand-rolled string surgery. Re-loading a rule means parsing its template once.
- **Sync engine gains slot-level access for transforms.** Per-slot case rules become possible — `{slug}` could carry a transform spec ("this slot is kebab-cased on the tag side"). Today's `caseTransform` applies globally; templates open up per-slot composition cleanly.
- **Power-user escape hatch remains.** Raw regex stays available in the advanced modal for cases templates can't express.

### What about the existing typed model?

`FolderClassifier`, `TagVocabulary`, and `TransferOp` don't go away — they're orthogonal. The template describes the *shape*; the typed model describes the *semantics*. A `marker-only` rule with template `'Capture/Inbox/{rest...}'` and a tag template that *omits* `{rest...}` (just emits `#capture-inbox`) is still a marker-only rule — the typed semantics tell you that, the templates tell you the structural mapping.

Cardinality/bijective fall out of the template shapes too: count slots that appear on both sides. All slots shared → bijective. Folder-side has a slot the tag side doesn't → lossy folder-to-tag direction. The metadata becomes a derivable view over the structure rather than asserted alongside it.

## Reference implementations — what we could borrow

Phase H doesn't have to be greenfield. Several existing libraries do exactly the compile-template-to-regex + extract-slots + instantiate-from-slots dance. Listed in priority order for fit:

### `path-to-regexp` (most directly applicable)

[`path-to-regexp`](https://github.com/pillarjs/path-to-regexp) — the regex-compiler behind Express, NestJS, Fastify, ky, react-router. Production-grade, ~7M weekly downloads. Exports both directions:

```ts
import { match, compile } from 'path-to-regexp';

// Forward: extract slots from a path
const fn = match('/users/:userId/posts/:postId');
fn('/users/42/posts/100');
// → { path: '/users/42/posts/100', params: { userId: '42', postId: '100' } }

// Inverse: build a path from slot values
const toPath = compile('/users/:userId/posts/:postId');
toPath({ userId: '42', postId: '100' });
// → '/users/42/posts/100'
```

The library handles syntax sugar we'd otherwise build ourselves: optional slots (`:name?`), repeating segments (`:rest+` and `:rest*`), custom slot patterns (`:name(\\d+)`), escape characters. It compiles down to standard `RegExp` so sync engines stay pattern-agnostic.

**Tradeoffs**: 8KB+ minified, opinionated `:name` syntax (no `{name}` braces), tied to web/URL conventions (separator is always `/`). Could vendor a tiny subset, or pull in as a dependency.

### URL Pattern Standard / `urlpattern-polyfill`

[URL Pattern Standard](https://urlpattern.spec.whatwg.org/) — modern web standard, browser-native in Chromium. [`urlpattern-polyfill`](https://github.com/kenchris/urlpattern-polyfill) for non-browser environments.

```ts
const pattern = new URLPattern({ pathname: '/Projects/:slug/:rest*' });
const result = pattern.exec({ pathname: '/Projects/Web/auth-rewrite' });
// result.pathname.groups → { slug: 'Web', rest: 'auth-rewrite' }
```

Same primitive as `path-to-regexp` but with a structured spec. Slightly heavier (it's URL-shaped, not just path-shaped), but stable / standardized / has multi-vendor implementation effort behind it.

### `micromatch` (glob-flavored matching)

[`micromatch`](https://github.com/micromatch/micromatch) — the matcher behind most npm-ecosystem path tooling. Glob-shaped (no named captures), but battle-tested for vault-scale path enumeration:

```ts
import micromatch from 'micromatch';

micromatch(['Projects/Web', 'Areas/Health'], 'Projects/**');
// → ['Projects/Web']

// Capture mode (limited; positional, not named):
const captures = micromatch.capture('Projects/*/auth', 'Projects/Web/auth');
// → ['Web']
```

Useful for the *match* half of the equation; useless for the inverse (positional capture without named slots can't reliably round-trip). Worth knowing about as the reference implementation for "vault scan, find candidates" workflows.

### `monocle-ts` (lens-flavored, TypeScript-native)

[`monocle-ts`](https://github.com/gcanti/monocle-ts) — TypeScript Profunctor-style optics. Mostly forward-direction (getters/setters), but composes cleanly. The "what would adopting lenses look like in our actual codebase" reference.

```ts
import { Lens } from 'monocle-ts';

interface ParaPath { entry: 'Projects'; slug: string; rest?: string }

const slugLens = Lens.fromProp<ParaPath>()('slug');
const slug = slugLens.get(parsedPath);            // 'Web'
const updated = slugLens.set('NewName')(parsedPath);
```

Heavier learning curve than path-to-regexp; pays off if we eventually want full lens-law guarantees rather than just slot extraction.

### Side-by-side capability matrix

| Library / spec | Forward (match) | Inverse (instantiate) | Named slots | Globs | Optional | Per-slot transforms | License | Bundle size | Fit |
|---|:-:|:-:|:-:|:-:|:-:|:-:|---|---|---|
| **`path-to-regexp`** | ✓ | ✓ | ✓ | ✓ (`*`, `+`) | ✓ (`?`) | ✗ | MIT | ~8 KB | Best |
| **URL Pattern Standard** | ✓ | partial | ✓ | ✓ (`*`) | ✓ | ✗ | Spec | (native) | Good |
| **`urlpattern-polyfill`** | ✓ | partial | ✓ | ✓ | ✓ | ✗ | Apache-2.0 | ~30 KB | Heavy |
| **`micromatch`** | ✓ | ✗ | ✗ (positional) | ✓ (`**`, `{a,b}`) | ✓ | ✗ | MIT | ~25 KB | Match-only |
| **`monocle-ts`** | ✓ | ✓ | n/a (typed access) | ✗ | n/a | ✗ | MIT | ~15 KB | Heavy / formal |
| **Augeas** (C) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | LGPL | C lib | Reference only |
| **Mustache/Handlebars** | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ (helpers) | MIT | varies | Inverse-only |
| **Jinja2** | ✗ | ✓ | ✓ | ✗ | ✗ | ✓ (filters) | BSD | Python | Syntax inspiration |
| **Hand-rolled (~50 LOC)** | ✓ | ✓ | ✓ | ✓ | ✓ | future | n/a | ~1 KB | **Likely choice** |

### Recommendation

For Phase H's first cut: **write the compiler ourselves** (~50 lines as the *Migration story* section sketches, plus tests). The surface is small enough that vendoring `path-to-regexp` is overkill, and the rule-pack file format already has its own JSON shape — the slot syntax just needs to round-trip cleanly through that.

What we borrow from the prior art:

- **Slot syntax**: `{name}` braces (OpenAPI / FastAPI / Spring / Symfony / Mustache convention). Reads as "data shape" rather than URL path, which fits how rule packs are authored.
- **Glob slot suffix**: `{name...}` for multi-segment (Next.js `[...rest]`-flavored, since `*` already has regex meaning).
- **Optional slots**: `{name?}` (path-to-regexp / Mustache).
- **Future per-slot transforms**: `{name|kebab}` (Jinja-style pipe operator) — Phase H+ or wherever transform composition lands.
- **Glob conventions for any-segment matching**: `**` from gitignore/micromatch, if we extend templates to support arbitrary-depth matching beyond the explicit `{name...}` glob slot.
- **Bidirectional consistency thinking** from lenses — even if we don't formalize the laws, we name the consistency requirement explicitly: "slots that appear on both sides round-trip; everything else is documented as one-way."

If we hit composition/expressiveness limits in Phase H+ (multi-template fan-out, formal bijection checking, edit propagation), revisit `monocle-ts` or full Boomerang-style lenses then. The path-template surface has plenty of room to grow without leaving the ~50-LOC compiler.

## Open questions — where the abstraction might still leak

- **Optional vs required slots.** `{slug?}` or some trailing-`?` syntax? What does omission mean — does the template fall through to a shorter form, or does the rule decline to match?
- **Slot cardinality.** `{slug}` is exactly one segment; `{rest...}` is one-or-more. What about *zero*-or-more? What about a fixed depth (`{a}/{b}` matches exactly two segments)? Maps to the existing `truncation.depth + tailHandling` choices, but that translation has corners.
- **Per-slot transforms.** If `{slug}` on the tag side is implicitly kebab-cased, what does that mean when the template *also* declares a global `caseTransform`? Composition order matters and gets confusing fast. The rule for "transforms apply per-slot only when explicitly declared" is probably the right default.
- **Many-to-one fan-out.** Multiple folder templates collapsing into the same tag (e.g., `'Projects/{slug}'` AND `'Active/Projects/{slug}'` both emit `#projects/{slug}`). Single-template rules can't express this; needs a higher-level "alternation" or multiple rules + priority.
- **Static bijection checking.** Can we tell at authoring time whether a template pair is lossy? Slot-set comparison gets us most of the way — `folderSlots ⊆ tagSlots` ⇒ folder-to-tag is bijective; etc. — but transforms and conditional logic complicate the picture.
- **Unicode literals in templates.** The `cyberbase-actual` rule pack uses emoji prefixes (`⬇️ Clipping`). Templates need to handle unicode in literal segments cleanly — verifiable in the compiler tests.

## Migration story (Phase H plan summary)

1. **Define the type and slot syntax** — `PathTemplate`, `SlotDef`, `CompiledTemplate` in `src/types/typed.ts`. Optional fields on `TypedRuleSpec`.
2. **Pure compiler** — new `src/engine/compileTemplate.ts` with `compileTemplate`, `extractSlots`, `instantiateTemplate`. Comprehensive unit tests for single-segment, glob, mixed, optional, unicode literals, escape characters.
3. **Sync-engine slot extraction** — `applyRuleForward` / `applyRuleInverse` use `extractSlots` + `instantiateTemplate` when a rule has templates. Anchor-aware regex strip stays as the legacy path.
4. **Derivation branch** — when a rule pack provides `folderTemplate`, `deriveRule` compiles it and stores both the regex (for engine matching) and the slot metadata (for forward/inverse extraction).
5. **Loader validation** — balanced braces, valid slot names, optional fields. Existing packs continue to load without templates.
6. **Guided modal — visual slot diagram.** The most uncertain piece. Two text inputs (folder template, tag template); below, a visual shows each slot as a chip — green if it appears on both sides, yellow if only one (lossy), blue if it picks up a per-slot transform. Will likely need its own mini-plan after the engine work is solid.
7. **Migrate one shipped rule pack** — PARA most likely (simplest). Verify both old and new paths produce identical sync behavior. Worked example for this very document to point to.

## Open invitation

This is a research challenge in the literal sense — an architectural question we want to explore in code, not just on paper. Counterexamples (rules templates can't express), pointers to additional prior art, or implementation contributions are all welcome. Open an issue at [obsidian-folder-tag-sync](https://github.com/cybersader/obsidian-folder-tag-sync/issues) to discuss.

Phase G commits 1-5 already shipped (`folderAnchor` first-class). The remaining Phase G commits (anchor selector UI, fixtures) land before Phase H starts. The research here grounds *why* Phase H is the next step, not a far-future evolution.

## Related concepts

- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the 8 primitives templates layer over (this is the load-bearing primitives page)
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — the bridge from primitives to round-trip behavior; the collision-vs-lossy distinction explained at length
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary covering the vocabulary used in this entry
- [Philosophy](/obsidian-folder-tag-sync/concepts/philosophy/) — why typed layers exist, why determinism is non-negotiable
- [When to use regex](/obsidian-folder-tag-sync/concepts/when-to-use-regex/) — current escape hatch (will remain in Phase H)
- [Open questions](/obsidian-folder-tag-sync/agent-context/open-questions/) — design decisions still in flight
- [Tradeoffs](/obsidian-folder-tag-sync/agent-context/tradeoffs/) — chosen-vs-rejected captures
