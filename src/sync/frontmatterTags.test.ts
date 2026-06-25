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

	test('variant B: separator-less concat is treated as ONE literal tag (NOT halved)', () => {
		// The blind even-length "halving" heuristic was removed (hole 1) — it
		// destroyed legitimate tags like `2020`/`bonbon`. Separator-less glue is
		// now an accepted, documented limitation: lossless, never corrupting.
		expect(parseFrontmatterTags('tags:\n  - my-projectmy-project')).toEqual([
			'#my-projectmy-project',
		]);
	});

	test('variant C: inline scalar concat is also a single literal tag (NOT halved)', () => {
		const corrupt = 'tags: work/projects/my-projectwork/projects/my-project';
		expect(parseFrontmatterTags(corrupt)).toEqual([
			'#work/projects/my-projectwork/projects/my-project',
		]);
	});

	test('mixed real + glued preserves the real neighbor', () => {
		const fm = 'tags:\n  - alpha\n  - my-project- my-project';
		expect(parseFrontmatterTags(fm)).toEqual(['#alpha', '#my-project']);
	});

	test('a clean nested tag is NOT collapsed', () => {
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

	test('does NOT collapse separator-less doubling (heuristic removed in hole 1)', () => {
		// `abab` could be the corruption `ab`+`ab` OR a real tag literally named
		// `abab` — indistinguishable, so it is left intact rather than destroyed.
		expect(splitGluedTagValue('abab')).toEqual(['abab']);
	});

	test('splits the illegal "- " boundary and dedupes identical halves', () => {
		expect(splitGluedTagValue('a/b- a/b')).toEqual(['a/b']);
	});

	test('splits the illegal ", " boundary too', () => {
		expect(splitGluedTagValue('a, b')).toEqual(['a', 'b']);
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
		['multiline flow array', 'tags: [\n  a/b,\n  c/d\n]'],
		['corruption variant A', 'tags:\n  - a/b- a/b'],
		['separator-less value treated literally', 'tags: a/ba/b'],
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

// ─────────────────────────────────────────────────────────────────────────────
// Adversarial-review holes (patches on top of the issue-#1 fix)
// ─────────────────────────────────────────────────────────────────────────────

describe('HOLE 1 — clean values are NEVER corrupted by a doubling heuristic', () => {
	// The old `collapseDoubling` halved any even-length value whose halves
	// matched, silently destroying real tags on every read (`2020`→`20`,
	// `bonbon`→`bon`, `couscous`→`cous`). These lock that regression closed.
	test('numeric year tag survives intact (VERIFIED bug: returned #20)', () => {
		expect(parseFrontmatterTags('tags:\n  - 2020')).toEqual(['#2020']);
	});

	test('doubled-looking real words survive (bonbon/yoyo/aa/1010/couscous)', () => {
		expect(parseFrontmatterTags('tags:\n  - bonbon')).toEqual(['#bonbon']);
		expect(parseFrontmatterTags('tags:\n  - yoyo')).toEqual(['#yoyo']);
		expect(parseFrontmatterTags('tags:\n  - aa')).toEqual(['#aa']);
		expect(parseFrontmatterTags('tags:\n  - 1010')).toEqual(['#1010']);
		expect(parseFrontmatterTags('tags:\n  - couscous')).toEqual(['#couscous']);
	});

	test('issue-#1 variant-A corruption STILL heals (the repair we kept)', () => {
		const corrupt = 'tags:\n  - work/projects/my-project- work/projects/my-project';
		expect(parseFrontmatterTags(corrupt)).toEqual(['#work/projects/my-project']);
	});

	// HARD ACCEPTANCE: set→parse identity for doubled-looking values.
	for (const val of ['2020', 'bonbon', 'yoyo', 'aa', '1010', 'couscous']) {
		test(`round-trip identity: set→parse is identity for "${val}"`, () => {
			const written = setFrontmatterTags('', [`#${val}`]);
			expect(written).toBe(`tags:\n  - ${val}`);
			expect(parseFrontmatterTags(written)).toEqual([`#${val}`]);
		});
	}
});

describe('HOLE 2 — multiline flow array on the WRITE path stays valid YAML', () => {
	test('write replaces the whole flow array, no dangling "]"', () => {
		const out = setFrontmatterTags('tags: [\n  alpha\n]', ['#alpha', '#x']);
		expect(out).toBe('tags:\n  - alpha\n  - x');
		expect(out).not.toContain(']');
	});

	test('multiline flow array with siblings → only the block replaced, no dangle', () => {
		const fm = 'title: Hi\ntags: [\n  alpha,\n  beta\n]\nstatus: draft';
		const out = setFrontmatterTags(fm, ['#alpha', '#beta', '#x']);
		expect(out).toBe('title: Hi\ntags:\n  - alpha\n  - beta\n  - x\nstatus: draft');
	});

	test('multiline flow array is also READ (no data loss on a triggered write)', () => {
		expect(parseFrontmatterTags('tags: [\n  alpha,\n  beta\n]')).toEqual([
			'#alpha',
			'#beta',
		]);
		// Newline-separated (no commas) flow array items are read too.
		expect(parseFrontmatterTags('tags: [\n  alpha\n  beta\n]')).toEqual([
			'#alpha',
			'#beta',
		]);
	});
});

describe('HOLE 3 — CRLF / lone-CR tolerated by the pure parser/writer', () => {
	test('CRLF frontmatter parses correctly (trailing \\r stripped)', () => {
		expect(parseFrontmatterTags('tags:\r\n  - alpha\r\n')).toEqual(['#alpha']);
	});

	test('CRLF inline scalar parses correctly', () => {
		expect(parseFrontmatterTags('tags: a/b/c\r\nstatus: draft')).toEqual(['#a/b/c']);
	});

	test('CRLF input writes a clean LF block', () => {
		expect(setFrontmatterTags('tags:\r\n  - old', ['#new'])).toBe('tags:\n  - new');
	});
});

describe('HOLE 4 — bare null/bool/number scalar is NOT a tag', () => {
	test('tags: null / ~ / true / false / number → no tags', () => {
		expect(parseFrontmatterTags('tags: null')).toEqual([]);
		expect(parseFrontmatterTags('tags: ~')).toEqual([]);
		expect(parseFrontmatterTags('tags: true')).toEqual([]);
		expect(parseFrontmatterTags('tags: false')).toEqual([]);
		expect(parseFrontmatterTags('tags: 123')).toEqual([]);
		expect(parseFrontmatterTags('tags: 1.5')).toEqual([]);
	});

	test('a QUOTED "null" is an explicit string tag and is kept', () => {
		expect(parseFrontmatterTags('tags: "null"')).toEqual(['#null']);
	});

	test('a numeric value in a block LIST is preserved (only scalars are filtered)', () => {
		expect(parseFrontmatterTags('tags:\n  - 2020')).toEqual(['#2020']);
		expect(parseFrontmatterTags('tags: [2020, alpha]')).toEqual(['#2020', '#alpha']);
	});
});

describe('HOLE 5 — duplicate tags: keys are healed', () => {
	test('both keys are unioned on read', () => {
		expect(parseFrontmatterTags('tags:\n  - a\ntags:\n  - b')).toEqual(['#a', '#b']);
	});

	test('all keys collapse into ONE block on write', () => {
		const out = setFrontmatterTags('tags:\n  - a\ntags:\n  - b', ['#a', '#b']);
		expect(out).toBe('tags:\n  - a\n  - b');
		expect((out.match(/^tags:/gm) ?? []).length).toBe(1);
	});

	test('duplicate keys with siblings collapse to one block, siblings preserved', () => {
		const fm = 'title: Hi\ntags:\n  - a\nstatus: x\ntags:\n  - b';
		const out = setFrontmatterTags(fm, parseFrontmatterTags(fm));
		expect((out.match(/^tags:/gm) ?? []).length).toBe(1);
		expect(out).toContain('title: Hi');
		expect(out).toContain('status: x');
		expect(out).toContain('  - a');
		expect(out).toContain('  - b');
	});
});

describe('HOLE 6 — YAML comments do not hide or pollute tags', () => {
	test('full-line indented comment inside a block does not hide following items', () => {
		expect(parseFrontmatterTags('tags:\n  # a comment\n  - alpha')).toEqual([
			'#alpha',
		]);
	});

	test('trailing inline comment is stripped from a list-item value', () => {
		expect(parseFrontmatterTags('tags:\n  - alpha # note')).toEqual(['#alpha']);
	});

	test('trailing inline comment is stripped from an inline scalar', () => {
		expect(parseFrontmatterTags('tags: alpha # note')).toEqual(['#alpha']);
	});

	test('a #-prefixed tag value is NOT mistaken for a comment', () => {
		expect(parseFrontmatterTags('tags:\n  - "#alpha"')).toEqual(['#alpha']);
	});
});
