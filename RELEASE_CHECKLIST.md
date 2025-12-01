# Release Checklist

Use this checklist before creating each GitHub release.

## Pre-Release Checks

### Code Quality
- [ ] All tests passing (`bun test`)
- [ ] No TypeScript errors (`bun run build`)
- [ ] No console.log statements in production code
- [ ] Code is well-commented
- [ ] No personal information in code or docs

### Documentation
- [ ] README.md is up to date
- [ ] CHANGELOG.md updated with changes (if exists)
- [ ] All new features documented
- [ ] Breaking changes clearly noted

### Version Management
- [ ] manifest.json version bumped (e.g., 0.1.0 → 0.1.1)
- [ ] versions.json updated with new version
- [ ] Version follows semantic versioning

### Testing
- [ ] Tested in Obsidian desktop
- [ ] Tested in Obsidian mobile (or confirmed desktop-only)
- [ ] Tested with clean vault
- [ ] Tested with existing user data
- [ ] No data loss scenarios

## Build Process

```bash
# 1. Clean build
rm -f main.js main.js.map
bun run build

# 2. Verify build succeeded
ls -lh main.js

# 3. Test the built plugin in Obsidian
# Copy to test vault and verify it works
```

## Git Operations

```bash
# 1. Commit version bump
git add manifest.json versions.json
git commit -m "Bump version to 0.X.Y"

# 2. Create and push tag
git tag 0.X.Y
git push origin main
git push origin 0.X.Y
```

## GitHub Release

1. Go to: https://github.com/cybersader/obsidian-tag-and-folder-mapper/releases/new

2. Fill in:
   - **Tag**: 0.X.Y (select the tag you just pushed)
   - **Release title**: 0.X.Y
   - **Description**:
     ```markdown
     ## What's New
     - Feature 1
     - Feature 2

     ## Bug Fixes
     - Fix 1
     - Fix 2

     ## Known Issues
     - Issue 1 (if any)
     ```

3. Attach files:
   - `main.js` (REQUIRED)
   - `manifest.json` (REQUIRED)
   - `styles.css` (if you have custom styles)

4. **Important**:
   - [ ] Do NOT check "Set as pre-release" for stable releases
   - [ ] Do NOT check "Set as latest release" if this is a beta

5. Click "Publish release"

## Post-Release

- [ ] Test installation via community plugins (after approval)
- [ ] Monitor GitHub issues for bug reports
- [ ] Respond to user questions
- [ ] Update documentation based on feedback

## Beta Testing (Before Official Submission)

Before submitting to Obsidian community plugins:

1. Release several beta versions (0.1.0, 0.1.1, etc.)
2. Have users install via BRAT plugin
3. Gather feedback and fix bugs
4. Iterate until stable

## Version Numbering Guide

- **0.1.0** - First beta release, basic features working
- **0.1.X** - Bug fixes and minor improvements
- **0.2.0** - New features added
- **0.X.0** - Major feature milestones
- **1.0.0** - Production-ready, fully tested, stable

## Common Mistakes to Avoid

❌ Don't commit main.js to the repo (only in releases)
❌ Don't forget to update versions.json
❌ Don't create releases without testing
❌ Don't skip version numbering (0.1.0 → 0.3.0)
❌ Don't include test vault data in releases

✅ Do test thoroughly before each release
✅ Do write clear release notes
✅ Do respond to user issues promptly
✅ Do keep a CHANGELOG.md (optional but recommended)

## Quick Command Reference

```bash
# Build
bun run build

# Test
bun test

# Version bump (example)
# Edit manifest.json and versions.json manually

# Git workflow
git add .
git commit -m "Descriptive message"
git tag 0.X.Y
git push && git push --tags

# Clean build artifacts
rm -f main.js main.js.map
```
