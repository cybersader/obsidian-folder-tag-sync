import { App, TFile, Notice, MetadataCache } from 'obsidian';
import type { DynamicTagsFoldersSettings, MappingRule } from '../types/settings';
import { DebugLogger } from '../utils/debug';
import { findMatchingRules } from '../engine/ruleMatcher';
import { applyTransformPipeline } from '../transformers/pipeline';

/**
 * Handles tag-to-folder synchronization
 * When tags are added/changed, moves files to appropriate folders based on rules
 */
export class TagToFolderSync {
  constructor(
    private app: App,
    private settings: DynamicTagsFoldersSettings,
    private logger: DebugLogger
  ) {}

  /**
   * Sync a single file: read its tags and determine target folder
   */
  async syncFile(file: TFile): Promise<SyncResult> {
    await this.logger.info('Starting tag-to-folder sync', {
      file: file.path,
      currentFolder: file.parent?.path
    });

    try {
      // Extract tags from file using MetadataCache
      const tags = await this.extractTagsFromFile(file);

      if (tags.length === 0) {
        await this.logger.info('No tags found in file', { file: file.path });
        return {
          success: true,
          targetFolder: null,
          message: 'No tags found'
        };
      }

      await this.logger.info('Found tags', {
        tags,
        count: tags.length
      });

      // Find target folder based on tags
      const targetFolder = await this.determineTargetFolder(tags);

      if (!targetFolder) {
        await this.logger.info('No matching rule found for tags', { tags });
        return {
          success: true,
          targetFolder: null,
          message: 'No matching rules'
        };
      }

      // Check if file is already in target folder
      const currentFolder = file.parent?.path || '';
      if (currentFolder === targetFolder) {
        await this.logger.info('File already in target folder', {
          targetFolder
        });
        return {
          success: true,
          targetFolder,
          message: 'Already in target folder'
        };
      }

      await this.logger.info('Moving file to target folder', {
        from: currentFolder,
        to: targetFolder
      });

      // Move file to target folder
      await this.moveFileToFolder(file, targetFolder);

      if (this.settings.options.showNotifications) {
        new Notice(`Moved to: ${targetFolder}`);
      }

      return {
        success: true,
        targetFolder,
        message: 'File moved successfully'
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
        targetFolder: null,
        error: errorMessage
      };
    }
  }

  /**
   * Extract tags from file using Obsidian's MetadataCache
   * Returns normalized tags with # prefix
   */
  private async extractTagsFromFile(file: TFile): Promise<string[]> {
    const cache = this.app.metadataCache.getFileCache(file);

    if (!cache) {
      await this.logger.warn('No metadata cache for file', { file: file.path });
      return [];
    }

    const tags: string[] = [];

    // Get tags from frontmatter
    if (cache.frontmatter?.tags) {
      const frontmatterTags = cache.frontmatter.tags;

      if (Array.isArray(frontmatterTags)) {
        tags.push(...frontmatterTags.map(t => String(t)));
      } else if (typeof frontmatterTags === 'string') {
        tags.push(frontmatterTags);
      }
    }

    // Get inline tags from content
    if (cache.tags) {
      tags.push(...cache.tags.map(t => t.tag));
    }

    // Normalize tags: ensure they start with #
    const normalizedTags = tags.map(tag =>
      tag.startsWith('#') ? tag : `#${tag}`
    );

    await this.logger.info('Extracted tags from file', {
      file: file.path,
      frontmatterTags: cache.frontmatter?.tags,
      inlineTags: cache.tags?.map(t => t.tag),
      normalizedTags
    });

    return normalizedTags;
  }

  /**
   * Determine target folder based on file's tags
   * Uses first-match-wins based on rule order (consistent with folder-to-tag)
   */
  private async determineTargetFolder(tags: string[]): Promise<string | null> {
    // Try each tag against rules in order
    for (const tag of tags) {
      await this.logger.info('Checking tag against rules', { tag });

      // Remove # prefix for pattern matching (patterns don't include #)
      const tagWithoutHash = tag.startsWith('#') ? tag.slice(1) : tag;

      // Find matching rules for this tag
      const matchingRules = findMatchingRules(tagWithoutHash, this.settings.rules, {
        input: tagWithoutHash,
        matchType: 'tag',
        direction: 'tag-to-folder'
      });

      if (matchingRules.length > 0) {
        const { rule } = matchingRules[0];

        // Check if rule supports tag-to-folder
        if (rule.direction === 'folder-to-tag') {
          await this.logger.warn('Rule only supports folder-to-tag, skipping', {
            rule: rule.name
          });
          continue;
        }

        await this.logger.info('Found matching rule', {
          tag,
          rule: rule.name
        });

        // Transform tag to folder path
        const folderPath = await this.transformTagToFolder(tag, rule);

        if (folderPath) {
          return folderPath;
        }
      }
    }

    return null;
  }

  /**
   * Transform tag to folder path using rule's transformations
   * This is the inverse of transformFolderToTag in FolderToTagSync
   */
  private async transformTagToFolder(tag: string, rule: MappingRule): Promise<string | null> {
    try {
      // Remove # prefix if present
      let tagContent = tag.startsWith('#') ? tag.slice(1) : tag;

      // Remove tag entry point if specified
      if (rule.tagEntryPoint) {
        const entryPoint = rule.tagEntryPoint.startsWith('#')
          ? rule.tagEntryPoint.slice(1)
          : rule.tagEntryPoint;
        tagContent = tagContent.replace(new RegExp(`^${entryPoint}/?`), '');
      }

      await this.logger.info('Extracted tag content for transformation', {
        originalTag: tag,
        extractedContent: tagContent,
        rule: rule.name
      });

      // Apply transformations using the pipeline
      // For tag-to-folder, we need to reverse the transformations
      if (rule.folderTransforms) {
        const transformed = applyTransformPipeline(tagContent, rule.folderTransforms, {
          isTagTransform: false
        });

        // Add folder entry point if specified
        let folderPath: string;
        if (rule.folderEntryPoint) {
          folderPath = transformed
            ? `${rule.folderEntryPoint}/${transformed}`
            : rule.folderEntryPoint;
        } else {
          folderPath = transformed;
        }

        await this.logger.info('Transformed tag to folder', {
          tag,
          folderPath
        });

        return folderPath;
      }

      return null;
    } catch (error) {
      await this.logger.error('Transformation error', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Move file to target folder
   * Creates folders if they don't exist
   */
  private async moveFileToFolder(file: TFile, targetFolder: string): Promise<void> {
    try {
      // Create target folder if it doesn't exist
      const folderExists = this.app.vault.getAbstractFileByPath(targetFolder);
      if (!folderExists) {
        await this.logger.info('Creating target folder', { targetFolder });
        await this.app.vault.createFolder(targetFolder);
      }

      // Construct new file path
      const newPath = `${targetFolder}/${file.name}`;

      // Check if file already exists at target
      const existingFile = this.app.vault.getAbstractFileByPath(newPath);
      if (existingFile) {
        throw new Error(`File already exists at target: ${newPath}`);
      }

      await this.logger.info('Moving file', {
        from: file.path,
        to: newPath
      });

      // Move the file
      await this.app.fileManager.renameFile(file, newPath);

      await this.logger.info('File moved successfully', { newPath });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.logger.error('Failed to move file', {
        file: file.path,
        targetFolder,
        error: errorMessage
      });
      throw error;
    }
  }
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  success: boolean;
  targetFolder: string | null;
  message?: string;
  error?: string;
}
