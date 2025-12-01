# Claude Code Workflow Guide

This guide addresses the specific workflow and challenges when developing this Obsidian plugin with Claude Code.

## Table of Contents

1. [Documentation Organization](#documentation-organization)
2. [What Claude Code Can and Cannot See](#what-claude-code-can-and-cannot-see)
3. [Conversation Migration](#conversation-migration)
4. [Avoiding Permission Issues](#avoiding-permission-issues)
5. [Alternative Testing Workflows](#alternative-testing-workflows)
6. [Debug Logging Strategy](#debug-logging-strategy)
7. [Best Practices](#best-practices)

---

## Documentation Organization

This project uses a specific structure for LLM-friendly documentation:

### `.claude/` Folder (Internal - NOT in GitHub)

**Purpose**: Personal context, internal notes, files for you to respond to during development

**What goes here:**
- Personal Q&A and feedback (e.g., `RESPONSE_TO_FEEDBACK.md`)
- Development notes specific to your vault setup
- Internal implementation plans with personal context
- Draft documentation that references personal file paths
- Conversation context you want preserved but not shared

**Excluded from GitHub**: The `.claude/` folder is in `.gitignore`

### Root Folder - ALL CAPS Files (Public - FOR GitHub)

**Purpose**: Useful documentation for other developers and their LLMs

**What goes here:**
- `CLAUDE_CODE_WORKFLOW.md` - This file! Workflow guidance for LLM development
- `ENVIRONMENT_SETUP.md` - Setup instructions for any developer
- `TESTING_GUIDE.md` - How to test the plugin
- `CONTRIBUTING.md` - Standard GitHub contribution guidelines
- `README.md` - Standard GitHub readme

**Benefits:**
- All caps makes these files obvious and easy to find
- Other developers using Claude Code (or other LLMs) can benefit from your workflow
- Generic examples (no personal paths or vault-specific details)
- Helps establish best practices for Obsidian plugin development with AI

### Rule of Thumb

Ask yourself: **"Would another developer using an LLM find this helpful?"**
- **Yes** → Root folder (ALL CAPS filename)
- **No** (personal context) → `.claude/` folder

---

## What Claude Code Can and Cannot See

### What I CAN See ✅

- **File contents**: Any file you ask me to read or that I read during development
- **Command output**: Output from bash commands I run (npm, bun, tsc, git, etc.)
- **Test results**: Output from `bun test`, TypeScript compilation errors
- **Build output**: esbuild errors and warnings
- **File structure**: Directory listings, file searches
- **Log files**: If the plugin writes to log files, I can read them

### What I CANNOT See ❌

- **Obsidian Developer Console**: I cannot see `console.log()` output when you run Obsidian
- **Obsidian UI**: I cannot see the actual plugin UI or how it renders
- **Runtime behavior**: I cannot see how the plugin behaves when you interact with it
- **Obsidian's internal state**: Vault files, metadata cache, etc. (unless you share them)
- **Your screen**: I cannot see screenshots unless you explicitly share them

### Implications

Because I cannot see Obsidian's console:

1. **You need to report errors**: Copy console errors/warnings and paste them to me
2. **Debug logs should write to files**: We can set up file-based logging I can read
3. **UI testing is manual**: You'll need to test the UI and report what you see
4. **Integration testing requires your input**: You'll need to describe behavior

---

## Conversation Migration

Sometimes you need to move a Claude Code conversation to a different directory (e.g., to avoid permission issues or switch environments).

### The Gist Approach

Based on [gwpl's conversation migration script](https://gist.github.com/gwpl/e0b78a711b4a6b2fc4b594c9b9fa2c4c), here's how to migrate a conversation:

### Step 1: Locate Your Conversation

Claude Code stores conversations in `~/.claude/conversations/`.

```bash
# List recent conversations
ls -lt ~/.claude/conversations/ | head -10

# Find conversations by looking at .claude.json
cat ~/.claude.json | grep -A 5 '"currentDirectory"'
```

### Step 2: Identify the Conversation ID

Each conversation has a unique ID. Find it by:

```bash
# Your current conversation ID is in your working directory
cat .claude.json 2>/dev/null | grep conversationId

# Or check Claude Code's main config
cat ~/.claude/.claude.json | grep conversationId
```

### Step 3: Copy Conversation to New Directory

```bash
# Example: Moving from Windows path to WSL home
OLD_DIR="/mnt/c/Users/YourUsername/Documents/vault/plugin_development/dynamic-tags-folders-plugin"
NEW_DIR="$HOME/projects/dynamic-tags-folders-plugin"

# Create new directory
mkdir -p "$NEW_DIR"

# Copy project files (not node_modules!)
cd "$OLD_DIR"
rsync -av --exclude='node_modules' --exclude='.git' . "$NEW_DIR/"

# Or use git clone if it's a repo
cd "$HOME/projects"
git clone <repo-url> dynamic-tags-folders-plugin
```

### Step 4: Start Fresh in New Directory

Instead of migrating the conversation (which is complex), it's often simpler to:

1. **Summarize the current state** in a message to me
2. **Start a new conversation** in the new directory
3. **Reference the summary** so I have context

Example summary template:

```
I'm continuing work on the Obsidian Dynamic Tags & Folders plugin.
Current state:
- 156 tests passing
- TypeScript compilation working
- UI components built (RuleEditorModal, SettingsTab)
- Pending: Sync engine implementation
- Issue: esbuild platform mismatch, need to reinstall deps

Project location: ~/projects/dynamic-tags-folders-plugin
Environment: WSL / PowerShell / Linux
```

### Automated Migration Script

If you frequently need to migrate, create this helper script:

```bash
#!/bin/bash
# save as: ~/bin/migrate-claude-project.sh

OLD_DIR="$1"
NEW_DIR="$2"

if [ -z "$OLD_DIR" ] || [ -z "$NEW_DIR" ]; then
  echo "Usage: migrate-claude-project.sh <old-dir> <new-dir>"
  exit 1
fi

echo "Migrating from: $OLD_DIR"
echo "Migrating to: $NEW_DIR"

# Create new directory
mkdir -p "$NEW_DIR"

# Copy files excluding heavy directories
rsync -av \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='dist' \
  --exclude='build' \
  "$OLD_DIR/" "$NEW_DIR/"

echo "Migration complete!"
echo "Now run: cd \"$NEW_DIR\" && bun install"
```

Usage:

```bash
chmod +x ~/bin/migrate-claude-project.sh
~/bin/migrate-claude-project.sh \
  "/mnt/c/Users/YourUsername/Documents/vault/plugin_development/dynamic-tags-folders-plugin" \
  "$HOME/projects/dynamic-tags-folders-plugin"
```

---

## Avoiding Permission Issues

The biggest pain point with WSL + Claude Code is permission mismatches.

### Root Cause

Claude Code may run as:
- `root` user (via sudo)
- Different user than your WSL user
- With different environment variables

This causes files created by Claude Code to be owned by `root`, making them hard to modify.

### Solution 1: Work in WSL Home Directory (RECOMMENDED)

Instead of working in `/mnt/c/Users/...`, work in your WSL home directory:

```bash
# Bad (Windows filesystem, permission issues)
/mnt/c/Users/YourUsername/Documents/vault/plugin_development/dynamic-tags-folders-plugin

# Good (WSL filesystem, no permission issues)
~/projects/dynamic-tags-folders-plugin
```

**Steps:**

1. Clone or copy the project to `~/projects/`:

```bash
cd ~/projects
git clone https://github.com/cybersader/obsidian-tag-and-folder-mapper.git dynamic-tags-folders-plugin
cd dynamic-tags-folders-plugin
bun install
```

2. Start a new Claude Code session in `~/projects/dynamic-tags-folders-plugin`

3. Access from Windows if needed:

```bash
# In Windows Explorer, navigate to:
\\wsl$\Ubuntu\home\<your-username>\projects\dynamic-tags-folders-plugin
```

### Solution 2: Fix Permissions After the Fact

If you're already working in `/mnt/c/` and files are owned by root:

```bash
# Fix ownership
sudo chown -R $USER:$USER .

# Make files writable
chmod -R u+w .

# Reinstall dependencies in your user context
rm -rf node_modules
bun install
```

### Solution 3: Don't Run Claude Code with Sudo

If you're running Claude Code with `sudo claude-code`, stop doing that:

```bash
# Bad
sudo claude-code

# Good
claude-code
```

If Claude Code requires sudo for some reason, that's a configuration issue to fix, not a workflow to maintain.

### Solution 4: Separate Environments Completely

Keep WSL and Windows development completely separate:

```bash
# WSL environment
~/projects/dynamic-tags-folders-plugin/
  - Work here with Claude Code
  - Run tests, builds
  - All file operations

# Link to Obsidian vault (for testing)
ln -s ~/projects/dynamic-tags-folders-plugin \
  "/mnt/c/Users/YourUsername/Documents/YourVault/.obsidian/plugins/dynamic-tags-folders"
```

---

## Alternative Testing Workflows

Since I cannot see Obsidian's console, here are alternative testing approaches:

### Workflow 1: File-Based Debug Logging

Modify the plugin to write debug logs to a file I can read:

```typescript
// src/utils/debug.ts
import { App } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

export class DebugLogger {
  private logPath: string;

  constructor(app: App) {
    // Write to vault's root directory
    this.logPath = path.join(app.vault.adapter.basePath, 'plugin-debug.log');
  }

  log(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}${data ? '\n' + JSON.stringify(data, null, 2) : ''}\n`;

    fs.appendFileSync(this.logPath, logEntry);
    console.log(message, data); // Also log to console
  }

  clear() {
    fs.writeFileSync(this.logPath, '');
  }
}

// Usage in main.ts
import { DebugLogger } from './utils/debug';

export default class DynamicTagsFoldersPlugin extends Plugin {
  debugLogger: DebugLogger;

  async onload() {
    if (this.settings.debugMode) {
      this.debugLogger = new DebugLogger(this.app);
      this.debugLogger.clear(); // Clear old logs
      this.debugLogger.log('Plugin loaded');
    }
  }
}
```

Then I can read the log file:

```bash
# I can read this file to see what's happening
cat "/mnt/c/Users/YourUsername/Documents/YourVault/plugin-debug.log"
```

### Workflow 2: Unit Test Everything

Instead of relying on UI testing, write comprehensive unit tests:

```typescript
// src/sync/folder-to-tag.test.ts
import { describe, test, expect } from 'bun:test';
import { FolderToTagSync } from './folder-to-tag';

describe('FolderToTagSync', () => {
  test('applies folder name as tag', () => {
    const sync = new FolderToTagSync(/* ... */);
    const result = sync.syncFile('Projects/MyProject/note.md');

    expect(result.tags).toContain('MyProject');
  });
});
```

Benefits:
- I can run `bun test` and see results
- No need for Obsidian to be running
- Faster development iteration

### Workflow 3: Console Error Reporting

When you test in Obsidian:

1. Open Obsidian Developer Console: `Ctrl+Shift+I` (Windows) or `Cmd+Option+I` (Mac)
2. Test the plugin feature
3. Copy any errors/logs
4. Paste them in our conversation

Example:

```
User: I tested creating a new rule and got this error:

TypeError: Cannot read property 'folderTransforms' of undefined
    at RuleEditorModal.onOpen (main.js:234)
    at Modal.open (app.js:1234)
```

### Workflow 4: Emulate UI Interactions in Tests

Instead of testing through the UI, test the underlying logic:

```typescript
// src/ui/RuleEditorModal.test.ts
import { describe, test, expect } from 'bun:test';
import { Rule, RuleDirection } from '../types/settings';

describe('Rule Creation Logic', () => {
  test('creates valid folder-to-tag rule', () => {
    const rule: Rule = {
      id: 'test-rule',
      name: 'Test Rule',
      enabled: true,
      direction: 'folder-to-tag',
      pattern: { type: 'path', value: 'Projects/**' },
      folderTransforms: { caseTransform: 'none' },
      tagTransforms: { caseTransform: 'kebab-case' },
      options: {
        createFolders: false,
        addTags: true,
        removeOrphanedTags: false,
        syncOnFileCreate: true,
        syncOnFileMove: true,
        syncOnFileRename: true
      }
    };

    // Test that rule is valid
    expect(rule.direction).toBe('folder-to-tag');
    expect(rule.options.addTags).toBe(true);
  });
});
```

### Workflow 5: Incremental Testing

Break down testing into small, verifiable steps:

1. **You**: "I'm going to test creating a rule through the UI"
2. **You**: "The modal opened successfully, I see all the fields"
3. **You**: "I filled in: name='Test', direction='folder-to-tag', pattern='/Projects'"
4. **You**: "Clicking Save gave me an error: [paste error]"
5. **Me**: "I see the issue, let me fix it..." [makes fix]
6. **You**: "Testing again... it worked!"

This gives me visibility without needing console access.

---

## Debug Logging Strategy

Here's a comprehensive debug logging setup:

### 1. Create Debug Utility

```typescript
// src/utils/debug.ts
import { App, normalizePath } from 'obsidian';

export class DebugLogger {
  private logPath: string;
  private enabled: boolean;

  constructor(private app: App, enabled: boolean = false) {
    this.enabled = enabled;
    // Use vault's config directory
    this.logPath = normalizePath(
      `${app.vault.configDir}/plugins/dynamic-tags-folders/debug.log`
    );
  }

  async log(level: 'info' | 'warn' | 'error', message: string, data?: any) {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const dataStr = data ? '\n' + JSON.stringify(data, null, 2) : '';
    const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}\n`;

    // Write to file
    try {
      const adapter = this.app.vault.adapter;
      const existing = await adapter.read(this.logPath).catch(() => '');
      await adapter.write(this.logPath, existing + logEntry);
    } catch (e) {
      console.error('Failed to write debug log:', e);
    }

    // Also log to console
    console[level](message, data);
  }

  async clear() {
    if (!this.enabled) return;

    try {
      await this.app.vault.adapter.write(this.logPath, '');
    } catch (e) {
      console.error('Failed to clear debug log:', e);
    }
  }

  info(message: string, data?: any) { return this.log('info', message, data); }
  warn(message: string, data?: any) { return this.log('warn', message, data); }
  error(message: string, data?: any) { return this.log('error', message, data); }
}
```

### 2. Integrate with Plugin

```typescript
// src/main.ts
import { DebugLogger } from './utils/debug';

export default class DynamicTagsFoldersPlugin extends Plugin {
  debugLogger: DebugLogger;

  async onload() {
    await this.loadSettings();

    this.debugLogger = new DebugLogger(
      this.app,
      this.settings.pluginOptions.debugMode
    );

    await this.debugLogger.clear();
    await this.debugLogger.info('Plugin loaded', {
      version: this.manifest.version,
      rulesCount: this.settings.rules.length
    });

    // ... rest of onload
  }
}
```

### 3. Use Throughout Codebase

```typescript
// Example: In sync engine
export class FolderToTagSync {
  constructor(
    private app: App,
    private settings: DynamicTagsFoldersSettings,
    private logger: DebugLogger
  ) {}

  async syncFile(file: TFile) {
    await this.logger.info('Starting folder-to-tag sync', {
      file: file.path,
      folder: file.parent?.path
    });

    try {
      // ... sync logic
      await this.logger.info('Sync completed successfully');
    } catch (error) {
      await this.logger.error('Sync failed', {
        error: error.message,
        stack: error.stack
      });
    }
  }
}
```

### 4. Reading Debug Logs

I can read the debug log file:

```bash
# Read the entire log
cat "/mnt/c/Users/YourUsername/Documents/YourVault/.obsidian/plugins/dynamic-tags-folders/debug.log"

# Watch log in real-time (as you test)
tail -f "/mnt/c/Users/YourUsername/Documents/YourVault/.obsidian/plugins/dynamic-tags-folders/debug.log"

# Filter for errors only
grep ERROR "/mnt/c/Users/YourUsername/Documents/YourVault/.obsidian/plugins/dynamic-tags-folders/debug.log"
```

---

## Best Practices

### 1. Clear Division of Responsibilities

**Claude Code handles:**
- TypeScript compilation
- Running tests
- Code generation
- Refactoring
- Documentation
- Reading log files

**You handle:**
- UI testing in Obsidian
- Final builds (if platform issues)
- Git commits
- Reporting console errors
- Testing edge cases

### 2. Communication Protocol

When reporting issues, include:

```
What you did: [Clicked "Create Rule" button]
What you expected: [Rule editor modal to open]
What happened: [Nothing happened, console shows error]
Error message: [paste full error from console]
Environment: [WSL/PowerShell/Linux]
Plugin version: [latest from main.ts]
```

### 3. Iterative Development

1. **Me**: Implement feature
2. **Me**: Write unit tests
3. **Me**: Run tests, ensure they pass
4. **You**: Test in Obsidian UI
5. **You**: Report any issues
6. **Me**: Fix issues
7. Repeat until feature works

### 4. Use Platform-Aware Scripts

Always use the platform-aware build script:

```bash
# Instead of:
bun run build

# Use:
node scripts/build.mjs
```

This automatically handles platform detection.

### 5. Keep Environments Separate

Don't mix WSL and PowerShell in the same project directory:

```bash
# BAD: Installing in WSL, building in PowerShell
cd /mnt/c/Users/YourUsername/Documents/vault/plugin_development
bun install  # WSL
# Then in PowerShell: bun run build  # ERROR: platform mismatch

# GOOD: Pick one environment per project
cd ~/projects/project  # WSL only
bun install
bun run build
```

### 6. Regular Permission Checks

Periodically verify file ownership:

```bash
# Check ownership
ls -la | grep root

# If you see root-owned files, fix:
sudo chown -R $USER:$USER .
```

### 7. Leverage Version Control

Commit working states frequently:

```bash
# After each feature works
git add .
git commit -m "feat: implement folder-to-tag sync"

# This makes it easy to revert if something breaks
git log --oneline
git reset --hard <commit-hash>
```

---

## Quick Reference

### Migrating Conversation

```bash
# 1. Summarize state in Claude Code
# 2. Copy project to new location
rsync -av --exclude='node_modules' old/ new/

# 3. Start fresh session in new location
cd new/
bun install
```

### Fixing Permissions

```bash
sudo chown -R $USER:$USER .
rm -rf node_modules
bun install
```

### Reading Debug Logs

```bash
cat "/mnt/c/path/to/vault/.obsidian/plugins/dynamic-tags-folders/debug.log"
tail -f "/mnt/c/path/to/vault/.obsidian/plugins/dynamic-tags-folders/debug.log"
```

### Platform-Aware Build

```bash
node scripts/build.mjs
```

---

## Summary

**Key Takeaways:**

1. **I cannot see Obsidian console** - Use file-based logging or report errors manually
2. **Work in WSL home directory** - Avoids permission issues with `/mnt/c/`
3. **Migrate conversations by summarizing state** - Simpler than technical migration
4. **Use debug logging to file** - Gives me visibility into runtime behavior
5. **Test incrementally** - Small steps with clear reporting
6. **Keep environments separate** - WSL OR PowerShell, not both

With these workflows, we can develop effectively even with Claude Code's limitations.

---

## Next Steps

1. **Decide on environment**: Work in `~/projects/` (WSL) or native PowerShell?
2. **Set up debug logging**: Add DebugLogger utility
3. **Create test vault**: See [TESTING_GUIDE.md](./TESTING_GUIDE.md)
4. **Start testing**: Test existing UI, report any issues
5. **Implement sync engine**: Next major feature

Let me know which environment you prefer, and we can proceed!
