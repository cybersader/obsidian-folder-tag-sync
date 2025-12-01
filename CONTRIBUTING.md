# Contributing to Dynamic Tags & Folders

Thank you for your interest in contributing! This guide will help you get set up for development.

## Table of Contents

1. [Development Environment](#development-environment)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Testing](#testing)
5. [Code Style](#code-style)
6. [Submitting Changes](#submitting-changes)
7. [Working with Claude Code](#working-with-claude-code)

---

## Development Environment

### Prerequisites

Choose ONE of the following package managers:

- **bun** (recommended) - Fast JavaScript runtime
  - [Install bun](https://bun.sh/)
- **npm** (alternative) - Comes with Node.js
  - [Install Node.js](https://nodejs.org/)

### Supported Environments

This plugin can be developed in multiple environments:

| Environment | Package Manager | Notes |
|-------------|----------------|-------|
| **WSL** | bun or npm | Recommended for Windows users |
| **PowerShell** | bun or npm | Windows native |
| **Linux** | bun or npm | Native Linux |
| **macOS** | bun or npm | Intel or Apple Silicon |

**Important**: Due to esbuild platform binaries, you should install dependencies in the same environment where you'll run the build. See [TESTING_GUIDE.md](./TESTING_GUIDE.md#common-issues) for platform-specific issues.

---

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/cybersader/obsidian-tag-and-folder-mapper.git
cd obsidian-tag-and-folder-mapper
```

### 2. Install Dependencies

**Using bun (recommended):**
```bash
bun install
```

**Using npm:**
```bash
npm install
```

### 3. Verify Installation

```bash
# Check that tests pass
bun test
# or
npm test

# Check that TypeScript compiles
bun x tsc -noEmit -skipLibCheck
# or
npx tsc -noEmit -skipLibCheck
```

You should see:
- ✅ 156 tests passing
- ✅ No TypeScript errors

---

## Development Workflow

### File Structure

```
src/
├── main.ts                      # Plugin entry point
├── types/
│   └── settings.ts             # TypeScript interfaces
├── transformers/               # Transformation engines
│   ├── caseTransformers.ts     # Case conversions
│   ├── emojiTransformers.ts    # Emoji handling
│   ├── numberTransformers.ts   # Number prefixes
│   ├── regexTransformers.ts    # Regex & glob patterns
│   ├── pipeline.ts             # Orchestration
│   └── *.test.ts               # Unit tests (colocated)
├── engine/
│   └── ruleMatcher.ts          # Rule evaluation
├── ui/
│   ├── SettingsTab.ts          # Settings interface
│   └── RuleEditorModal.ts      # Rule creation UI
└── sync/                       # (Phase 3 - coming soon)
    ├── FolderToTagSync.ts
    └── TagToFolderSync.ts
```

### Development Commands

```bash
# Run tests (156 passing)
bun test

# Run tests in watch mode (auto-rerun on changes)
bun test --watch

# TypeScript type checking
bun x tsc -noEmit -skipLibCheck

# Build for development (watch mode)
bun run dev

# Build for production
bun run build

# Platform-aware build (auto-detects environment)
node scripts/build.mjs
```

### Making Changes

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow the existing code style
   - Add tests for new functionality
   - Update documentation if needed

3. **Run tests**
   ```bash
   bun test
   ```

4. **Type check**
   ```bash
   bun x tsc -noEmit -skipLibCheck
   ```

5. **Test in Obsidian**
   - See [TESTING_GUIDE.md](./TESTING_GUIDE.md) for detailed instructions
   - Create a symlink to your vault for live testing
   - Use Hot Reload plugin for faster iteration

6. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

---

## Testing

### Unit Tests

All transformer modules have comprehensive test coverage:

```bash
# Run all tests
bun test

# Run specific test file
bun test src/transformers/caseTransformers.test.ts

# Run tests matching a pattern
bun test --test-name-pattern="snake_case"
```

**Test Coverage:**
- Case transformers: 20 tests
- Emoji transformers: 21 tests
- Number transformers: 26 tests
- Regex transformers: 40 tests
- Pipeline: 28 tests
- Rule matcher: 27 tests

**Total: 156 tests ✅**

### Integration Testing

1. **Create a test vault** - See [TESTING_GUIDE.md](./TESTING_GUIDE.md#creating-a-test-vault)

2. **Test the UI**
   - Open Obsidian with the test vault
   - Enable the plugin
   - Test rule creation, editing, drag-and-drop, etc.

3. **Test transformations**
   - Create rules with different transformation configs
   - Use the preview feature in the rule editor
   - Verify transformations work as expected

### Writing Tests

When adding new features, include tests:

```typescript
// src/transformers/myNewTransformer.test.ts
import { describe, test, expect } from 'bun:test';
import { myNewFunction } from './myNewTransformer';

describe('myNewFunction', () => {
	test('handles basic case', () => {
		expect(myNewFunction('input')).toBe('expected output');
	});

	test('handles edge case', () => {
		expect(myNewFunction('')).toBe('');
	});
});
```

---

## Code Style

### TypeScript

- **Strict mode enabled** - All type safety features on
- **No implicit any** - Always specify types
- **Prefer explicit types** for public APIs
- **Use interfaces** over type aliases for objects

### Naming Conventions

- **Files**: camelCase.ts (e.g., `caseTransformers.ts`)
- **Classes**: PascalCase (e.g., `RuleEditorModal`)
- **Functions**: camelCase (e.g., `applyTransform`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `DEFAULT_SETTINGS`)
- **Interfaces**: PascalCase (e.g., `MappingRule`)

### Code Organization

- **Colocate tests** - Keep `*.test.ts` next to `*.ts`
- **One export per file** for main functionality
- **Use barrel exports** (`index.ts`) for modules
- **Document complex logic** with comments

### Commenting

```typescript
/**
 * JSDoc for public APIs
 *
 * @param input - Description of parameter
 * @returns Description of return value
 */
export function publicFunction(input: string): string {
	// Inline comments for complex logic
	const result = complexOperation(input);
	return result;
}
```

---

## Submitting Changes

### Pull Request Process

1. **Fork the repository**

2. **Create a feature branch**
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make your changes**
   - Write code
   - Add tests
   - Update docs

4. **Ensure quality**
   ```bash
   # All tests pass
   bun test

   # No TypeScript errors
   bun x tsc -noEmit -skipLibCheck

   # Code builds successfully
   node scripts/build.mjs
   ```

5. **Commit with conventional commits**
   ```bash
   git commit -m "feat: add amazing feature"
   ```

   Types:
   - `feat:` - New feature
   - `fix:` - Bug fix
   - `docs:` - Documentation changes
   - `test:` - Test additions/changes
   - `refactor:` - Code refactoring
   - `chore:` - Build process, dependencies

6. **Push to your fork**
   ```bash
   git push origin feature/amazing-feature
   ```

7. **Open a pull request**
   - Describe what changed and why
   - Reference any related issues
   - Include screenshots for UI changes
   - Note which environments you tested in

### PR Checklist

- [ ] Tests pass (`bun test`)
- [ ] TypeScript compiles (`bun x tsc -noEmit`)
- [ ] Plugin builds (`node scripts/build.mjs`)
- [ ] Tested in Obsidian
- [ ] Documentation updated
- [ ] Conventional commit message
- [ ] No merge conflicts

---

## Working with Claude Code

This project is actively developed with Claude Code. Here are some tips:

### Environment Considerations

**Claude Code** may run commands with different permissions or in a different environment than your normal shell. This affects:

1. **File permissions** - Files created by Claude Code may be owned by root
2. **Package installation** - Dependencies might be installed for a different platform
3. **Build artifacts** - Compiled files might not work in your environment

### Best Practices

#### 1. Separate Environments

- **Let Claude Code handle**: TypeScript compilation, testing
- **You handle**: Final builds, Obsidian testing, git commits

#### 2. Platform-Aware Building

Use the platform-aware build script:

```bash
# This auto-detects your environment
node scripts/build.mjs
```

Instead of:
```bash
# This might use wrong platform binaries
bun run build
```

#### 3. Fix Permission Issues (WSL)

If Claude Code creates files as root:

```bash
# Fix ownership
sudo chown -R $USER:$USER .

# Then reinstall dependencies in your environment
rm -rf node_modules
bun install
```

#### 4. Verify Tests Independently

After Claude Code makes changes:

```bash
# Run tests yourself to verify
bun test

# Check TypeScript compilation
bun x tsc -noEmit
```

### Communication with Claude Code

When working with Claude Code:

1. **Specify your environment** - "I'm in WSL" or "I'm using PowerShell"
2. **Mention platform issues** - "This might have permission differences"
3. **Test the changes** - Always test in Obsidian yourself
4. **Report results** - Let Claude Code know if tests pass/fail

---

## Development Phases

The project is being developed in phases:

### ✅ Phase 1: Foundation (Complete)
- TypeScript setup with strict mode
- Transformation engines (case, emoji, number, regex)
- Transformation pipeline
- Rule matching engine
- **156 tests passing**

### ✅ Phase 2: User Interface (Complete)
- Settings tab with rule management
- Rule editor modal
- Drag-and-drop priority reordering
- Import/export settings
- Live transformation preview

### 🚧 Phase 3: Core Sync Engine (Next)
- File event watchers
- Folder → Tag synchronization
- Tag → Folder synchronization
- Frontmatter manipulation

### 📋 Phase 4: Advanced Features
- Entry points and flattening
- Exclusion patterns
- Breadth vs depth preferences
- Untagged note handling

### 🔌 Phase 5: Integrations
- Folder notes support
- Plugin API for QuickAdd, Templater
- Commands and hotkeys

See [README.md](./README.md#roadmap) for the complete roadmap.

---

## Getting Help

- **Documentation**: Check [TESTING_GUIDE.md](./TESTING_GUIDE.md) and [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md)
- **Issues**: Search [existing issues](https://github.com/cybersader/obsidian-tag-and-folder-mapper/issues) first
- **Discussions**: Ask questions in [Discussions](https://github.com/cybersader/obsidian-tag-and-folder-mapper/discussions)
- **Discord**: Join the Obsidian Discord and ask in #plugin-dev

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
