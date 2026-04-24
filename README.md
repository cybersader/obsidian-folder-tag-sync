<p align="center">
  <img src="assets/logo/logo.svg" alt="Folder Tag Sync" width="180">
</p>

<h1 align="center">Folder Tag Sync</h1>

<p align="center">
  <strong>Bidirectional sync between folder paths and Obsidian tags using regex patterns and transformations</strong>
</p>

<p align="center">
  <a href="https://github.com/cybersader/obsidian-folder-tag-sync/releases/latest"><img src="https://img.shields.io/github/v/release/cybersader/obsidian-folder-tag-sync?style=flat-square&color=7c3aed" alt="Latest Release"></a>
  <a href="https://github.com/cybersader/obsidian-folder-tag-sync/blob/main/LICENSE"><img src="https://img.shields.io/github/license/cybersader/obsidian-folder-tag-sync?style=flat-square" alt="License"></a>
  <a href="https://cybersader.github.io/obsidian-folder-tag-sync"><img src="https://img.shields.io/badge/docs-Starlight-blue?style=flat-square" alt="Documentation"></a>
  <a href="https://obsidian.md/plugins?id=folder-tag-sync"><img src="https://img.shields.io/badge/Obsidian-Plugin-7c3aed?style=flat-square&logo=obsidian&logoColor=white" alt="Obsidian Plugin"></a>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="https://cybersader.github.io/obsidian-folder-tag-sync">Docs</a> •
  <a href="#-roadmap">Roadmap</a>
</p>

---

## 🏷️ Also Known As

This plugin goes by several names that describe the same concept:
- **Folder Tag Sync** (official name)
- **Dynamic Tags & Folders**
- **Tag and Folder Mapper**
- **Polyhierarchy Plugin** (conceptual nickname)

All refer to this same plugin for **bidirectional folder-tag synchronization**.

---

## 🚧 Development Status

This plugin is currently in **active development** (v0.1.0 beta). Core features are working, with advanced features in progress.

### 🤖 AI-Assisted Development

**Full Transparency**: Most of this plugin's code was written by AI (Claude Code) with me deeply involved in testing, design decisions, and quality control. I'm not a seasoned web or Obsidian plugin developer—my background is primarily Python and tabular data work.

**What this means:**
- ✅ Rapid development with comprehensive testing
- ✅ Well-documented, modern codebase
- ✅ 156+ automated tests
- ⚠️ Ongoing learning curve for traditional plugin patterns
- 💡 Committed to maintenance and user feedback

If you find issues or have suggestions, please [open an issue](https://github.com/cybersader/obsidian-folder-tag-sync/issues)!

---

## ✨ Features

### Current (v0.1.0)
- ✅ **Folder → Tag Sync** - Automatically add tags based on folder location
- ✅ **Tag → Folder Sync** - Move files to folders based on tags
- ✅ **Regex Pattern Matching** - Flexible folder/tag matching
- ✅ **Transformation Pipeline** - Handle naming conventions:
  - Case transformations (snake_case, kebab-case, Title Case, camelCase, PascalCase)
  - Emoji handling (strip or keep)
  - Number prefix handling (Johnny Decimal format)
  - Custom regex transformations
- ✅ **Rule-Based System** - Define multiple rules with priority ordering
- ✅ **Settings UI** - Visual rule editor with drag-to-reorder
- ✅ **Manual Sync Commands** - Sync on demand via command palette
- ✅ **Debug Logging** - Comprehensive logging for troubleshooting

### Coming Soon
- 🔄 Automatic sync on file create/move/rename
- 🔄 Conflict resolution (multiple tags → multiple possible folders)
- 🔄 Folder rename → bulk tag update
- 🔄 Bulk vault sync operations
- 🔄 Folder notes support
- 🔄 Attachment handling

See the [full roadmap](#-roadmap) below.

---

## 🎯 Why This Plugin?

### The Problem
- **Folders** are rigid, single-hierarchy structures required for file storage
- **Tags** are flexible, overlapping hierarchies better for knowledge representation
- Managing both manually is tedious and error-prone

### The Solution
Intelligent, rule-based bidirectional mapping that:
- Keeps your folder structure organized for specific audiences
- Maintains a flexible tag system for knowledge connections
- Automatically synchronizes both views based on rules you define

### Unlike Other Plugins
Unlike simple file movers (like Auto Note Mover), this plugin uses:
- **Regex patterns** instead of exact string matching
- **Transformation templates** to handle naming convention changes
- **Bidirectional sync** to maintain both folder and tag views
- **Priority system** for conflict resolution

---

## 🚀 Installation

### Method 1: Manual Installation (Current)

1. Download the latest release from [GitHub Releases](https://github.com/cybersader/obsidian-folder-tag-sync/releases)
2. Extract to `.obsidian/plugins/folder-tag-sync/` in your vault
3. Reload Obsidian
4. Enable "Folder Tag Sync" in Settings → Community Plugins

### Method 2: BRAT (Beta Testing)

Install via the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat):
1. Install BRAT from community plugins
2. Open BRAT settings
3. Add `cybersader/obsidian-folder-tag-sync`
4. Enable "Folder Tag Sync"

### Method 3: Community Plugins (Coming Soon)

Once approved, install directly from Obsidian's community plugins browser.

---

## 🎬 Quick Start

### 1. Open Plugin Settings

Go to **Settings → Folder Tag Sync**

### 2. Create Your First Rule

Click **"Add Rule"** and configure:

**Example: Projects Folder**
```
Rule Name: Projects Folder
Direction: Bidirectional

Folder Pattern: ^📁 01 - Projects/(.*)
Folder Entry Point: 📁 01 - Projects

Tag Pattern: ^01-projects/
Tag Entry Point: 01-projects

Transformations:
  - Strip emojis from tags
  - Convert to snake_case
  - Keep number prefixes
```

**Result:**
- File in `📁 01 - Projects/Web Dev/` → Gets tag `#01-projects/web_dev`
- File with tag `#01-projects/mobile_app` → Moves to `📁 01 - Projects/Mobile App/`

### 3. Test Your Rule

Use the **"Test & Preview"** section to see how patterns transform.

### 4. Sync Manually

Use command palette commands:
- **"Folder Tag Sync: Sync folder to tags"** - Updates tags based on current folder
- **"Folder Tag Sync: Sync tags to folder"** - Moves file based on tags

---

## 📖 Documentation

### Core Concepts

#### Rule Directions
- **Folder → Tag**: File location determines tags (read-only tag generation)
- **Tag → Folder**: Tags determine file location (moves files)
- **Bidirectional**: Both directions active

#### Transformation Pipeline
Folder paths and tags can be transformed through a pipeline:
1. **Emoji Handling** - Strip or keep Unicode emojis
2. **Number Prefixes** - Handle Johnny Decimal format (01, 02, etc.)
3. **Case Transform** - Convert between naming conventions
4. **Regex Transform** - Custom pattern replacements
5. **Character Cleaning** - Remove invalid tag characters

#### Priority System
Rules are evaluated in order (top to bottom). First matching rule wins.
- Drag rules to reorder priority
- Higher rules = higher priority

### Example Configurations

<details>
<summary><b>Example 1: PARA Method</b></summary>

```json
{
  "name": "Projects",
  "folderPattern": "^Projects/(.*)",
  "tagPattern": "^projects/",
  "direction": "bidirectional",
  "tagTransforms": {
    "caseTransform": "kebab-case"
  }
}
```

**Result:**
- `Projects/Active/My Project` ↔ `#projects/active/my-project`

</details>

<details>
<summary><b>Example 2: Zettelkasten Inbox</b></summary>

```json
{
  "name": "Inbox",
  "folderPattern": "^Inbox$",
  "tagPattern": "^inbox$",
  "direction": "bidirectional",
  "folderEntryPoint": "Inbox",
  "tagEntryPoint": "inbox"
}
```

**Result:**
- Files in `Inbox/` ↔ Tag `#inbox`

</details>

<details>
<summary><b>Example 3: Entity-Based Organization</b></summary>

```json
{
  "name": "User Projects",
  "folderPattern": "^👤 Alice/📁 Projects/(.*)",
  "tagPattern": "^--alice/projects/",
  "direction": "bidirectional",
  "folderEntryPoint": "👤 Alice",
  "tagEntryPoint": "--alice",
  "tagTransforms": {
    "caseTransform": "snake_case",
    "emojiHandling": "strip"
  }
}
```

**Result:**
- `👤 Alice/📁 Projects/Research` ↔ `#--alice/projects/research`

</details>

---

## 🗺️ Roadmap

See [detailed roadmap](FEATURE_ROADMAP.md) for complete planning.

### ✅ Phase 1: Foundation (COMPLETE)
- [x] TypeScript setup with 156+ tests
- [x] Transformation engine (case, emoji, numbers, regex)
- [x] Rule matching and priority system
- [x] Settings UI with rule editor

### ✅ Phase 2: Basic Sync (COMPLETE)
- [x] Folder → Tag synchronization
- [x] Tag → Folder synchronization
- [x] Manual sync commands

### 🔄 Phase 3: Core Features (IN PROGRESS)
- [x] Basic tag-to-folder movement (v0.1.0)
- [ ] Conflict resolution (multiple tags)
- [ ] Movement timing (on-save, on-close, manual)
- [ ] Folder notes support
- [ ] Safety features (dry-run, undo)

### 📋 Phase 4: Advanced Features
- [ ] Folder rename → tag propagation
- [ ] Bulk vault sync
- [ ] Wildcard pattern matching
- [ ] Exclusion patterns
- [ ] Advanced conflict strategies

### 🔌 Phase 5: Integrations
- [ ] Context menu integration
- [ ] Plugin API for other plugins
- [ ] Rule packs (PARA, Zettelkasten, etc.)

### 🎨 Phase 6: Polish
- [ ] Performance optimization (10k+ files)
- [ ] Sync history and undo
- [ ] Rule analytics
- [ ] Mobile testing and optimization

---

## 🏗️ Architecture

### Data Flow
```
File Event → Rule Matcher → Transformation Pipeline → Sync Executor
     ↓             ↓                    ↓                    ↓
  Created     Finds match      Converts naming       Updates tags
  Moved       by priority      conventions           or moves file
  Tagged
```

### Transformation Example
```
Input: "📁 01 - My Cool Project"
  ↓ Strip Emoji
"01 - My Cool Project"
  ↓ Strip Number Prefix
"My Cool Project"
  ↓ snake_case
"my_cool_project"
  ↓ Tag Entry Point
"#projects/my_cool_project"
```

### Tech Stack
- **Language**: TypeScript
- **Build**: esbuild
- **Testing**: Bun test runner (156 tests)
- **Obsidian API**: v0.15.0+

---

## 🤝 Contributing

Contributions welcome! This project uses AI-assisted development, so contributors comfortable with that workflow are encouraged.

### Development Setup

See [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md) and [CLAUDE_CODE_WORKFLOW.md](CLAUDE_CODE_WORKFLOW.md) for detailed setup.

**Quick start:**
```bash
# Clone
git clone https://github.com/cybersader/obsidian-folder-tag-sync.git
cd obsidian-folder-tag-sync

# Install
bun install  # or npm install

# Test
bun test

# Build
bun run build

# Dev mode (watch)
bun run dev
```

### Testing
```bash
# Run all tests (156+ passing)
bun test

# Watch mode
bun test --watch

# Build and verify
bun run build && ls -lh main.js
```

### Contributing Guidelines
See [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Code style
- Testing requirements
- PR process
- Issue reporting

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file.

---

## 🙏 Acknowledgments

- **Obsidian Team** - For the amazing API and platform
- **Claude (Anthropic)** - AI assistant that wrote most of this code
- **Community** - For testing, feedback, and feature ideas
- **Existing Plugins** - Auto Note Mover, Tag Wrangler, and others for inspiration

---

## 📬 Support

- **Issues**: [GitHub Issues](https://github.com/cybersader/obsidian-folder-tag-sync/issues)
- **Discussions**: [GitHub Discussions](https://github.com/cybersader/obsidian-folder-tag-sync/discussions)
- **Questions**: Tag me on [Obsidian Forum](https://forum.obsidian.md/)

---

## ⭐ Star History

If this plugin helps you, consider starring the repo!

[![Star History Chart](https://api.star-history.com/svg?repos=cybersader/obsidian-folder-tag-sync&type=Date)](https://star-history.com/#cybersader/obsidian-folder-tag-sync&Date)

---

<div align="center">

**Made with 🤖 AI assistance and ❤️ human testing**

[Report Bug](https://github.com/cybersader/obsidian-folder-tag-sync/issues) • [Request Feature](https://github.com/cybersader/obsidian-folder-tag-sync/issues) • [Star on GitHub](https://github.com/cybersader/obsidian-folder-tag-sync)

</div>
