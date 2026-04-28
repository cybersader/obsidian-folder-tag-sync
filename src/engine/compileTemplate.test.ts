/**
 * Tests for the Path Lens template compiler.
 *
 * Covers:
 * - Compiler: literal segments, segment slots, glob slots, filters, errors
 * - Slot extraction: matching paths to compiled templates
 * - Template instantiation: building paths from slot values
 * - Bijectivity detection: Layer 1 (structural) + Layer 2 (per-transform)
 *
 * Reference: docs/concepts/bijectivity-detection.md
 */

import { describe, expect, test } from 'bun:test';
import {
	compileTemplate,
	extractSlots,
	instantiateTemplate,
	computeBijectivity,
	TemplateParseError,
} from './compileTemplate';

describe('compileTemplate', () => {
	describe('basic parsing', () => {
		test('compiles a single-literal template', () => {
			const compiled = compileTemplate('Projects');
			expect(compiled.slots).toHaveLength(0);
			expect(compiled.regex.test('Projects')).toBe(true);
			expect(compiled.regex.test('Project')).toBe(false);
			expect(compiled.regex.test('Projects/Web')).toBe(false);
		});

		test('compiles a single-slot template', () => {
			const compiled = compileTemplate('Projects/{topic}');
			expect(compiled.slots).toHaveLength(1);
			expect(compiled.slots[0].name).toBe('topic');
			expect(compiled.slots[0].kind).toBe('segment');
			expect(compiled.slots[0].filters).toEqual([]);
			expect(compiled.regex.test('Projects/Web')).toBe(true);
			expect(compiled.regex.test('Projects/Web/Auth')).toBe(false); // segment slot rejects extra segment
		});

		test('compiles a glob slot', () => {
			const compiled = compileTemplate('Projects/{deeper...}');
			expect(compiled.slots[0].kind).toBe('glob');
			expect(compiled.regex.test('Projects/Web')).toBe(true);
			expect(compiled.regex.test('Projects/Web/Auth/oauth.md')).toBe(true);
		});

		test('compiles multiple slots', () => {
			const compiled = compileTemplate('Projects/{topic}/{deeper...}');
			expect(compiled.slots).toHaveLength(2);
			expect(compiled.slots[0].name).toBe('topic');
			expect(compiled.slots[0].kind).toBe('segment');
			expect(compiled.slots[1].name).toBe('deeper');
			expect(compiled.slots[1].kind).toBe('glob');
		});

		test('compiles filters', () => {
			const compiled = compileTemplate('Projects/{topic | kebab-case}');
			expect(compiled.slots[0].filters).toEqual(['kebab-case']);
		});

		test('compiles multiple filters', () => {
			const compiled = compileTemplate('Projects/{topic | kebab-case | strip-emoji}');
			expect(compiled.slots[0].filters).toEqual(['kebab-case', 'strip-emoji']);
		});

		test('compiles slot with hyphen + underscore in name', () => {
			const compiled = compileTemplate('Projects/{topic-name}/{some_var}');
			expect(compiled.slots[0].name).toBe('topic-name');
			expect(compiled.slots[1].name).toBe('some_var');
		});
	});

	describe('regex output correctness', () => {
		test('escapes regex metacharacters in literals', () => {
			const compiled = compileTemplate('Projects.bak/{topic}');
			expect(compiled.regex.test('Projects.bak/Web')).toBe(true);
			expect(compiled.regex.test('ProjectsXbak/Web')).toBe(false);
		});

		test('handles emoji in literals', () => {
			const compiled = compileTemplate('📁 Projects/{topic}');
			expect(compiled.regex.test('📁 Projects/Web')).toBe(true);
			expect(compiled.regex.test('Projects/Web')).toBe(false);
		});

		test('anchors at both ends', () => {
			const compiled = compileTemplate('Projects/{topic}');
			expect(compiled.regex.test('XProjects/Web')).toBe(false); // no prefix allowed
			expect(compiled.regex.test('Projects/WebX')).toBe(true); // 'X' is part of the topic capture
			expect(compiled.regex.test('Projects/Web/Extra')).toBe(false); // segment slot rejects extra segment
		});
	});

	describe('error handling', () => {
		test('throws on unclosed slot', () => {
			expect(() => compileTemplate('Projects/{topic')).toThrow(TemplateParseError);
		});

		test('throws on empty slot', () => {
			expect(() => compileTemplate('Projects/{}')).toThrow(TemplateParseError);
		});

		test('throws on invalid slot name', () => {
			expect(() => compileTemplate('Projects/{1invalid}')).toThrow(TemplateParseError);
			expect(() => compileTemplate('Projects/{has space}')).toThrow(TemplateParseError);
		});

		test('throws on duplicate slot names', () => {
			expect(() => compileTemplate('Projects/{topic}/{topic}')).toThrow(TemplateParseError);
		});

		test('throws on null/undefined input', () => {
			expect(() => compileTemplate(null as unknown as string)).toThrow(TemplateParseError);
			expect(() => compileTemplate(undefined as unknown as string)).toThrow(TemplateParseError);
		});
	});
});

describe('extractSlots', () => {
	test('extracts a single slot', () => {
		const compiled = compileTemplate('Projects/{topic}');
		const result = extractSlots(compiled, 'Projects/Web');
		expect(result).toEqual({ topic: 'Web' });
	});

	test('extracts multiple slots', () => {
		const compiled = compileTemplate('Projects/{topic}/{deeper...}');
		const result = extractSlots(compiled, 'Projects/Web/Auth/oauth.md');
		expect(result).toEqual({ topic: 'Web', deeper: 'Auth/oauth.md' });
	});

	test('returns null on no-match', () => {
		const compiled = compileTemplate('Projects/{topic}');
		expect(extractSlots(compiled, 'Areas/Web')).toBeNull();
	});

	test('handles emoji in input', () => {
		const compiled = compileTemplate('📁 Projects/{topic}');
		const result = extractSlots(compiled, '📁 Projects/Web Auth');
		expect(result).toEqual({ topic: 'Web Auth' });
	});
});

describe('instantiateTemplate', () => {
	test('instantiates a single slot', () => {
		const compiled = compileTemplate('Projects/{topic}');
		const result = instantiateTemplate(compiled, { topic: 'Web' });
		expect(result).toBe('Projects/Web');
	});

	test('instantiates multiple slots', () => {
		const compiled = compileTemplate('Projects/{topic}/{deeper...}');
		const result = instantiateTemplate(compiled, { topic: 'Web', deeper: 'Auth/oauth.md' });
		expect(result).toBe('Projects/Web/Auth/oauth.md');
	});

	test('throws on missing slot value', () => {
		const compiled = compileTemplate('Projects/{topic}');
		expect(() => instantiateTemplate(compiled, {})).toThrow(TemplateParseError);
	});

	test('round-trips: extract → instantiate produces the original', () => {
		const compiled = compileTemplate('Projects/{topic}/{deeper...}');
		const path = 'Projects/Web Auth/oauth/notes.md';
		const slots = extractSlots(compiled, path);
		expect(slots).not.toBeNull();
		const reconstructed = instantiateTemplate(compiled, slots!);
		expect(reconstructed).toBe(path);
	});
});

describe('computeBijectivity', () => {
	describe('Layer 1 — structural slot overlap', () => {
		test('identical templates → fully bijective', () => {
			const verdict = computeBijectivity('Projects/{topic}', '#projects/{topic}');
			expect(verdict.layer1Pass).toBe(true);
			expect(verdict.status).toBe('total');
			expect(verdict.folderOnlySlots).toEqual([]);
			expect(verdict.tagOnlySlots).toEqual([]);
		});

		test('slots only on folder side → lossy + folderOnlySlots populated', () => {
			const verdict = computeBijectivity('Projects/{topic}/{discarded...}', '#projects/{topic}');
			expect(verdict.layer1Pass).toBe(false);
			expect(verdict.status).toBe('lossy');
			expect(verdict.folderOnlySlots).toEqual(['discarded']);
			expect(verdict.tagOnlySlots).toEqual([]);
			expect(verdict.reason).toContain('discarded');
		});

		test('slots only on tag side → lossy + tagOnlySlots populated', () => {
			const verdict = computeBijectivity('Projects/{topic}', '#{owner}/projects/{topic}');
			expect(verdict.layer1Pass).toBe(false);
			expect(verdict.tagOnlySlots).toEqual(['owner']);
			expect(verdict.reason).toContain('owner');
			expect(verdict.reason).toContain('unsourced');
		});

		test('mismatched slot names → both sides flagged', () => {
			const verdict = computeBijectivity('Projects/{topic}', '#projects/{section}');
			expect(verdict.layer1Pass).toBe(false);
			expect(verdict.folderOnlySlots).toEqual(['topic']);
			expect(verdict.tagOnlySlots).toEqual(['section']);
		});
	});

	describe('Layer 2 — per-transform reversibility', () => {
		test('no filters → total bijection', () => {
			const verdict = computeBijectivity('Projects/{topic}', '#projects/{topic}');
			expect(verdict.status).toBe('total');
			expect(verdict.perSlot).toEqual({ topic: 'total' });
		});

		test('reversible filter (kebab-case) on tag side → conditional', () => {
			const verdict = computeBijectivity(
				'Projects/{topic}',
				'#projects/{topic | kebab-case}',
			);
			expect(verdict.layer1Pass).toBe(true);
			expect(verdict.status).toBe('conditional');
			expect(verdict.perSlot.topic).toBe('conditional');
			expect(verdict.reason).toContain('kebab-case');
		});

		test('lossy filter (strip-emoji) → lossy', () => {
			const verdict = computeBijectivity(
				'Projects/{topic}',
				'#projects/{topic | strip-emoji}',
			);
			expect(verdict.layer1Pass).toBe(true);
			expect(verdict.status).toBe('lossy');
			expect(verdict.perSlot.topic).toBe('lossy');
			expect(verdict.reason).toContain('strip-emoji');
		});

		test('mixed filters: lossy short-circuits even with conditional', () => {
			const verdict = computeBijectivity(
				'Projects/{topic}',
				'#projects/{topic | kebab-case | strip-emoji}',
			);
			expect(verdict.status).toBe('lossy'); // strip-emoji wins
		});

		test('multiple slots: any-lossy makes whole rule lossy', () => {
			const verdict = computeBijectivity(
				'Projects/{topic}/{deeper}',
				'#projects/{topic | strip-emoji}/{deeper}',
			);
			expect(verdict.status).toBe('lossy');
			expect(verdict.perSlot.topic).toBe('lossy');
			expect(verdict.perSlot.deeper).toBe('total');
		});

		test('unknown filter → treated as lossy (conservative)', () => {
			const verdict = computeBijectivity(
				'Projects/{topic}',
				'#projects/{topic | unknown-filter-xyz}',
			);
			expect(verdict.status).toBe('lossy');
		});
	});

	describe('edge cases', () => {
		test('missing template → lossy with reason', () => {
			const verdict = computeBijectivity(undefined as unknown as string, '#projects/{topic}');
			expect(verdict.status).toBe('lossy');
			expect(verdict.reason).toContain('missing');
		});

		test('parse error → lossy with reason', () => {
			const verdict = computeBijectivity('Projects/{topic', '#projects/{topic}');
			expect(verdict.status).toBe('lossy');
			expect(verdict.reason).toContain('parse failed');
		});
	});

	describe('canonical scenarios', () => {
		test('PARA identity rule → total bijection', () => {
			const verdict = computeBijectivity('Projects/{project}', '#projects/{project}');
			expect(verdict.status).toBe('total');
			expect(verdict.layer1Pass).toBe(true);
			expect(verdict.layer2Pass).toBe(true);
		});

		test('marker-only rule (slot discarded on tag side) → lossy', () => {
			const verdict = computeBijectivity('Capture/Inbox/{discarded...}', '#-inbox');
			expect(verdict.status).toBe('lossy');
			expect(verdict.folderOnlySlots).toEqual(['discarded']);
		});

		test('SEACOW per-entity → total when slots flow through both sides', () => {
			const verdict = computeBijectivity(
				'Entity/{owner}/Projects/{project}',
				'#--{owner}/projects/{project}',
			);
			expect(verdict.status).toBe('total');
		});

		test('JD with kebab-case on tag side → conditional', () => {
			const verdict = computeBijectivity(
				'{jd-area}/{topic}/{deeper...}',
				'#{jd-area | kebab-case}/{topic | kebab-case}/{deeper}',
			);
			expect(verdict.status).toBe('conditional');
		});

		test('truncation/aggregate via join filter → lossy (separator collision)', () => {
			const verdict = computeBijectivity(
				"Capture/Clips/{section}/{subsection}/{deeper...}",
				"#-clip/{section}/{subsection}/{deeper | join('-')}",
			);
			expect(verdict.status).toBe('lossy');
			expect(verdict.perSlot.deeper).toBe('lossy');
		});
	});

	describe('ambiguous-by-construction templates', () => {
		test('adjacent slots without separator: regex backtracks, ambiguous split', () => {
			// `{a}{b}` is a footgun — both slots are `[^/]+`, the regex backtracks
			// to find a split that satisfies both. For `foo` it yields {a:"fo", b:"o"}
			// (greedy `a` plus 1-char `b`). For `f` (1 char) there's no valid split.
			// We should warn about adjacent slots in F2 commit 1d (UI).
			const compiled = compileTemplate('{a}{b}');
			expect(extractSlots(compiled, 'foo')).toEqual({ a: 'fo', b: 'o' });
			expect(extractSlots(compiled, 'f')).toBeNull();
		});

		test('adjacent slots with literal separator inside: matches correctly', () => {
			const compiled = compileTemplate('{a}-{b}');
			const result = extractSlots(compiled, 'foo-bar');
			expect(result).toEqual({ a: 'foo', b: 'bar' });
		});

		test('glob slot followed by literal segment: glob is greedy → unexpected match', () => {
			// `{front...}/middle/{back}` — `.+` is greedy, will gobble `middle/`
			// and only release on backtrack. This works but is fragile.
			const compiled = compileTemplate('{front...}/middle/{back}');
			const result = extractSlots(compiled, 'a/b/middle/c');
			expect(result).toEqual({ front: 'a/b', back: 'c' });
		});

		test('glob followed by literal: glob ALSO matches paths with `middle/` inside front', () => {
			// Greedy `.+` + backtracking means front absorbs the inner `middle/`
			// when there's another `middle/` later. Document the over-match risk.
			const compiled = compileTemplate('{front...}/middle/{back}');
			const result = extractSlots(compiled, 'a/middle/b/middle/c');
			expect(result).toEqual({ front: 'a/middle/b', back: 'c' });
		});

		test('two glob slots in sequence: trailing optional eats nothing, first slot greedy', () => {
			// Post trailing-optional-glob relaxation: `{b...}` at the end is the
			// trailing glob and becomes optional. So compiled regex is
			// `^(?<a>.+)(?:/(?<b>.+))?$`. With input `x/y/z`, greedy `a` captures
			// the whole thing and `b` is undefined. Documenting the actual
			// behavior; two-globs-in-a-row remains a footgun template authors
			// should avoid (warn in UI later).
			const compiled = compileTemplate('{a...}/{b...}');
			const result = extractSlots(compiled, 'x/y/z');
			expect(result).toEqual({ a: 'x/y/z' });
		});

		test('trailing glob with nothing-after still rejects path with empty trailing segment', () => {
			// `Projects/` ends with `/` followed by nothing — neither the bare
			// entry (Projects) nor a deeper path (Projects/X). Should not match.
			const compiled = compileTemplate('Projects/{deeper...}');
			expect(extractSlots(compiled, 'Projects/')).toBeNull();
			// Bare entry DOES match post-relaxation (this is the whole point —
			// `Projects/{deeper...}` now expresses "Projects or Projects/anything")
			expect(extractSlots(compiled, 'Projects')).toEqual({});
		});
	});

	describe('empty input handling', () => {
		test('empty template compiles to literal-empty regex', () => {
			const compiled = compileTemplate('');
			expect(compiled.slots).toEqual([]);
			expect(compiled.regex.test('')).toBe(true);
			expect(compiled.regex.test('anything')).toBe(false);
		});

		test('extractSlots on empty path with non-empty template → null', () => {
			const compiled = compileTemplate('Projects/{topic}');
			expect(extractSlots(compiled, '')).toBeNull();
		});

		test('extractSlots on empty path with empty template → empty object', () => {
			const compiled = compileTemplate('');
			expect(extractSlots(compiled, '')).toEqual({});
		});

		test('instantiateTemplate with empty slot value → produces path with empty segment', () => {
			const compiled = compileTemplate('Projects/{topic}');
			const result = instantiateTemplate(compiled, { topic: '' });
			expect(result).toBe('Projects/');
		});
	});

	describe('filters on both sides — combined chain semantics', () => {
		test('same conditional filter both sides: still conditional (chain stays conditional)', () => {
			const verdict = computeBijectivity(
				'Projects/{topic | kebab-case}',
				'#projects/{topic | kebab-case}',
			);
			expect(verdict.layer1Pass).toBe(true);
			expect(verdict.status).toBe('conditional');
			expect(verdict.perSlot.topic).toBe('conditional');
		});

		test('different conditional filters each side: chained conditional', () => {
			const verdict = computeBijectivity(
				'Projects/{topic | kebab-case}',
				'#projects/{topic | snake_case}',
			);
			expect(verdict.layer1Pass).toBe(true);
			expect(verdict.status).toBe('conditional');
			expect(verdict.perSlot.topic).toBe('conditional');
		});

		test('lossy on folder side propagates through chain → lossy', () => {
			const verdict = computeBijectivity(
				'Projects/{topic | strip-emoji}',
				'#projects/{topic | kebab-case}',
			);
			expect(verdict.status).toBe('lossy');
			expect(verdict.perSlot.topic).toBe('lossy');
		});

		test('total on both sides → total', () => {
			const verdict = computeBijectivity(
				'Projects/{topic | keep}',
				'#projects/{topic | keep}',
			);
			expect(verdict.status).toBe('total');
			expect(verdict.perSlot.topic).toBe('total');
		});

		test('multi-filter chain on each side: any-lossy short-circuits whole chain', () => {
			const verdict = computeBijectivity(
				'Projects/{topic | kebab-case | keep}',
				'#projects/{topic | strip-num-prefix | keep}',
			);
			expect(verdict.status).toBe('lossy');
		});
	});

	describe('parse-failure paths in computeBijectivity', () => {
		test('tag-side parse failure → lossy with reason (folder-side success)', () => {
			const verdict = computeBijectivity('Projects/{topic}', '#projects/{topic');
			expect(verdict.status).toBe('lossy');
			expect(verdict.reason).toContain('parse failed');
		});

		test('both sides parse fail → lossy with reason', () => {
			const verdict = computeBijectivity('Projects/{topic', '#projects/{section');
			expect(verdict.status).toBe('lossy');
			expect(verdict.reason).toContain('parse failed');
		});
	});

	describe('round-trip property — extract→instantiate is identity for matching paths', () => {
		const cases: Array<{ template: string; path: string }> = [
			{ template: 'Projects/{topic}', path: 'Projects/Web' },
			{ template: 'Projects/{topic}/{deeper...}', path: 'Projects/Web/Auth/oauth.md' },
			{ template: 'Entity/{owner}/Projects/{project}', path: 'Entity/Cybersader/Projects/folder-tag-sync' },
			{ template: '📁 {area}/{topic}', path: '📁 Work/Q4-Planning' },
			{ template: '{jd-area}/{topic}/{deeper...}', path: '20-29 Areas/Health/exercise/log.md' },
			{ template: 'Capture/Inbox/{discarded...}', path: 'Capture/Inbox/2026-04-28/notes.md' },
			{ template: '{a}-{b}', path: 'foo-bar' },
			{ template: 'A/{x}/B/{y}/C', path: 'A/one/B/two/C' },
		];

		for (const { template, path } of cases) {
			test(`round-trips: "${template}" matched against "${path}"`, () => {
				const compiled = compileTemplate(template);
				const slots = extractSlots(compiled, path);
				expect(slots).not.toBeNull();
				const reconstructed = instantiateTemplate(compiled, slots!);
				expect(reconstructed).toBe(path);
			});
		}
	});

	describe('trailing-optional-glob — bare-entry-or-deeper matching', () => {
		test('Projects/{deeper...} matches bare Projects (no children)', () => {
			const compiled = compileTemplate('Projects/{deeper...}');
			expect(compiled.slots[0].trailingOptionalGlob).toBe(true);
			expect(compiled.regex.test('Projects')).toBe(true);
			const slots = extractSlots(compiled, 'Projects');
			expect(slots).toEqual({}); // deeper undefined for bare match
		});

		test('Projects/{deeper...} matches Projects/X (single child)', () => {
			const compiled = compileTemplate('Projects/{deeper...}');
			const slots = extractSlots(compiled, 'Projects/Web');
			expect(slots).toEqual({ deeper: 'Web' });
		});

		test('Projects/{deeper...} matches Projects/X/Y/Z (deep child)', () => {
			const compiled = compileTemplate('Projects/{deeper...}');
			const slots = extractSlots(compiled, 'Projects/Web/Auth/oauth');
			expect(slots).toEqual({ deeper: 'Web/Auth/oauth' });
		});

		test('Projects/{deeper...} does NOT match unrelated folders', () => {
			const compiled = compileTemplate('Projects/{deeper...}');
			expect(compiled.regex.test('Areas')).toBe(false);
			expect(compiled.regex.test('Areas/Health')).toBe(false);
			expect(compiled.regex.test('ProjectsBackup')).toBe(false);
		});

		test('instantiateTemplate with empty slots yields the bare entry', () => {
			const compiled = compileTemplate('Projects/{deeper...}');
			const result = instantiateTemplate(compiled, {});
			expect(result).toBe('Projects');
		});

		test('instantiateTemplate with deeper slot yields full path', () => {
			const compiled = compileTemplate('Projects/{deeper...}');
			const result = instantiateTemplate(compiled, { deeper: 'Web/Auth' });
			expect(result).toBe('Projects/Web/Auth');
		});

		test('round-trip: bare entry → extract → instantiate → bare entry', () => {
			const compiled = compileTemplate('Projects/{deeper...}');
			const slots = extractSlots(compiled, 'Projects');
			expect(slots).toEqual({});
			const reconstructed = instantiateTemplate(compiled, slots!);
			expect(reconstructed).toBe('Projects');
		});

		test('round-trip: deep entry → extract → instantiate → deep entry', () => {
			const compiled = compileTemplate('Projects/{deeper...}');
			const slots = extractSlots(compiled, 'Projects/Web/Auth/oauth');
			const reconstructed = instantiateTemplate(compiled, slots!);
			expect(reconstructed).toBe('Projects/Web/Auth/oauth');
		});

		test('NON-trailing glob (slot followed by literal) keeps strict matching', () => {
			// `{front...}/middle` — glob is NOT last; relaxation should NOT apply.
			const compiled = compileTemplate('{front...}/middle');
			expect(compiled.slots[0].trailingOptionalGlob).toBeFalsy();
			expect(compiled.regex.test('middle')).toBe(false); // bare middle doesn't match
		});

		test('{root}/{deeper...} matches single root + deeper, AND bare root', () => {
			// Common starter: catch every top-level folder, optionally with descendants.
			const compiled = compileTemplate('{root}/{deeper...}');
			expect(compiled.slots[1].trailingOptionalGlob).toBe(true);
			// Bare root
			expect(extractSlots(compiled, 'Projects')).toEqual({ root: 'Projects' });
			// Root + descendants
			expect(extractSlots(compiled, 'Projects/Web/Auth')).toEqual({
				root: 'Projects',
				deeper: 'Web/Auth',
			});
		});

		test('emoji + JD prefix with trailing glob: `📁 01 - Projects/{deeper...}` matches bare', () => {
			const compiled = compileTemplate('📁 01 - Projects/{deeper...}');
			expect(compiled.regex.test('📁 01 - Projects')).toBe(true);
			expect(compiled.regex.test('📁 01 - Projects/Web Auth')).toBe(true);
			expect(extractSlots(compiled, '📁 01 - Projects')).toEqual({});
		});

		test('enterprise-style single-digit JD root with trailing glob matches bare + deep', () => {
			const compiled = compileTemplate('0 - Tasks, Planning/{deeper...}');
			expect(compiled.regex.test('0 - Tasks, Planning')).toBe(true);
			expect(compiled.regex.test('0 - Tasks, Planning/Annual Planning')).toBe(true);
		});
	});

	describe('Tier B — inline regex slot constraints {name:regex}', () => {
		describe('parsing + capture', () => {
			test('{num:\\d+} captures only digits', () => {
				const compiled = compileTemplate('{num:\\d+}');
				expect(compiled.slots[0].inlineRegex).toBe('\\d+');
				expect(extractSlots(compiled, '42')).toEqual({ num: '42' });
				expect(extractSlots(compiled, 'abc')).toBeNull(); // letters fail the regex
			});

			test('{num:\\d{1,2}} captures 1-2 digits exactly', () => {
				const compiled = compileTemplate('{num:\\d{1,2}}');
				expect(extractSlots(compiled, '0')).toEqual({ num: '0' });
				expect(extractSlots(compiled, '99')).toEqual({ num: '99' });
				expect(extractSlots(compiled, '100')).toBeNull(); // 3 digits fails
			});

			test('{name:[A-Z][a-z]+} captures PascalCase words', () => {
				const compiled = compileTemplate('{name:[A-Z][a-z]+}');
				expect(extractSlots(compiled, 'Projects')).toEqual({ name: 'Projects' });
				expect(extractSlots(compiled, 'projects')).toBeNull(); // lowercase first
				expect(extractSlots(compiled, 'PROJECTS')).toBeNull(); // all caps
			});

			test('numbered-area template with regex constraint', () => {
				const compiled = compileTemplate('{num:\\d{1,2}} - {name}/{deeper...}');
				expect(extractSlots(compiled, '0 - Tasks/Annual')).toEqual({
					num: '0',
					name: 'Tasks',
					deeper: 'Annual',
				});
				expect(extractSlots(compiled, '99 - Archive/Old')).toEqual({
					num: '99',
					name: 'Archive',
					deeper: 'Old',
				});
				expect(extractSlots(compiled, 'foo - Tasks/X')).toBeNull(); // 'foo' fails \d{1,2}
			});

			test('inline regex composes with filter pipe', () => {
				const compiled = compileTemplate('{num:\\d+ | keep}');
				expect(compiled.slots[0].inlineRegex).toBe('\\d+');
				expect(compiled.slots[0].filters).toEqual(['keep']);
			});

			test('glob slot with inline regex `{name:[a-z/-]+...}`', () => {
				const compiled = compileTemplate('{tail:[a-z/-]+...}');
				expect(compiled.slots[0].kind).toBe('glob');
				expect(compiled.slots[0].inlineRegex).toBe('[a-z/-]+');
				expect(extractSlots(compiled, 'web/auth/oauth')).toEqual({ tail: 'web/auth/oauth' });
				expect(extractSlots(compiled, 'Web/Auth')).toBeNull(); // uppercase fails
			});
		});

		describe('safety validation — regex must not break path-shape semantics', () => {
			test('rejects segment-slot regex that matches `/`', () => {
				expect(() => compileTemplate('{name:.+}')).toThrow(TemplateParseError);
				expect(() => compileTemplate('{name:.*}')).toThrow(TemplateParseError);
			});

			test('rejects segment-slot regex with explicit `/` in character class', () => {
				expect(() => compileTemplate('{name:[a-z/]+}')).toThrow(TemplateParseError);
			});

			test('rejects segment-slot regex with negated class containing `/`', () => {
				// `[^a-z]` matches `/` (since `/` is not in [a-z])
				expect(() => compileTemplate('{name:[^a-z]+}')).toThrow(TemplateParseError);
			});

			test('error message points at the safe alternative (use glob)', () => {
				try {
					compileTemplate('{name:.+}');
					throw new Error('should have thrown');
				} catch (e) {
					expect(e).toBeInstanceOf(TemplateParseError);
					expect((e as Error).message).toContain('cross path boundaries');
					expect((e as Error).message).toContain('glob slot');
				}
			});

			test('rejects empty regex', () => {
				expect(() => compileTemplate('{name:}')).toThrow(TemplateParseError);
			});

			test('rejects malformed regex', () => {
				expect(() => compileTemplate('{name:[a-}')).toThrow(TemplateParseError);
			});

			test('GLOB slots ALLOW regex that matches `/`', () => {
				// `.+` includes `/` for glob slots — that's the whole point.
				const compiled = compileTemplate('{tail:.+...}');
				expect(extractSlots(compiled, 'a/b/c')).toEqual({ tail: 'a/b/c' });
			});

			test('common safe regexes pass validation', () => {
				expect(() => compileTemplate('{num:\\d+}')).not.toThrow();
				expect(() => compileTemplate('{name:[A-Za-z]+}')).not.toThrow();
				expect(() => compileTemplate('{slug:[a-z][a-z0-9-]*}')).not.toThrow();
				expect(() => compileTemplate('{date:\\d{4}-\\d{2}-\\d{2}}')).not.toThrow();
				expect(() => compileTemplate('{code:[A-Z]{2,3}}')).not.toThrow();
				expect(() => compileTemplate('{ver:v\\d+(?:\\.\\d+)*}')).not.toThrow();
			});
		});

		describe('round-trip + bijectivity with inline regex', () => {
			test('numbered-area template round-trips for matching paths', () => {
				const compiled = compileTemplate('{num:\\d{1,2}} - {name}/{deeper...}');
				const slots = extractSlots(compiled, '5 - Projects/Web');
				expect(slots).toEqual({ num: '5', name: 'Projects', deeper: 'Web' });
				const reconstructed = instantiateTemplate(compiled, slots!);
				expect(reconstructed).toBe('5 - Projects/Web');
			});

			test('bijectivity verdict computes for inline-regex templates', () => {
				const verdict = computeBijectivity(
					'{num:\\d{1,2}} - {name}/{deeper...}',
					'#{num}-{name | kebab-case}/{deeper...}',
				);
				// Layer 1: same slots (num, name, deeper) on both sides → pass
				expect(verdict.layer1Pass).toBe(true);
				// Layer 2: kebab-case on `name` is conditional → overall conditional
				expect(verdict.status).toBe('conditional');
			});
		});
	});
});
