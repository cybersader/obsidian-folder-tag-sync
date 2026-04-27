---
title: Path abstractions, part 2 — solutions in practice
description: Concrete code and tradeoff analysis for the candidates surveyed in Part 1. Plus the hybrid story — what changes if regex stays valid and the tool's job is to handle multiple rule shapes coexisting.
tags: [research, architecture, abstraction, phase-h]
sidebar:
  label: "04-27 · Solutions in practice"
  order: -20260427000
date: 2026-04-27
---

## Where Part 1 left off

Part 1 framed the architectural question — *is regex the right primitive for describing bidirectional folder ↔ tag mappings?* — and surveyed prior art (lenses, asymmetric lenses, BiGUL, path templates, glob patterns, tree pattern languages, Datalog). It ended with a leaning toward path templates with named slots, and a sketch of how Phase H would migrate.

This entry picks up where that ended. The original framing was implicitly winner-takes-all: pick the better abstraction, migrate. After more thought, that framing is wrong. The real question is **what tooling is needed for the abstraction choice to *not be* binary** — for regex and templates to coexist usefully within the same rule pack, with the tool surfacing the per-rule tradeoffs honestly.

A redirect that landed mid-research: *"I still think regex would potentially be fine if our tool can account for that, account for if someone uses multiple types of rules, how the system would communicate the issues with choices, etc. Granted, that may add way too much unmanageable logic and interactions."* That's the load-bearing observation for Part 2. Regex stays a first-class option *if* the tool is built to hold the heterogeneity gracefully. The rest of this entry evaluates the candidates against that bar.

## Reframe — the abstraction choice is downstream of a tooling choice

Part 1 evaluated candidates on intuitiveness, JSON-friendliness, bijection visibility, and so on. Useful, but those are properties of the abstraction *in isolation*. Part 2 adds two dimensions that swap the meaning of the comparison:

- **Hybrid-friendliness** — does this shape coexist with other shapes in the same pack? What's the loader's job to unify them?
- **Tool burden** — to support this shape *alongside* existing regex, what's the surface area added in the loader, inference layer, sync engine, and guided modal?

Under those criteria, the question changes from *"what should we replace regex with?"* to *"which shape(s) should we add as peers, given the cost of supporting more than one?"* The answer might still be "templates" — but it might also be "regex stays, we just make the tool smarter about communicating its limits." This entry honestly evaluates both.

## Hybrid rule-pack architecture — the load-bearing diagram

Before any code, here's the architecture this doc argues for. Rule packs ship JSON; rules in a pack can be *any of* the supported shapes; the loader normalizes; the engine consumes one internal form; the UI surfaces the original shape and per-rule guarantees.

<figure aria-label="Architecture diagram showing how rules in different shapes coexist. A rule pack JSON contains three rules in different shapes (regex, template, slot-object). The loader normalizes them through per-shape parsers into a common internal Layer-1 representation. The engine consumes only the normalized form. The guided modal reads metadata about each rule's original shape and surfaces it to the user." style="margin: 2em 0;">
<div style="border: 1.5px solid currentColor; border-color: rgba(125,125,125,0.4); border-radius: 12px; padding: 1em 1.25em; margin-bottom: 0.6em;"><div style="font-size: 0.7em; font-weight: 700; opacity: 0.6; letter-spacing: 0.1em; margin-bottom: 0.5em;">RULE PACK · JSON ON DISK</div><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.6em;"><div style="border: 1px solid rgba(184, 115, 51, 0.5); border-radius: 6px; padding: 0.5em 0.75em;"><div style="font-size: 0.7em; font-weight: 700; color: #b87333; letter-spacing: 0.06em;">RULE 1 — regex shape</div><code style="font-size: 0.78em; opacity: 0.85;">folderPattern: "^Projects(?:/|$)"</code></div><div style="border: 1px solid rgba(79, 138, 74, 0.5); border-radius: 6px; padding: 0.5em 0.75em;"><div style="font-size: 0.7em; font-weight: 700; color: #4f8a4a; letter-spacing: 0.06em;">RULE 2 — template shape</div><code style="font-size: 0.78em; opacity: 0.85;">folderTemplate: "Areas/&#123;slug?&#125;"</code></div><div style="border: 1px solid rgba(125,125,125,0.4); border-radius: 6px; padding: 0.5em 0.75em;"><div style="font-size: 0.7em; font-weight: 700; opacity: 0.7; letter-spacing: 0.06em;">RULE 3 — marker-only</div><code style="font-size: 0.78em; opacity: 0.85;">folderEntryPoint: "Inbox"<br>transfer: marker-only</code></div></div></div>
<div style="text-align: center; opacity: 0.55; font-style: italic; font-size: 0.8em; margin: 0.4em 0;">↓ load time ↓</div>
<div style="border: 1.5px solid currentColor; border-color: rgba(125,125,125,0.4); border-radius: 12px; padding: 0.9em 1.25em; margin-bottom: 0.6em; background: rgba(125,125,125,0.05);"><div style="font-size: 0.7em; font-weight: 700; opacity: 0.6; letter-spacing: 0.1em; margin-bottom: 0.5em;">LOADER · per-shape normalizers</div><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.5em; font-size: 0.85em;"><div style="text-align: center; padding: 0.4em; border: 1px dashed currentColor; border-radius: 6px; opacity: 0.85;">parse regex<br><em style="opacity: 0.6;">(no-op)</em></div><div style="text-align: center; padding: 0.4em; border: 1px dashed currentColor; border-radius: 6px; opacity: 0.85;">compile template<br><em style="opacity: 0.6;">→ regex + slots</em></div><div style="text-align: center; padding: 0.4em; border: 1px dashed currentColor; border-radius: 6px; opacity: 0.85;">marker-only<br><em style="opacity: 0.6;">→ regex from entry</em></div></div></div>
<div style="text-align: center; opacity: 0.55; font-style: italic; font-size: 0.8em; margin: 0.4em 0;">↓ ↓ ↓</div>
<div style="border: 1.5px solid currentColor; border-color: rgba(125,125,125,0.5); border-radius: 12px; padding: 0.9em 1.25em; margin-bottom: 0.6em;"><div style="font-size: 0.7em; font-weight: 700; opacity: 0.6; letter-spacing: 0.1em; margin-bottom: 0.5em;">INTERNAL · uniform Layer 1 (regex + transforms + anchor)</div><code style="font-size: 0.85em; display: block; padding: 0.5em 0.65em; background: rgba(125,125,125,0.1); border-radius: 4px;">MappingRule { folderPattern, folderEntryPoint, folderAnchor, transfer, ... }</code><div style="font-size: 0.78em; opacity: 0.7; margin-top: 0.4em; font-style: italic;">— plus per-rule provenance: which shape it came from, what guarantees apply</div></div>
<div style="text-align: center; opacity: 0.55; font-style: italic; font-size: 0.8em; margin: 0.4em 0;">↓</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 0.75em;"><div style="border: 1.5px solid rgba(125,125,125,0.4); border-radius: 12px; padding: 0.9em 1.25em;"><div style="font-size: 0.7em; font-weight: 700; opacity: 0.7; letter-spacing: 0.06em; margin-bottom: 0.4em;">SYNC ENGINE</div><div style="font-size: 0.85em; opacity: 0.85;">Reads only the normalized form. <strong>No fork.</strong> Forward + inverse work the same regardless of original shape.</div></div><div style="border: 1.5px solid rgba(125,125,125,0.4); border-radius: 12px; padding: 0.9em 1.25em;"><div style="font-size: 0.7em; font-weight: 700; opacity: 0.7; letter-spacing: 0.06em; margin-bottom: 0.4em;">GUIDED MODAL</div><div style="font-size: 0.85em; opacity: 0.85;">Reads provenance. Renders the editor matching the rule's shape. Surfaces per-rule status: <em>"this rule uses raw regex; bijection asserted."</em></div></div></div>
</figure>

The architecture has one decisive property: **the engine never branches on rule shape.** All shapes normalize to the existing Layer 1 internal type before the engine sees them. Every shape adds cost only at load time (the parser) and at edit time (the UI mode). Sync, matching, transform application — all unchanged from today's regex-only path.

That's the bound on hybrid cost. It's not unlimited; it's *N parsers + N UI editors*. With N=2 (regex + templates), it's manageable. At N=3+, it stops being.

## The seven candidate solutions, applied to the same example

Below: the same PARA Projects rule (`Projects/{slug?}` ↔ `#projects/{slug?}`) expressed under each candidate. After each shape, a hybrid-coexistence verdict.

### A. Status quo — regex strings (Phase G)

```json
{
  "id": "para-projects",
  "folderPattern": "^Projects(?:/|$)",
  "folderEntryPoint": "Projects",
  "folderAnchor": "root",
  "tagPattern": "^projects/",
  "tagEntryPoint": "projects",
  "transfer": { "op": "identity" },
  "folderTransforms": { "caseTransform": "Title Case" },
  "tagTransforms": { "caseTransform": "kebab-case" }
}
```

Authoring: medium (regex familiar to power users, hostile to novices). JSON-friendliness: clean. Bijection visibility: hidden — derived from the typed-spec semantics, not from the regex pair. Per-slot transforms: hard, would need custom regex transforms. Migration cost: zero.

**Hybrid verdict:** Native. Already the engine's internal form. Always coexistence-ready. The status indicator should say *"raw regex; bijection asserted from typed spec."*

### B. Named-slot path templates

```json
{
  "id": "para-projects",
  "folderTemplate": "Projects/{slug?}",
  "tagTemplate": "#projects/{slug?}",
  "transfer": { "op": "identity" },
  "folderTransforms": { "caseTransform": "Title Case" },
  "tagTransforms": { "caseTransform": "kebab-case" }
}
```

Authoring: very high. JSON-friendliness: clean. Bijection visibility: excellent — same `{slug?}` on both sides means it round-trips. Per-slot transforms: medium, with extension syntax (`{slug|kebab}`). Migration cost: medium.

**Hybrid verdict:** First-class peer to regex. Loader compiles `folderTemplate` to `folderPattern` + slot metadata at load time. Status indicator: *"template; bijection visible from slot overlap."*

<figure aria-label="A worked template example with domain-meaningful slot names instead of the abstract slug/rest. The folder template uses {owner}, {project-name}, and {notes...} slots, mirrored on the tag side. Slots present on both sides round-trip bijectively. The diagram below shows the two failure modes: a slot only on the folder side is matched-but-discarded (lossy forward); a slot only on the tag side is inserted-but-unsourced (a configuration error the system can warn about)." style="margin: 1.5em 0;">
<div style="border: 1.5px solid #4f8a4a; border-radius: 12px; padding: 1em 1.25em; margin-bottom: 0.8em;"><div style="font-size: 0.78em; font-weight: 700; color: #4f8a4a; letter-spacing: 0.06em; margin-bottom: 0.7em;">SLOTS LINE UP · round-trips cleanly</div><div style="display: grid; grid-template-columns: 1fr; gap: 0.55em; font-family: ui-monospace, monospace; font-size: 0.88em;"><div><strong>folder template:</strong> &nbsp;Entity/<span style="background: rgba(79, 138, 74, 0.18); border-radius: 3px; padding: 0 4px;">&#123;owner&#125;</span>/Work/10 - Projects/<span style="background: rgba(79, 138, 74, 0.18); border-radius: 3px; padding: 0 4px;">&#123;project-name&#125;</span>/<span style="background: rgba(79, 138, 74, 0.18); border-radius: 3px; padding: 0 4px;">&#123;notes...&#125;</span></div><div style="text-align: center; opacity: 0.55; font-style: italic; font-family: inherit;">&#x2195; same slot names appear on both sides &#x2195;</div><div><strong>tag template:</strong> &nbsp;&nbsp;&nbsp;#--<span style="background: rgba(79, 138, 74, 0.18); border-radius: 3px; padding: 0 4px;">&#123;owner | kebab&#125;</span>/10-projects/<span style="background: rgba(79, 138, 74, 0.18); border-radius: 3px; padding: 0 4px;">&#123;project-name | kebab&#125;</span>/<span style="background: rgba(79, 138, 74, 0.18); border-radius: 3px; padding: 0 4px;">&#123;notes...&#125;</span></div></div><div style="margin-top: 0.85em; padding: 0.65em 0.85em; background: rgba(79, 138, 74, 0.1); border-radius: 6px; font-size: 0.85em;"><strong style="color: #4f8a4a;">Bijective.</strong> Every slot appears on both sides. The <code>| kebab</code> filter is reversible (lossless when input is a single line of word characters). Folder &rarr; tag &rarr; folder reproduces the original folder.</div></div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1em;"><div style="border: 1.5px solid #b87333; border-radius: 12px; padding: 1em 1.25em;"><div style="font-size: 0.78em; font-weight: 700; color: #b87333; letter-spacing: 0.06em; margin-bottom: 0.5em;">SLOT ONLY ON FOLDER SIDE &middot; matched but discarded</div><div style="font-family: ui-monospace, monospace; font-size: 0.85em; line-height: 1.7; padding: 0.5em 0.65em; background: rgba(125,125,125,0.1); border-radius: 4px;">folder: Entity/<strong style="color: #b87333;">&#123;owner&#125;</strong>/Work/&#123;notes...&#125;<br>tag:&nbsp;&nbsp;&nbsp;&nbsp;#work/&#123;notes...&#125;</div><div style="font-size: 0.82em; opacity: 0.75; margin-top: 0.55em; font-style: italic;">{owner} is captured from folders but never produced on the tag side. Forward-direction lossy: who the project belongs to is dropped. The inverse can recover Work/notes path but not owner.</div></div><div style="border: 1.5px solid #b87333; border-radius: 12px; padding: 1em 1.25em;"><div style="font-size: 0.78em; font-weight: 700; color: #b87333; letter-spacing: 0.06em; margin-bottom: 0.5em;">SLOT ONLY ON TAG SIDE &middot; inserted but unsourced</div><div style="font-family: ui-monospace, monospace; font-size: 0.85em; line-height: 1.7; padding: 0.5em 0.65em; background: rgba(125,125,125,0.1); border-radius: 4px;">folder: 10 - Projects/&#123;project-name&#125;<br>tag:&nbsp;&nbsp;&nbsp;&nbsp;#--<strong style="color: #b87333;">&#123;owner&#125;</strong>/projects/&#123;project-name&#125;</div><div style="font-size: 0.82em; opacity: 0.75; margin-top: 0.55em; font-style: italic;">{owner} appears on the tag side but is never matched on the folder side. Configuration error the system can warn about at load time: "tag template references a slot the folder template doesn't capture."</div></div></div>
</figure>

> **Plain-English version:** A "slot" is just a labeled blank in the path. Slots that appear on both sides round-trip cleanly — the same value plugs into both. Slots only on the folder side are *matched but discarded* (forward-direction lossy). Slots only on the tag side are *unsourced* — usually a configuration mistake the loader can flag before the rule ever runs.

### C. JSON-shaped slot objects (no string DSL)

```json
{
  "id": "para-projects",
  "folderShape": {
    "literal": "Projects",
    "slots": [{ "name": "slug", "kind": "segment", "optional": true }]
  },
  "tagShape": {
    "literal": "projects",
    "slots": [{ "name": "slug", "kind": "segment", "optional": true }]
  },
  "transfer": { "op": "identity" }
}
```

Authoring: low (verbose, requires understanding of `literal` vs `slots`). TypeScript types: excellent — slot objects carry name, kind, optional, all visible at compile time. Per-slot transforms: trivial — each slot can carry its own transform config.

**Hybrid verdict:** Coexists, but the verbosity outweighs benefits. Templates (B) give you the same expressive power with one-tenth the JSON. Defer; revisit only if per-slot transforms become a hard requirement.

### D. OpenAPI-style nested spec

```json
{
  "id": "para-projects",
  "folder": {
    "path": "Projects/{slug}",
    "parameters": [{ "name": "slug", "in": "path", "required": false }]
  },
  "tag": {
    "path": "projects/{slug}",
    "parameters": [{ "name": "slug", "in": "path", "required": false }]
  },
  "transfer": { "op": "identity" }
}
```

Authoring: medium — familiar to API designers, alien to knowledge workers. Borrowed vocabulary (`parameters`, `in: "path"`) doesn't fit the domain.

**Hybrid verdict:** Defer. Doesn't add capability over Candidate B; just adds vocabulary cost.

### E. Lens-flavored explicit forward/inverse pair

```json
{
  "id": "para-projects",
  "lens": {
    "get": "Projects/{slug}",
    "put": "#projects/{slug}",
    "iso": true
  },
  "transfer": { "op": "identity" }
}
```

Authoring: medium — `get`/`put` framing is unfamiliar to non-FP users. Bijection visibility: explicit (`iso: true` flags it).

**Hybrid verdict:** Strong alternative to B; same mechanical content, slightly different vocabulary. Could be a wrapper over B's templates — `lens.get` and `lens.put` are just two templates with an explicit ISO claim that the loader can verify (slot names match → claim is correct). Minimal extra cost; might be worth supporting as syntactic sugar.

### F. TypeScript tagged template literals

```typescript
const para_projects = rule({
  id: "para-projects",
  folder: template`Projects/${slug}`,
  tag: template`#projects/${slug}`,
  transfer: "identity",
});
```

Authoring: high for TypeScript authors, zero for JSON-only users. The plugin's rule packs are user-authored JSON; introducing TS compilation breaks the workflow.

**Hybrid verdict:** Defer indefinitely. Wrong layer — this is a build tool, not a runtime format. If a future packaging story emerges (compiled rule packs distributed via npm), revisit.

### G. Custom Boomerang-style mini-DSL

```
para-projects = const "Projects" . copy [^/]+ <-> const "projects" . copy [^/]+
```

Boomerang and BiGUL prove this works at the formal level. For our domain, it's a tax: users have to learn a DSL, the plugin has to ship a DSL parser, IDE tooling needs custom support.

**Hybrid verdict:** Defer indefinitely. Returns are too small for the cost.

## Real implementations — what the candidates look like in deployed code

The candidates aren't theoretical. Each has at least one mature reference implementation in production. The samples below come from those projects' official sources.

### Path-template libraries (Candidate B's family)

[**path-to-regexp**](https://github.com/pillarjs/path-to-regexp) is the JS-ecosystem default. Production-grade (powering Express, Fastify, NestJS, ky, react-router; ~7M weekly downloads). Both directions:

```typescript
import { match, compile } from 'path-to-regexp';

const fn = match('/users/:id/posts/:postId');
fn('/users/42/posts/100');
// → { params: { id: '42', postId: '100' } }

const toPath = compile('/users/:id/posts/:postId');
toPath({ id: '42', postId: '100' });
// → '/users/42/posts/100'
```

Slot syntax: `:name`, `:name(\d+)` (custom regex per slot), `*splat`, `:name+` (one or more), `:name*` (zero or more). TypeScript generics make slot names compile-time visible. ~5.5 KB minified + gzipped, MIT.

[**URL Pattern Standard**](https://urlpattern.spec.whatwg.org/) is browser-native in Chromium, polyfill via [`urlpattern-polyfill`](https://github.com/kenchris/urlpattern-polyfill). Forward only:

```typescript
const pattern = new URLPattern({ pathname: '/blog/:title' });
const result = pattern.exec('https://example.com/blog/hello-world');
// result.pathname.groups.title → 'hello-world'
```

No standard inverse — the spec is forward-match-only. Important asymmetry: it's a *matching* primitive, not a bijective abstraction.

[**TanStack Router**](https://tanstack.com/router/latest) (React/Solid) gives full compile-time slot typing via codegen:

```typescript
// Forward (extraction):
const { userId } = useParams({ from: '/users/$userId' });
// Inverse (compilation):
<Link to="/users/$userId" params={{ userId: '42' }} />
router.navigate({ to: '/users/$userId', params: { userId: '42' } });
```

[**FastAPI**](https://fastapi.tiangolo.com/tutorial/path-params/) (Python) typed via Pydantic, with built-in inverse:

```python
@app.get("/items/{item_id}", name="get_item")
async def read_item(item_id: int):
    return {"item_id": item_id}

# Inverse — generate URL by route name + params
url = app.url_path_for("get_item", item_id=42)
# → '/items/42'
```

[**Next.js**](https://nextjs.org/docs/pages/building-your-application/routing/dynamic-routes), [**SvelteKit**](https://svelte.dev/docs/kit/routing), and [**Astro**](https://docs.astro.build/en/core-concepts/routing/) all use file-system path-template conventions: `[slug]`, `[...rest]` (catch-all), `[[...optional]]`. Forward extraction is built in; inverse is manual string concatenation in all three (no `url_path_for` equivalent).

[**OpenAPI 3**](https://swagger.io/docs/specification/paths-and-operations/) and [**gRPC HTTP transcoding**](https://google.aip.dev/127) provide path-template *specifications* (not runtime implementations). OpenAPI's `paths.{path}.parameters[]` is the closest precedent for Candidate D's JSON shape.

**Takeaway:** path-to-regexp is what we'd vendor (or borrow from). Its API design — `match()` returns slot values, `compile()` takes slot values and returns a path — is exactly what Phase H's compiler needs.

### Lens-based / bidirectional libraries (Candidates E and G's family)

[**Augeas**](http://augeas.net/) is the most production-tested lens implementation in existence. It edits Linux config files via lens definitions in a DSL (`.aug` files). Example from `hosts.aug` (parses `/etc/hosts` to a structured tree, edits the tree, writes back to disk byte-equivalent):

```ocaml
module Hosts =
  autoload xfm

  let word = /[^# \n\t]+/
  let record = [ seq "host" . Util.indent .
                              [ label "ipaddr" . store word ] . Sep.tab .
                              [ label "canonical" . store word ] .
                              [ label "alias" . Sep.space . store word ]*
                 . Util.comment_or_eol ]

  let lns = ( Util.empty | Util.comment | record ) *
  let xfm = transform lns (incl "/etc/hosts")
```

The combinators (`del`, `store`, `key`, `seq`, `*`, `|`) are the lens primitives; Augeas guarantees the round-trip property automatically. Folder-tag-sync's domain is structurally similar — we have on-disk artifacts (folder trees) and want a structured edit/query interface. Augeas is the closest precedent for "this works in real software at scale."

[**Boomerang**](https://www.seas.upenn.edu/~harmony/) is the academic foundation — Foster, Pierce, et al. (POPL 2005). Lens composition operators (`;`, `|`, `*`, `+`) build complex bidirectional transformations from primitives. Worth knowing about; not directly portable to our JSON-rule-pack domain.

[**BiGUL**](https://hackage.haskell.org/package/BiGUL) (formally verified in Agda, Hu et al.) inverts the model: you write only the *putback* (inverse) direction, and BiGUL derives the forward function automatically. Good intellectual frame; production usage is rare.

[**Haskell `lens`**](https://hackage.haskell.org/package/lens) is the gold standard for composable optics. The relevant type for our use case is `Iso' s a` — a bijection between `s` and `a`:

```haskell
iso :: (s -> a) -> (a -> s) -> Iso' s a
textToString :: Iso' Text String
textToString = iso Text.unpack Text.pack
-- Round-trip property:
view textToString . review textToString ≡ id
```

The three lens laws (GetPut, PutGet, PutPut) are the formal version of the bijection guarantee. We don't need the formalism, but the *mental model* is exactly what we want for Candidate E's `iso: true` flag.

[**monocle-ts**](https://github.com/gcanti/monocle-ts) — TypeScript Profunctor lenses. Closest fit if we wanted to vendor a JS-ecosystem optics library:

```typescript
import { Lens, Iso } from 'monocle-ts';

const personToCoder = new Iso<Person, Coder>(
  person => person,
  coder => { const { languages, ...rest } = coder; return rest; }
);
// Iso.reverseGet(Iso.get(a)) === a
```

Heavier than path-to-regexp; the mental model bleeds into the type system. Right tool if we wanted formal optic guarantees; overkill if we just want path templates.

[**partial-lenses**](https://github.com/calmm-js/partial-lenses) handles missing-value semantics first-class — relevant if optional slots (`{slug?}`) become a major feature.

**Takeaway for hybrid:** the lens-family is *informationally equivalent* to a template-pair with `iso: true`. Candidate E (lens-flavored) is just templates with explicit framing. We don't need to adopt the lens calculus to get its benefit — we just need to be honest about which rules are bijective and surface that to the user.

## The hybrid coexistence story (the central section)

Your redirect: regex is fine *if the tool can account for the heterogeneity*. The honest evaluation:

### What heterogeneity costs

For each additional shape we support beyond regex:

1. **Loader complexity** — one parser per shape. For templates, that's ~50 LOC plus tests. For slot-object (C), ~80 LOC. For lens (E), trivial (it's just two templates plus an `iso` claim to verify).
2. **Inference layer** — already needed for regex (`inferTyped.ts:inferEntryFromPattern`). Adding template-shape inference is straightforward: parse the template, extract slots, build the typed-spec view. Crucially, *both* directions of inference can coexist without conflict — they're triggered by which fields are present in the rule JSON.
3. **Guided modal complexity** — N editor modes. For N=2, manageable: a tab control between "regex" and "template," with a per-rule auto-detection of which mode the rule was authored in. For N≥3, the UI starts to feel busy. This is the meaningful constraint on N.
4. **Sync engine** — *zero added cost*. The architecture diagram earlier shows why: shapes normalize to the existing Layer 1 internal type. The engine never knows or cares which shape a rule was authored in.

The total cost for adding templates to a regex-only system is roughly: ~50 LOC parser + ~30 LOC inference + ~150 LOC UI tab + tests for each. That's a Phase H-scoped commit, not a multi-month rewrite.

### What heterogeneity buys

- Existing regex rules keep working untouched. Phase G's anchor work, the SEACOW/PARA/JD packs, every rule that's already in production stays valid.
- Power users keep regex as an escape hatch when templates can't express their pattern (rare but real).
- Template-first authors get the better authoring surface. The guided modal renders templates; the user never sees regex unless they explicitly drop into the advanced editor.
- No forced migration. Rule packs can be incrementally converted (or never converted), one rule at a time.
- The engine stays a single code path, with all the test coverage that already exists.

### A common worry — does adopting templates force a naming convention?

No. A folder that doesn't match any rule's pattern is invisible to the sync engine. The plugin doesn't enforce naming conventions; it acts only on files matching a rule the user explicitly authored. Templates aren't a fence around your vault — they're an opt-in description of structure you already have, plus a way to keep that description bidirectional. Concretely:

<figure aria-label="A sample vault showing what the sync engine does with each file. Files matching a rule's pattern get tags applied. Files outside any rule's pattern are untouched — no tags, no movement. The plugin doesn't enforce naming conventions." style="margin: 1.5em 0;">
<div style="border: 1.5px solid currentColor; border-color: rgba(125,125,125,0.4); border-radius: 12px; padding: 1em 1.25em;"><div style="font-size: 0.7em; font-weight: 700; opacity: 0.6; letter-spacing: 0.1em; margin-bottom: 0.6em;">SAMPLE VAULT &middot; what the sync engine does with each file</div><div style="display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.6fr) minmax(0, 1fr); gap: 0.5em 1em; font-family: ui-monospace, monospace; font-size: 0.86em; align-items: start;"><div style="font-family: inherit; font-weight: 700; font-size: 0.78em; opacity: 0.65; letter-spacing: 0.05em;">FILE</div><div style="font-family: inherit; font-weight: 700; font-size: 0.78em; opacity: 0.65; letter-spacing: 0.05em;">RULE MATCH</div><div style="font-family: inherit; font-weight: 700; font-size: 0.78em; opacity: 0.65; letter-spacing: 0.05em;">RESULT</div><div style="grid-column: 1 / -1; height: 1px; background: rgba(125,125,125,0.3);"></div><div><strong>Projects/Web/auth.md</strong></div><div style="opacity: 0.85;">PARA Projects rule (<code>Projects/&#123;slug&#125;</code>)</div><div><span style="color: #4f8a4a; font-weight: 700;">tagged #projects/web</span></div><div><strong>Inbox/scratch.md</strong></div><div style="opacity: 0.85;">marker-only Inbox rule</div><div><span style="color: #4f8a4a; font-weight: 700;">tagged #inbox</span></div><div><strong>Random thoughts.md</strong></div><div style="opacity: 0.85;">no rule matches</div><div style="opacity: 0.65; font-style: italic;">untouched</div><div><strong>Drafts/wip.md</strong></div><div style="opacity: 0.85;">no rule matches</div><div style="opacity: 0.65; font-style: italic;">untouched</div><div><strong>12 - Lab notebook/entry.md</strong></div><div style="opacity: 0.85;">JD anchored under Entity/&#123;user&#125;/Work/ &mdash; doesn't match here</div><div style="opacity: 0.65; font-style: italic;">untouched</div><div><strong>2026-04-27-meeting.md</strong></div><div style="opacity: 0.85;">no rule matches</div><div style="opacity: 0.65; font-style: italic;">untouched</div></div><div style="margin-top: 0.9em; padding: 0.6em 0.8em; background: rgba(125,125,125,0.08); border-radius: 6px; font-size: 0.84em; opacity: 0.85;"><strong>Rules describe what to sync.</strong> Everything else is left alone &mdash; no naming-convention enforcement, no global validation, no warnings about "non-conforming" files. The user remains in charge of the vault.</div></div>
</figure>

This is the architectural answer to *"if templates land, do my filenames have to follow them?"* — no. Adding a template-shaped rule for `Projects/{slug}` doesn't reach beyond Projects/. The rest of the vault is unchanged. Templates describe; they don't enforce.

### What the tool needs to communicate

The user's third concern was: *how does the system communicate the issues with each choice?* This is the part that makes hybrid usable rather than chaotic. Concrete UI:

- **Per-rule status indicator** — when the user opens a rule in the guided modal, a one-line status bar shows the rule's shape and what guarantees apply:
  - *"This rule uses raw regex. Bijection is asserted (computed from typed spec, not visible in the pattern)."*
  - *"This rule uses a path template. Bijection is visible: both sides share slots [`slug`]."*
  - *"This rule is marker-only. Many-to-one folder→tag by design; tag→folder reconstructs the entry folder only."*
- **Pack-load summary** — when a pack is loaded or scanned, a brief notice: *"Imported 4 rules: 2 templates, 1 regex, 1 marker-only."* No alarm — just visibility.
- **Convert action** — for rules where conversion is safe, a one-click *"Convert to template"* (or *"Convert to regex"*) action in the rule's edit modal. The conversion is a no-op semantically (both compile to the same internal regex), so it never changes behavior — just changes the authoring shape.
- **Conflict resolution** — when two rules might match the same path, the conflict resolution dialog shows which abstraction each came from and what each rule would do. Same UI today; just gains the abstraction-source annotation.

### The tipping point — when hybrid breaks down

The architecture stays manageable as long as:

1. **N ≤ 3 supported shapes.** With regex + templates + (maybe) marker-only as a third quasi-shape, the loader and UI complexity is bounded. At N=4+, the matrix of possible cross-rule interactions starts producing unforeseen edge cases.
2. **All shapes normalize to one internal Layer 1.** If we ever introduce a shape that the engine *can't* normalize (e.g., a pattern that requires AST-level matching, not regex), the engine forks. That's where hybrid stops being free.
3. **Per-shape inference round-trips.** When you take a regex rule and infer its template, then derive the regex back, you should get the same regex. Currently true for `^Entry(?:/|$)` shape; not true for arbitrary regex (the inferred template is just a hint, not a faithful round-trip). The UI must be honest about this — *"approximated as a template"* vs *"exact template"*.

If any of those three constraints breaks, the cost-benefit flips. The recommendation below assumes they hold.

## The full comparison matrix

| Dimension | A: regex | B: templates | C: slot objects | D: OpenAPI | E: lens | F: TS literals | G: mini-DSL |
|---|---|---|---|---|---|---|---|
| **Authoring intuitiveness** | medium | ★★★ | ★ | ★★ | ★★ | ★★★ (TS only) | ★ |
| **JSON-friendliness** | ★★★ | ★★★ | ★★ | ★★ | ★★★ | (compiled) | ★ |
| **Bijection visibility** | hidden | ★★★ | ★★★ | ★★ | ★★★ explicit | ★★★ | ★★★ |
| **TS type-safety** | none | ★★ (parsed) | ★★★ | ★★ | ★★ | ★★★ | ★ |
| **Per-slot transforms** | hard | ★★ (extension) | ★★★ | ★★ | ★★ | ★★★ | ★★★ |
| **Migration cost** | zero | medium | high | high | medium | extreme | extreme |
| **Hybrid-friendly?** | ★★★ native | ★★★ peer | ★★ verbose | ★ vocab cost | ★★★ wrap of B | ✗ wrong layer | ✗ DSL tax |
| **Tool burden** | zero | ~250 LOC + tests | ~400 LOC + tests | ~300 LOC | ~50 LOC over B | (toolchain) | (DSL runtime) |
| **Verdict** | keep | **add as peer** | defer | defer | optional sugar | defer indef. | defer indef. |

> **Connection to Challenge 04 (name collisions across hierarchy levels).** Candidates that capture position as a slot (B, E, F) automatically disambiguate same-name-different-layer cases — the layer literally becomes a captured value. Candidates that treat position as separate metadata (A, C, D) need additional machinery to disambiguate. The hybrid story doesn't change this; it just lets both kinds coexist. Collision is a *forward-direction* problem (see [Part 1, Diagram B](../2026-04-26-regex-vs-path-templates-research/#collision-vs-lossy--distinct-failure-modes)) — a more expressive abstraction reduces collisions by making structural position part of what the rule can talk about.

## Recommendation

Phase H adds **templates as a first-class peer to regex.** Existing regex rules continue to work exactly as today. New rules can be authored as either shape. The engine consumes one normalized internal form. The guided modal renders the right editor per rule, with a status indicator surfacing the per-rule abstraction and bijection guarantees.

Concretely, this scopes Phase H slightly *narrower* than the original plan:

- The plan to "deprecate regex visually in favor of templates" is dropped. Both stay first-class.
- The slot-diagram UI becomes a per-mode editor inside the guided modal — regex mode renders the existing pattern field, template mode renders the new slot diagram. Mode auto-detected from rule JSON; one-click switch where round-trip is safe.
- The migration commit (originally H7) becomes optional rather than required. Migrating one rule pack to demonstrate is still useful as documentation, but not a blocker for shipping.
- A new lightweight commit: per-rule status indicator + "Convert to template/regex" action in the modal. ~60 LOC + tests.

Candidates C, D, F, G all get deferred indefinitely. They each add cost without clearly added capability over B. If a future use case surfaces that B genuinely can't express (per-slot typed transforms beyond what an extension syntax can handle, or formal bijection proof requirements), revisit then.

## Open questions specific to the hybrid

These don't block Phase H — they're things to validate during implementation or in user testing.

- **Round-trip fidelity of inferred templates.** When a regex rule is opened in the guided modal and the loader infers a template-shape hint, how often does the inferred template match what a human would have authored? Probably very high for the canonical shapes (PARA identity, JD numbered prefixes); lower for hand-authored regex with constraints. Worth measuring against the shipped rule packs.
- **User-facing language for bijection status.** "Bijection asserted" vs "bijection visible" is jargon. Better phrasings: *"This rule round-trips cleanly: folder ↔ tag in both directions"* (visible) vs *"This rule round-trips per its declared transfer semantics"* (asserted, the regex doesn't prove it). Find the right level of honesty without overwhelming non-FP users.
- **Conflict warnings between shapes.** Should the engine warn when a regex rule and a template rule could both match the same path? Today's conflict resolution is order-based (priority); it doesn't care about shape. Probably keep that; the shape is metadata for the user, not the engine.
- **Auto-suggest at scan time.** When the vault scan detects a pack and offers to import its rules, should the import dialog show a "convert all rules to templates" option? Probably yes for packs whose rules round-trip cleanly; probably no for packs with hand-authored regex (cyberbase-actual is the obvious case — emoji-prefixed patterns that don't fit cleanly into the template syntax).
- **Per-slot transforms — the path forward.** Templates with extension syntax (`{slug|kebab}`) is one path. A separate transforms map keyed by slot name (`{ slug: { caseTransform: 'kebab' } }`) is another. The first is more compact; the second is more JSON-friendly. Decision deferred to Phase H+ when the use case is concrete.

## Style + production constraints (lessons from Part 1)

For future docs in this lineage:

- **Use HTML, not SVG, for any block with prose content.** SVG `<text>` does not wrap; HTML does. SVG is the right tool for arrow flows, structural graphs, and small diagrams with short labels. Anything else: HTML with inline styles.
- **CSS Grid `auto-fit, minmax(280px, 1fr)`** for any side-by-side comparison — auto-collapses to single-column at narrow viewports without media queries.
- **No blank lines inside HTML blocks in markdown.** CommonMark closes the HTML block at the first blank line and re-parses what follows as markdown. The `<figure>...</figure>` content must be one contiguous block.
- **Inline styles only.** `<style is:global>` is Astro-specific; works in `.mdx` but breaks markdown HTML-block parsing in `.md`. Inline `style="..."` attributes always work.
- **Avoid `.mdx` in zz-log.** MDX parses `{...}` as JSX expressions. The body of these research entries has dozens of `{slug}`-style examples; converting to MDX requires escaping each one. Stay in `.md`.
- **Link order field: 11-digit `-YYYYMMDDXXX`.** Existing entries use 8-digit, but one entry slipped to 11-digit and broke sorting. All entries normalized to 11-digit; the trailing 3 digits are a within-day sub-order (default 000).

## Related concepts

- [Path abstractions, part 1](../2026-04-26-regex-vs-path-templates-research/) — the framing, prior art, vocabulary, and abstraction-comparison diagram
- [Philosophy](../../concepts/philosophy/) — typed model layers, why determinism is non-negotiable
- [Transfer operations](../../concepts/transfer-operations/) — the eight primitives both regex and templates compile against
- [When to use regex](../../concepts/when-to-use-regex/) — current escape-hatch guidance; revisit after Phase H lands
- [Open questions](../open-questions/) — design decisions in flight
- [Tradeoffs](../tradeoffs/) — chosen-vs-rejected captures
