/**
 * Emoji handling utilities
 *
 * Detects and removes emoji from strings, useful for converting folder names
 * with emoji prefixes (like "📁 Projects") to clean tag names.
 */

/**
 * Strip all emoji from a string
 * Example: "📁 01 - Projects" -> "01 - Projects"
 */
export function stripEmoji(input: string): string {
	return input
		// Remove emoji using comprehensive Unicode ranges
		.replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
		.replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc Symbols and Pictographs
		.replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
		.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // Regional country flags
		.replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
		.replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
		.replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols and Pictographs
		.replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess Symbols
		.replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
		.replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // Variation Selectors
		.replace(/[\u{1F000}-\u{1F02F}]/gu, '') // Mahjong Tiles
		.replace(/[\u{2B00}-\u{2BFF}]/gu, '')   // Misc Symbols and Arrows (includes ⬇)
		// Clean up extra whitespace
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Detect if a string contains emoji
 */
export function containsEmoji(input: string): boolean {
	const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2B00}-\u{2BFF}]/u;
	return emojiRegex.test(input);
}

/**
 * Extract emoji from a string
 * Returns array of emoji found (including variation selectors)
 */
export function extractEmoji(input: string): string[] {
	// Match emoji with optional variation selectors
	const emojiRegex = /([\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2B00}-\u{2BFF}][\u{FE00}-\u{FE0F}]?)/gu;
	return input.match(emojiRegex) || [];
}

/**
 * Strip special characters that are invalid in Obsidian tags
 * Obsidian tags cannot contain: . : ; , ? ! @ \
 */
export function stripInvalidTagChars(input: string): string {
	return input.replace(/[.:;,?!@\\]/g, '');
}

/**
 * Normalize unicode to NFC form (recommended for consistency)
 */
export function normalizeUnicode(input: string): string {
	return input.normalize('NFC');
}

/**
 * Apply emoji handling based on configuration
 */
export function applyEmojiHandling(input: string, handling: 'keep' | 'strip'): string {
	if (handling === 'strip') {
		return stripEmoji(input);
	}
	return input;
}
