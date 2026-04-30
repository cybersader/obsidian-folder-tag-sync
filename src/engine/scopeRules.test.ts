/**
 * Tests for scopeRules — verifies that rule patterns/templates get
 * correctly rewritten to apply only inside a selected scope folder, and
 * that overlapping selections collapse via minimalScopeCover.
 */

import { describe, expect, test } from 'bun:test';
import { scopeRule, scopeRules, minimalScopeCover } from './scopeRules';
import type { MappingRule } from '../types/settings';

const baseRule: MappingRule = {
	id: 'test-rule',
	name: 'Test rule',
	enabled: true,
	priority: 10,
	direction: 'folder-to-tag',
	folderPattern: '^\\d+ - .*',
	folderTemplate: '{num} - {name}',
	folderEntryPoint: '',
	options: {
		createFolders: true,
		addTags: true,
		removeOrphanedTags: false,
		syncOnFileCreate: true,
		syncOnFileMove: true,
		syncOnFileRename: true,
	},
};

describe('scopeRule — single-rule scope rewrite', () => {
	test('empty scope is a no-op clone', () => {
		const result = scopeRule(baseRule, '');
		expect(result).not.toBe(baseRule); // new object
		expect(result.id).toBe(baseRule.id);
		expect(result.folderPattern).toBe(baseRule.folderPattern);
	});

	test('non-empty scope prepends scope to ^-anchored regex', () => {
		// `-` is literal outside a character class — no escape needed
		const result = scopeRule(baseRule, 'Projects/Cybersader/01 - Active');
		expect(result.folderPattern).toBe('^Projects/Cybersader/01 - Active/\\d+ - .*');
	});

	test('non-empty scope prepends scope to template literally', () => {
		const result = scopeRule(baseRule, 'Projects/Cybersader/01 - Active');
		expect(result.folderTemplate).toBe('Projects/Cybersader/01 - Active/{num} - {name}');
	});

	test('non-empty scope sets folderEntryPoint to the scope path', () => {
		const result = scopeRule(baseRule, 'A/B');
		expect(result.folderEntryPoint).toBe('A/B');
	});

	test('rule id gets scope-slug suffix', () => {
		const result = scopeRule(baseRule, 'Projects/Cybersader/01 - Active');
		expect(result.id).toBe('test-rule__projects-cybersader-01-active');
	});

	test('rule name gets human-readable @ scope suffix', () => {
		const result = scopeRule(baseRule, 'Projects/Cybersader');
		expect(result.name).toBe('Test rule @ Projects/Cybersader');
	});

	test('regex metacharacters in scope path get escaped', () => {
		// folder names with parens, dots, plus signs are unusual but legal
		const result = scopeRule(baseRule, 'Notes (2026)/v1.0+');
		expect(result.folderPattern).toBe('^Notes \\(2026\\)/v1\\.0\\+/\\d+ - .*');
	});

	test('pattern without leading ^ wraps via non-capturing group', () => {
		const r: MappingRule = { ...baseRule, folderPattern: 'middle\\d+' };
		const result = scopeRule(r, 'Some/Folder');
		expect(result.folderPattern).toBe('(?:Some/Folder/)middle\\d+');
	});

	test('rule without folderPattern keeps undefined', () => {
		const r: MappingRule = { ...baseRule, folderPattern: undefined };
		const result = scopeRule(r, 'A');
		expect(result.folderPattern).toBeUndefined();
	});

	test('does not mutate input rule', () => {
		const original = { ...baseRule };
		scopeRule(baseRule, 'A/B');
		expect(baseRule).toEqual(original);
	});
});

describe('scopeRules — batch scope rewrite', () => {
	test('scopes every rule in the list', () => {
		const rules: MappingRule[] = [
			{ ...baseRule, id: 'r1' },
			{ ...baseRule, id: 'r2' },
		];
		const scoped = scopeRules(rules, 'Projects/X');
		expect(scoped.length).toBe(2);
		expect(scoped[0].id).toBe('r1__projects-x');
		expect(scoped[1].id).toBe('r2__projects-x');
	});

	test('preserves order', () => {
		const rules: MappingRule[] = [
			{ ...baseRule, id: 'a', priority: 1 },
			{ ...baseRule, id: 'b', priority: 2 },
			{ ...baseRule, id: 'c', priority: 3 },
		];
		const scoped = scopeRules(rules, 'X');
		expect(scoped.map((r) => r.priority)).toEqual([1, 2, 3]);
	});
});

describe('minimalScopeCover — overlap reduction', () => {
	test('drops descendant scopes when ancestor is also selected', () => {
		const cover = minimalScopeCover(['Projects', 'Projects/Web', 'Projects/Web/Auth']);
		expect(cover).toEqual(['Projects']);
	});

	test('keeps independent scopes', () => {
		const cover = minimalScopeCover(['A', 'B', 'C']);
		expect(cover.sort()).toEqual(['A', 'B', 'C']);
	});

	test('mixed independent + overlapping', () => {
		const cover = minimalScopeCover([
			'Projects',
			'Projects/Web', // dropped (descendant of Projects)
			'Areas',
			'Resources/Topic', // kept (no ancestor in list)
		]);
		expect(cover.sort()).toEqual(['Areas', 'Projects', 'Resources/Topic']);
	});

	test('root scope (empty string) absorbs everything', () => {
		const cover = minimalScopeCover(['', 'Projects', 'Areas']);
		expect(cover).toEqual(['']);
	});

	test('partial-prefix names do NOT get folded', () => {
		// `Project` is not an ancestor of `Projects` (different segment)
		const cover = minimalScopeCover(['Project', 'Projects']);
		expect(cover.sort()).toEqual(['Project', 'Projects']);
	});

	test('empty input returns empty list', () => {
		expect(minimalScopeCover([])).toEqual([]);
	});
});

describe('scopeRule + minimalScopeCover composed (apply-flow simulation)', () => {
	test('selecting nested + outer scope reduces to outer scope', () => {
		// User selects Projects, Projects/Cybersader, Areas — apply path
		// reduces to [Projects, Areas] before scoping rules. Order is
		// length-asc due to the cover algorithm's pre-sort.
		const selected = ['Projects', 'Projects/Cybersader', 'Areas'];
		const cover = minimalScopeCover(selected);
		expect(cover.sort()).toEqual(['Areas', 'Projects']);

		// Each scope yields its own scoped copy of the rules
		const scopedAtProjects = scopeRule(baseRule, 'Projects');
		const scopedAtAreas = scopeRule(baseRule, 'Areas');
		expect(scopedAtProjects.id).not.toBe(scopedAtAreas.id);
		expect(scopedAtProjects.folderPattern).toBe('^Projects/\\d+ - .*');
		expect(scopedAtAreas.folderPattern).toBe('^Areas/\\d+ - .*');
	});
});
