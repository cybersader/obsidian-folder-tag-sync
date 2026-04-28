---
title: Rule schema
description: The MappingRule interface — every field a rule supports.
sidebar:
  order: 1
---

A rule is a JSON object stored in plugin settings. The editor UI builds these for you, but understanding the schema helps when importing rule packs or debugging.

## MappingRule

```typescript
interface MappingRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  direction: 'folder-to-tag' | 'tag-to-folder' | 'bidirectional';

  // Pattern matching — pick ONE shape per rule:

  // Shape A: Path Lens templates (F2, recommended)
  folderTemplate?: string;     // e.g. 'Projects/{topic}'
  tagTemplate?: string;        // e.g. '#projects/{topic | kebab-case}'

  // Shape B: regex (power-user / legacy)
  folderPattern?: string;      // Regex, e.g. '^projects/(.*)$'
  tagPattern?: string;         // Regex, e.g. '^projects/(.*)$'
  folderEntryPoint?: string;   // Base path for creating new folders, e.g. 'Projects/'
  tagEntryPoint?: string;      // Tag prefix, e.g. 'projects/'

  // Transformations (regex shape only — template shape uses per-slot filters)
  folderTransforms?: TransformConfig;
  tagTransforms?: TransformConfig;

  // Behavior
  addTags?: boolean;                   // Folder→tag: add tags to frontmatter
  removeOrphanedTags?: boolean;        // Folder→tag: remove tags that no longer match
  createFolders?: boolean;             // Tag→folder: create folders if missing
  onConflict?: 'skip' | 'prompt' | 'priority';

  // F1 Step 3 — cross-pack precedence cluster (optional)
  group?: string;

  // F2 — bijectivity verdict computed at load time (read-only, advisory)
  bijective?: boolean;
}
```

## Path Lens templates (F2)

Templates are the canonical rule shape. A rule with `folderTemplate` + `tagTemplate` set is template-shaped; the loader auto-derives `folderPattern` + `tagPattern` from the compiled templates so the matcher works unchanged. Mutually exclusive with `typedSpec` — pick one shape per rule.

### Slot syntax (Tier A)

| Syntax | Meaning |
|---|---|
| `{name}` | Single path-segment slot (matches one segment) |
| `{name...}` | Glob slot (matches one or more segments, including `/`) |
| `{name \| filter}` | Slot with one filter applied |
| `{name \| f1 \| f2}` | Filter pipeline applied in order |

Slot names must match `[a-zA-Z_][a-zA-Z0-9_-]*`. Hyphens are allowed in names (`{jd-area}`); the compiler sanitizes them internally for the regex named-capture-group identifier.

### Filters

Forward direction (folder → tag) applies the chain in order; inverse direction walks it in reverse using each filter's `inverse` from the per-transform metadata table.

| Filter | Reversibility | Notes |
|---|---|---|
| `keep` / `keep-emoji` / `keep-num-prefix` | total | Identity |
| `kebab-case`, `snake_case`, `Title Case`, `camelCase`, `PascalCase`, `lower`, `upper` | conditional | Reversible iff input is in the case's domain |
| `strip-emoji` | lossy | Emoji discarded; no inverse |
| `strip-num-prefix` | lossy | JD-style numeric prefix discarded; no inverse |
| `extract-num-prefix` | conditional | Conditional on the extracted prefix flowing to another slot |
| `join('-')`, `join('_')` | lossy | Separator collision; cannot reconstruct path separators |
| `join('/')` | total | Identity for path-shaped values |

See [bijectivity detection](/obsidian-folder-tag-sync/concepts/bijectivity-detection/) for how the engine composes per-slot reversibility into a per-rule verdict.

### Slot-name semantics

- **Within-rule renaming is comment-like**: renaming `{topic}` to `{x}` consistently on both sides produces identical engine behavior. The name is a label.
- **Cross-side name match is load-bearing**: the engine uses name equality to bind folder-side `{topic}` to tag-side `{topic}`. Mismatched names (`{topic}` vs `{section}`) are flagged as Layer 1 bijectivity failures.
- **F4 future**: when a slot pulls its value from a frontmatter property, the name is the property reference — load-bearing as a binding.

### Example

```json
{
  "id": "para-projects-templated",
  "name": "PARA: Projects (template)",
  "enabled": true,
  "priority": 10,
  "direction": "bidirectional",
  "folderTemplate": "Projects/{topic}",
  "tagTemplate": "#projects/{topic | kebab-case}",
  "options": {
    "createFolders": true,
    "addTags": true,
    "syncOnFileCreate": true,
    "syncOnFileMove": true,
    "syncOnFileRename": true
  }
}
```

This rule is *conditional*-bijective: round-trips cleanly for inputs that are already lowercase-with-hyphens; lossy on inputs containing characters that don't survive `kebab-case` round-trip.

## TransformConfig

Pipeline of transformations applied in the listed order.

```typescript
interface TransformConfig {
  stripEmoji?: boolean;
  handleNumberPrefix?: 'strip' | 'keep';  // Johnny Decimal style
  caseTransform?:
    | 'snake_case'
    | 'kebab-case'
    | 'Title Case'
    | 'camelCase'
    | 'PascalCase'
    | 'none';
  customRegex?: RegexTransform[];
}

interface RegexTransform {
  pattern: string;
  replacement: string;
  flags?: string;  // e.g. 'gi'
}
```

## Direction semantics

- **folder-to-tag**: `folderPattern` + `folderEntryPoint` read from the file's path → `tagTransforms` applied → tag written using `tagEntryPoint`
- **tag-to-folder**: `tagPattern` + `tagEntryPoint` read from frontmatter → `folderTransforms` applied → file moved under `folderEntryPoint`
- **bidirectional**: Both, with conflict resolution controlled by `onConflict`

## Priority

Rules are sorted ascending by `priority`. Lower = higher precedence. The first rule whose pattern matches wins. More specific rules should get lower numbers.

## Example

A rule that maps `Projects/Archive/*` specifically (before the generic `Projects/*` rule fires):

```json
{
  "id": "projects-archive",
  "name": "Archived projects",
  "enabled": true,
  "priority": 10,
  "direction": "folder-to-tag",
  "folderPattern": "^Projects/Archive/(.*)$",
  "tagEntryPoint": "projects/archive/",
  "folderTransforms": { "stripEmoji": true, "caseTransform": "snake_case" },
  "addTags": true
}
```
