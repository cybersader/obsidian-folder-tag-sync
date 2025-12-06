# Testing Guide

This guide explains how to test the Dynamic Tags & Folders plugin in different environments.

## Table of Contents

1. [Environment Detection](#environment-detection)
2. [Building the Plugin](#building-the-plugin)
3. [Testing in Obsidian](#testing-in-obsidian)
4. [Creating a Test Vault](#creating-a-test-vault)
5. [Testing the UI](#testing-the-ui)
6. [Common Issues](#common-issues)

---

## Environment Detection

The plugin can be developed and tested in three main environments:

### 1. WSL (Windows Subsystem for Linux)
- Running Linux commands in Windows
- Most common for development with Claude Code
- **Identifier**: `/proc/version` contains "microsoft"

### 2. PowerShell (Windows Native)
- Native Windows environment
- Uses Windows-native Node.js and bun
- **Identifier**: `process.platform === 'win32'`

### 3. Native Linux
- Pure Linux environment (no Windows)
- **Identifier**: `process.platform === 'linux'` without Microsoft in `/proc/version`

### 4. macOS
- Apple Silicon or Intel Mac
- **Identifier**: `process.platform === 'darwin'`

---

## Building the Plugin

### Option 1: Using the Platform-Aware Build Script (Recommended)

```bash
# Development build
node scripts/build.mjs

# Production build
node scripts/build.mjs --production
```

This script automatically:
- Detects your environment (WSL, PowerShell, Linux, macOS)
- Finds the correct package manager (bun or npm)
- Handles esbuild platform differences
- Provides clear error messages

### Option 2: Manual Build Commands

#### In WSL or Linux

```bash
# If using bun (recommended)
bun run build

# If using npm
npm run build

# Development with watch mode
bun run dev
```

#### In PowerShell

```powershell
# If using bun
bun run build

# If using npm
npm run build
```

**Note**: If you get esbuild platform errors in WSL, you may need to:

```bash
# Remove node_modules and reinstall in WSL
rm -rf node_modules
bun install
# or
npm install
```

### Option 3: TypeScript Check Only

If you just want to verify the code compiles without bundling:

```bash
# WSL/Linux
bun x tsc -noEmit -skipLibCheck

# PowerShell
npx tsc -noEmit -skipLibCheck
```

---

## Testing in Obsidian

### Embedded Test Vault Approach (Recommended)

The plugin includes an embedded test vault at `test-vault/`. Build outputs go directly there—no copying or symlinks needed.

**Setup (one-time):**
```bash
# Build outputs to test-vault/.obsidian/plugins/dynamic-tags-folders/
npm run build
```

**Development workflow:**
```bash
# Watch mode - rebuilds automatically on changes
npm run dev

# Open test-vault/ as a vault in Obsidian
# File → Open vault → select test-vault/
```

### Enable the Plugin

1. Open Obsidian with the test-vault
2. Go to **Settings** → **Community Plugins**
3. Make sure **Safe Mode** is **OFF**
4. Find "Dynamic Tags & Folders" in the list
5. Enable the plugin

### Install Hot Reload (Optional but Recommended)

For automatic plugin reloading during development:

1. Install the [Hot Reload](https://github.com/pjeby/hot-reload) community plugin in test-vault
2. Enable it in Obsidian
3. Now when you run `npm run dev`, changes auto-reload!

---

## Test Vault Structure

The test vault is embedded in the project at `test-vault/`. It includes sample content for testing.

### Initial Setup

If `test-vault/` doesn't exist, create it:

```bash
# From the plugin project root
mkdir -p test-vault/.obsidian/plugins/dynamic-tags-folders
mkdir -p "test-vault/Projects/Web Development"
mkdir -p "test-vault/Projects/Mobile Apps"
mkdir -p "test-vault/📁 01 - Archive/Old Projects"
mkdir -p "test-vault/📁 02 - Active/Current Work"
```

### Sample Test Notes

Create sample notes in `test-vault/`:

```bash
# Web project note
cat > "test-vault/Projects/Web Development/Project1.md" << 'EOF'
---
tags:
  - projects/web
---

# Web Project 1
EOF

# Mobile project note
cat > "test-vault/Projects/Mobile Apps/App1.md" << 'EOF'
---
tags:
  - projects/mobile
---

# Mobile App 1
EOF

# Untagged note
cat > "test-vault/Projects/Untagged.md" << 'EOF'
# Untagged Note

This note has no tags.
EOF
```

### Test Vault Structure

Your embedded test vault should look like this:

```
test-vault/
├── .obsidian/
│   └── plugins/
│       └── dynamic-tags-folders/
│           ├── main.js          # Build output
│           ├── manifest.json
│           └── styles.css
├── Projects/
│   ├── Web Development/
│   │   └── Project1.md (tags: projects/web)
│   ├── Mobile Apps/
│   │   └── App1.md (tags: projects/mobile)
│   └── Untagged.md (no tags)
├── 📁 01 - Archive/
│   └── Old Projects/
└── 📁 02 - Active/
    └── Current Work/
```

---

## Testing the UI

### Test Checklist

#### 1. Settings Tab

- [ ] Open Settings → Dynamic Tags & Folders
- [ ] Verify general options display correctly
- [ ] Toggle each option and verify it saves
- [ ] Check that "No rules" message appears

#### 2. Create a Rule

- [ ] Click "Add Rule" button
- [ ] Rule editor modal opens
- [ ] Fill in basic information:
  - Name: "Test Rule - Projects"
  - Description: "Map Projects folder to tags"
  - Priority: 10
- [ ] Select direction: Bidirectional
- [ ] Set folder pattern: `Projects/*`
- [ ] Set tag pattern: `projects/*`
- [ ] Configure transformations:
  - Folder → Tag: snake_case, strip emoji, strip numbers
  - Tag → Folder: Title Case
- [ ] Test preview section:
  - Enter `Projects/Web Development` → should show `projects/web_development`
  - Enter `web_development` → should show `Web Development`
- [ ] Click "Create Rule"
- [ ] Verify rule appears in settings list

#### 3. Edit a Rule

- [ ] Click on the rule in the list
- [ ] Modal opens with existing values
- [ ] Change priority to 5
- [ ] Click "Save Changes"
- [ ] Verify changes persist

#### 4. Drag and Drop Reordering

- [ ] Create a second rule
- [ ] Drag one rule above/below the other
- [ ] Verify priorities update automatically

#### 5. Import/Export

- [ ] Click "Export" button
- [ ] Verify JSON is copied to clipboard
- [ ] Paste into import text area
- [ ] Click "Import"
- [ ] Confirm replacement
- [ ] Verify settings imported correctly

#### 6. Rule Validation

- [ ] Create a rule with no name
- [ ] Try to save
- [ ] Verify error message appears
- [ ] Try invalid regex pattern `[invalid(`
- [ ] Verify validation error

---

## Common Issues

### Issue 1: esbuild Platform Mismatch

**Error:**
```
You installed esbuild for another platform than the one you're currently using.
```

**Solution (WSL):**
```bash
# Remove node_modules and reinstall in WSL
rm -rf node_modules
bun install
```

**Solution (PowerShell):**
```powershell
# Remove node_modules and reinstall in PowerShell
Remove-Item -Recurse -Force node_modules
bun install
```

### Issue 2: Plugin Not Showing in Obsidian

**Check:**
1. Is the plugin folder in `.obsidian/plugins/`?
2. Does it contain `main.js` and `manifest.json`?
3. Is Community Plugins enabled (Safe Mode off)?
4. Try restarting Obsidian

**Debug:**
```bash
# Check plugin files exist
ls .obsidian/plugins/dynamic-tags-folders/

# Should show:
# - main.js
# - manifest.json
# - styles.css (optional)
```

### Issue 3: TypeScript Errors

**Check:**
```bash
# Run type check
bun x tsc -noEmit -skipLibCheck

# If errors, check:
# 1. Did you modify type definitions?
# 2. Are imports correct?
# 3. Try: rm -rf node_modules && bun install
```

### Issue 4: Hot Reload Not Working

**Solutions:**
1. Restart Obsidian
2. Disable and re-enable the plugin
3. Check that Hot Reload plugin is enabled
4. Check console (Ctrl+Shift+I) for errors

### Issue 5: Permission Errors (WSL)

If you get permission errors when running Claude Code commands:

```bash
# Check file ownership
ls -la

# If files are owned by root, fix:
sudo chown -R $USER:$USER .
```

### Issue 6: Bun Not Found

**WSL:**
```bash
# Check bun installation
which bun

# If not found, add to PATH in ~/.bashrc or ~/.zshrc:
export PATH="$HOME/.bun/bin:$PATH"

# Reload shell
source ~/.bashrc
```

**PowerShell:**
```powershell
# Check bun installation
Get-Command bun

# If not found, reinstall or add to PATH
```

---

## Debug Mode

Enable debug mode in plugin settings for detailed logging:

1. Open Settings → Dynamic Tags & Folders
2. Enable "Debug mode"
3. Open Developer Console (Ctrl+Shift+I)
4. Look for `[Dynamic Tags & Folders]` logs

---

## Running Tests

### Unit Tests

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run specific test file
bun test src/transformers/caseTransformers.test.ts
```

**Current test status**: 156 tests passing ✅

---

## Next Steps

After verifying the UI works:

1. Create test rules for your actual use cases
2. Test folder → tag transformations (coming in Phase 3)
3. Test tag → folder transformations (coming in Phase 3)
4. Report any bugs or UX issues

---

## Getting Help

If you encounter issues:

1. Check this guide first
2. Check `CONTRIBUTING.md` for development setup
3. Check `ENVIRONMENT_SETUP.md` for environment-specific issues
4. Open an issue on GitHub with:
   - Your environment (WSL/PowerShell/Linux/macOS)
   - Error message
   - Steps to reproduce
