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

### Step 1: Copy Plugin to Obsidian Vault

You have two options:

#### Option A: Symlink (Development - Recommended)

**WSL:**
```bash
# Create symlink from WSL
ln -s "$(pwd)" "/mnt/c/Users/YourUsername/Documents/ObsidianVault/.obsidian/plugins/dynamic-tags-folders"
```

**PowerShell:**
```powershell
# Create symlink from PowerShell (requires admin)
New-Item -ItemType SymbolicLink -Path "C:\Users\YourUsername\Documents\ObsidianVault\.obsidian\plugins\dynamic-tags-folders" -Target "C:\Users\YourUsername\Documents\4 VAULTS\plugin_development\dynamic-tags-folders-plugin"
```

**Benefits**: Changes are immediately available, no need to copy files

#### Option B: Copy Files (Quick Test)

**WSL:**
```bash
# Copy to vault
cp -r . "/mnt/c/Users/YourUsername/Documents/ObsidianVault/.obsidian/plugins/dynamic-tags-folders"
```

**PowerShell:**
```powershell
# Copy to vault
Copy-Item -Recurse -Force . "C:\Users\YourUsername\Documents\ObsidianVault\.obsidian\plugins\dynamic-tags-folders"
```

**Benefits**: Isolated test, won't affect development files

### Step 2: Enable the Plugin

1. Open Obsidian
2. Go to **Settings** → **Community Plugins**
3. Make sure **Safe Mode** is **OFF**
4. Click **Browse** and search for "Dynamic Tags & Folders" (if it's in the list)
5. Or click the **folder icon** to manually enable it
6. Enable the plugin

### Step 3: Install Hot Reload (Optional but Recommended)

For faster development iteration:

1. Install the [Hot Reload](https://github.com/pjeby/hot-reload) community plugin
2. Enable it in Obsidian
3. Now when you run `bun run dev`, changes will auto-reload!

---

## Creating a Test Vault

Create a dedicated test vault with sample data to test the plugin:

### Quick Setup Script

**WSL/Linux:**
```bash
# Create test vault structure
mkdir -p /mnt/c/Users/YourUsername/Documents/ObsidianVault-Test
cd /mnt/c/Users/YourUsername/Documents/ObsidianVault-Test

# Create sample folder structure
mkdir -p "Projects/Web Development"
mkdir -p "Projects/Mobile Apps"
mkdir -p "📁 01 - Archive/Old Projects"
mkdir -p "📁 02 - Active/Current Work"

# Create sample notes
echo "---
tags:
  - projects/web
---

# Web Project 1" > "Projects/Web Development/Project1.md"

echo "---
tags:
  - projects/mobile
---

# Mobile App 1" > "Projects/Mobile Apps/App1.md"

echo "# Untagged Note

This note has no tags." > "Projects/Untagged.md"
```

**PowerShell:**
```powershell
# Create test vault structure
New-Item -ItemType Directory -Force -Path "C:\Users\YourUsername\Documents\ObsidianVault-Test"
cd "C:\Users\YourUsername\Documents\ObsidianVault-Test"

# Create sample folders
New-Item -ItemType Directory -Force -Path "Projects\Web Development"
New-Item -ItemType Directory -Force -Path "Projects\Mobile Apps"
New-Item -ItemType Directory -Force -Path "📁 01 - Archive\Old Projects"
New-Item -ItemType Directory -Force -Path "📁 02 - Active\Current Work"

# Create sample notes
@"
---
tags:
  - projects/web
---

# Web Project 1
"@ | Out-File -FilePath "Projects\Web Development\Project1.md"

@"
---
tags:
  - projects/mobile
---

# Mobile App 1
"@ | Out-File -FilePath "Projects\Mobile Apps\App1.md"

@"
# Untagged Note

This note has no tags.
"@ | Out-File -FilePath "Projects\Untagged.md"
```

### Test Vault Structure

Your test vault should look like this:

```
ObsidianVault-Test/
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
