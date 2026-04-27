---
title: Roadmap
description: Planned features and enhancements
sidebar:
  order: 1
---


This document tracks planned features, UI improvements, and enhancement ideas for the Dynamic Tags & Folders plugin.

## Immediate UI Improvements

### 1. Conditional Form Fields Based on Direction

**Problem**: Rule editor currently shows all options regardless of sync direction, which can be confusing.

**Solution**: Show/hide options based on selected direction:

#### Folder-to-Tag Direction
**Show:**
- Folder pattern & entry point
- Folder transformations
- Tag entry point
- Tag transformations
- `addTags` option
- `removeOrphanedTags` option ✅ (only relevant here!)
- `syncOnFileCreate`, `syncOnFileMove`, `syncOnFileRename`
- `keepRelationTags` option

**Hide:**
- `createFolders` option (N/A - folders already exist)
- Folder conflict resolution (folder is the source)

#### Tag-to-Folder Direction
**Show:**
- Tag pattern & entry point
- Tag transformations
- Folder entry point
- Folder transformations
- `createFolders` option
- `syncOnFileCreate`, `syncOnFileMove`, `syncOnFileRename`
- `moveAttachments` option
- `handleFolderNote` option
- `onConflict` dropdown
- `removeSourceTag` option (remove the tag after moving)
- `keepDestinationTag` option

**Hide:**
- `removeOrphanedTags` option (N/A - tags are the source)

#### Bidirectional
**Show:**
- All options (both directions active)
- Clear indication of which options apply to which direction
- Could use tabs or sections: "Folder → Tag Options" and "Tag → Folder Options"

**Implementation Priority**: High (improves UX significantly)

---

### 2. Field Validation & Helpful Hints

**Features:**
- Real-time validation of regex patterns
- Preview of how transformations will work
- Tooltips explaining each option
- Warning icons for potentially conflicting settings
- Examples in placeholder text

**Implementation Priority**: Medium

---

### 3. Rule Testing/Preview

**Features:**
- "Test Rule" button in rule editor
- Shows how rule would process sample files/tags
- Displays transformation steps
- Highlights potential conflicts
- Dry-run mode before actually moving files

**Implementation Priority**: High

---

## New Features

### 1. Default Rule Packs (High Priority)

**Inspiration**: Tasks plugin's preset task formats

**Features:**
- Library of pre-made rule packs for common workflows:
  - **SEACOW(r) Framework** (Capture/Output/Work/Entity/System)
  - **PARA** (Projects/Areas/Resources/Archives)
  - **Zettelkasten** (Inbox/Permanent/Literature/Fleeting)
  - **JD (Johnny Decimal)** (Numeric hierarchies)
  - **Simple Flat to Nested** (Convert flat tags to nested folders)
  - **Emoji-based Organization**
- UI to browse and preview rule packs
- **Confirmation dialog** before importing: "This will add [N] rules to your configuration. Continue?"
- Option to import all rules or select specific ones
- Each pack includes:
  - Name & description
  - Author
  - Version
  - List of rules with explanations
  - Usage notes

**UI Components Needed:**
- "Browse Rule Packs" button in settings
- Modal showing available packs
- Pack details view with preview
- Import confirmation dialog
- Success/error notifications

**File Structure:**
```
rule-packs/
├── seacow-cyberbase.json
├── para-method.json
├── zettelkasten.json
├── johnny-decimal.json
└── README.md (explains pack format)
```

**Implementation Priority**: High

---

### 2. Rule Pack Export/Share

**Features:**
- Export current rules as a rule pack
- Add metadata (name, description, author)
- Share as JSON file
- Community-contributed rule packs repository
- In-app rule pack marketplace/browser

**Implementation Priority**: Medium

---

### 3. Bulk Rule Operations

**Features:**
- Select multiple rules
- Enable/disable in bulk
- Change priority in bulk
- Duplicate rules
- Apply transformations to multiple rules
- Export selected rules

**Implementation Priority**: Low

---

### 4. Rule Groups/Folders

**Features:**
- Organize rules into collapsible groups
- E.g., "SEACOW Rules", "Project Rules", "Archive Rules"
- Drag-and-drop between groups
- Enable/disable entire groups
- Group-level settings that cascade to rules

**Implementation Priority**: Medium

---

### 5. Visual Rule Builder

**Features:**
- Flowchart-style rule creation
- Drag-and-drop components
- Visual pattern matcher
- Live preview of transformations
- Simpler for non-technical users

**Implementation Priority**: Low

---

### 6. Advanced Conflict Resolution

**Features:**
- Custom conflict resolution strategies per rule
- "Always prefer tag X over Y"
- "Merge into multi-folder structure" (using links/aliases)
- "Create disambiguation note"
- Log conflicts for manual review

**Implementation Priority**: Medium

---

### 7. Sync History & Undo

**Features:**
- Track all sync operations
- View history of moves/tag changes
- Undo last sync operation
- Rollback to previous state
- Export sync log

**Implementation Priority**: Medium

---

### 8. Rule Analytics

**Features:**
- Show how many files each rule affects
- Most/least used rules
- Rules with errors or conflicts
- Performance metrics (rule execution time)
- Suggestions for rule optimization

**Implementation Priority**: Low

---

### 9. Template Integration

**Features:**
- API for Templater/QuickAdd
- Helper functions: `getTargetFolder(tags)`, `getTargetTags(folder)`
- Auto-suggest tags based on folder
- Auto-suggest folder based on tags
- Integration with new note creation workflow

**Implementation Priority**: High (mentioned in original requirements)

---

### 10. Batch Processing

**Features:**
- "Apply rules to existing vault" command
- Select scope: entire vault, folder, or tag query
- Show preview of changes before applying
- Progress bar with cancel option
- Summary report after completion

**Implementation Priority**: High

---

### 11. Smart Suggestions

**Features:**
- AI/pattern-based rule suggestions
- "You have many files in folder X with tag Y - create a rule?"
- Detect common patterns in vault
- Suggest rule refinements
- Auto-complete for patterns based on vault structure

**Implementation Priority**: Low

---

### 12. Multi-Vault Support

**Features:**
- Different rule sets per vault
- Import/export vault-specific configs
- Global rules vs. vault-specific rules
- Sync rules across vaults

**Implementation Priority**: Low

---

### 13. Resolution-Engine Improvements — match confidence + rule-group precedence

**Problem**: Today's `findBestMatch` (`src/engine/ruleMatcher.ts:97-117`) sorts matches by `priority` then by `confidence` (specificity tiebreak). The `calculateMatchConfidence` heuristic at `ruleMatcher.ts:156-185` produces a 0..1 score from a regex pattern — but it has known weaknesses:

- Doesn't penalize alternation (`(foo|bar|baz|...)` scores high on length but is *less* specific than a literal segment).
- Anchor awareness is implicit — two patterns differing only in `^foo` vs `(?:^|/)foo` vs `^prefix/foo` score similarly under the current formula despite wildly different actual specificity.
- Slot-count proxy is missing — when path templates land (Phase H), slot count *is* specificity in a clean way, but today's regex-shape heuristic can't see slots.
- Tied scores are common — high tie rate means priority still ends up doing real disambiguation work the heuristic should do.

Also: `findBestMatch` doesn't have a rule-group concept, so multiple third-party rule packs (PARA + JD + SEACOW) can silently collide on the same input.

**Solution** (researched in detail at [Specificity + groups research](/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/)): two combined improvements.

1. **Refine the specificity heuristic.** Promote `calculateMatchConfidence` from tiebreak to primary sort key. Add anchor-awareness (root / under / any-segment bonuses), slot-count handling for future template rules, and refined wildcard/alternation penalties (Formula 3 in the research entry).
2. **Add rule groups (CSS @layer-style).** New optional `group?: string` field on `MappingRule`. Group precedence is configurable per-vault (default derived from SEACOW axes when groups declare axes). The combined algorithm: group precedence wins outright; within a group, specificity sort; priority becomes the manual override tiebreak.

**File-by-file scope** (~150 LOC of production code, ~30 LOC of tests):

- `src/engine/ruleMatcher.ts` — refine `calculateMatchConfidence`, swap sort key in `findBestMatch`, add group-by-precedence layer
- `src/types/settings.ts` — add `group?: string` to `MappingRule`
- `src/types/typed.ts` — add group field to `TypedRuleSpec`
- `src/engine/rulePackLoader.ts` — validate group field; default group from pack ID if missing
- `src/ui/SettingsTab.ts` — drag-to-reorder list of declared groups
- `src/ui/RuleEditorModal.ts`, `src/ui/GuidedRuleEditorModal.ts` — group dropdown; rename "Priority" to "Priority (override)"
- `rule-packs/*.json` — backfill `group` field on PARA/JD/SEACOW packs

**Recommended phasing**: refine `calculateMatchConfidence` first (pure refactor, no behavior change), audit shipped packs to compare new vs old implied ordering, then swap the sort order. Add the group field as a separate phase.

**Implementation Priority**: High — addresses Challenge 01 (rule priority stress test) and Challenge 04 (name collisions across hierarchy) directly.

**Note on item #4 above**: the existing "Rule Groups/Folders" feature (line 159) is a *UI organization* feature — collapsible groups in the rule list for visual structure. It's distinct from the *resolution-engine groups* described here, which are layered partitions in the matching algorithm. Same word, different concepts; both can coexist (resolution-engine groups can drive the UI organization, but they don't have to be the same boundary).

---

## Implementation Phases

### Phase 1: Core Functionality (Current)
- ✅ Transformation engine
- ✅ Rule matching
- ✅ UI components (basic)
- ⏳ Folder-to-tag sync engine
- ⏳ Tag-to-folder sync engine

### Phase 2: UI Polish & Usability
- 🎯 Conditional form fields
- 🎯 Default rule packs
- 🎯 Rule testing/preview
- Field validation
- Better error messages

### Phase 3: Advanced Features
- Template integration (API)
- Batch processing
- Conflict resolution strategies
- Rule groups

### Phase 4: Polish & Community
- Rule pack marketplace
- Analytics
- Sync history
- Visual rule builder

---

## UI Mockup Notes

### Conditional Fields Implementation

```typescript
// In RuleEditorModal.ts
onDirectionChange(direction: RuleDirection) {
  // Show/hide sections based on direction
  if (direction === 'folder-to-tag') {
    this.hideElement(this.createFoldersToggle);
    this.showElement(this.removeOrphanedTagsToggle);
  } else if (direction === 'tag-to-folder') {
    this.showElement(this.createFoldersToggle);
    this.hideElement(this.removeOrphanedTagsToggle);
  } else if (direction === 'bidirectional') {
    this.showElement(this.createFoldersToggle);
    this.showElement(this.removeOrphanedTagsToggle);
    // Maybe add tabs or sections
  }
}
```

### Rule Pack Import Modal

```
┌─────────────────────────────────────────┐
│  Browse Rule Packs                  [X] │
├─────────────────────────────────────────┤
│                                         │
│  Available Packs:                       │
│                                         │
│  [📦 SEACOW(r) Framework]              │
│      6 rules • Capture, Output, Work    │
│      By: Cybersader                     │
│                                         │
│  [📦 PARA Method]                       │
│      4 rules • Projects, Areas, etc.    │
│      By: Tiago Forte                    │
│                                         │
│  [📦 Zettelkasten]                      │
│      5 rules • Slip-box method          │
│      By: Community                      │
│                                         │
│  [+ Import Custom Pack from JSON]       │
│                                         │
└─────────────────────────────────────────┘
```

### Import Confirmation

```
┌─────────────────────────────────────────┐
│  Confirm Import                     [X] │
├─────────────────────────────────────────┤
│                                         │
│  You are about to import:               │
│                                         │
│  Pack: SEACOW(r) Framework              │
│  Rules: 6                               │
│                                         │
│  This will add the following rules:     │
│  • CAPTURE: Clip folder sync            │
│  • CAPTURE: Inbox flat tag              │
│  • ENTITY: Cybersader work structure    │
│  • OUTPUT: Public Taxonomy structure    │
│  • OUTPUT: Main public facing (_/)      │
│  • SYSTEM: Templates and config         │
│                                         │
│  ⚠️  Existing rules will not be        │
│     modified or replaced.               │
│                                         │
│           [Cancel]  [Import Rules]      │
│                                         │
└─────────────────────────────────────────┘
```

---

## Related Design Decisions

### Why Conditional Fields?
1. **Reduces cognitive load**: Users only see relevant options
2. **Prevents errors**: Can't configure irrelevant settings
3. **Clearer intent**: Direction-specific options make purpose obvious
4. **Better mobile UX**: Less scrolling on smaller screens

### Why Default Rule Packs?
1. **Lower barrier to entry**: New users can start quickly
2. **Educational**: Shows examples of well-structured rules
3. **Community building**: Users can share their workflows
4. **Best practices**: Curated packs embody good patterns

### Why Confirmation Dialogs for Import?
1. **Prevents accidents**: Users review before committing
2. **Shows what changes**: Transparency about modifications
3. **Allows cancellation**: User maintains control
4. **Builds trust**: Clear communication about actions

---

## Questions to Resolve

1. **Rule Pack Format**: Should we support multiple formats (JSON, YAML)?
2. **Pack Versioning**: How do we handle updates to rule packs?
3. **Pack Dependencies**: Can one pack reference/extend another?
4. **Conflict Detection**: What if imported rules conflict with existing ones?
5. **Auto-Updates**: Should packs support auto-update from repository?

---

## Technical Implementation Notes: Modular Content in Obsidian Plugins

### The Challenge
Everything ships in `main.js` - no external files. How do we handle rule packs?

### Approaches (from simplest to most complex)

#### 1. **Bundle JSON into main.js** (Recommended for Built-in Packs)
esbuild automatically bundles imported JSON files:

```typescript
// In your code
import seacowPack from './rule-packs/seacow-cyberbase.json';
import paraPack from './rule-packs/para-method.json';

const BUILT_IN_PACKS = [seacowPack, paraPack];
```

Ensure `tsconfig.json` has:
```json
{ "compilerOptions": { "resolveJsonModule": true } }
```

**Pros**: Simple, works out of box, no external dependencies
**Cons**: Built-in packs only, can't add community packs without rebuilding

#### 2. **User-imported JSON files** (For Custom Packs)
Users import JSON files from their vault:

```typescript
// Use Obsidian's Vault API
const file = this.app.vault.getAbstractFileByPath('my-pack.json');
if (file instanceof TFile) {
  const content = await this.app.vault.read(file);
  const pack = JSON.parse(content);
}
```

**Pros**: Users can add custom packs, share via files
**Cons**: User must manage files in vault

#### 3. **Fetch from URL** (For Community Marketplace)
```typescript
const response = await requestUrl({
  url: 'https://raw.githubusercontent.com/user/repo/pack.json'
});
const pack = response.json;
```

**Pros**: Dynamic community packs, auto-updates possible
**Cons**: Requires network, security concerns, URL maintenance

#### 4. **Store in plugin data.json** (Hybrid Approach)
Import once, store in settings:

```typescript
// On import
this.settings.installedPacks.push(importedPack);
await this.saveSettings();

// On load
const allPacks = [...BUILT_IN_PACKS, ...this.settings.installedPacks];
```

**Pros**: Persist user-imported packs, works offline after import
**Cons**: Settings file can grow large

### Recommended Strategy for This Plugin

1. **Phase 1**: Bundle 3-5 built-in packs directly in main.js (SEACOW, PARA, Zettelkasten, etc.)
2. **Phase 2**: Allow users to import custom packs from JSON files in their vault
3. **Phase 3** (optional): Community pack browser fetching from GitHub repo

### Obsidian Plugin Limitations to Consider

- **No external assets**: Everything must be in main.js, manifest.json, or styles.css
- **No server-side**: Plugins run client-side only
- **Sandboxed**: Limited file system access (vault only via API)
- **Mobile compatibility**: Network requests may behave differently
- **Auto-updates**: Only through new plugin releases (version bump)

### How Tasks Plugin Handles Presets

The Tasks plugin bundles "Status Collections" (presets) directly in the code. Users click a button in settings to import them into their configuration. This is the same approach we should use - bundle built-in packs, let users import to their settings.

**Sources:**
- [Obsidian Forum: Support for assets in plugins](https://forum.obsidian.md/t/support-for-assets-in-plugins/25837)
- [esbuild-plugin-obsidian](https://github.com/eth-p/esbuild-plugin-obsidian)
- [Tasks Plugin User Guide](https://publish.obsidian.md/tasks/Introduction)

---

## Community Contributions

To contribute:
1. Create a rule pack following the format in `rule-packs/README.md`
2. Test it thoroughly in your vault
3. Submit PR with pack JSON and documentation
4. Include usage examples and screenshots

---

## Next Steps

1. ✅ Document conditional field logic
2. ✅ Create SEACOW(r) rule pack
3. ⏳ Implement conditional UI fields in RuleEditorModal
4. ⏳ Create rule pack browser modal
5. ⏳ Add import functionality
6. ⏳ Write rule pack format documentation
