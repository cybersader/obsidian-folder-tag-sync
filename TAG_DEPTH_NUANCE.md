# Tag Depth Nuance

## The Problem

When files are nested under entities or categories, there's an important design question: **Should we create tags for just the full path, or also create tags for each level of the hierarchy?**

This isn't just a technical question - it affects how users search, filter, and organize their knowledge.

---

## Example Scenario

**File location**: `VaultUser1/📁 01 - Projects/Web Development/React Component/note.md`

**Question**: What tags should this file have?

### Option A: Full Path Only

**Tags created**:
- `#--vaultuser1/01-projects/web-development/react-component`

**Pros**:
- Precise, unambiguous
- One tag per rule
- Easier to implement
- No tag clutter

**Cons**:
- Can't filter by entity alone (`#--vaultuser1`)
- Can't filter by category alone (`#01-projects`)
- Long tags are harder to type
- Doesn't support hierarchical filtering

**Use case**: When you want precise, specific tags and use search/dataview for broader queries.

### Option B: Entity + Full Path

**Tags created**:
- `#--vaultuser1`
- `#--vaultuser1/01-projects/web-development/react-component`

**Pros**:
- Can filter by entity
- Can see all entity content
- Hierarchical representation
- Better for tag pane navigation

**Cons**:
- Redundant information
- More tags per file
- Entity tag less meaningful alone
- Still can't filter by mid-level categories

**Use case**: When entity is a meaningful grouping (person, team, client) that you want to filter by.

### Option C: All Levels

**Tags created**:
- `#--vaultuser1`
- `#01-projects`
- `#01-projects/web-development`
- `#01-projects/web-development/react-component`
- `#--vaultuser1/01-projects/web-development/react-component`

**Pros**:
- Maximum flexibility for filtering
- Can see all projects across entities
- Can see all entity content
- Supports any level of filtering
- Tag hierarchy fully represented

**Cons**:
- Many tags per file (tag explosion)
- Ambiguous: Is `#01-projects` from root or entity?
- Potential tag conflicts between entities
- Harder to maintain
- Performance impact?

**Use case**: When you need maximum discoverability and don't mind tag volume.

### Option D: Entity + Category Path

**Tags created**:
- `#--vaultuser1`
- `#--vaultuser1/01-projects`
- `#--vaultuser1/01-projects/web-development`
- `#--vaultuser1/01-projects/web-development/react-component`

**Pros**:
- Hierarchical without ambiguity
- Can filter at any depth within entity
- No cross-entity tag conflicts
- Reasonable tag count

**Cons**:
- Can't see all `#01-projects` across entities (only per-entity)
- Still multiple tags per file
- Longer tag paths

**Use case**: Entity-centric organization where you want hierarchy within each entity, but don't need cross-entity category views.

---

## User's Concern

From feedback:

> "One big issue we have to note is what about when someone uses 01-projects (which they should be) under an entity. Is that tag going to show up as `#--cybersader/01-projects` or are we going to instead show `#01-projects` in some cases since the rule might not care about depth."

> "OR - are we going to have `#--cybersader/01-projects` and `#--cybersader` OR even add on `#01-projects` at the end? (probably not). I'm not sure our current rule engine accounts for this logic and nuance though."

**Key insight**: Our current rule engine does NOT account for this - we just match patterns and create ONE tag based on the match.

---

## Current Implementation

**How it works now**:
1. Rule matches folder path with pattern
2. Transformation extracts/modifies captured groups
3. ONE tag is created from the transformation result

**Example**:
```json
{
  "folderPattern": "^VaultUser1/📁 (\\d+) - ([^/]+)/(.*)",
  "tagPattern": "^--vaultuser1/(\\d+)-(.*)"
}
```

**Result**: Creates `#--vaultuser1/01-projects/web-development/...` (Option A)

**We do NOT**:
- Create intermediate tags (`#--vaultuser1`, `#--vaultuser1/01-projects`)
- Create category tags without entity (`#01-projects`)
- Give users choice of which tags to create

---

## Proposed Solution

### 1. Add "Tag Depth Strategy" Option

Per-rule configuration:

```typescript
interface RuleOptions {
  // ... existing options

  /**
   * Tag depth strategy for hierarchical paths
   */
  tagDepthStrategy?: 'full-path-only' | 'with-parent-tags' | 'all-levels' | 'custom';

  /**
   * If strategy is 'custom', specify which levels to create tags for
   */
  customTagLevels?: number[]; // e.g., [0, -1] = root and leaf only
}
```

### 2. Implementation in Transform Pipeline

```typescript
function createTagsWithDepth(
  fullPath: string,
  strategy: TagDepthStrategy
): string[] {
  const parts = fullPath.split('/');

  switch (strategy) {
    case 'full-path-only':
      return [fullPath]; // Current behavior

    case 'with-parent-tags':
      // Create entity + full path
      return [
        parts[0], // e.g., "--vaultuser1"
        fullPath   // e.g., "--vaultuser1/01-projects/web-dev"
      ];

    case 'all-levels':
      // Create tag for every level
      const tags = [];
      for (let i = 1; i <= parts.length; i++) {
        tags.push(parts.slice(0, i).join('/'));
      }
      return tags;

    case 'custom':
      // User specifies which levels
      return this.options.customTagLevels!.map(level => {
        const idx = level < 0 ? parts.length + level : level;
        return parts.slice(0, idx + 1).join('/');
      });
  }
}
```

### 3. UI for Configuration

In rule editor:

```
┌─────────────────────────────────────────┐
│  Tag Depth Strategy                     │
│  ○ Full path only                       │
│  ● With parent tags (recommended)       │
│  ○ All levels (tag explosion warning)  │
│  ○ Custom...                            │
│                                         │
│  Preview:                               │
│    File: VaultUser1/📁 01-Projects/note│
│    Tags: #--vaultuser1                  │
│          #--vaultuser1/01-projects      │
└─────────────────────────────────────────┘
```

---

## Edge Cases to Consider

### 1. Tag Conflicts Across Entities

**Scenario**: Both VaultUser1 and VaultUser2 have `📁 01 - Projects`

**With `all-levels` strategy**:
- File in VaultUser1/01-Projects gets: `#01-projects`, `#--vaultuser1/01-projects`
- File in VaultUser2/01-Projects gets: `#01-projects`, `#--vaultuser2/01-projects`

**Question**: Should `#01-projects` show files from BOTH entities?
**Answer**: Probably yes - that's the point of category-level filtering!

**But what if**: Root level also has `📁 01 - Projects`?

**Solution**: Root-level categories get no prefix, entity categories get entity prefix:
- Root: `#01-projects`
- VaultUser1: `#--vaultuser1/01-projects` (no standalone `#01-projects`)

This avoids conflicts.

### 2. Orphan Tag Removal

**Scenario**: File moves from `VaultUser1/01-Projects` to `VaultUser2/02-CyberNews`

**With `with-parent-tags` strategy**:

**Old tags**:
- `#--vaultuser1`
- `#--vaultuser1/01-projects`

**New tags**:
- `#--vaultuser2`
- `#--vaultuser2/02-cybernews`

**Question**: Should we remove `#--vaultuser1` but keep it if file is still under VaultUser1 in another category?

**Solution**: Only remove tags that match the pattern AND aren't still valid:
- Check if file is still under `VaultUser1/` anywhere
- If no, remove `#--vaultuser1`
- If yes, keep it

This requires checking ALL rules, not just the current one.

### 3. Bidirectional Sync Ambiguity

**Scenario**: Tag-to-folder sync with `#--vaultuser1/01-projects`

**Question**: Does this mean:
- Move to `VaultUser1/📁 01 - Projects/`?
- Or just add tags, don't move?

**With `with-parent-tags` strategy**:

If file has ONLY `#--vaultuser1`:
- Not enough info to determine folder (which category?)
- Don't move, or prompt user

If file has `#--vaultuser1/01-projects`:
- Clear target: `VaultUser1/📁 01 - Projects/`
- Move confidently

**Solution**: For tag-to-folder, only use the most specific tag (longest path).

---

## Recommended Defaults

### For Entity-Based Organization

**Recommended strategy**: `with-parent-tags`

**Why**:
- Balances tag count and functionality
- Entity tag is useful for filtering
- Full path tag is precise
- Avoids tag explosion

**Example**:
```json
{
  "tagDepthStrategy": "with-parent-tags",
  "tags": [
    "#--vaultuser1",
    "#--vaultuser1/01-projects/web-dev"
  ]
}
```

### For Flat Organization (No Entities)

**Recommended strategy**: `full-path-only`

**Why**:
- Simpler is better
- One tag per rule
- No ambiguity
- Tag pane stays clean

**Example**:
```json
{
  "tagDepthStrategy": "full-path-only",
  "tags": [
    "#01-projects/web-dev"
  ]
}
```

### For Power Users

**Recommended strategy**: `custom`

**Why**:
- Maximum control
- Can optimize for specific workflows
- Avoid unused intermediate tags

**Example** (entity + leaf only):
```json
{
  "tagDepthStrategy": "custom",
  "customTagLevels": [0, -1],
  "tags": [
    "#--vaultuser1",                    // level 0
    "#--vaultuser1/01-projects/web-dev" // level -1 (last)
  ]
}
```

---

## Implementation Priority

### Phase 1 (MVP): Full Path Only
- Current behavior
- No changes needed
- Document limitation

### Phase 2 (Quick Win): With Parent Tags
- Add `tagDepthStrategy` option
- Implement `with-parent-tags` mode
- Update UI
- Test with entities

### Phase 3 (Complete): All Strategies
- Implement `all-levels` mode
- Implement `custom` mode
- Add preview in rule editor
- Comprehensive testing

---

## Testing Strategy

### Test Scenarios

1. **Single level depth**
   - File: `VaultUser1/note.md`
   - Tags: `#--vaultuser1`

2. **Two level depth**
   - File: `VaultUser1/📁 01 - Projects/note.md`
   - Tags: Depends on strategy

3. **Deep nesting**
   - File: `VaultUser1/📁 01 - Projects/Web/React/Components/note.md`
   - Tags: Test all strategies

4. **Cross-entity conflicts**
   - Both VaultUser1 and VaultUser2 have same categories
   - Ensure tags don't conflict
   - Test filtering works correctly

5. **Tag-to-folder with partial tags**
   - File has `#--vaultuser1` but not full path
   - Should not move (ambiguous)
   - Or prompt user

6. **Orphan tag removal**
   - File moves between entities
   - Old entity tag removed only if no longer valid
   - Test edge cases

---

## User Impact

### For Users Without Entities

**Impact**: None - use `full-path-only` (current behavior)

### For Users With Entities

**Impact**: Choose strategy based on needs:
- Want to filter by entity? Use `with-parent-tags`
- Want maximum flexibility? Use `all-levels` (accept tag volume)
- Want precise control? Use `custom`

### Migration Path

**For existing users**:
1. Default to `full-path-only` (backwards compatible)
2. Show banner: "New feature: Hierarchical tag support! See docs"
3. Provide migration guide for upgrading

---

## Related Features

This connects to several other features:

1. **Wildcard Matching** (WILDCARD_MATCHING_CHALLENGE.md)
   - Once we have wildcards, entities auto-generate
   - Tag depth strategy applies to all generated rules

2. **Conditional UI Fields**
   - Show `tagDepthStrategy` only for `folder-to-tag` or `bidirectional`
   - Hide for `tag-to-folder` (doesn't apply)

3. **Rule Analytics**
   - Show tag count per file for each strategy
   - Warn if `all-levels` creates 10+ tags per file

4. **Bulk Operations**
   - When changing strategy, offer to re-sync entire vault
   - Show preview of tag changes before applying

---

## Status

**Current**: Documented, not implemented
**Priority**: Medium-High (blocks effective entity usage)
**Complexity**: Medium (requires tag management refactor)
**Dependencies**: None (can implement independently)
**Recommended**: Implement before or alongside wildcard matching

---

## Questions for User

1. Which strategy do you prefer for testing?
   - `full-path-only` (simpler)
   - `with-parent-tags` (recommended)
   - `all-levels` (most flexible)

2. For cross-entity categories:
   - Should `#01-projects` show files from all entities?
   - Or only use entity-scoped tags?

3. For orphan tag removal:
   - Remove entity tag immediately when file moves?
   - Or check if still valid first?

Let me know your preferences and I'll update the rule pack accordingly!
