---
title: When to use regex
description: The escape hatch — cases the typed model can't cleanly express and how to drop to Layer 1.
sidebar:
  order: 7
---

The typed model is the [recommended](/obsidian-folder-tag-sync/concepts/philosophy/) layer to author rules at. But it doesn't replace regex — it sits on top. Some rules genuinely need regex, and for those, Layer 1 is always available: a MappingRule can carry `folderPattern` and `tagPattern` as raw regex even when `folder`, `tag`, and `transfer` are empty.

## Cases the typed model can't express cleanly

### Non-Latin character handling

The built-in transform pipeline has `caseTransform`, `emojiHandling`, and `numberPrefixHandling`. If your folder or tag names use non-Latin characters in ways these transforms don't handle — Chinese, Japanese, Cyrillic, etc. — you may need a `customTransforms` regex rewrite.

```ts
{
  customTransforms: [
    { pattern: '([一-鿿]+)', replacement: '$1', flags: 'g' }
  ]
}
```

This field is on `TransformConfig`, which is available whether or not the rule has typed metadata.

### Unusual prefix conventions

The `TagPrefixMarker` type enumerates five values: `'/'`, `'--'`, `'-'`, `'_'`, `''`, and `null`. If your vault uses a different convention — e.g. `@entity/...` for entities, or numeric prefixes like `1/projects`, `2/areas` — the typed model doesn't have a slot for that.

You have two options:
1. **Treat the non-standard prefix as part of the `tagEntry`**. If your convention is `@cybersader/projects`, set `tagEntry: '@cybersader'` and `prefixMarker: null`. The regex will anchor on `@cybersader`.
2. **Author the rule entirely at Layer 1** if you don't want the inferred typed metadata to be misleading.

### Ad-hoc migration rules

"I need one rule that matches exactly three specific directories and rewrites their paths in an unusual way." This is a migration one-shot, not a lasting part of your organizational system. The typed model is meant for rules you'll live with; it's overkill for a throwaway regex.

### Rules that span multiple independent regex alternations

```
^(Projects|Archive)/(\d{4})/([^/]+)$
```

This captures an alternation between two entry points, then a year, then a project slug. There's no clean way to express "entry point is one of these two alternatives" in the typed model today. Author it as raw regex.

## How to author a Layer-1-only rule

Skip the `folder`, `tag`, `transfer`, `inverseTransfer`, `cardinality`, `bijective` fields. Populate `folderPattern`, `tagPattern`, `folderEntryPoint`, `tagEntryPoint`, `folderTransforms`, `tagTransforms`, `options`, and the required meta fields (`id`, `name`, `priority`, `direction`, `enabled`).

```json
{
  "id": "legacy-migration-2024",
  "name": "Old notes migration",
  "priority": 100,
  "direction": "folder-to-tag",
  "enabled": true,
  "folderPattern": "^(Projects|Archive)/(\\d{4})/([^/]+)$",
  "folderEntryPoint": "",
  "tagPattern": "^legacy/",
  "tagEntryPoint": "legacy",
  "folderTransforms": {
    "caseTransform": "kebab-case"
  },
  "tagTransforms": {
    "caseTransform": "kebab-case"
  },
  "options": { /* ... */ }
}
```

The sync engines consume this identically to a derived rule. The only thing you lose is the typed metadata visibility — future Phase 2B UI won't be able to render this rule in the guided view.

## Inference can help

If you have an existing regex-only rule and want to know roughly what typed model it corresponds to, `inferTypedModel(rule)` (exported from `src/engine/inferTyped.ts`) makes a best-effort guess. The result is a `Partial<TypedRuleSpec>` — fields it can't confidently infer are omitted. Useful for:

- Migrating a hand-written rule pack to the typed form
- Showing "what axis is this rule roughly on" in UI without forcing a type
- Validating that a rule's pattern shape matches its declared intent

Inference is not authoritative. If inference returns `{transfer: {op: 'identity'}}` for a rule you authored as truncation, the rule runs as identity (because Layer 1 is what the sync engines see). Always trust the explicit typed fields over inferred ones.

## Mixing typed and regex

A rule can carry BOTH typed fields AND hand-written regex that overrides what derivation would produce. The main plugin's rule-pack loader treats **legacy Layer 1 fields as authoritative** if they're present — derivation only fills in what's missing. This makes typed fields a backing description rather than a hard source of truth, which matters when an existing hand-authored pack needs to keep working.

## See also

- [Transfer operations](/obsidian-folder-tag-sync/concepts/transfer-operations/) — the eight typed primitives most rules can be expressed in
- [Bijection and loss](/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — what determinism guarantees the typed model gives you (and what raw regex doesn't surface)
- [Terminology](/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary
- [Path abstractions, part 1](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — research log on whether regex stays the right primitive long-term, or templates land as a peer
