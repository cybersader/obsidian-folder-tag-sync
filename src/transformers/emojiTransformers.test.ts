/**
 * Unit tests for emoji transformers
 */

import {
	stripEmoji,
	containsEmoji,
	extractEmoji,
	stripInvalidTagChars,
	normalizeUnicode,
	applyEmojiHandling
} from './emojiTransformers';

describe('stripEmoji', () => {
	test('removes common folder emoji', () => {
		expect(stripEmoji('📁 Projects')).toBe('Projects');
	});

	test('removes multiple emoji', () => {
		expect(stripEmoji('📁 ⬇️ INBOX')).toBe('INBOX');
	});

	test('removes emoji from middle of string', () => {
		expect(stripEmoji('My 📁 Projects')).toBe('My Projects');
	});

	test('handles string without emoji', () => {
		expect(stripEmoji('Projects')).toBe('Projects');
	});

	test('handles empty string', () => {
		expect(stripEmoji('')).toBe('');
	});

	test('removes various emoji types', () => {
		expect(stripEmoji('🎉 Celebration 🎊')).toBe('Celebration');
		expect(stripEmoji('✅ Tasks')).toBe('Tasks');
		expect(stripEmoji('🕸️ UNSTRUCTURED')).toBe('UNSTRUCTURED');
	});
});

describe('containsEmoji', () => {
	test('detects emoji presence', () => {
		expect(containsEmoji('📁 Projects')).toBe(true);
	});

	test('detects no emoji', () => {
		expect(containsEmoji('Projects')).toBe(false);
	});

	test('detects various emoji', () => {
		expect(containsEmoji('🎉')).toBe(true);
		expect(containsEmoji('test 🎉 test')).toBe(true);
	});
});

describe('extractEmoji', () => {
	test('extracts single emoji', () => {
		expect(extractEmoji('📁 Projects')).toEqual(['📁']);
	});

	test('extracts multiple emoji', () => {
		const result = extractEmoji('📁 ⬇️ INBOX');
		expect(result.length).toBe(2);
		expect(result).toContain('📁');
		expect(result).toContain('⬇️');
	});

	test('returns empty array when no emoji', () => {
		expect(extractEmoji('Projects')).toEqual([]);
	});
});

describe('stripInvalidTagChars', () => {
	test('removes periods', () => {
		expect(stripInvalidTagChars('test.name')).toBe('testname');
	});

	test('removes colons', () => {
		expect(stripInvalidTagChars('test:name')).toBe('testname');
	});

	test('removes multiple invalid chars', () => {
		expect(stripInvalidTagChars('test.:;,?!@name')).toBe('testname');
	});

	test('preserves valid characters', () => {
		expect(stripInvalidTagChars('test_name-123')).toBe('test_name-123');
	});

	test('handles already clean string', () => {
		expect(stripInvalidTagChars('testname')).toBe('testname');
	});
});

describe('normalizeUnicode', () => {
	test('normalizes to NFC form', () => {
		const input = 'café'; // Could be composed or decomposed
		const normalized = normalizeUnicode(input);
		expect(normalized).toBe('café');
		expect(normalized.length).toBeLessThanOrEqual(4);
	});

	test('handles regular ASCII', () => {
		expect(normalizeUnicode('test')).toBe('test');
	});
});

describe('applyEmojiHandling', () => {
	test('strips emoji when configured', () => {
		expect(applyEmojiHandling('📁 Projects', 'strip')).toBe('Projects');
	});

	test('keeps emoji when configured', () => {
		expect(applyEmojiHandling('📁 Projects', 'keep')).toBe('📁 Projects');
	});
});
