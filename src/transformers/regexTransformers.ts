/**
 * Regex transformation utilities
 *
 * Provides custom regex pattern matching and replacement with capture groups.
 * This is the most flexible transformation option, allowing users to define
 * complex pattern-based transformations.
 */

import { RegexTransform } from '../types/settings';

/**
 * Apply a regex transformation with capture group support
 * Example: pattern "^(\\d+) - (.+)$", replacement "$2_$1"
 *          input "01 - Projects" -> "Projects_01"
 */
export function applyRegexTransform(input: string, transform: RegexTransform): string {
	try {
		const regex = new RegExp(transform.pattern, transform.flags || 'g');
		return input.replace(regex, transform.replacement);
	} catch (error) {
		console.error('Invalid regex pattern:', transform.pattern, error);
		return input; // Return original on error
	}
}

/**
 * Apply multiple regex transformations in sequence
 */
export function applyRegexTransforms(input: string, transforms: RegexTransform[]): string {
	let result = input;
	for (const transform of transforms) {
		result = applyRegexTransform(result, transform);
	}
	return result;
}

/**
 * Validate a regex pattern
 */
export function validateRegexPattern(pattern: string): { valid: boolean; error?: string } {
	try {
		new RegExp(pattern);
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			error: error instanceof Error ? error.message : 'Invalid regex pattern'
		};
	}
}

/**
 * Test if a string matches a regex pattern
 */
export function matchesPattern(input: string, pattern: string, flags?: string): boolean {
	try {
		const regex = new RegExp(pattern, flags);
		return regex.test(input);
	} catch (error) {
		console.error('Invalid regex pattern:', pattern, error);
		return false;
	}
}

/**
 * Extract capture groups from a regex match
 * Returns object with named groups if available, or array of matches
 */
export function extractCaptureGroups(
	input: string,
	pattern: string,
	flags?: string
): { groups?: Record<string, string>; matches: string[] } | null {
	try {
		const regex = new RegExp(pattern, flags);
		const match = input.match(regex);

		if (!match) {
			return null;
		}

		return {
			groups: match.groups,
			matches: Array.from(match)
		};
	} catch (error) {
		console.error('Invalid regex pattern:', pattern, error);
		return null;
	}
}

/**
 * Common regex patterns for folder/tag matching
 */
export const COMMON_PATTERNS = {
	// Johnny Decimal: "01 - Projects"
	johnnyDecimal: '^(\\d+)\\s*-\\s*(.+)$',

	// Folder with emoji: "📁 Projects"
	emojiPrefix: '^[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}]\\s*(.+)$',

	// Nested path: "parent/child/grandchild"
	nestedPath: '^([^/]+)/(.+)$',

	// Tag with prefix: "#_/01_projects"
	tagWithPrefix: '^#([^/]+)/(.+)$',

	// Wildcard match: "Projects/*"
	wildcardSuffix: '^(.+)/\\*$',

	// Any folder depth: "**/subfolder"
	anyDepth: '\\*\\*/(.+)$'
};

/**
 * Convert glob pattern to regex
 * Supports: * (any chars), ? (single char), ** (any depth)
 */
export function globToRegex(glob: string): string {
	let regex = glob;

	// Escape special regex characters except * and ?
	regex = regex.replace(/[.+^${}()|[\]\\]/g, '\\$&');

	// Handle ** (must be done before single * to avoid conflicts)
	// Use placeholders to prevent subsequent * replacements from affecting **
	const DOUBLE_STAR_PLACEHOLDER = '\x00DOUBLESTAR\x00';
	const PATH_SEG_PLACEHOLDER = '\x00PATHSEG\x00';
	const START_PATH_SEG_PLACEHOLDER = '\x00STARTPATHSEG\x00';

	// /**/ in middle -> match zero or more path segments
	regex = regex.replace(/\/\*\*\//g, PATH_SEG_PLACEHOLDER);
	// /** at end -> match anything after slash
	regex = regex.replace(/\/\*\*$/g, '/' + DOUBLE_STAR_PLACEHOLDER);
	// **/ at start -> match zero or more path segments at start (without leading /)
	regex = regex.replace(/^\*\*\//g, START_PATH_SEG_PLACEHOLDER);
	// ** alone (remaining) -> match anything
	regex = regex.replace(/\*\*/g, DOUBLE_STAR_PLACEHOLDER);

	// Convert remaining * to match any chars except /
	regex = regex.replace(/\*/g, '[^/]*');

	// Convert ? to match single character
	regex = regex.replace(/\?/g, '.');

	// Replace placeholders with actual regex patterns
	regex = regex.replace(new RegExp(DOUBLE_STAR_PLACEHOLDER, 'g'), '.*');
	regex = regex.replace(new RegExp(PATH_SEG_PLACEHOLDER, 'g'), '(?:/[^/]+)*/');
	regex = regex.replace(new RegExp(START_PATH_SEG_PLACEHOLDER, 'g'), '(?:[^/]+/)*');

	// Anchor to start and end
	return `^${regex}$`;
}

/**
 * Check if a pattern is a glob pattern (contains *, ?, or **)
 */
export function isGlobPattern(pattern: string): boolean {
	return /[*?]/.test(pattern);
}

/**
 * Convert a simple pattern to regex, handling both glob and regex syntax
 */
export function patternToRegex(pattern: string): RegExp {
	if (isGlobPattern(pattern)) {
		return new RegExp(globToRegex(pattern));
	} else {
		return new RegExp(pattern);
	}
}
