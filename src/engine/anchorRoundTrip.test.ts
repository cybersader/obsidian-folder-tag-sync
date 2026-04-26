/**
 * End-to-end anchor round-trip — Phase G commit 5.
 *
 * Builds a typed rule with each `folderAnchor` mode, derives the MappingRule,
 * and exercises the full forward (folder → tag) and inverse (tag → folder)
 * pipelines. Pinning here protects against regressions in:
 *   - `derive.ts:deriveFolderPattern` emitting the wrong regex shape
 *   - `applyTransfer.ts:applyRuleForward` stripping the wrong prefix
 *   - `applyTransfer.ts:applyRuleInverse` failing to prepend the parent
 *     when reversing a `under: ...` rule
 *
 * Negative cases pin the original Phase F bug (root-anchor rule against a
 * vault with only nested matches → 0 matches) so any future loosening of
 * pattern semantics is intentional.
 */

import { describe, expect, test } from 'bun:test';
import { deriveRule } from './derive';
import { applyRuleForward, applyRuleInverse } from './applyTransfer';
import type { TypedRuleSpec } from '../types/typed';

const baseOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
};

const baseSpec = (overrides: Partial<TypedRuleSpec>): TypedRuleSpec => ({
	id: 'test',
	name: 'Test',
	priority: 1,
	direction: 'bidirectional',
	enabled: true,
	folder: { axes: ['work'], scheme: 'enumerative', naming: 'word', subdivisionDepth: 'unbounded', siblingUniformity: 'parallel' },
	tag: { axis: 'work', coordination: 'pre-coordinated', prefixMarker: null, authority: 'mutual' },
	transfer: { op: 'identity' },
	inverseTransfer: { op: 'identity' },
	folderEntry: 'Projects',
	tagEntry: 'projects',
	options: baseOptions,
	...overrides,
});

// ─── 'root' anchor — current default behavior ────────────────────────────

describe("anchor 'root' (default) — forward sync", () => {
	const rule = deriveRule(baseSpec({ folderAnchor: 'root' }));

	test('matches and tags root-level entry', () => {
		const result = applyRuleForward('Projects', rule);
		expect(result.tags).toEqual(['#projects']);
	});

	test('matches and tags nested-below-entry', () => {
		const result = applyRuleForward('Projects/Web/auth', rule);
		expect(result.tags).toEqual(['#projects/web/auth']);
	});

	test('does NOT match nested-under-other-folder (the original Phase F bug)', () => {
		// `fixtures/Projects` → root anchor pattern doesn't match.
		const result = applyRuleForward('fixtures/Projects', rule);
		expect(result.tags).toEqual([]);
	});

	test('does NOT match unrelated folder', () => {
		const result = applyRuleForward('Areas', rule);
		expect(result.tags).toEqual([]);
	});
});

describe("anchor 'root' (default) — inverse sync", () => {
	const rule = deriveRule(baseSpec({ folderAnchor: 'root' }));

	test('reverses tag back to root-anchored folder path', () => {
		// Folder transform default is Title Case → 'web' → 'Web'.
		const result = applyRuleInverse('#projects/web', rule);
		expect(result.folder).toBe('Projects/Web');
	});
});

// ─── 'any-segment' anchor — matches at any depth ─────────────────────────

describe("anchor 'any-segment' — forward sync", () => {
	const rule = deriveRule(baseSpec({ folderAnchor: 'any-segment' }));

	test('matches root-level entry (still works at root)', () => {
		const result = applyRuleForward('Projects', rule);
		expect(result.tags).toEqual(['#projects']);
	});

	test('matches nested entry — fixtures/Projects', () => {
		// The Phase F user-vault scenario: fixtures/Projects should now match.
		const result = applyRuleForward('fixtures/Projects', rule);
		expect(result.tags).toEqual(['#projects']);
	});

	test('matches deeply-nested entry — a/b/Projects/sub', () => {
		const result = applyRuleForward('a/b/Projects/sub', rule);
		expect(result.tags).toEqual(['#projects/sub']);
	});

	test('does NOT match partial-word folders', () => {
		// `(?:^|/)Projects(?:/|$)` requires a segment boundary on both sides
		const result = applyRuleForward('NotProjects', rule);
		expect(result.tags).toEqual([]);
	});
});

describe("anchor 'any-segment' — inverse sync", () => {
	const rule = deriveRule(baseSpec({ folderAnchor: 'any-segment' }));

	test('reverses tag → root-level folder (no canonical parent for any-segment)', () => {
		// Inverse direction has no unique parent for any-segment rules —
		// default to root placement. Users who want a specific location
		// should use `under: ...` instead.
		const result = applyRuleInverse('#projects/web', rule);
		expect(result.folder).toBe('Projects/Web');
	});
});

// ─── { under: 'X' } anchor — nested deployment ───────────────────────────

describe("anchor { under: 'fixtures' } — forward sync", () => {
	const rule = deriveRule(baseSpec({ folderAnchor: { under: 'fixtures' } }));

	test('matches and tags nested entry', () => {
		const result = applyRuleForward('fixtures/Projects', rule);
		expect(result.tags).toEqual(['#projects']);
	});

	test('strips the parent prefix correctly when extracting remainder', () => {
		// fixtures/Projects/Web → strip "fixtures/Projects/" → remainder "Web" → tag #projects/web
		const result = applyRuleForward('fixtures/Projects/Web', rule);
		expect(result.tags).toEqual(['#projects/web']);
	});

	test('strips a deeply-nested remainder cleanly', () => {
		const result = applyRuleForward('fixtures/Projects/Web/auth', rule);
		expect(result.tags).toEqual(['#projects/web/auth']);
	});

	test('does NOT match root-level entry (must be under fixtures/)', () => {
		const result = applyRuleForward('Projects', rule);
		expect(result.tags).toEqual([]);
	});

	test('does NOT match nested-under-different-parent', () => {
		const result = applyRuleForward('other/Projects', rule);
		expect(result.tags).toEqual([]);
	});
});

describe("anchor { under: 'fixtures' } — inverse sync", () => {
	const rule = deriveRule(baseSpec({ folderAnchor: { under: 'fixtures' } }));

	test('reverses tag back to under-prefixed folder path', () => {
		// Critical correctness check: the inverse must prepend the under
		// prefix so files created from a tag end up in the right place.
		// Folder transform default is Title Case → 'web' → 'Web'.
		const result = applyRuleInverse('#projects/web', rule);
		expect(result.folder).toBe('fixtures/Projects/Web');
	});

	test('reverses bare tag entry-point', () => {
		const result = applyRuleInverse('#projects', rule);
		expect(result.folder).toBe('fixtures/Projects');
	});
});

// ─── Realistic scenario: JD pack deployed under fixtures/ ────────────────

describe('realistic — JD-style rule deployed under fixtures/', () => {
	// Closes the loop on the user's original Phase F observation:
	// "Clicking edit on the JD rule doesn't show useful preview" — root
	// cause was the JD rule anchored to vault root, vault has folders under
	// fixtures/. With under: 'fixtures' anchor, the rule now matches.
	const rule = deriveRule(
		baseSpec({
			folderEntry: '10 - Projects',
			tagEntry: '10-projects',
			folderAnchor: { under: 'fixtures' },
		}),
	);

	test('matches typical JD-nested folder', () => {
		const r = applyRuleForward('fixtures/10 - Projects', rule);
		expect(r.tags).toEqual(['#10-projects']);
	});

	test('matches with sub-folders — kebab-case tag transform applied', () => {
		// Tag transform default for non-marker is kebab-case.
		// '11 - Q4 Roadmap' → '11-q4-roadmap'.
		const r = applyRuleForward('fixtures/10 - Projects/11 - Q4 Roadmap', rule);
		expect(r.tags).toEqual(['#10-projects/11-q4-roadmap']);
	});
});
