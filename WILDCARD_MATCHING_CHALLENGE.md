# Wildcard Matching Challenge

## The Problem

SEACOW(r) is a **meta-framework** for organizing knowledge, not a specific structure. This means users can have entity-based structures where content is organized under different entities (people/teams), but each entity has its own OUTPUT structure.

### Example Structure

```
Cybersader/
  📁 01 - Projects/
  📁 02 - CyberNews/
  📁 03 - Curations, Stacks/

Username1/
  📁 01 - Projects/
  📁 02 - CyberNews/
  📁 03 - Curations, Stacks/
```

### The Challenge

We need to support wildcard patterns like `Cybersader/*` where:
1. The `*` matches any remaining path depth
2. The matched content becomes tags **bidirectionally**
3. The pattern works for multiple entities without duplicating rules

### Current Limitations

Our current implementation requires explicit patterns:
- `tagPattern: "^--cybersader/projects"`
- `folderPattern: "^Cybersader/Projects"`

This doesn't scale when you have:
- Multiple entities
- Dynamic sub-structures under each entity
- Need to avoid rule explosion (1 rule per entity per subfolder)

---

## Desired Behavior

### Folder to Tag

**File location**: `Cybersader/📁 01 - Projects/MyProject/note.md`

**Should create tags**:
- `#--cybersader` (entity)
- `#--cybersader/01-projects` (OUTPUT structure)
- `#--cybersader/01-projects/myproject` (specific project)

### Tag to Folder

**File has tags**:
- `#--username1/02-cybernews/security-breach`

**Should move to**:
- `Username1/📁 02 - CyberNews/Security Breach/`

---

## Proposed Solution

### 1. Wildcard Pattern Syntax

Introduce `*` and `**` wildcards in patterns:

```json
{
  "tagPattern": "^--{entity}/*",
  "folderPattern": "^{entity}/*"
}
```

Where:
- `{entity}` is a captured group (matches any entity name)
- `*` matches one path level
- `**` matches multiple path levels recursively

### 2. Capture Groups

Use regex capture groups to extract and transform matched parts:

```json
{
  "tagPattern": "^--([^/]+)/(.*)",
  "folderPattern": "^([^/]+)/(.*)",
  "captures": {
    "1": "entity",
    "2": "path"
  },
  "transforms": [
    {
      "target": "path",
      "operations": ["removeEmoji", "removeNumberPrefix", "kebab-case"]
    }
  ]
}
```

**Behavior**:
- Capture group 1: Entity name (e.g., "cybersader", "username1")
- Capture group 2: Remaining path (e.g., "📁 01 - Projects/MyProject")
- Transform the path independently of the entity

### 3. Dynamic Rule Generation

When a wildcard rule is defined, the engine:
1. Scans the vault for matching entities
2. Dynamically generates specific rules for each entity
3. Caches generated rules for performance
4. Regenerates when vault structure changes

---

## Implementation Considerations

### Performance

**Challenge**: Scanning entire vault to detect entities
**Solutions**:
- Cache entity list
- Only rescan on folder creation/deletion
- Lazy evaluation (generate rules on-demand)

### Ambiguity Resolution

**Challenge**: Multiple wildcard rules matching the same file
**Solutions**:
- Priority system (as we already have)
- Most specific pattern wins
- Explicit "wildcard priority" setting

### UI Representation

**Challenge**: How to show wildcard rules in settings
**Options**:
1. Show as single rule with "dynamic" badge
2. Expand to show all generated rules (collapsible)
3. Preview mode: "This rule will match X entities"

### Validation

**Challenge**: Validating wildcard patterns before applying
**Solutions**:
- Pattern syntax validator
- Preview/dry-run mode
- Show matched files before confirming

---

## Example Rule Configuration

### Simple Entity Wildcard

```json
{
  "id": "entity-output-wildcard",
  "name": "Entity OUTPUT structures",
  "description": "Sync any entity's OUTPUT folder structure to tags",
  "wildcardEnabled": true,
  "direction": "bidirectional",
  "tagPattern": "^--(?<entity>[^/]+)/(?<path>.*)",
  "folderPattern": "^(?<entity>[^/]+)/(?<path>.*)",
  "transforms": {
    "entity": {
      "caseTransform": "lowercase"
    },
    "path": {
      "caseTransform": "kebab-case",
      "emojiHandling": "strip",
      "numberPrefixHandling": "strip"
    }
  },
  "options": {
    "createFolders": true,
    "addTags": true,
    "syncOnFileCreate": true
  }
}
```

**Generated Rules** (dynamic):
- `Cybersader/**` ↔ `#--cybersader/**`
- `Username1/**` ↔ `#--username1/**`
- `TeamA/**` ↔ `#--teama/**`

### Filtered Wildcard

Only match certain subfolders:

```json
{
  "wildcardEnabled": true,
  "folderPattern": "^(?<entity>[^/]+)/📁 \\d+ - (?<section>[^/]+)/(?<path>.*)",
  "tagPattern": "^--(?<entity>[^/]+)/(?<section>[^/]+)/(?<path>.*)",
  "entityWhitelist": ["Cybersader", "Username1"],
  "pathFilter": "^📁 \\d+ -"
}
```

**Matches**:
- ✅ `Cybersader/📁 01 - Projects/...`
- ✅ `Username1/📁 02 - CyberNews/...`
- ❌ `Cybersader/Random Folder/...`
- ❌ `OtherEntity/📁 01 - Projects/...`

---

## Alternative Workarounds (Current System)

Until wildcard matching is implemented, users can:

### Option 1: Explicit Entity Rules

Create one rule per entity:

```json
{
  "id": "cybersader-output",
  "folderPattern": "^Cybersader/",
  "tagPattern": "^--cybersader/"
}
```

**Pros**: Works now
**Cons**: Doesn't scale with many entities

### Option 2: Flat Entity Tag

Use entity as a single tag, structure separately:

**Tags**:
- `#--cybersader` (flat, no nesting)
- `#01-projects/myproject` (structure tag)

**Pros**: Simpler rules
**Cons**: Loses entity-path relationship

### Option 3: Manual Tag Management

Don't auto-sync entity structures, manage manually:
- Entity folders for file organization
- Tags for cross-linking and filtering
- Use MoCs to bridge the two

**Pros**: Full control
**Cons**: Manual work, defeats plugin purpose

---

## Related Features

### Entity Detection

The plugin could auto-detect entities by:
1. Scanning top-level folders
2. Looking for certain patterns (e.g., double-dash prefix)
3. User-defined entity list in settings

### Entity Management UI

Settings panel for:
- List of detected entities
- Manually add/remove entities
- Set per-entity transformation rules
- Enable/disable entity sync

### Template Variables

Support template variables in patterns:

```json
{
  "folderPattern": "^{$ENTITY}/📁 {$NUMBER} - {$SECTION}/*",
  "tagPattern": "^--{$ENTITY}/{$SECTION}/*"
}
```

Where variables are:
- Defined by user in settings
- Auto-populated from vault structure
- Used in transformation rules

---

## Priority for Implementation

### Phase 1 (MVP)
- Basic capture group support
- Static entity list (user-defined)
- Simple `*` wildcard (one level)

### Phase 2 (Enhanced)
- `**` recursive wildcard
- Auto-detect entities
- Named capture groups

### Phase 3 (Advanced)
- Template variables
- Entity management UI
- Dynamic rule generation with caching

---

## Technical Design Notes

### Regex Engine Extensions

Current: Basic pattern matching
Needed: Named capture groups + transformations per group

```typescript
interface WildcardPattern {
  pattern: string; // Regex with named groups
  captures: {
    [groupName: string]: {
      transform: TransformConfig;
      required: boolean;
    }
  };
}

function applyWildcardPattern(
  path: string,
  pattern: WildcardPattern
): TransformedPath | null {
  const match = path.match(pattern.pattern);
  if (!match) return null;

  const transformed = {};
  for (const [name, config] of Object.entries(pattern.captures)) {
    const captured = match.groups?.[name];
    if (!captured && config.required) return null;

    transformed[name] = applyTransforms(captured, config.transform);
  }

  return transformed;
}
```

### Caching Strategy

```typescript
class WildcardRuleCache {
  private cache: Map<string, GeneratedRule[]> = new Map();

  getOrGenerate(wildcardRule: Rule, vault: Vault): GeneratedRule[] {
    const cacheKey = wildcardRule.id;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const generated = this.generateRules(wildcardRule, vault);
    this.cache.set(cacheKey, generated);
    return generated;
  }

  invalidate(wildcardRuleId: string) {
    this.cache.delete(wildcardRuleId);
  }
}
```

---

## Questions to Resolve

1. **Syntax**: Use regex capture groups or custom template syntax?
2. **Performance**: Generate rules upfront or on-demand?
3. **UI**: How to visualize wildcard rules and generated rules?
4. **Validation**: How to validate wildcard patterns before saving?
5. **Conflicts**: What happens when wildcard rules overlap with explicit rules?
6. **Entities**: Auto-detect or manual configuration?

---

## User Feedback Needed

- Is the proposed syntax intuitive?
- What edge cases are we missing?
- Which workaround is most acceptable short-term?
- Priority: Wildcard matching vs. other features?

---

## Status

**Current**: Documented, not implemented
**Priority**: High (blocks real-world usage for entity-based structures)
**Complexity**: High (requires significant regex and caching logic)
**Dependencies**: None (can implement independently)

---

## Related Issues

- Conditional UI fields (simpler, should do first)
- Rule filtering/search (simpler, should do first)
- Bulk operations (orthogonal, can do in parallel)
- Import/export (works with or without wildcards)
