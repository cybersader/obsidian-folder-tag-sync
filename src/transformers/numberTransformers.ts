/**
 * Number prefix handling utilities
 *
 * Handles Johnny Decimal-style numbering in folder names (e.g., "01 - Projects")
 * and other numeric prefixes.
 */

export interface NumberPrefixResult {
	number: string | null;
	name: string;
	fullMatch: boolean;
}

/**
 * Extract number prefix from Johnny Decimal format
 * Example: "01 - Projects" -> { number: "01", name: "Projects" }
 */
export function extractNumberPrefix(input: string): NumberPrefixResult {
	// Match patterns like "01 - Name" or "1 - Name"
	const johnnyDecimalMatch = input.match(/^(\d+)\s*-\s*(.+)$/);

	if (johnnyDecimalMatch) {
		return {
			number: johnnyDecimalMatch[1],
			name: johnnyDecimalMatch[2].trim(),
			fullMatch: true
		};
	}

	// Match simple number prefix like "01 Name" or "1. Name"
	const simpleNumberMatch = input.match(/^(\d+)\.?\s+(.+)$/);

	if (simpleNumberMatch) {
		return {
			number: simpleNumberMatch[1],
			name: simpleNumberMatch[2].trim(),
			fullMatch: true
		};
	}

	// No number prefix found
	return {
		number: null,
		name: input,
		fullMatch: false
	};
}

/**
 * Strip number prefix from string
 * Example: "01 - Projects" -> "Projects"
 */
export function stripNumberPrefix(input: string): string {
	return extractNumberPrefix(input).name;
}

/**
 * Add Johnny Decimal style number prefix
 * Example: ("Projects", "01") -> "01 - Projects"
 */
export function addNumberPrefix(name: string, number: string, format: 'johnny-decimal' | 'simple' = 'johnny-decimal'): string {
	if (format === 'johnny-decimal') {
		return `${number} - ${name}`;
	} else {
		return `${number} ${name}`;
	}
}

/**
 * Check if string has a number prefix
 */
export function hasNumberPrefix(input: string): boolean {
	return extractNumberPrefix(input).fullMatch;
}

/**
 * Normalize number prefix to consistent format
 * Example: "1 - Projects" -> "01 - Projects"
 */
export function normalizeNumberPrefix(input: string, padLength: number = 2): string {
	const result = extractNumberPrefix(input);

	if (!result.fullMatch || !result.number) {
		return input;
	}

	const paddedNumber = result.number.padStart(padLength, '0');
	return addNumberPrefix(result.name, paddedNumber);
}

/**
 * Apply number prefix handling based on configuration
 */
export function applyNumberHandling(
	input: string,
	handling: 'keep' | 'strip' | 'extract'
): string | NumberPrefixResult {
	switch (handling) {
		case 'strip':
			return stripNumberPrefix(input);
		case 'extract':
			return extractNumberPrefix(input);
		case 'keep':
		default:
			return input;
	}
}
