/**
 * Unit tests for regex transformers
 */

import {
	applyRegexTransform,
	applyRegexTransforms,
	validateRegexPattern,
	matchesPattern,
	extractCaptureGroups,
	globToRegex,
	isGlobPattern,
	patternToRegex,
	COMMON_PATTERNS
} from './regexTransformers';

describe('applyRegexTransform', () => {
	test('applies simple replacement', () => {
		const transform = {
			pattern: 'Projects',
			replacement: 'Work'
		};
		expect(applyRegexTransform('My Projects', transform)).toBe('My Work');
	});

	test('uses capture groups', () => {
		const transform = {
			pattern: '^(\\d+) - (.+)$',
			replacement: '$2_$1'
		};
		expect(applyRegexTransform('01 - Projects', transform)).toBe('Projects_01');
	});

	test('handles multiple capture groups', () => {
		const transform = {
			pattern: '^([^/]+)/([^/]+)/(.+)$',
			replacement: '$3 in $1/$2'
		};
		expect(applyRegexTransform('parent/child/file', transform)).toBe('file in parent/child');
	});

	test('returns original on invalid regex', () => {
		const transform = {
			pattern: '[invalid(',
			replacement: 'test'
		};
		expect(applyRegexTransform('test', transform)).toBe('test');
	});

	test('handles case-insensitive flag', () => {
		const transform = {
			pattern: 'projects',
			replacement: 'work',
			flags: 'gi'
		};
		expect(applyRegexTransform('My Projects', transform)).toBe('My work');
	});
});

describe('applyRegexTransforms', () => {
	test('applies multiple transformations in sequence', () => {
		const transforms = [
			{ pattern: '^(\\d+) - ', replacement: '' },
			{ pattern: '\\s+', replacement: '_', flags: 'g' },
			{ pattern: '_+', replacement: '_', flags: 'g' }
		];
		expect(applyRegexTransforms('01 - My Project', transforms)).toBe('My_Project');
	});

	test('handles empty transform array', () => {
		expect(applyRegexTransforms('test', [])).toBe('test');
	});

	test('stops on first matching transform when not global', () => {
		const transforms = [
			{ pattern: 'a', replacement: 'b' }
		];
		expect(applyRegexTransforms('aaa', transforms)).toBe('bbb');
	});
});

describe('validateRegexPattern', () => {
	test('validates correct patterns', () => {
		expect(validateRegexPattern('^test$')).toEqual({ valid: true });
		expect(validateRegexPattern('\\d+')).toEqual({ valid: true });
		expect(validateRegexPattern('(\\w+)')).toEqual({ valid: true });
	});

	test('detects invalid patterns', () => {
		const result = validateRegexPattern('[invalid(');
		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();
	});

	test('handles complex valid patterns', () => {
		expect(validateRegexPattern('^(?<folder>\\w+)/(?<file>.+)$')).toEqual({ valid: true });
	});
});

describe('matchesPattern', () => {
	test('matches simple patterns', () => {
		expect(matchesPattern('Projects', '^Projects$')).toBe(true);
		expect(matchesPattern('My Projects', 'Projects')).toBe(true);
	});

	test('handles case sensitivity', () => {
		expect(matchesPattern('Projects', '^projects$')).toBe(false);
		expect(matchesPattern('Projects', '^projects$', 'i')).toBe(true);
	});

	test('matches complex patterns', () => {
		expect(matchesPattern('01 - Projects', '^\\d+ - \\w+$')).toBe(true);
		expect(matchesPattern('Projects', '^\\d+ - \\w+$')).toBe(false);
	});

	test('returns false for invalid patterns', () => {
		expect(matchesPattern('test', '[invalid(')).toBe(false);
	});
});

describe('extractCaptureGroups', () => {
	test('extracts numbered capture groups', () => {
		const result = extractCaptureGroups('01 - Projects', '^(\\d+) - (.+)$');
		expect(result).not.toBeNull();
		expect(result?.matches[0]).toBe('01 - Projects');
		expect(result?.matches[1]).toBe('01');
		expect(result?.matches[2]).toBe('Projects');
	});

	test('extracts named capture groups', () => {
		const result = extractCaptureGroups(
			'parent/child',
			'^(?<parent>[^/]+)/(?<child>.+)$'
		);
		expect(result).not.toBeNull();
		expect(result?.groups?.parent).toBe('parent');
		expect(result?.groups?.child).toBe('child');
	});

	test('returns null for non-matching pattern', () => {
		const result = extractCaptureGroups('test', '^\\d+$');
		expect(result).toBeNull();
	});

	test('returns null for invalid pattern', () => {
		const result = extractCaptureGroups('test', '[invalid(');
		expect(result).toBeNull();
	});
});

describe('globToRegex', () => {
	test('converts * to match any chars except slash', () => {
		const regex = globToRegex('Projects/*');
		expect(new RegExp(regex).test('Projects/file.md')).toBe(true);
		expect(new RegExp(regex).test('Projects/sub/file.md')).toBe(false);
	});

	test('converts ** to match any depth', () => {
		const regex = globToRegex('Projects/**');
		expect(new RegExp(regex).test('Projects/file.md')).toBe(true);
		expect(new RegExp(regex).test('Projects/sub/file.md')).toBe(true);
		expect(new RegExp(regex).test('Projects/sub/deep/file.md')).toBe(true);
	});

	test('converts ? to match single char', () => {
		const regex = globToRegex('file?.md');
		expect(new RegExp(regex).test('file1.md')).toBe(true);
		expect(new RegExp(regex).test('file12.md')).toBe(false);
	});

	test('escapes special regex characters', () => {
		const regex = globToRegex('test.file');
		expect(new RegExp(regex).test('test.file')).toBe(true);
		expect(new RegExp(regex).test('testXfile')).toBe(false);
	});

	test('handles multiple wildcards', () => {
		const regex = globToRegex('*/test/*');
		expect(new RegExp(regex).test('parent/test/child')).toBe(true);
		expect(new RegExp(regex).test('test/child')).toBe(false);
	});
});

describe('isGlobPattern', () => {
	test('detects glob patterns', () => {
		expect(isGlobPattern('test/*')).toBe(true);
		expect(isGlobPattern('test?')).toBe(true);
		expect(isGlobPattern('**/test')).toBe(true);
	});

	test('rejects non-glob patterns', () => {
		expect(isGlobPattern('test')).toBe(false);
		expect(isGlobPattern('^test$')).toBe(false);
		expect(isGlobPattern('test/path')).toBe(false);
	});
});

describe('patternToRegex', () => {
	test('converts glob to regex', () => {
		const regex = patternToRegex('Projects/*');
		expect(regex.test('Projects/file.md')).toBe(true);
	});

	test('uses regex as-is when not glob', () => {
		const regex = patternToRegex('^Projects$');
		expect(regex.test('Projects')).toBe(true);
		expect(regex.test('My Projects')).toBe(false);
	});

	test('handles complex glob patterns', () => {
		const regex = patternToRegex('**/Projects/*.md');
		expect(regex.test('parent/child/Projects/file.md')).toBe(true);
		expect(regex.test('Projects/file.md')).toBe(true);
		expect(regex.test('Projects/sub/file.md')).toBe(false);
	});
});

describe('COMMON_PATTERNS', () => {
	test('johnnyDecimal matches correctly', () => {
		const regex = new RegExp(COMMON_PATTERNS.johnnyDecimal);
		expect(regex.test('01 - Projects')).toBe(true);
		expect(regex.test('123 - Test')).toBe(true);
		expect(regex.test('Projects')).toBe(false);
	});

	test('nestedPath matches correctly', () => {
		const regex = new RegExp(COMMON_PATTERNS.nestedPath);
		expect(regex.test('parent/child')).toBe(true);
		expect(regex.test('parent/child/grandchild')).toBe(true);
		expect(regex.test('single')).toBe(false);
	});

	test('wildcardSuffix matches correctly', () => {
		const regex = new RegExp(COMMON_PATTERNS.wildcardSuffix);
		expect(regex.test('Projects/*')).toBe(true);
		expect(regex.test('parent/child/*')).toBe(true);
		expect(regex.test('Projects/file')).toBe(false);
	});
});

describe('integration with other transformers', () => {
	test('regex can extract then transform', () => {
		// Extract number and name, then swap them
		const transform = {
			pattern: '^(\\d+) - (.+)$',
			replacement: '$2 ($1)'
		};
		expect(applyRegexTransform('01 - Projects', transform)).toBe('Projects (01)');
	});

	test('multiple regex transforms combine', () => {
		const transforms = [
			{ pattern: '^📁 ', replacement: '' }, // Remove emoji
			{ pattern: '^(\\d+) - ', replacement: '' }, // Remove number
			{ pattern: '\\s+', replacement: '_', flags: 'g' } // Spaces to underscores
		];
		expect(applyRegexTransforms('📁 01 - My Project', transforms)).toBe('My_Project');
	});
});
