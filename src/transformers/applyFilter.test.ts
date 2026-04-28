import { describe, expect, test } from 'bun:test';
import {
	applyFilter,
	applyFilterChain,
	applyFilterInverse,
	applyFilterChainInverse,
} from './applyFilter';

describe('applyFilter (forward)', () => {
	describe('identity filters', () => {
		test('keep is identity', () => {
			expect(applyFilter('Web Auth', 'keep')).toBe('Web Auth');
		});
		test('keep-emoji is identity', () => {
			expect(applyFilter('📁 Projects', 'keep-emoji')).toBe('📁 Projects');
		});
		test('keep-num-prefix is identity', () => {
			expect(applyFilter('01 - Projects', 'keep-num-prefix')).toBe('01 - Projects');
		});
	});

	describe('case transforms', () => {
		test('kebab-case converts spaces', () => {
			expect(applyFilter('Web Auth', 'kebab-case')).toBe('web-auth');
		});
		test('snake_case converts spaces', () => {
			expect(applyFilter('Web Auth', 'snake_case')).toBe('web_auth');
		});
		test('Title Case converts kebab', () => {
			expect(applyFilter('web-auth', 'Title Case')).toBe('Web Auth');
		});
		test('lower lowercases', () => {
			expect(applyFilter('Web Auth', 'lower')).toBe('web auth');
		});
		test('upper uppercases', () => {
			expect(applyFilter('Web Auth', 'upper')).toBe('WEB AUTH');
		});
		test('camelCase', () => {
			expect(applyFilter('Web Auth', 'camelCase')).toBe('webAuth');
		});
		test('PascalCase', () => {
			expect(applyFilter('web auth', 'PascalCase')).toBe('WebAuth');
		});
	});

	describe('emoji + number filters', () => {
		test('strip-emoji removes emoji', () => {
			expect(applyFilter('📁 Projects', 'strip-emoji')).toBe('Projects');
		});
		test('strip-num-prefix removes JD prefix', () => {
			expect(applyFilter('01 - Projects', 'strip-num-prefix')).toBe('Projects');
		});
		test('extract-num-prefix returns the number', () => {
			expect(applyFilter('01 - Projects', 'extract-num-prefix')).toBe('01');
		});
		test('extract-num-prefix returns empty when no prefix', () => {
			expect(applyFilter('Projects', 'extract-num-prefix')).toBe('');
		});
	});

	describe('join filters (glob slot separator swap)', () => {
		test("join('-') swaps / for -", () => {
			expect(applyFilter('a/b/c', "join('-')")).toBe('a-b-c');
		});
		test("join('_') swaps / for _", () => {
			expect(applyFilter('a/b/c', "join('_')")).toBe('a_b_c');
		});
		test("join('/') is identity for path-shaped values", () => {
			expect(applyFilter('a/b/c', "join('/')")).toBe('a/b/c');
		});
	});

	describe('error / pass-through', () => {
		test('regex-replace without args passes through', () => {
			expect(applyFilter('foo', 'regex-replace')).toBe('foo');
		});
		test('unknown filter passes through', () => {
			expect(applyFilter('foo', 'made-up-filter-xyz')).toBe('foo');
		});
	});
});

describe('applyFilterChain', () => {
	test('empty chain is identity', () => {
		expect(applyFilterChain('Web Auth', [])).toBe('Web Auth');
	});
	test('single-filter chain', () => {
		expect(applyFilterChain('Web Auth', ['kebab-case'])).toBe('web-auth');
	});
	test('multi-filter chain applies in order', () => {
		expect(applyFilterChain('📁 Web Auth', ['strip-emoji', 'kebab-case'])).toBe('web-auth');
	});
	test('order matters: kebab then strip-emoji vs strip-emoji then kebab', () => {
		// Both happen to produce same result here because emoji is a separate
		// character class, but verify chain order is respected
		expect(applyFilterChain('📁 Web Auth', ['kebab-case', 'strip-emoji'])).toBe('-web-auth');
		expect(applyFilterChain('📁 Web Auth', ['strip-emoji', 'kebab-case'])).toBe('web-auth');
	});
});

describe('applyFilterInverse', () => {
	test('keep inverse is identity', () => {
		expect(applyFilterInverse('Web Auth', 'keep')).toBe('Web Auth');
	});
	test('kebab-case inverse → Title Case (via metadata)', () => {
		expect(applyFilterInverse('web-auth', 'kebab-case')).toBe('Web Auth');
	});
	test('snake_case inverse → Title Case', () => {
		expect(applyFilterInverse('web_auth', 'snake_case')).toBe('Web Auth');
	});
	test('lossy filter (strip-emoji) inverse is identity', () => {
		expect(applyFilterInverse('Projects', 'strip-emoji')).toBe('Projects');
	});
	test('lossy filter (strip-num-prefix) inverse is identity', () => {
		expect(applyFilterInverse('Projects', 'strip-num-prefix')).toBe('Projects');
	});
	test('unknown filter inverse passes through', () => {
		expect(applyFilterInverse('foo', 'unknown-xyz')).toBe('foo');
	});
});

describe('applyFilterChainInverse', () => {
	test('empty chain', () => {
		expect(applyFilterChainInverse('Web Auth', [])).toBe('Web Auth');
	});
	test('single conditional filter round-trips for in-domain input', () => {
		const forward = applyFilterChain('Web Auth', ['kebab-case']);
		const inverse = applyFilterChainInverse(forward, ['kebab-case']);
		expect(inverse).toBe('Web Auth');
	});
	test('inverse walks chain in reverse order', () => {
		// Forward: lower then kebab-case → "Web Auth" → "web auth" → "web-auth"
		// Reverse: kebab-case^-1 then lower^-1 → "web-auth" → "Web Auth" → "Web Auth"
		const inverse = applyFilterChainInverse('web-auth', ['lower', 'kebab-case']);
		expect(inverse).toBe('Web Auth');
	});
});
