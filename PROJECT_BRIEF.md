# Dynamic Tags & Folders Plugin - Complete Project Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Plugin Names & Concept](#plugin-names--concept)
3. [Philosophy & Vision](#philosophy--vision)
4. [Core Concepts](#core-concepts)
5. [Technical Requirements](#technical-requirements)
6. [Related Existing Plugins](#related-existing-plugins)
7. [Development Environment](#development-environment)
8. [Implementation Plan](#implementation-plan)

---

## Project Overview

**Goal**: Build an Obsidian plugin that creates bidirectional mapping between folder paths and tags, solving the limitations of hierarchical file systems for knowledge management.

**Key Innovation**: Unlike existing plugins (like Auto Note Mover) that use exact string matching, this plugin uses regex patterns and transformation templates to flexibly map between folder structures and tag hierarchies.

**Primary Use Case**: Enable polyhierarchical organization where notes can be organized by folders (for file explorer navigation) while maintaining flexible, overlapping tag-based categorization that better represents knowledge structures.

---

## Plugin Names & Concept

### Potential Names
- Dynamic Tags & Folders
- Dynamic Tag & Folder Mapper
- Tag & Folder Mapper

### Description Keywords
- Path-based-tagging
- automatic-tagging
- organization
- combine the use of tags and folders
- Polyhierarchy

### Core Concept

The idea is to have a **bidirectional system** where you can define rules to translate a folder path (e.g. `person1/Projects/Project 1`) into a tag (e.g. `#projects/project1`) and vice versa.

**Key Points:**

- **Dual Mapping:**
    - **Folder → Tag:** Convert folder names into tags using regex patterns and transformation templates.
    - **Tag → Folder:** Use similar rules in reverse, letting you determine where a note should live based on its tags.

- **Transformation Flexibility:**
    Beyond simple snake-case conversion, allow regex-based replacements and templating (e.g., using `$1` for captured groups) so that users can handle variations in naming conventions.

- **Priority & Conflict Handling:**
    When rules overlap (a note may belong to multiple folders/tags), let users set priorities so the most specific or preferred rule "wins." You can also offer options like prompting the user or preserving multiple tags.

- **Additional Features:**
    Consider special cases such as handling untagged notes, folder notes (where a folder might have an associated note), and exclusions using regex or glob patterns.

---

## Philosophy & Vision

### The Knowledge Communication Problem

As humans, we don't have perfect intellect and our memory is limited. We have to put faith in what we've already done and in something higher. In order to use technology and interface with it, we have to communicate with it - a lot and with high volume.

Most interfaces with applications have limits in how you can interact with that solution, which makes sense because they're designed to solve specific problems. However, most of our work takes place in our minds and hearts, where we have limited memory and ability to see backwards with every decision we make.

### The Obsidian Opportunity

Obsidian is a good tool for knowledge work because it can grow with you without being limited like other systems. However, one of the big problems is how we represent knowledge using file and folder systems - the same structures that operating systems use.

**The Limitation**: We are often limited by the file and folder system structures. This is the same system that Obsidian uses in the background. Libraries try to represent knowledge better, but they're literally limited by physical space where a person has to walk in a sequential manner to navigate.

### The Solution Vision

My idea is that if we use knowledge platforms like Obsidian to their fullest, we can communicate our knowledge and make it really consumable, functional, and useful to all sorts of entities. Then we're not limited by our memory but only by how much we can communicate to technology.

**Bridging System Components**: Build bridges between the different system components used to structure knowledge platforms and information. In Obsidian, we have:
- **Tags**: Can have nested hierarchies, but don't scale well in super large systems
- **Folders**: Most limiting, but necessary for file system storage
- **Links**: Scale really large, but slow to input and hard to build up

### The Dynamic Folder & Tag Plugin Role

This plugin helps solve the fundamental problem: **everything has to be stored in folders**, yet folders provide strict hierarchies that don't match how knowledge actually works.

By creating intelligent mappings between tags and folders with regex patterns and priorities, we can:
1. Store files in folder structures that make sense for specific audiences/use cases
2. Use tags to represent the actual, flexible, overlapping knowledge structure
3. Automatically sync between the two based on user-defined rules
4. Handle the polyhierarchical nature of knowledge while working within file system constraints

---

## Core Concepts

### 1) Dual Mapping: Folder ↔ Tag

We need a way to represent these relationships with syntax that accounts for the nested and hierarchical nature of tags or folders and allows you to define entry points at either side (tag or folder) into those ultimate hierarchies.

**Example**: Match a tag like `#project/project1` to a folder like `person1/project/project1`

**Key Challenge**: The defined rules shouldn't need explicit perfect matches and should use syntax, patterns like regex, or templating to make the configuration logic concise and intuitive.

**Fundamental Requirement**: We have to have both directions figured out and each logical piece has to work in both directions. There must be mechanisms or logic to make sure the syntax is correct.

**Approach**: Transferring between the two requires deterministic logic (not AI-based). Snake-case and regex replacements are options.

#### Tags to Folder

A rule/definition line could have:

- **Tag regex** - to match or wildcard glob syntax
    - Typically you'll use this to match to the start of a tag

- **Tag to folder transformations**
    - Case transformations: snake to spaces capitalized, etc. - common default options
    - Allow a regex replace per path level (separately for each folder in a depth like "/parent/child")

- **Folder path entry point** - under what folder to establish matching transformed tags
    - Allow a flatten setting with a depth value to flatten upwards
    - Using regex groups for tag regex matches like `$1$2`

#### Folder to Tags

Certain Tag to Folder configs/rules will make matching up the directions difficult unless deterministic with specific case transformations by default.

The options will be similar to Tag to Folders:
- Folder matching with regex or glob for top level
- Folder transformations with default case transformations along with custom regex replace that can run at each path level
- Tag entry point

### 2) Customizable Transformations

- Using a custom piping syntax would be difficult - not recommended
- Use defaults (like case transformations) or regex (one or the other likely)
- Keep it simple and deterministic

### 3) Priority, Logic, & Overlapping Hierarchies

**Priority System:**
- For priority, have rules/definitions sorted like how Auto Note Mover does
- Nesting and drop-down for organizing rules could be helpful
- Allow setting to prompt user to move with button to ignore for future notes

**Advanced Settings per Rule:**
- Key:value settings like ignore or ask user for prompt
- Option to retain/add conflicting tags on conflicts
- Option to remove tag when moving from a folder (remove source folder tag)
- Option to prompt for keeping or removing tags

**Commands & Automation:**
- Make many things as commands to allow for hotkeys and automation with other tools
- Only run after leaving active file
- Only run on save
- Command to delete conflicting tags (lower priority)
- Options to favor broader or narrower tag paths (e.g. `#project` vs `#project/1`)

### 4) Handling Special Cases & Additional Features

**Special Cases:**
- How to handle untagged notes
- Handling for folder note based systems (move the folder)
  - Use a function to look at the vault and figure out if you're using folder notes
  - Count how many folder notes you have (folder matching note name)
  - Account for attachments stored adjacent to parent folder instead of in it
- Folder exclusions - allow regex here too

**Integration Points:**
- API that QuickAdd, Templater, or Modal Forms could access to help decide where a new note should go

**Import/Export:**
- Ability to export settings as JSON or import them with copy/paste

---

## Technical Requirements

### Core Functionality

1. **Rule Definition System**
   - User-friendly UI for defining mapping rules
   - Support for regex patterns in both directions
   - Template system for transformations (e.g., `$1`, `$2` for regex groups)
   - Default case transformation options (snake_case, Title Case, etc.)
   - Priority ordering system

2. **Bidirectional Sync Engine**
   - Watch for tag changes → move files to appropriate folders
   - Watch for file moves → update tags accordingly
   - Conflict resolution based on priority rules
   - Option for user prompts on conflicts

3. **Settings Interface**
   - Visual rule builder
   - Rule testing/preview functionality
   - Import/export settings as JSON
   - Per-rule advanced settings

4. **Triggers & Execution**
   - Run on file save
   - Run when leaving active file
   - Manual command execution
   - Batch processing option for existing files

5. **Special Handling**
   - Untagged notes handling
   - Folder notes detection and handling
   - Attachment management
   - Exclusion patterns

### Architecture Requirements

**Need in README.md:**
- Architecture of the code
- Logical flow of components
- Component modeling
- How to get started
- How to contribute

### Development Environment

**Current Setup:**
- Using bun and husky for development
- Reference: See Obsidian Plugin Development Quickstart documentation

**Tech Stack:**
- TypeScript (Obsidian plugin standard)
- Obsidian API
- Regex engine for pattern matching

---

## Related Existing Plugins

### Combining Tags and Folders/Notes

1. **[obsidian-lazy-cached-vault-load](https://github.com/d7sd6u/obsidian-lazy-cached-vault-load)**
   - Has concept of folder/index notes and "ftags"
   - Relevant for understanding folder note integration

2. **[obsidian-auto-note-mover](https://github.com/farux/obsidian-auto-note-mover)**
   - Closest existing solution
   - **Limitation**: Uses exact string matching, not regex patterns
   - **Our improvement**: Flexible regex-based rules with transformations

3. **[AutoMover](https://github.com/al0cam/AutoMover)**
   - Moves files with specified names into the same folder
   - Basic functionality we're expanding upon

### Combining Tags and Links

4. **[Tag Wrangler](https://www.obsidianstats.com/plugins/tag-wrangler)**
   - Rename tags functionality
   - Can represent tags as notes then link to them
   - **Limitation**: Doesn't scale well

### Combining Folders and Links

5. **[Waypoint](https://github.com/IdreesInc/Waypoint)**
   - Generates dynamic MOCs in folder notes
   - Enables folders to show up in graph view
   - Removes need for messy tags (different philosophy)

6. **[Folder Notes](https://github.com/LostPaul/obsidian-folder-notes)**
   - Create notes within folders
   - Accessible without collapsing the folder

### Other Relevant Plugins

- **Folder by Tags Distributor** - doesn't handle unstructured notes other than root
- **MyThesaurus** - affects structure
- **TagFolder** - tag/folder relationship
- **Tag Buddy** - tag management
- **Quick Tagger** - quick tagging
- **Tag Page MD** - tag pages
- **Graph Nested Tags** - visualize nested tags
- **Index Notes** - auto-generate index blocks based on tags
- **Automatic Tags** - basic automatic tagging

---

## Development Environment

### Setup

**Build Tools:**
- **bun**: Fast JavaScript runtime and package manager
- **husky**: Git hooks for automated workflows

**Reference Documentation:**
See: `Obsidian Plugin Development Quickstart` in cyberbase vault for:
- Testing procedures
- Plugin development information
- Environment documentation

### Required Dependencies

```json
{
  "obsidian": "latest",
  "typescript": "^4.x",
  "@types/node": "latest"
}
```

### File Structure

```
dynamic-tags-folders-plugin/
├── .claude/
│   └── CLAUDE.md
├── src/
│   ├── main.ts
│   ├── settings.ts
│   ├── ruleEngine.ts
│   ├── syncEngine.ts
│   ├── transformations.ts
│   └── ui/
│       ├── SettingsTab.ts
│       └── RuleBuilder.ts
├── manifest.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Implementation Plan

### Phase 1: Core Infrastructure (MVP)

**Goal**: Basic one-directional folder → tag mapping with simple transformations

1. **Setup Plugin Scaffold**
   - Initialize Obsidian plugin structure
   - Setup TypeScript, bun, husky
   - Create basic manifest and settings

2. **Rule Data Structure**
   - Define TypeScript interfaces for rules
   - Create rule storage in plugin settings
   - JSON schema for import/export

3. **Simple Transformation Engine**
   - Implement snake_case conversion
   - Implement Title Case conversion
   - Basic regex pattern matching

4. **Folder → Tag Sync**
   - Watch file events
   - Extract folder path
   - Apply rules to generate tags
   - Write tags to frontmatter

5. **Settings UI**
   - Basic rule list display
   - Add/edit/delete rules
   - Rule priority ordering

### Phase 2: Bidirectional Sync

**Goal**: Enable tag → folder direction and conflict handling

1. **Tag → Folder Sync**
   - Watch tag changes in files
   - Apply reverse transformation rules
   - Move files to target folders

2. **Conflict Resolution**
   - Implement priority system
   - User prompt for conflicts
   - Option to keep multiple tags

3. **Advanced Transformations**
   - Regex groups (`$1`, `$2`)
   - Per-path-level transformations
   - Custom transformation templates

### Phase 3: Advanced Features

**Goal**: Special cases and integrations

1. **Special Handling**
   - Untagged notes logic
   - Folder notes detection
   - Attachment management
   - Exclusion patterns

2. **Integration API**
   - Public API for QuickAdd
   - Templater integration
   - Modal Forms support

3. **Execution Control**
   - Trigger on save
   - Trigger on file leave
   - Batch processing command
   - Manual execution commands

### Phase 4: Polish & Documentation

**Goal**: Production-ready plugin

1. **Testing**
   - Unit tests for transformations
   - Integration tests for sync
   - Test with dummy vault
   - Edge case testing

2. **Documentation**
   - Comprehensive README
   - Architecture diagrams
   - User guide
   - Contribution guidelines
   - Code documentation

3. **Performance**
   - Optimize for large vaults
   - Debouncing and throttling
   - Background processing

4. **UI/UX**
   - Rule preview/testing
   - Better visual feedback
   - Error messages
   - Success notifications

---

## Testing Strategy

### Test Vault Setup

Create a dummy vault with:
- Multiple folder hierarchies
- Various naming conventions (spaces, underscores, capitals)
- Nested folders at different depths
- Folder notes
- Attachments
- Untagged notes
- Notes with multiple tags

### Test Scenarios

1. **Basic Folder → Tag**
   - Single level folders
   - Nested folders (2-3 levels)
   - Special characters in folder names
   - Case transformations

2. **Basic Tag → Folder**
   - Single tag
   - Nested tags
   - Multiple tags (conflict scenarios)

3. **Conflict Resolution**
   - Multiple matching rules
   - Overlapping hierarchies
   - Broader vs narrower tags

4. **Special Cases**
   - Untagged notes
   - Folder notes + attachments
   - Excluded folders
   - Very deep hierarchies (5+ levels)

5. **Integration**
   - QuickAdd new note creation
   - File renames
   - Bulk operations
   - Manual tag edits

---

## Success Criteria

### Functional Requirements

✅ User can define folder→tag rules with regex patterns
✅ User can define tag→folder rules with regex patterns
✅ Plugin automatically syncs folder paths to tags
✅ Plugin automatically moves files based on tags
✅ Conflict resolution works based on priorities
✅ Special cases handled (untagged, folder notes, etc.)
✅ Settings can be imported/exported as JSON
✅ Commands available for manual triggering

### Quality Requirements

✅ Works reliably on vaults with 1000+ files
✅ No data loss or corruption
✅ Clear error messages for rule conflicts
✅ Intuitive UI for rule configuration
✅ Comprehensive documentation
✅ Clean, maintainable code architecture

### User Experience

✅ Setup takes less than 5 minutes for basic use case
✅ Rules are easy to understand and test
✅ Plugin doesn't slow down Obsidian
✅ User always understands what the plugin will do
✅ Undo/rollback capability for bulk operations

---

## Additional Context

### The Fundamental Problem

**Folders**: Hierarchical, limited, necessary for storage
**Tags**: Flexible, overlapping, better for knowledge representation
**Links**: Scalable, but slow to create manually

This plugin bridges the gap between what's necessary (folders for file system) and what's ideal (tags for knowledge structure).

### Design Philosophy

1. **Deterministic over AI**: Use regex and rules, not AI inference
2. **User Control**: Always let user define and understand the rules
3. **Flexible but Simple**: Powerful regex, but sensible defaults
4. **Safe Operations**: Preview, confirm, and be able to undo
5. **Integration Friendly**: Provide APIs for other plugins

---

## Next Steps

1. ✅ Read and understand existing Auto Note Mover source code
2. ⬜ Set up development environment with bun and husky
3. ⬜ Create dummy test vault with diverse scenarios
4. ⬜ Implement Phase 1 MVP
5. ⬜ Test with dummy vault
6. ⬜ Iterate based on real-world usage
7. ⬜ Implement subsequent phases
8. ⬜ Publish to Obsidian community plugins

---

## Questions to Resolve

1. **Rule Syntax**: What's the most intuitive way for users to define regex patterns and transformations?
2. **Performance**: How to handle large vaults (10k+ files) efficiently?
3. **Migration**: How to help users migrate from Auto Note Mover?
4. **Defaults**: What default rules would be most useful?
5. **UI**: What's the best way to visualize folder↔tag mappings?

---

## Resources

- **Obsidian API**: https://docs.obsidian.md/
- **Auto Note Mover**: https://github.com/farux/obsidian-auto-note-mover
- **Obsidian Plugin Development Guide**: https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin
- **TypeScript**: https://www.typescriptlang.org/

---

**Last Updated**: 2025-11-30
**Status**: Planning Phase
**Primary Contact**: cybersader

