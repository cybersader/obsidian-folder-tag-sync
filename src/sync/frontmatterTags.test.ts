/**
 * Unit tests for the pure frontmatter tag read/write helpers (issue #1).
 *
 * These cover every YAML shape the sync engine must round-trip — inline
 * scalar, inline array, block list, quoted, empty, missing, singular `tag:`,
 * nested-slash — plus the three glued-duplicate corruption variants reported
 * in issue #1 and their self-heal behavior. There were NO tests on this code
 * path before, which is exactly why the corruption shipped.
 */

import { describe, expect, test } from 'bun:test';
import {
	parseFrontmatterTags,
	setFrontmatterTags,
	splitGluedTagValue,
} from './frontmatterTags';

describe('parseFrontmatterTags — canonical block list (the regression)', () => {
	test('block list, single item — the plugin\'s own output, MUST round-trip', () => {
		// This is the exact shape the plugin writes. The old greedy regex
		// returned [] for it, so a second sync re-added the tag → corruption.
		expect(parseFrontmatterTags('tags:\n  - work/projects/my-project')).toEqual([
			'#work/projects/my-project',
		]);
	});

	test('block list, multiple items — order preserved', () => {
		expect(parseFrontmatterTags('tags:\n  - alpha\n  - beta')).toEqual([
			'#alpha',
			'#beta',
		]);
	});

	test('block list with quoted items — quotes stripped', () => {
		expect(parseFrontmatterTags('tags:\n  - "alpha"\n  - \'beta\'')).toEqual([
			'#alpha',
			'#beta',
		]);
	});

	test('block list followed by another top-level property — siblings ignored', () => {
		const fm = 'tags:\n  - alpha\naliases:\n  - Some Alias';
		expect(parseFrontmatterTags(fm)).toEqual(['#alpha']);
	});

	test('other properties BEFORE tags — tags still read', () => {
		const fm = 'title: Hi\ntags:\n  - alpha\nstatus: draft';
		expect(parseFrontmatterTags(fm)).toEqual(['#alpha']);
	});
});

describe('parseFrontmatterTags — inline shapes', () => {
	test('inline scalar', () => {
		expect(parseFrontmatterTags('tags: work/projects/my-project')).toEqual([
			'#work/projects/my-project',
		]);
	});

	test('inline scalar with a later property line', () => {
		expect(parseFrontmatterTags('tags: a/b/c\nstatus: draft')).toEqual(['#a/b/c']);
	});

	test('inline array unquoted', () => {
		expect(parseFrontmatterTags('tags: [a, b]')).toEqual(['#a', '#b']);
	});

	test('inline array quoted (double + single)', () => {
		expect(parseFrontmatterTags('tags: ["a", "b"]')).toEqual(['#a', '#b']);
		expect(parseFrontmatterTags("tags: ['a', 'b']")).toEqual(['#a', '#b']);
	});

	test('empty inline array → no tags', () => {
		expect(parseFrontmatterTags('tags: []')).toEqual([]);
	});
});

describe('parseFrontmatterTags — empty / missing / singular', () => {
	test('empty value (key present, no value) → no tags', () => {
		expect(parseFrontmatterTags('tags:')).toEqual([]);
		expect(parseFrontmatterTags('tags:\nstatus: draft')).toEqual([]);
	});

	test('missing tags key entirely → no tags', () => {
		expect(parseFrontmatterTags('title: Hi\nstatus: draft')).toEqual([]);
		expect(parseFrontmatterTags('')).toEqual([]);
	});

	test('singular `tag:` key — inline and list', () => {
		expect(parseFrontmatterTags('tag: solo')).toEqual(['#solo']);
		expect(parseFrontmatterTags('tag:\n  - solo')).toEqual(['#solo']);
	});

	test('a key like `tagline:` is NOT mistaken for the tags key', () => {
		expect(parseFrontmatterTags('tagline: a catchy phrase')).toEqual([]);
	});
});

describe('parseFrontmatterTags — nested slashes + dedupe', () => {
	test('nested-slash tag is NOT split on "/"', () => {
		expect(parseFrontmatterTags('tags:\n  - a/b/c/d')).toEqual(['#a/b/c/d']);
	});

	test('duplicate identical items are deduped, order-preserving', () => {
		expect(parseFrontmatterTags('tags:\n  - alpha\n  - beta\n  - alpha')).toEqual([
			'#alpha',
			'#beta',
		]);
	});

	test('#-prefixed and bare forms of the same tag dedupe together', () => {
		expect(parseFrontmatterTags('tags:\n  - "#alpha"\n  - alpha')).toEqual(['#alpha']);
	});
});

describe('parseFrontmatterTags — glued-duplicate corruption self-heal (issue #1)', () => {
	test('variant A: block-list replace glue "<tag>- <tag>"', () => {
		// The EXACT corruption string from issue #1.
		const corrupt = 'tags:\n  - work/projects/my-project- work/projects/my-project';
		expect(parseFrontmatterTags(corrupt)).toEqual(['#work/projects/my-project']);
	});

	test('variant A (short): list value "my-project- my-project"', () => {
		expect(parseFrontmatterTags('tags:\n  - my-project- my-project')).toEqual([
			'#my-project',
		]);
	});

	test('variant B: list value "my-projectmy-project" (direct concat)', () => {
		expect(parseFrontmatterTags('tags:\n  - my-projectmy-project')).toEqual([
			'#my-project',
		]);
	});

	test('variant C: inline scalar "<tag><tag>" concat', () => {
		const corrupt = 'tags: work/projects/my-projectwork/projects/my-project';
		expect(parseFrontmatterTags(corrupt)).toEqual(['#work/projects/my-project']);
	});

	test('mixed real + glued preserves the real neighbor', () => {
		const fm = 'tags:\n  - alpha\n  - my-project- my-project';
		expect(parseFrontmatterTags(fm)).toEqual(['#alpha', '#my-project']);
	});

	test('a clean nested tag is NOT collapsed (separator makes it odd-length)', () => {
		// `done/done` has a slash → odd length → the doubling heuristic leaves it.
		expect(parseFrontmatterTags('tags:\n  - done/done')).toEqual(['#done/done']);
	});
});

describe('splitGluedTagValue — unit behavior', () => {
	test('clean value passes through unchanged', () => {
		expect(splitGluedTagValue('work/projects/my-project')).toEqual([
			'work/projects/my-project',
		]);
	});

	test('does not split a kebab-case hyphen (no trailing whitespace)', () => {
		expect(splitGluedTagValue('my-project')).toEqual(['my-project']);
	});

	test('splits the illegal "- " boundary', () => {
		expect(splitGluedTagValue('a- b')).toEqual(['a', 'b']);
	});

	test('collapses exact even-length doubling', () => {
		expect(splitGluedTagValue('abab')).toEqual(['ab']);
	});

	test('empty / whitespace → no tokens', () => {
		expect(splitGluedTagValue('   ')).toEqual([]);
	});
});

describe('setFrontmatterTags — write any shape cleanly', () => {
	test('empty frontmatter → creates a bare block', () => {
		expect(setFrontmatterTags('', ['#x'])).toBe('tags:\n  - x');
	});

	test('accepts #-prefixed or bare input, strips # for YAML', () => {
		expect(setFrontmatterTags('', ['#a', 'b'])).toBe('tags:\n  - a\n  - b');
	});

	test('inline scalar input → normalized to a clean block, no glued residue', () => {
		const out = setFrontmatterTags('tags: old', ['#new']);
		expect(out).toBe('tags:\n  - new');
		expect(out).not.toContain('old');
	});

	test('inline array input → normalized to block list', () => {
		expect(setFrontmatterTags('tags: [a, b]', ['#a', '#b'])).toBe(
			'tags:\n  - a\n  - b',
		);
	});

	test('block list with surrounding properties → only the block replaced', () => {
		const fm = 'title: Hi\ntags:\n  - old\nstatus: draft';
		const out = setFrontmatterTags(fm, ['#new']);
		expect(out).toBe('title: Hi\ntags:\n  - new\nstatus: draft');
	});

	test('no tags key → appended, existing frontmatter intact', () => {
		const out = setFrontmatterTags('title: Hi', ['#new']);
		expect(out).toBe('title: Hi\ntags:\n  - new');
	});

	test('block list followed by aliases → aliases preserved', () => {
		const fm = 'tags:\n  - old\naliases:\n  - Alt Name';
		const out = setFrontmatterTags(fm, ['#new']);
		expect(out).toBe('tags:\n  - new\naliases:\n  - Alt Name');
	});

	test('empty tag set → tags: []', () => {
		expect(setFrontmatterTags('tags:\n  - old', [])).toBe('tags: []');
	});

	test('dedupes input order-preserving', () => {
		expect(setFrontmatterTags('', ['#a', '#b', '#a'])).toBe('tags:\n  - a\n  - b');
	});
});

describe('round-trip — set then parse recovers the same set, per shape', () => {
	const shapes: Array<[string, string]> = [
		['inline scalar', 'tags: a/b/c'],
		['inline array', 'tags: [a/b, c/d]'],
		['block list', 'tags:\n  - a/b\n  - c/d'],
		['quoted block', 'tags:\n  - "a/b"\n  - \'c/d\''],
		['block + siblings', 'title: Hi\ntags:\n  - a/b\nstatus: x'],
		['corruption variant A', 'tags:\n  - a/b- a/b'],
		['corruption variant C', 'tags: a/ba/b'],
	];

	for (const [label, fm] of shapes) {
		test(label, () => {
			const tags = parseFrontmatterTags(fm);
			const written = setFrontmatterTags(fm, tags);
			expect(parseFrontmatterTags(written)).toEqual(tags);
		});
	}

	test('healing is a fixed point: re-parsing a healed block is stable', () => {
		const corrupt = 'tags:\n  - work/projects/my-project- work/projects/my-project';
		const tags = parseFrontmatterTags(corrupt);
		const healed = setFrontmatterTags(corrupt, tags);
		expect(healed).toBe('tags:\n  - work/projects/my-project');
		// Re-running parse + set is a no-op (idempotent).
		expect(setFrontmatterTags(healed, parseFrontmatterTags(healed))).toBe(healed);
	});
});
