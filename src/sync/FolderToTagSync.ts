import { App, TFile, Notice } from 'obsidian';
import type { DynamicTagsFoldersSettings, MappingRule } from '../types/settings';
import { DebugLogger } from '../utils/debug';
import { findMatchingRules, findBestMatch } from '../engine/ruleMatcher';
import { applyTransformPipeline } from '../transformers/pipeline';
import { applyRuleForward } from '../engine/applyTransfer';
import { injectWitness as injectWitnessFn, parseWitness as parseWitnessFn } from './frontmatterWitness';
import { parseFrontmatterTags, setFrontmatterTags } from './frontmatterTags';

/**
 * Handles folder-to-tag synchronization
 * When a file is in a folder, adds appropriate tags based on rules
 */
export class FolderToTagSync {
  constructor(
    private app: App,
    private settings: DynamicTagsFoldersSettings,
    private logger: DebugLogger
  ) {}

  /**
   * Sync a single file: read its folder path and add appropriate tags
   */
  async syncFile(file: TFile): Promise<SyncResult> {
    await this.logger.info('Starting folder-to-tag sync', {
      file: file.path,
      folder: file.parent?.path
    });

    try {
      // Get file's folder path
      const folderPath = file.parent?.path || '';

      // Find matching rules (used for logging count + names)
      const matchingRules = findMatchingRules(folderPath, this.settings.rules, {
        input: folderPath,
        matchType: 'folder',
        direction: 'folder-to-tag'
      });

      if (matchingRules.length === 0) {
        await this.logger.info('No matching rules found', { folderPath });
        return {
          success: true,
          tagsAdded: [],
          tagsRemoved: [],
          message: 'No matching rules'
        };
      }

      await this.logger.info('Found matching rules', {
        count: matchingRules.length,
        rules: matchingRules.map((r: { rule: MappingRule }) => r.rule.name)
      });

      // F1 Step 3 — Use findBestMatch so group-precedence + specificity-aware
      // resolution actually take effect. Earlier code took matchingRules[0]
      // directly, which bypassed Step 1+2's sort-order swap.
      const bestMatch = findBestMatch(folderPath, this.settings.rules, {
        input: folderPath,
        matchType: 'folder',
        direction: 'folder-to-tag'
      }, this.settings.groupPrecedence);

      if (!bestMatch) {
        // Defensive: findMatchingRules returned matches but findBestMatch
        // didn't (shouldn't happen). Fall back to first match.
        await this.logger.warn('findBestMatch returned null despite matches; using first match');
      }

      const { rule } = bestMatch ?? matchingRules[0];

      // Check if rule supports folder-to-tag
      if (rule.direction === 'tag-to-folder') {
        await this.logger.warn('Rule only supports tag-to-folder, skipping', {
          rule: rule.name
        });
        return {
          success: true,
          tagsAdded: [],
          tagsRemoved: [],
          message: 'Rule only supports tag-to-folder'
        };
      }

      // Transform folder path to tag(s) — may emit zero, one, or many tags
      // depending on the rule's transfer op (opaque ⇒ 0; identity / truncation /
      // marker-only / promotion / flattening / aggregation ⇒ 1; post-coordination ⇒ N).
      const tags = await this.transformFolderToTag(folderPath, rule);

      if (tags.length === 0) {
        await this.logger.info('Rule produced no tags (opaque or empty)', {
          folderPath,
          rule: rule.name,
        });
        return {
          success: true,
          tagsAdded: [],
          tagsRemoved: [],
          message: 'Rule produced no tags',
        };
      }

      await this.logger.info('Transformed folder to tag(s)', {
        folderPath,
        tags,
      });

      // Read current file content
      const content = await this.app.vault.read(file);

      // Parse frontmatter and tags
      const { frontmatter, body } = this.parseFrontmatter(content);
      const currentTags = this.extractTags(frontmatter);

      // Metadata-cache fallback for the WRITE DECISION only. Obsidian's own
      // parser (via metadataCache.frontmatter.tags) handles shapes our line
      // parser intentionally can't (e.g. multiline flow arrays) and removes the
      // FolderToTag/TagToFolder read asymmetry. We union it with the
      // text-parsed tags ONLY to decide what's new — the block we actually
      // reconstruct is still based on `currentTags` (freshly text-parsed), so a
      // stale cache can suppress a duplicate add (safe) but can never resurrect
      // a tag the user just deleted.
      const cacheTags = this.cacheFrontmatterTags(file);
      const existingForDecision = new Set([...currentTags, ...cacheTags]);

      const newTagsToAdd = tags.filter((t) => !existingForDecision.has(t));

      // A6 — orphan cleanup. When `removeOrphanedTags: true` AND the file
      // has an `fts:` witness from a prior sync, identify FTS-owned tags
      // that are no longer emitted and remove them. Without the witness,
      // we can't tell which tags FTS owns vs which the user added —
      // skipping cleanup is the safe behavior.
      let tagsToRemove: string[] = [];
      if (rule.options.removeOrphanedTags) {
        const witness = this.parseWitness(frontmatter);
        if (witness) {
          // FTS-owned tags from prior sync are listed in witness.tags.
          // Emitted tags now (from current rule + path) are `tags`.
          // Remove tags that were FTS-owned but are no longer emitted.
          const emittedNow = new Set(tags.map((t) => t.replace(/^#/, '')));
          tagsToRemove = witness.tags
            .filter((witnessed) => !emittedNow.has(witnessed))
            .map((t) => `#${t}`)
            .filter((withHash) => currentTags.includes(withHash));
        }
      }

      if (newTagsToAdd.length === 0 && tagsToRemove.length === 0) {
        await this.logger.info('All emitted tags already present, no orphans, no changes needed', { tags });
        return {
          success: true,
          tagsAdded: [],
          tagsRemoved: [],
          message: 'Tags already exist',
        };
      }

      // Compute final tag set: existing tags + new ones to add, MINUS orphans
      const tagsToRemoveSet = new Set(tagsToRemove);
      const updatedTags = [...currentTags.filter((t) => !tagsToRemoveSet.has(t)), ...newTagsToAdd];
      let newFrontmatter = this.updateTags(frontmatter, updatedTags);

      // F3 commit 1 — Passive frontmatter witness: when the rule has
      // `frontmatterMemory: true`, write a tracking record so future syncs
      // (and orphan cleanup) know which tags FTS owns and where this file
      // came from. Off by default (explicit opt-in).
      if (rule.options.frontmatterMemory) {
        const witness = {
          origin: folderPath,
          ruleId: rule.id,
          tags: updatedTags.map((t) => t.replace(/^#/, '')),
          timestamp: new Date().toISOString(),
        };
        newFrontmatter = this.injectWitness(newFrontmatter, witness);
      }

      const newContent = this.reconstructFile(newFrontmatter, body);

      // Write back to file
      await this.app.vault.modify(file, newContent);

      await this.logger.info('Successfully added/removed tag(s)', {
        added: newTagsToAdd,
        removed: tagsToRemove,
        file: file.path,
        witnessWritten: !!rule.options.frontmatterMemory,
      });

      if (this.settings.options.showNotifications) {
        const addedMsg = newTagsToAdd.length > 0 ? `Added ${newTagsToAdd.length} tag(s)` : '';
        const removedMsg = tagsToRemove.length > 0 ? `removed ${tagsToRemove.length} orphan(s)` : '';
        const summary = [addedMsg, removedMsg].filter(Boolean).join('; ');
        new Notice(summary || 'Tags up to date');
      }

      return {
        success: true,
        tagsAdded: newTagsToAdd,
        tagsRemoved: tagsToRemove,
        message: 'Tag(s) updated successfully',
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.logger.error('Sync failed', {
        file: file.path,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });

      return {
        success: false,
        tagsAdded: [],
        tagsRemoved: [],
        error: errorMessage
      };
    }
  }

  /**
   * Transform folder path to one or more tags.
   *
   * Delegates to the pure `applyRuleForward` — this method exists only to
   * adapt the result into the sync-engine's logged async context. The
   * library-science pipeline (match → extract → recoordinate → transform →
   * emit) lives in `engine/applyTransfer.ts` where it can be unit-tested
   * without instantiating the sync engine.
   */
  private async transformFolderToTag(folderPath: string, rule: MappingRule): Promise<string[]> {
    try {
      const result = applyRuleForward(folderPath, rule);
      await this.logger.info('Recoordinated folder→tag', {
        originalPath: folderPath,
        op: rule.transfer?.op ?? 'identity',
        emitted: result.tags,
        lossy: result.lossy,
        rule: rule.name,
      });
      return result.tags;
    } catch (error) {
      await this.logger.error('Transformation error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return [];
    }
  }

  /**
   * Parse frontmatter from markdown content.
   *
   * The closing-fence newline is optional so a file whose frontmatter ends at
   * EOF with no trailing newline (some template-created notes) is still
   * recognized as having frontmatter, instead of being treated as bodyless and
   * getting a second frontmatter block prepended on write.
   */
  private parseFrontmatter(content: string): { frontmatter: string; body: string } {
    const fmRegex = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/;
    const match = content.match(fmRegex);

    if (match) {
      return {
        frontmatter: match[1],
        body: match[2] ?? ''
      };
    }

    return {
      frontmatter: '',
      body: content
    };
  }

  /**
   * Extract tags from frontmatter. Delegates to the pure, line-based parser in
   * `frontmatterTags.ts`, which correctly reads inline scalars, inline arrays,
   * and block lists (including the plugin's own canonical output), heals
   * glued-duplicate corruption, and dedupes — returning `#`-prefixed tags.
   */
  private extractTags(frontmatter: string): string[] {
    return parseFrontmatterTags(frontmatter);
  }

  /**
   * Read the file's frontmatter `tags` via Obsidian's own parser (metadata
   * cache). Used only as a fallback for the write DECISION — never to
   * reconstruct the written block. Reads ONLY `frontmatter.tags` (the property),
   * deliberately NOT `cache.tags` (inline body tags), so body tags are never
   * promoted into the frontmatter property. Returns `#`-prefixed tags.
   */
  private cacheFrontmatterTags(file: TFile): string[] {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      const fmTags = cache?.frontmatter?.tags;
      if (fmTags == null) return [];
      const raw = Array.isArray(fmTags) ? fmTags : [fmTags];
      return raw
        .map((t) => String(t).trim())
        .filter((t) => t.length > 0)
        .map((t) => (t.startsWith('#') ? t : `#${t}`));
    } catch {
      return [];
    }
  }

  /**
   * Update tags in frontmatter. Delegates to the pure `setFrontmatterTags`,
   * which replaces ANY existing tags shape (scalar / array / block list,
   * before or after other properties) by whole-line span — never a regex
   * substitution — so it can't append a second `tags:` block or leave an old
   * value dangling.
   */
  private updateTags(frontmatter: string, tags: string[]): string {
    return setFrontmatterTags(frontmatter, tags);
  }

  private parseWitness(frontmatter: string): { origin: string; ruleId: string; tags: string[] } | null {
    return parseWitnessFn(frontmatter);
  }

  private injectWitness(
    frontmatter: string,
    witness: { origin: string; ruleId: string; tags: string[]; timestamp: string },
  ): string {
    return injectWitnessFn(frontmatter, witness);
  }

  /**
   * Reconstruct file content with updated frontmatter
   */
  private reconstructFile(frontmatter: string, body: string): string {
    if (!frontmatter.trim()) {
      return body;
    }

    return `---\n${frontmatter}\n---\n${body}`;
  }

  /**
   * Preview what would happen if we ran forward sync on every markdown file
   * in the vault — without actually modifying any files. Used by the
   * 'Preview vault sync' command to give users confidence before bulk-applying.
   */
  async previewVault(): Promise<VaultPreviewResult> {
    const allFiles = this.app.vault.getMarkdownFiles();
    const items: VaultPreviewItem[] = [];
    let filesAffected = 0;
    let filesUnchanged = 0;
    let filesNoMatch = 0;
    let totalTagsToAdd = 0;

    for (const file of allFiles) {
      const folderPath = file.parent?.path || '';
      const bestMatch = findBestMatch(folderPath, this.settings.rules, {
        input: folderPath,
        matchType: 'folder',
        direction: 'folder-to-tag'
      }, this.settings.groupPrecedence);

      if (!bestMatch) {
        filesNoMatch++;
        continue;
      }

      const { rule } = bestMatch;
      if (rule.direction === 'tag-to-folder') {
        filesNoMatch++;
        continue;
      }

      const tags = await this.transformFolderToTag(folderPath, rule);
      if (tags.length === 0) {
        filesNoMatch++;
        continue;
      }

      // Read frontmatter to compute currentTags + diff (but DO NOT write).
      // Mirror syncFile's metadata-cache union so the preview doesn't report
      // phantom additions for files that already carry their folder tag in a
      // YAML shape the line parser can't read (e.g. multiline flow arrays).
      let textTags: string[] = [];
      try {
        const content = await this.app.vault.read(file);
        const { frontmatter } = this.parseFrontmatter(content);
        textTags = this.extractTags(frontmatter);
      } catch {
        // unreadable; treat as empty current
      }
      const currentTags = [...new Set([...textTags, ...this.cacheFrontmatterTags(file)])];
      const tagsToAdd = tags.filter(t => !currentTags.includes(t));

      if (tagsToAdd.length > 0) {
        filesAffected++;
        totalTagsToAdd += tagsToAdd.length;
        // Cap raised from 100 → 1000 because the hierarchical preview tree
        // collapses subtrees on demand, so larger samples are still navigable.
        if (items.length < 1000) {
          items.push({
            filePath: file.path,
            folderPath,
            matchedRule: rule.name,
            currentTags,
            tagsToAdd,
          });
        }
      } else {
        filesUnchanged++;
      }
    }

    return {
      totalFiles: allFiles.length,
      filesAffected,
      filesUnchanged,
      filesNoMatch,
      items,
      totalTagsToAdd,
    };
  }

  /**
   * Run forward sync on every markdown file. Reports progress via callback.
   * Returns aggregate result. Errors per file logged but don't abort the run.
   */
  async syncVault(
    progressCallback?: (current: number, total: number, file: string) => void,
    onlyPaths?: Set<string>,
  ): Promise<VaultSyncResult> {
    const allFiles = this.app.vault.getMarkdownFiles();
    // If `onlyPaths` is supplied, restrict to just those files (selective apply
    // from the preview modal). Otherwise process the entire vault.
    const targetFiles = onlyPaths
      ? allFiles.filter((f) => onlyPaths.has(f.path))
      : allFiles;
    let filesProcessed = 0;
    let filesAffected = 0;
    let totalTagsAdded = 0;
    const errors: Array<{ file: string; error: string }> = [];

    for (let i = 0; i < targetFiles.length; i++) {
      const file = targetFiles[i];
      progressCallback?.(i + 1, targetFiles.length, file.path);
      try {
        const result = await this.syncFile(file);
        filesProcessed++;
        if (result.tagsAdded.length > 0) {
          filesAffected++;
          totalTagsAdded += result.tagsAdded.length;
        }
      } catch (err) {
        errors.push({
          file: file.path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      totalFiles: targetFiles.length,
      filesProcessed,
      filesAffected,
      totalTagsAdded,
      errors,
    };
  }
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean;
  tagsAdded: string[];
  tagsRemoved: string[];
  message?: string;
  error?: string;
}

export interface VaultPreviewItem {
  filePath: string;
  folderPath: string;
  matchedRule: string;
  currentTags: string[];
  tagsToAdd: string[];
}

export interface VaultPreviewResult {
  totalFiles: number;
  filesAffected: number;
  filesUnchanged: number;
  filesNoMatch: number;
  items: VaultPreviewItem[]; // capped at 100 for display
  totalTagsToAdd: number;
}

export interface VaultSyncResult {
  totalFiles: number;
  filesProcessed: number;
  filesAffected: number;
  totalTagsAdded: number;
  errors: Array<{ file: string; error: string }>;
}
