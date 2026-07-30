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

This plugin is in **active beta development**, distributed through GitHub Releases and BRAT. Core synchronization, rule authoring, detection, previews, and the Taxonomy Workbench are working, with advanced authoring features still in progress.

### 🤖 AI-Assisted Development

**Full Transparency**: Most of this plugin's code was written by AI (Claude Code) with me deeply involved in testing, design decisions, and quality control. I'm not a seasoned web or Obsidian plugin developer—my background is primarily Python and tabular data work.

**What this means:**
- ✅ Rapid development with comprehensive testing
- ✅ Well-documented, modern codebase (Astro + Starlight docs site at [cybersader.github.io/obsidian-folder-tag-sync](https://cybersader.github.io/obsidian-folder-tag-sync/))
- ✅ 1000+ automated tests across the engine, transformers, sync, UI plumbing, privacy boundaries, and real-Obsidian workflows
- ✅ Substantive in-flight research artifacts in the docs site (see [Documentation](#-documentation) below)
- ⚠️ Ongoing learning curve for traditional plugin patterns
- 💡 Committed to maintenance and user feedback

If you find issues or have suggestions, please [open an issue](https://github.com/cybersader/obsidian-folder-tag-sync/issues)!

---

## ✨ Features

### Current
- ✅ **Folder → Tag Sync** — Automatically add tags based on folder location
- ✅ **Tag → Folder Sync** — Move files to folders based on tags
- ✅ **Regex Pattern Matching** — Flexible folder/tag matching with confidence-based specificity tiebreak
- ✅ **Typed rule model** (Phase 2) — Author rules as `FolderClassifier + TagVocabulary + TransferOp` triples; eight library-science transfer primitives (`identity`, `truncation`, `marker-only`, `promotion-to-root`, `flattening-to-leaf`, `post-coordination`, `aggregation`, `opaque`). Falls back to raw regex (Layer 1) for cases the typed model can't express. See [Philosophy](https://cybersader.github.io/obsidian-folder-tag-sync/concepts/philosophy/).
- ✅ **Layer-aware anchors** (Phase G) — Rules declare *where* in the vault tree they fire (`'root'`, `'any-segment'`, or `{ under: 'parentPath' }`); supports nested deployments where the same organizational system (PARA, JD) appears at multiple depths.
- ✅ **Transformation Pipeline** — Handle naming conventions:
  - Case transformations (snake_case, kebab-case, Title Case, camelCase, PascalCase)
  - Emoji handling (strip or keep)
  - Number prefix handling (Johnny Decimal format)
  - Custom regex transformations
- ✅ **Rule-Based System** — Define multiple rules with priority ordering and bidirectional inverse logic
- ✅ **Settings UI** — Visual rule editor with drag-to-reorder, guided modal, and advanced regex modal
- ✅ **Rule packs** — Import shipped packs (PARA, Johnny Decimal, SEACOW-cyberbase, Zettelkasten) from an embedded catalog that works in the standard three-file BRAT install
- ✅ **Taxonomy Workbench** — One persistent Map → Scope → Candidates workflow with a compact **Organizational systems** summary and responsive browser. Anchored occurrences stay grouped and selectable; the browser sits beside the active surface in wide panes and opens as a temporary drawer in narrow panes, so Map/Scope/Candidates keep the available height. Selecting an occurrence only focuses it across surfaces—it does not add or enable rules.
- ✅ **Self-explaining Workbench objects** — Paths distinguish muted parent context from the bold segment that matters now (`Applies here`, `Folder inspected`, `Inclusion boundary`, `System anchor`, or `Rule anchor`). Cards and rows identify themselves as system occurrences, evidence folders, candidate rules, or runtime layers, and lifecycle text says whether an object is actionable or inspect-only.
- ✅ **Neutral hierarchy annotations** — Map rows use explicit **Member of** / **Support for** chips with a separately labelled system anchor instead of unexplained pack-colour rails or tints. Installed-rule emissions are neutral results, and multiple matches show a textual **Conflict** badge rather than color-only meaning.
- ✅ **Rule layers and partial evidence** — Installed rules remain grouped honestly as collapsed **Installed rule layers** in runtime precedence order. Every card is labelled `Runtime layer`, and occurrence associations are explicitly inferred or unknown. Incomplete systems remain visible by default for inspection but cannot create deployments or candidates.
- ✅ **Disabled-draft review boundary** — Candidate groups represent exact source system occurrences; rows represent individual candidate rules. Checking a row queues a disabled draft, and **Add selected disabled drafts** never changes files, folders, frontmatter, or current sync behavior.
- ✅ **Compatible command routes** — The existing detect, draft, and map command IDs now open the corresponding Workbench surface and reuse one leaf, preserving hotkeys without reopening legacy modals
- ✅ **Manual Sync Commands** — Sync on demand via command palette
- ✅ **Support bundles and debug logging** — Preview and copy configuration, rule diagnostics, a complete folder-only tree, and a sanitized bounded log tail; optionally anonymize user-authored names before sharing

### Active research / next phases

These are **scoped and researched** but not yet shipped. Pointers to the design docs, in case you're curious about where the project is headed:

- 🔄 **Resolution-engine refinement** (Phase 2.5) — Promote `calculateMatchConfidence` from tiebreak to primary sort key; add anchor-aware specificity scoring and a `group?: string` field for cross-pack precedence (CSS `@layer`-style). Addresses [Challenge 01](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/01-rule-priority-stress-test/) and [Challenge 04](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/) directly. See [Specificity + groups research](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/).
- 🔄 **Path templates** (Phase H) — Bidirectional `Projects/{slug}` ↔ `#projects/{slug}` templates that compile to regex internally; bijection visible from slot overlap. See [Path abstractions parts 1 + 2](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/).
- 🔄 **Interactive conflict-resolution UI** — When several rules genuinely match the same input, surface the candidates rather than silently picking one.
- 🔄 **Automatic sync on file events** (create/move/rename)
- 🔄 **Bulk vault sync operations**
- 🔄 **Folder notes + attachments handling**

See the [full roadmap](#-roadmap) below or the [canonical roadmap page](https://cybersader.github.io/obsidian-folder-tag-sync/about/roadmap/) for the complete picture.

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

### Design principles

Three commitments that thread every feature decision:

- **Progressive system** — easy to start (pick a rule pack, defaults work; you don't need to learn regex, templates, anchors, or transfer ops to get value on day one), powerful as you align it (templates, slot transforms, frontmatter memory, group precedence, per-rule status indicators all surface progressively for users who want them).
- **Honest positioning** — the README and docs reflect what the plugin actually does today. As the architecture evolves (typed model → layer-aware anchors → path templates → opt-in frontmatter memory), the framing keeps up. "Regex" is increasingly an escape hatch in a richer typed system, not the headline.
- **Testing partnership** — every architectural increment ships with concrete user-testing checkpoints (named scenarios validated against a test vault). See the [development plan](https://cybersader.github.io/obsidian-folder-tag-sync/about/development-plan/) for the per-increment checklist.

### Unlike Other Plugins
Unlike simple file movers (like Auto Note Mover), this plugin uses:
- **Regex patterns** instead of exact string matching, with a typed-model layer on top so most rules don't have to think about regex at all
- **Transformation pipeline** (case, emoji, number-prefix, custom regex) for naming convention changes — applied per-side so folder and tag styling can differ
- **Bidirectional sync** with explicit forward + inverse logic for each of eight transfer primitives
- **Bijection visibility** — the typed model surfaces which rules round-trip cleanly and which are deliberately lossy, with the `cardinality` (`1:1` / `1:many` / `many:1`) and `bijective: boolean` fields making this inspectable per-rule
- **Priority + specificity** for matching — pattern specificity is the load-bearing signal (with priority as manual override; refining further in Phase 2.5)

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

### Production troubleshooting

From any BRAT-installed vault, run **Folder Tag Sync: Open support bundle preview** to inspect and copy a local troubleshooting snapshot. It contains the plugin configuration, derived rule diagnostics, a concise complete folder-only tree, and a sanitized debug-log tail. Note filenames, note contents, frontmatter, the vault name, and absolute paths are excluded; an anonymized mode replaces user-authored folder/rule/tag/pattern names with stable aliases.

See [Create a support bundle](https://cybersader.github.io/obsidian-folder-tag-sync/guides/creating-a-support-bundle/) for the complete privacy boundary and workflow.

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

The full docs are at **[cybersader.github.io/obsidian-folder-tag-sync](https://cybersader.github.io/obsidian-folder-tag-sync)** (Astro + Starlight). Quick map:

### Concept pillars

The load-bearing concept pages — read these first if you want the mental model.

- [Philosophy](https://cybersader.github.io/obsidian-folder-tag-sync/concepts/philosophy/) — typed-model layers (Layer 1 regex, Layer 2 typed); folder strict hierarchy vs. tag polyhierarchy; SEACOW axis framing; pre/post-coordination
- [Transfer operations](https://cybersader.github.io/obsidian-folder-tag-sync/concepts/transfer-operations/) — the 8 library-science primitives; per-op worked examples with forward + inverse round-trip
- [Bijection and loss](https://cybersader.github.io/obsidian-folder-tag-sync/concepts/bijection-and-loss/) — built bottom-up from transfer-ops; what determinism, lossy / lossless, bijection, cardinality, and collision-vs-lossy actually mean
- [Terminology](https://cybersader.github.io/obsidian-folder-tag-sync/concepts/terminology/) — plain-English glossary of every load-bearing term in the docs
- [Axes](https://cybersader.github.io/obsidian-folder-tag-sync/concepts/axes/) · [Folder classifiers](https://cybersader.github.io/obsidian-folder-tag-sync/concepts/folder-classifiers/) · [Tag vocabularies](https://cybersader.github.io/obsidian-folder-tag-sync/concepts/tag-vocabularies/) · [Compound cases](https://cybersader.github.io/obsidian-folder-tag-sync/concepts/compound-cases/)

### Guides

- [Importing rule packs](https://cybersader.github.io/obsidian-folder-tag-sync/guides/importing-rule-packs/)
- [Writing a rule pack](https://cybersader.github.io/obsidian-folder-tag-sync/guides/writing-a-rule-pack/)

### Active research entries

Substantive design documents that ground the upcoming phases. Worth reading if you're contributing or want to understand why the project is shaped this way.

- [Path abstractions, part 1 — regex vs. path templates](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-26-regex-vs-path-templates-research/) — the forward-direction abstraction question
- [Path abstractions, part 2 — solutions in practice](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-regex-vs-templates-part-2-solutions-in-practice/) — concrete code, hybrid coexistence, communication primitives
- [Tag → folder resolution research](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-tag-to-folder-resolution-research/) — the inverse-direction problem; six-candidate survey
- [Specificity + groups research](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-specificity-and-groups-research/) — combined design for Phase 2.5
- [Solution brainstorm (working draft)](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-log/2026-04-27-the-bidirectional-bijective-solution-work/) — meta-shape framing; SEACOW context-as-disambiguator

### Open challenges

- [01 — Rule priority stress test](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/01-rule-priority-stress-test/) · [02 — Pipeline reversibility](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/02-pipeline-reversibility/) · [03 — Performance at scale](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/03-performance-at-scale/) · [04 — Name collisions across hierarchy](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/04-name-collisions-across-hierarchy/) · [05 — Multi-entity namespace partitioning](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/05-multi-entity-namespace-partitioning/) · [06 — Compositional rule packs](https://cybersader.github.io/obsidian-folder-tag-sync/agent-context/zz-challenges/06-compositional-rule-packs/)

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

> **Canonical roadmap**: [cybersader.github.io/obsidian-folder-tag-sync/about/roadmap/](https://cybersader.github.io/obsidian-folder-tag-sync/about/roadmap/) (single source of truth, edited at `docs/src/content/docs/about/roadmap.md`).

### ✅ Phase 1 — Core Functionality (shipped)
- [x] TypeScript + esbuild + Bun pipeline; 416+ automated tests
- [x] Transformation engine (case, emoji, number-prefix, custom regex)
- [x] Rule matching (priority + confidence tiebreak)
- [x] Settings UI with drag-to-reorder, guided modal, advanced regex modal
- [x] Folder → Tag and Tag → Folder synchronization
- [x] Manual sync commands

### ✅ Phase 2 — Typed model + rule packs (shipped)
- [x] Layer 2 typed model: `FolderClassifier` + `TagVocabulary` + `TransferOp`
- [x] Eight transfer-op primitives with bidirectional forward + inverse logic
- [x] Rule pack import (PARA, Johnny Decimal, SEACOW-cyberbase, Zettelkasten)
- [x] Vault-scan organizational-system detection
- [x] Layer-aware folder anchors (Phase G: `'root'` / `'any-segment'` / `{ under: 'X' }`)

### 🎯 Phase 2.5 — Resolution-engine refinement (near-term, designed)
- [ ] Refine `calculateMatchConfidence` with anchor-aware specificity (Formula 3 — alternation penalty, slot-aware, root/under bonuses) — pure refactor, no behavior change
- [ ] Audit shipped packs against the new formula vs. user-authored priority
- [ ] Swap sort order in `findBestMatch`: confidence becomes primary, priority becomes tiebreak override
- [ ] Add optional `group?: string` field for cross-pack precedence (CSS `@layer`-style)
- [ ] Rule-group precedence config + drag-to-reorder UI in settings
- [ ] Rename "Priority" → "Priority (override)" in rule editors

### 🎯 Phase 3 — Advanced Features
- [ ] Path templates (Phase H — bidirectional `Projects/{slug}` ↔ `#projects/{slug}` with bijection visible from slot overlap)
- [ ] Interactive conflict-resolution UI for genuinely ambiguous tag→folder cases
- [ ] Automatic sync on file events (create/move/rename)
- [ ] Bulk vault sync
- [ ] Plugin API for other plugins (Templater, QuickAdd integration)
- [ ] UI rule organization (collapsible groups, distinct from Phase 2.5 resolution-engine groups)

### 📋 Phase 4 — Polish & Community
- [ ] Rule pack marketplace
- [ ] Analytics (rule usage, errors, performance)
- [ ] Sync history + undo
- [ ] Mobile testing and optimization
- [ ] Visual rule builder

For the full per-feature breakdown — file paths to touch, prior-art surveys, prioritization notes — see the [canonical roadmap page](https://cybersader.github.io/obsidian-folder-tag-sync/about/roadmap/).

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
- **Runtime/package manager**: Bun (npm also works)
- **Build**: esbuild via Bun
- **Testing**: Bun test runner (416+ tests across engine, transformers, sync, UI plumbing)
- **Docs site**: Astro + Starlight (`docs/`), deployed to GitHub Pages on push to `main`
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
# Run all tests (416+ passing)
bun test

# Watch mode
bun test --watch

# Build and verify
bun run build && ls -lh main.js

# Docs site (Astro + Starlight)
cd docs
bun run dev          # local dev server with HMR
bun run build        # static build → docs/dist/
bun run smoke        # build + route-and-content smoke check
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
