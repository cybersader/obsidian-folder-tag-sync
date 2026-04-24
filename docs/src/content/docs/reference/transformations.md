---
title: Transformations
description: Each transformation step, what it does, and examples.
sidebar:
  order: 2
---

Transformations are applied in a fixed order: **emoji → number prefix → case → custom regex**. Each step is optional.

## Emoji handling

| Option | Behavior |
|---|---|
| `stripEmoji: true` | Remove leading and embedded emojis |
| `stripEmoji: false` | Keep emojis unchanged |

**Example** (`stripEmoji: true`):

```
"📁 01 - Projects"  →  "01 - Projects"
```

## Number prefix handling

Targets Johnny Decimal-style prefixes like `01 - ` or `1.2.3 ` at the start of a segment.

| Option | Behavior |
|---|---|
| `'strip'` | Remove the leading numeric prefix and separator |
| `'keep'` | Preserve the prefix as part of the name |

**Example** (`'strip'`):

```
"01 - Projects"  →  "Projects"
```

## Case conversion

| Option | Example output |
|---|---|
| `snake_case` | `my_cool_thing` |
| `kebab-case` | `my-cool-thing` |
| `Title Case` | `My Cool Thing` |
| `camelCase` | `myCoolThing` |
| `PascalCase` | `MyCoolThing` |
| `none` | `My Cool Thing` (unchanged) |

Applied to each segment independently — path separators (`/`) are preserved.

## Custom regex transforms

Arbitrary pattern/replacement pairs, applied in array order after case conversion.

```json
"customRegex": [
  { "pattern": "\\s+", "replacement": "_", "flags": "g" },
  { "pattern": "^_+|_+$", "replacement": "", "flags": "" }
]
```

Supports standard JavaScript regex syntax and flags.

## Complete pipeline example

Input folder path: `"📁 01 - Projects/My Cool Thing"`

```
"📁 01 - Projects/My Cool Thing"
  ↓ stripEmoji: true
"01 - Projects/My Cool Thing"
  ↓ handleNumberPrefix: 'strip'
"Projects/My Cool Thing"
  ↓ caseTransform: 'snake_case'
"projects/my_cool_thing"
  ↓ (tag entry point prefix)
"#projects/my_cool_thing"
```

## Reversibility

The same pipeline drives both sync directions. For tag-to-folder, `folderTransforms` run on the captured tag segments to produce the folder name. If your tag convention and folder convention are different, define separate transforms for each direction on the same rule.
