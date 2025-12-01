/**
 * Unit tests for number prefix transformers
 */

import {
	extractNumberPrefix,
	stripNumberPrefix,
	addNumberPrefix,
	hasNumberPrefix,
	normalizeNumberPrefix,
	applyNumberHandling
} from './numberTransformers';

describe('extractNumberPrefix', () => {
	test('extracts Johnny Decimal format', () => {
		const result = extractNumberPrefix('01 - Projects');
		expect(result.number).toBe('01');
		expect(result.name).toBe('Projects');
		expect(result.fullMatch).toBe(true);
	});

	test('extracts simple number format', () => {
		const result = extractNumberPrefix('01 Projects');
		expect(result.number).toBe('01');
		expect(result.name).toBe('Projects');
		expect(result.fullMatch).toBe(true);
	});

	test('extracts number with dot', () => {
		const result = extractNumberPrefix('1. Projects');
		expect(result.number).toBe('1');
		expect(result.name).toBe('Projects');
		expect(result.fullMatch).toBe(true);
	});

	test('handles input without number', () => {
		const result = extractNumberPrefix('Projects');
		expect(result.number).toBeNull();
		expect(result.name).toBe('Projects');
		expect(result.fullMatch).toBe(false);
	});

	test('handles single digit numbers', () => {
		const result = extractNumberPrefix('1 - Project');
		expect(result.number).toBe('1');
		expect(result.name).toBe('Project');
	});

	test('handles multi-digit numbers', () => {
		const result = extractNumberPrefix('123 - Project');
		expect(result.number).toBe('123');
		expect(result.name).toBe('Project');
	});

	test('handles varied spacing', () => {
		const result = extractNumberPrefix('01  -  Projects');
		expect(result.number).toBe('01');
		expect(result.name).toBe('Projects');
	});
});

describe('stripNumberPrefix', () => {
	test('strips Johnny Decimal prefix', () => {
		expect(stripNumberPrefix('01 - Projects')).toBe('Projects');
	});

	test('strips simple number prefix', () => {
		expect(stripNumberPrefix('01 Projects')).toBe('Projects');
	});

	test('returns original when no prefix', () => {
		expect(stripNumberPrefix('Projects')).toBe('Projects');
	});

	test('preserves numbers in middle of string', () => {
		expect(stripNumberPrefix('Project 123')).toBe('Project 123');
	});
});

describe('addNumberPrefix', () => {
	test('adds Johnny Decimal format', () => {
		expect(addNumberPrefix('Projects', '01')).toBe('01 - Projects');
	});

	test('adds simple format', () => {
		expect(addNumberPrefix('Projects', '01', 'simple')).toBe('01 Projects');
	});

	test('handles multi-digit numbers', () => {
		expect(addNumberPrefix('Projects', '123')).toBe('123 - Projects');
	});
});

describe('hasNumberPrefix', () => {
	test('detects Johnny Decimal prefix', () => {
		expect(hasNumberPrefix('01 - Projects')).toBe(true);
	});

	test('detects simple number prefix', () => {
		expect(hasNumberPrefix('01 Projects')).toBe(true);
	});

	test('returns false when no prefix', () => {
		expect(hasNumberPrefix('Projects')).toBe(false);
	});

	test('returns false for numbers in middle', () => {
		expect(hasNumberPrefix('Project 01')).toBe(false);
	});
});

describe('normalizeNumberPrefix', () => {
	test('pads single digit to two digits', () => {
		expect(normalizeNumberPrefix('1 - Projects')).toBe('01 - Projects');
	});

	test('keeps two-digit numbers', () => {
		expect(normalizeNumberPrefix('01 - Projects')).toBe('01 - Projects');
	});

	test('handles custom pad length', () => {
		expect(normalizeNumberPrefix('1 - Projects', 3)).toBe('001 - Projects');
	});

	test('returns original when no prefix', () => {
		expect(normalizeNumberPrefix('Projects')).toBe('Projects');
	});
});

describe('applyNumberHandling', () => {
	test('keeps numbers when configured', () => {
		expect(applyNumberHandling('01 - Projects', 'keep')).toBe('01 - Projects');
	});

	test('strips numbers when configured', () => {
		expect(applyNumberHandling('01 - Projects', 'strip')).toBe('Projects');
	});

	test('extracts numbers when configured', () => {
		const result = applyNumberHandling('01 - Projects', 'extract');
		expect(typeof result).toBe('object');
		expect((result as any).number).toBe('01');
		expect((result as any).name).toBe('Projects');
	});
});

describe('integration with emoji', () => {
	test('handles emoji and number prefix together', () => {
		// This would typically be used with emoji stripping first
		const input = '01 - Projects'; // After emoji strip
		expect(stripNumberPrefix(input)).toBe('Projects');
	});
});
