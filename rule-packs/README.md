# Rule Packs

Rule packs are pre-configured sets of sync rules that you can import into your vault. They represent common workflows and organizational methods.

## Available Packs

### SEACOW(r) Framework (`seacow-cyberbase.json`)
Knowledge organization using the System, Entity, Activities (Capture, Output, Work, relation) framework.

**Best for:**
- Complex personal knowledge management
- Multiple audience publishing
- Separating capture, work, and output phases
- Entity-based organization (per-person/team workspaces)

**Rules:** 6
- CAPTURE: Clip folder sync (-clip/)
- CAPTURE: Inbox flat tag (-inbox)
- ENTITY: Cybersader work structure (--cybersader/)
- OUTPUT: Public Taxonomy structure (_publicTaxonomy/)
- OUTPUT: Main public facing (_/)
- SYSTEM: Templates and config (/)

---

## Using Rule Packs

### Method 1: Via UI (Coming Soon)
1. Open plugin settings
2. Click "Browse Rule Packs"
3. Select a pack
4. Review rules
5. Click "Import"

### Method 2: Manual Import
1. Open plugin settings
2. Click "Import Rules"
3. Paste contents of rule pack JSON file
4. Click "Import"

---

## Rule Pack Format

Rule packs are JSON files with the following structure:

```json
{
  "name": "Pack Name",
  "description": "Brief description of the organizational method",
  "version": "1.0.0",
  "author": "Author Name",
  "rules": [
    {
      "id": "unique-rule-id",
      "name": "Rule Display Name",
      "description": "What this rule does",
      "enabled": true,
      "priority": 1,
      "direction": "folder-to-tag" | "tag-to-folder" | "bidirectional",
      "tagPattern": "^tag/pattern",
      "tagEntryPoint": "tag/entry",
      "tagTransforms": {
        "caseTransform": "kebab-case",
        "emojiHandling": "keep",
        "numberPrefixHandling": "keep"
      },
      "folderPattern": "^Folder/Pattern",
      "folderEntryPoint": "Folder/Entry",
      "folderTransforms": {
        "caseTransform": "Title Case",
        "emojiHandling": "keep",
        "numberPrefixHandling": "keep"
      },
      "options": {
        "createFolders": true,
        "addTags": true,
        "removeOrphanedTags": false,
        "syncOnFileCreate": true,
        "syncOnFileMove": true,
        "syncOnFileRename": true,
        "onConflict": "prompt",
        "tagSpecificity": "narrower",
        "removeSourceTag": false,
        "keepDestinationTag": true,
        "keepRelationTags": true,
        "handleFolderNote": false,
        "moveAttachments": true
      }
    }
  ],
  "notes": [
    "Additional context",
    "Usage tips",
    "Important considerations"
  ]
}
```

---

## Field Reference

### Pack Metadata

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Display name of the pack |
| `description` | string | Yes | Brief description (1-2 sentences) |
| `version` | string | Yes | Semantic version (e.g., "1.0.0") |
| `author` | string | Yes | Pack creator |
| `rules` | array | Yes | Array of rule objects |
| `notes` | array | No | Additional documentation |

### Rule Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (kebab-case) |
| `name` | string | Yes | Display name |
| `description` | string | No | What this rule does |
| `enabled` | boolean | Yes | Whether rule is active by default |
| `priority` | number | Yes | Lower = higher priority |
| `direction` | enum | Yes | "folder-to-tag", "tag-to-folder", or "bidirectional" |
| `tagPattern` | string | No | Regex pattern for matching tags |
| `tagEntryPoint` | string | No | Base tag path |
| `tagTransforms` | object | No | Tag transformation config |
| `folderPattern` | string | No | Regex pattern for matching folders |
| `folderEntryPoint` | string | No | Base folder path |
| `folderTransforms` | object | No | Folder transformation config |
| `options` | object | Yes | Sync behavior options |

### Transform Config

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `caseTransform` | enum | "none", "snake_case", "kebab-case", "camelCase", "PascalCase", "Title Case", "lowercase", "UPPERCASE" | How to transform case |
| `emojiHandling` | enum | "keep", "strip" | What to do with emojis |
| `numberPrefixHandling` | enum | "keep", "strip", "extract" | How to handle number prefixes |
| `customTransforms` | array | [{pattern, replacement, flags}] | Custom regex transforms |

### Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `createFolders` | boolean | true | Create folders if they don't exist (tag-to-folder only) |
| `addTags` | boolean | true | Add tags to files (folder-to-tag) |
| `removeOrphanedTags` | boolean | false | Remove tags no longer matching folder (folder-to-tag only) |
| `syncOnFileCreate` | boolean | true | Sync when new file created |
| `syncOnFileMove` | boolean | true | Sync when file moved |
| `syncOnFileRename` | boolean | true | Sync when file renamed |
| `onConflict` | enum | "prompt" | "prompt", "auto-resolve", or "skip" |
| `tagSpecificity` | enum | "narrower" | "broader" or "narrower" for conflict resolution |
| `removeSourceTag` | boolean | false | Remove source tag when moving (tag-to-folder) |
| `keepDestinationTag` | boolean | true | Keep destination tag after moving |
| `keepRelationTags` | boolean | true | Preserve flat keyword tags |
| `handleFolderNote` | boolean | false | Handle folder note systems |
| `moveAttachments` | boolean | true | Move attachments with file |

---

## Creating a Custom Rule Pack

### Step 1: Plan Your Structure

Document your organizational method:
- What are the main categories/sections?
- How do tags map to folders?
- What transformations are needed?
- What should happen on conflicts?

### Step 2: Create Rules

For each mapping relationship, define:
1. Direction (folder-to-tag, tag-to-folder, or bidirectional)
2. Pattern matching (regex for both sides)
3. Entry points (base paths)
4. Transformations (case changes, emoji handling, etc.)
5. Options (when to sync, conflict handling, etc.)

### Step 3: Test Thoroughly

1. Create a test vault
2. Add sample files and folders
3. Import your rule pack
4. Test each rule individually
5. Test interactions between rules
6. Document edge cases

### Step 4: Document

Add helpful notes:
- Explain the organizational philosophy
- Provide usage examples
- List important considerations
- Include troubleshooting tips

### Step 5: Share (Optional)

If your rule pack would benefit others:
1. Clean up and polish
2. Add comprehensive documentation
3. Test with fresh vault
4. Submit PR to repository
5. Include screenshots/examples

---

## Example Workflow Packs (Coming Soon)

### PARA Method
Projects, Areas, Resources, Archives - Tiago Forte's productivity system.

### Zettelkasten
Slip-box method for knowledge work: Inbox, Literature, Permanent, Fleeting notes.

### Johnny Decimal
Numeric hierarchical organization (00-09 Admin, 10-19 Projects, etc.).

### LYT (Linking Your Thinking)
Home notes, Maps of Content, and emergent folder structure.

### ACE
Atlas (maps), Calendar (time), Efforts (projects).

### P.A.R.A. + C.O.D.E.
Combined method: Projects/Areas/Resources/Archives + Collect/Organize/Distill/Express.

---

## Best Practices

### Rule Priority

Lower numbers = higher priority. Consider this ordering:

1. **High priority (1-10)**: Time-sensitive capture (inbox, clips)
2. **Medium priority (11-50)**: Active work (projects, entities)
3. **Low priority (51-100)**: Output and archives
4. **Lowest priority (101+)**: System and templates

### Conflict Handling

- **Capture rules**: Use "prompt" (user decides)
- **Work rules**: Use "auto-resolve" with narrower specificity
- **Output rules**: Use "auto-resolve" with broader specificity
- **System rules**: Use "skip" (don't move system files)

### Transformation Guidelines

- **Capture**: Minimal transforms (preserve original format)
- **Work**: Standard case transforms (e.g., kebab-case to Title Case)
- **Output**: Strict formatting (consistent, publishable)
- **System**: Strict naming (lowercase, kebab-case)

### Tag Patterns

Use anchored patterns to prevent over-matching:

```
Good: "^-clip/"      (matches -clip/articles but not my-clip/stuff)
Bad:  "-clip/"       (matches anything containing -clip/)
```

### Folder Patterns

Be specific with folder paths:

```
Good: "^Projects/"          (matches Projects/* but not Archived/Projects/*)
Bad:  "Projects"            (matches anywhere)
```

---

## Troubleshooting

### Rules Not Applying

1. Check rule is enabled
2. Verify pattern matches your tags/folders
3. Check priority (lower priority rules may be blocked)
4. Look for conflicting rules
5. Enable debug mode and check logs

### Conflicts

1. Review priority order
2. Adjust `onConflict` setting
3. Use `tagSpecificity` for automatic resolution
4. Consider making patterns more specific

### Performance

1. Limit rule count (< 20 recommended)
2. Use specific patterns (less computation)
3. Disable unused rules
4. Avoid bidirectional rules if possible

### Unexpected Behavior

1. Enable debug mode
2. Test rules one at a time
3. Check transformation preview
4. Review folder/tag structure
5. Consult documentation

---

## Contributing

We welcome community-contributed rule packs!

**Requirements:**
- Well-documented
- Thoroughly tested
- Follows format specification
- Includes usage examples
- Has clear licensing

**Submission Process:**
1. Fork repository
2. Add rule pack to `rule-packs/`
3. Update this README
4. Submit pull request
5. Respond to review feedback

---

## License

All rule packs in this directory are licensed under MIT unless otherwise specified.

You are free to:
- Use rule packs in your vault
- Modify them for personal use
- Share modifications
- Create derivative works

Attribution appreciated but not required.
