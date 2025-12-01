/**
 * Transformation pipeline that coordinates all transformers
 *
 * Applies transformations in a specific order:
 * 1. Emoji handling (strip if configured)
 * 2. Number prefix handling (strip/extract if configured)
 * 3. Case transformation (apply desired case)
 * 4. Custom regex transformations (apply in sequence)
 * 5. Invalid character cleanup (for tags)
 */

import { TransformConfig } from '../types/settings';
import { applyCaseTransform, applyCaseTransformToPath } from './caseTransformers';
import { applyEmojiHandling, stripInvalidTagChars } from './emojiTransformers';
import { applyNumberHandling, stripNumberPrefix } from './numberTransformers';
import { applyRegexTransforms } from './regexTransformers';

export interface PipelineOptions {
	/**
	 * Whether this transformation is for tag generation
	 * If true, invalid tag characters will be stripped at the end
	 */
	isTagTransform?: boolean;

	/**
	 * Whether to preserve the original if transformation fails
	 */
	preserveOnError?: boolean;
}

/**
 * Apply all configured transformations to an input string
 */
export function applyTransformPipeline(
	input: string,
	config: TransformConfig,
	options: PipelineOptions = {}
): string {
	// Trim input at the start to ensure consistent processing
	let result = input.trim();

	try {
		// 1. Handle emoji (strip if configured)
		if (config.emojiHandling) {
			result = applyEmojiHandling(result, config.emojiHandling);
		}

		// 2. Handle number prefixes (strip if configured)
		// Note: 'extract' returns an object, so we only handle 'strip' and 'keep' here
		if (config.numberPrefixHandling === 'strip') {
			result = stripNumberPrefix(result);
		} else if (config.numberPrefixHandling === 'extract') {
			// For extract mode, we strip the number and return just the name
			// (the number can be accessed separately if needed)
			const extracted = applyNumberHandling(result, 'extract');
			if (typeof extracted === 'object' && extracted.name) {
				result = extracted.name;
			}
		}
		// 'keep' means do nothing

		// 3. Apply case transformation (path-aware to handle slashes correctly)
		if (config.caseTransform && config.caseTransform !== 'none') {
			result = applyCaseTransformToPath(result, config.caseTransform);
		}

		// 4. Apply custom regex transformations in sequence
		if (config.customTransforms && config.customTransforms.length > 0) {
			result = applyRegexTransforms(result, config.customTransforms);
		}

		// 5. Clean up invalid tag characters if this is for tag generation
		if (options.isTagTransform) {
			result = stripInvalidTagChars(result);
		}

		return result.trim();
	} catch (error) {
		console.error('Error in transformation pipeline:', error);
		return options.preserveOnError ? input : result;
	}
}

/**
 * Transform folder path to tag name
 */
export function folderToTag(
	folderPath: string,
	config: TransformConfig
): string {
	return applyTransformPipeline(folderPath, config, { isTagTransform: true });
}

/**
 * Transform tag name to folder path
 * Note: Some transformations may not be reversible (e.g., case changes)
 */
export function tagToFolder(
	tagName: string,
	config: TransformConfig
): string {
	// For tag-to-folder, we typically don't strip invalid chars
	// since folder names can have more characters than tags
	return applyTransformPipeline(tagName, config, { isTagTransform: false });
}

/**
 * Create a bidirectional transformation pair
 * Returns both tag and folder representations
 */
export function createBidirectionalMapping(
	input: string,
	folderConfig: TransformConfig,
	tagConfig: TransformConfig
): { folder: string; tag: string } {
	return {
		folder: tagToFolder(input, folderConfig),
		tag: folderToTag(input, tagConfig)
	};
}

/**
 * Helper to validate if a transformation is reversible
 * (useful for warning users about potential data loss)
 */
export function isTransformReversible(config: TransformConfig): {
	reversible: boolean;
	warnings: string[];
} {
	const warnings: string[] = [];
	let reversible = true;

	// Check for potentially lossy transformations
	if (config.emojiHandling === 'strip') {
		warnings.push('Emoji stripping is not reversible');
		reversible = false;
	}

	if (config.numberPrefixHandling === 'strip' || config.numberPrefixHandling === 'extract') {
		warnings.push('Number prefix removal is not reversible');
		reversible = false;
	}

	// Case transformations are generally reversible if you have the original case
	// but some information loss can occur (e.g., "iPhone" -> "iphone" -> can't restore to "iPhone")
	if (config.caseTransform && config.caseTransform !== 'none' && config.caseTransform !== 'Title Case') {
		warnings.push(`Case transformation to ${config.caseTransform} may not preserve original casing`);
	}

	// Regex transforms could be reversible if they use capture groups properly
	if (config.customTransforms && config.customTransforms.length > 0) {
		warnings.push('Custom regex transformations may not be reversible');
		reversible = false;
	}

	return { reversible, warnings };
}
