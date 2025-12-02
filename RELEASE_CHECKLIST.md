# Release Checklist

Use this checklist before creating each GitHub release.

## Automated Releases (Recommended)

This plugin uses **GitHub Actions** to automate releases. When you push a tag, it automatically:
1. Builds the plugin
2. Creates a GitHub release
3. Attaches `main.js`, `manifest.json`, and `styles.css`

### How to Release (Automated)

```bash
# 1. Update version in manifest.json and versions.json
# Edit manifest.json: "version": "0.1.1"
# Edit versions.json: add "0.1.1": "0.15.0"

# 2. Commit the version bump
git add manifest.json versions.json
git commit -m "Bump version to 0.1.1"

# 3. Create and push the tag (this triggers the release)
git tag 0.1.1
git push origin main
git push origin 0.1.1
```

That's it! GitHub Actions handles the rest. Check the "Actions" tab on GitHub to monitor progress.

### GitHub Actions Workflow

The workflow file is at `.github/workflows/release.yml`. It:
- Triggers on any tag push
- Sets up Node.js and Bun
- Installs dependencies
- Builds the plugin
- Creates a release with the required files

**Important:** You must enable workflow permissions first:
1. Go to: https://github.com/cybersader/obsidian-folder-tag-sync/settings/actions
2. Scroll to **"Workflow permissions"**
3. Select **"Read and write permissions"**
4. Click **Save**

---

## Manual Releases (Fallback)

If GitHub Actions fails or you need manual control:

1. Go to: https://github.com/cybersader/obsidian-folder-tag-sync/releases/new
2. Fill in:
   - **Tag**: Select the tag you pushed (e.g., `0.1.1`)
   - **Release title**: `0.1.1`
   - **Description**: Release notes
3. Attach files from your local build:
   - `main.js` (REQUIRED)
   - `manifest.json` (REQUIRED)
   - `styles.css` (REQUIRED)
4. Click "Publish release"

---

## Pre-Release Checks

### Code Quality
- [ ] All tests passing (`bun test`)
- [ ] No TypeScript errors (`bun run build`)
- [ ] No console.log statements in production code
- [ ] No personal information in code or docs

### Documentation
- [ ] README.md is up to date
- [ ] All new features documented
- [ ] Breaking changes clearly noted

### Version Management
- [ ] manifest.json version bumped
- [ ] versions.json updated with new version
- [ ] Version follows semantic versioning

### Testing
- [ ] Tested in Obsidian desktop
- [ ] Tested in Obsidian mobile (or confirmed desktop-only)
- [ ] Tested with clean vault
- [ ] No data loss scenarios

---

## Version Numbering Guide

- **0.1.0** - First beta release, basic features working
- **0.1.X** - Bug fixes and minor improvements
- **0.2.0** - New features added
- **0.X.0** - Major feature milestones
- **1.0.0** - Production-ready, fully tested, stable

## Common Mistakes to Avoid

- Don't commit main.js to the repo (only in releases)
- Don't forget to update versions.json
- Don't create releases without testing
- Don't skip version numbering (0.1.0 → 0.3.0)
- Don't include test vault data in releases

## Quick Command Reference

```bash
# Build locally (for testing)
bun run build

# Run tests
bun test

# Full release workflow
git add manifest.json versions.json
git commit -m "Bump version to X.Y.Z"
git tag X.Y.Z
git push origin main
git push origin X.Y.Z
# GitHub Actions handles the rest!
```
