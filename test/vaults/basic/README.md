# basic test vault

Minimal sandbox vault for Folder Tag Sync E2E tests. wdio-obsidian-service
copies this into a per-test working directory and installs the plugin, so
this folder stays read-only from the tests' perspective.

## What's here

- A single `README.md` (this file) so the vault isn't empty
- Intentionally no `.obsidian/plugins/` — the wdio service installs the
  plugin into the per-run copy
