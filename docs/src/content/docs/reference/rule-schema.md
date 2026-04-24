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

  // Pattern matching
  folderPattern?: string;      // Regex, e.g. '^projects/(.*)$'
  tagPattern?: string;         // Regex, e.g. '^projects/(.*)$'
  folderEntryPoint?: string;   // Base path for creating new folders, e.g. 'Projects/'
  tagEntryPoint?: string;      // Tag prefix, e.g. 'projects/'

  // Transformations
  folderTransforms?: TransformConfig;
  tagTransforms?: TransformConfig;

  // Behavior
  addTags?: boolean;                   // Folder→tag: add tags to frontmatter
  removeOrphanedTags?: boolean;        // Folder→tag: remove tags that no longer match
  createFolders?: boolean;             // Tag→folder: create folders if missing
  onConflict?: 'skip' | 'prompt' | 'priority';
}
```

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
