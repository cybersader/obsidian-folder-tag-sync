---
title: Installation
description: Install Folder Tag Sync from the Obsidian community plugin browser or manually from GitHub.
sidebar:
  order: 1
---

## Requirements

- Obsidian 0.15.0 or later
- Desktop or mobile

## From community plugins (recommended)

> [!NOTE]
> Pending approval in the Obsidian community plugin directory. Until then, use manual installation.

1. Open **Settings** → **Community plugins**
2. Click **Browse** and search for "Folder Tag Sync"
3. Click **Install**, then **Enable**

## Manual installation

1. Download the latest release from [GitHub releases](https://github.com/cybersader/obsidian-folder-tag-sync/releases/latest):
   - `main.js`
   - `manifest.json`
   - `styles.css` (if present)
2. Create a folder in your vault at `.obsidian/plugins/folder-tag-sync/`
3. Place the downloaded files inside that folder
4. Restart Obsidian
5. Go to **Settings** → **Community plugins** and enable **Folder Tag Sync**

## Via BRAT

If you use [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Open BRAT settings
2. Click **Add Beta plugin**
3. Enter `cybersader/obsidian-folder-tag-sync`
4. Enable the plugin after installation

## Verify installation

Open the command palette (`Ctrl/Cmd + P`) and search for "Folder Tag Sync". You should see commands like:

- **Folder Tag Sync: Sync folder to tags (current file)**
- **Folder Tag Sync: Sync tags to folder (current file)**
