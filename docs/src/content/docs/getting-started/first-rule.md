---
title: Your first rule
description: Use Taxonomy Workbench to turn a recognized folder system into safe disabled rule drafts, or create a custom rule when the system is unique.
sidebar:
  order: 2
---

The easiest first rule starts from the folder structure you already have. Taxonomy Workbench recognizes bundled systems such as PARA, Johnny Decimal, and SEACOW, lets you choose where they apply, and saves the resulting rules **disabled** for review.

> [!caution] Unreleased local workflow
> This page describes the current local Workbench refinement. It has not been versioned, committed, pushed, released through BRAT, or published; publication requires separate authorization after local verification.

## Recommended: use Taxonomy Workbench

### 1. Explore your vault

Run **Taxonomy Workbench: explore your vault** from the command palette.

Open **Organizational systems**. **Organizational systems in this vault** is a global overview shared by Explore, Choose, and Review; selecting one occurrence does not filter the overview to that system.

- **Ready organizational systems** have enough occurrence-local folder evidence to propose rules.
- **Organizational systems needing more folders** are inspect-only and explain which folder types or required parent system are missing.

Choose a Ready organizational system. Its identifying evidence expands directly beneath the selected card and scrolls with the card list; it is intentionally not a sticky header. The small occurrence marker follows that exact occurrence across surfaces, but the organizational system name, status, relationship text, and **Recognized here** path remain the accessible source of truth.

Choosing a card only focuses it; it does not add, enable, or filter rules. Click **Choose where this system applies** to make the explicit transition.

### 2. Choose where rules apply

Check the highest folder you want Folder Tag Sync to organize. Everything below that folder is included.

The **Current organizational system** is context only. It may receive a **Current focus** cue, but it never filters Scope: checked folders are the sole input that decides which Ready occurrences continue.

Rows reserve stable space for the scope rail, checkbox, and disclosure control, so parent, leaf, selected, absorbed, and inspect-only rows stay aligned as branches open and close. The horizontal **Resize folder chooser and plan** separator is keyboard accessible (Arrow Up/Down, Shift+Arrow, Home/End) and can be double-clicked to restore the default. Its preferred height and both scroll positions are view-local to the open Workbench.

The **What happens next** summary separates:

- the folders you included; and
- the detected systems that will propose rules from their correct starting folders.

Click **Review proposed rules for N organizational systems**.

### 3. Review proposed rules

Each proposed rule shows:

- the exact organizational-system occurrence it came from;
- where it applies;
- how many folders it matches;
- sample `folder → #tag` output;
- independent **Folder → tag** and **Tag → folder** status, including loss or uncertainty;
- exact overlap targets and the predicted winner by rule name.

In a **Rule overlap** section, a proposed-rule target focuses and briefly highlights that exact row without changing any checkboxes. An installed-rule target opens Settings centered on that exact rule.

Checked proposals are selected to save. Click **Save N draft rules**, then confirm.

> [!important] Safe by default
> Saved Workbench rules are added disabled. Saving does not run sync or change files, folders, tags, or frontmatter.

### 4. Review in Settings

Use the single post-save Settings action. Folder Tag Sync centers and briefly highlights the exact first saved draft.

Inspect its examples and warnings. Enable it only when you deliberately want it to participate in sync.

## Custom structure: create a rule manually

If your folder system is not recognized, open **Settings → Community plugins → Folder Tag Sync** and click **Add new rule**.

For a simple folder-to-tag rule that maps `Projects/*` to `#projects/*`:

1. Choose **Folder → tag**.
2. Use the folder pattern:

   ```text
   ^projects/(.*)$
   ```

3. Use the tag entry point:

   ```text
   projects/
   ```

4. Optionally enable **Strip emoji** and **snake_case** transformations.
5. Save the rule, review its preview, and enable it deliberately.
6. Test with a disposable note before using it across the vault.

## Next steps

- Read the [feature overview](/obsidian-folder-tag-sync/features/overview/) for Workbench, sync, and safety capabilities.
- Read the [transformations reference](/obsidian-folder-tag-sync/reference/transformations/) for the full pipeline.
- Review [rule priority and conflicts](/obsidian-folder-tag-sync/concepts/tag-depth/) before enabling overlapping rules.
