import { App, TFile, Notice } from 'obsidian';
import type { DynamicTagsFoldersSettings, MappingRule } from '../types/settings';
import { DebugLogger } from '../utils/debug';
import { findMatchingRules } from '../engine/ruleMatcher';
import { applyTransformPipeline } from '../transformers/pipeline';

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

      // Find matching rules
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

      // Get highest priority rule
      const { rule } = matchingRules[0];

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

      // Transform folder path to tag
      const tag = await this.transformFolderToTag(folderPath, rule);

      if (!tag) {
        await this.logger.error('Failed to transform folder to tag', {
          folderPath,
          rule: rule.name
        });
        return {
          success: false,
          tagsAdded: [],
          tagsRemoved: [],
          error: 'Transformation failed'
        };
      }

      await this.logger.info('Transformed folder to tag', {
        folderPath,
        tag
      });

      // Read current file content
      const content = await this.app.vault.read(file);

      // Parse frontmatter and tags
      const { frontmatter, body } = this.parseFrontmatter(content);
      const currentTags = this.extractTags(frontmatter);

      // Check if tag already exists
      if (currentTags.includes(tag)) {
        await this.logger.info('Tag already exists, no changes needed', { tag });
        return {
          success: true,
          tagsAdded: [],
          tagsRemoved: [],
          message: 'Tag already exists'
        };
      }

      // Add new tag
      const newTags = [...currentTags, tag];
      const newFrontmatter = this.updateTags(frontmatter, newTags);
      const newContent = this.reconstructFile(newFrontmatter, body);

      // Write back to file
      await this.app.vault.modify(file, newContent);

      await this.logger.info('Successfully added tag', {
        tag,
        file: file.path
      });

      if (this.settings.options.showNotifications) {
        new Notice(`Added tag: ${tag}`);
      }

      return {
        success: true,
        tagsAdded: [tag],
        tagsRemoved: [],
        message: 'Tag added successfully'
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
   * Transform folder path to tag using rule's transformations
   */
  private async transformFolderToTag(folderPath: string, rule: MappingRule): Promise<string | null> {
    try {
      // Extract the relevant part of the folder path based on rule pattern
      const pattern = new RegExp(rule.folderPattern || '.*');
      const match = folderPath.match(pattern);

      if (!match) {
        return null;
      }

      // Use the full matched path, not just capture groups
      let pathToTransform = match[0];

      // Remove folder entry point if specified
      if (rule.folderEntryPoint) {
        pathToTransform = pathToTransform.replace(new RegExp(`^${rule.folderEntryPoint}/?`), '');
      }

      await this.logger.info('Extracted path for transformation', {
        originalPath: folderPath,
        extractedPath: pathToTransform,
        rule: rule.name
      });

      // Apply transformations using the pipeline
      if (rule.tagTransforms) {
        const transformed = applyTransformPipeline(pathToTransform, rule.tagTransforms, {
          isTagTransform: true
        });

        // Add tag entry point if specified
        let tag: string;
        if (rule.tagEntryPoint) {
          // Only add slash if there's content after the entry point
          tag = transformed ? `${rule.tagEntryPoint}/${transformed}` : rule.tagEntryPoint;
        } else {
          tag = transformed;
        }

        // Ensure tag starts with #
        return tag.startsWith('#') ? tag : `#${tag}`;
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
   * Parse frontmatter from markdown content
   */
  private parseFrontmatter(content: string): { frontmatter: string; body: string } {
    const fmRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(fmRegex);

    if (match) {
      return {
        frontmatter: match[1],
        body: match[2]
      };
    }

    return {
      frontmatter: '',
      body: content
    };
  }

  /**
   * Extract tags from frontmatter
   */
  private extractTags(frontmatter: string): string[] {
    const tags: string[] = [];

    // Match tags: or tags:\n  - tag
    const tagsMatch = frontmatter.match(/tags:\s*\n?((?:  - .+\n?)*|\[.*?\])/);

    if (tagsMatch) {
      const tagsContent = tagsMatch[1];

      // Array format: [tag1, tag2]
      if (tagsContent.trim().startsWith('[')) {
        const arrayMatch = tagsContent.match(/\[(.*?)\]/);
        if (arrayMatch) {
          tags.push(...arrayMatch[1].split(',').map(t => t.trim().replace(/['"]/g, '')));
        }
      }
      // List format:
      // - tag1
      // - tag2
      else {
        const listTags = tagsContent.match(/- (.+)/g);
        if (listTags) {
          tags.push(...listTags.map(t => t.replace(/^- /, '').trim()));
        }
      }
    }

    return tags.map(tag => tag.startsWith('#') ? tag : `#${tag}`);
  }

  /**
   * Update tags in frontmatter
   */
  private updateTags(frontmatter: string, tags: string[]): string {
    // Remove # prefix for frontmatter
    const cleanTags = tags.map(t => t.replace(/^#/, ''));

    // If frontmatter is empty, create it
    if (!frontmatter.trim()) {
      return `tags:\n${cleanTags.map(t => `  - ${t}`).join('\n')}`;
    }

    // Check if tags field exists
    const tagsRegex = /tags:\s*\n?((?:  - .+\n?)*|\[.*?\])/;
    const tagsMatch = frontmatter.match(tagsRegex);

    if (tagsMatch) {
      // Replace existing tags
      const newTagsSection = `tags:\n${cleanTags.map(t => `  - ${t}`).join('\n')}`;
      return frontmatter.replace(tagsRegex, newTagsSection);
    } else {
      // Add tags field
      return `${frontmatter}\ntags:\n${cleanTags.map(t => `  - ${t}`).join('\n')}`;
    }
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
