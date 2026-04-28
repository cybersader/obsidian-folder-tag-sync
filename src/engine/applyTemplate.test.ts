/**
 * Tests for the Path Lens template runtime.
 *
 * Covers forward (folder → tag), inverse (tag → folder), `isTemplateRule`
 * predicate, lossy-flag propagation from `computeBijectivity`, and dispatch
 * integration with `applyRuleForward` / `applyRuleInverse`.
 */

import { describe, expect, test } from 'bun:test';
import {
	applyTemplateRuleForward,
	applyTemplateRuleInverse,
	isTemplateRule,
} from './applyTemplate';
import { applyRuleForward, applyRuleInverse } from './applyTransfer';
import type { MappingRule } from '../types/settings';

function ruleWithTemplates(folderTemplate: string, tagTemplate: string): MappingRule {
	return {
		id: 't',
		name: 'test',
		enabled: true,
		priority: 0,
		direction: 'bidirectional',
		folderTemplate,
		tagTemplate,
		options: {
			createFolders: false,
			addTags: true,
			removeOrphanedTags: false,
			syncOnFileCreate: true,
			syncOnFileMove: true,
			syncOnFileRename: true,
		},
	};
}

describe('isTemplateRule', () => {
	test('true when both templates set', () => {
		expect(isTemplateRule(ruleWithTemplates('Projects/{topic}', '#projects/{topic}'))).toBe(true);
	});

	test('false when only one set', () => {
		const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
		delete rule.tagTemplate;
		expect(isTemplateRule(rule)).toBe(false);
	});

	test('false when neither set', () => {
		const rule: MappingRule = {
			id: 't',
			name: 't',
			enabled: true,
			priority: 0,
			direction: 'folder-to-tag',
			options: {} as MappingRule['options'],
		};
		expect(isTemplateRule(rule)).toBe(false);
	});
});

describe('applyTemplateRuleForward', () => {
	describe('canonical scenarios', () => {
		test('PARA identity: Projects/Web → #projects/Web', () => {
			const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
			const result = applyTemplateRuleForward('Projects/Web', rule);
			expect(result.tags).toEqual(['#projects/Web']);
			expect(result.lossy).toBe(false);
		});

		test('JD with kebab-case on tag: 20-29 Health/exercise → #20-29-health/exercise', () => {
			const rule = ruleWithTemplates(
				'{jd-area}/{topic}',
				'#{jd-area | kebab-case}/{topic | kebab-case}',
			);
			const result = applyTemplateRuleForward('20-29 Health/Exercise', rule);
			expect(result.tags).toEqual(['#20-29-health/exercise']);
			expect(result.lossy).toBe(true); // conditional → lossy flag set
		});

		test('SEACOW per-entity: Entity/Cybersader/Projects/auth → #--cybersader/projects/auth', () => {
			const rule = ruleWithTemplates(
				'Entity/{owner}/Projects/{project}',
				'#--{owner | kebab-case}/projects/{project | kebab-case}',
			);
			const result = applyTemplateRuleForward('Entity/Cybersader/Projects/auth', rule);
			expect(result.tags).toEqual(['#--cybersader/projects/auth']);
		});

		test('glob slot preserves nested structure', () => {
			const rule = ruleWithTemplates(
				'Projects/{topic}/{deeper...}',
				'#projects/{topic}/{deeper}',
			);
			const result = applyTemplateRuleForward('Projects/Web/Auth/oauth.md', rule);
			expect(result.tags).toEqual(['#projects/Web/Auth/oauth.md']);
		});
	});

	describe('non-matching paths', () => {
		test('returns empty when folder template does not match', () => {
			const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
			const result = applyTemplateRuleForward('Areas/Health', rule);
			expect(result.tags).toEqual([]);
		});

		test('returns empty when rule is not template-shaped', () => {
			const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
			delete rule.tagTemplate;
			const result = applyTemplateRuleForward('Projects/Web', rule);
			expect(result.tags).toEqual([]);
		});
	});

	describe('lossy-flag propagation', () => {
		test('total bijection → lossy:false', () => {
			const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
			const result = applyTemplateRuleForward('Projects/Web', rule);
			expect(result.lossy).toBe(false);
		});

		test('conditional (kebab-case) → lossy:true', () => {
			const rule = ruleWithTemplates(
				'Projects/{topic}',
				'#projects/{topic | kebab-case}',
			);
			const result = applyTemplateRuleForward('Projects/Web Auth', rule);
			expect(result.lossy).toBe(true);
			expect(result.tags).toEqual(['#projects/web-auth']);
		});

		test('lossy filter (strip-emoji) → lossy:true and emission still happens', () => {
			const rule = ruleWithTemplates(
				'Projects/{topic}',
				'#projects/{topic | strip-emoji}',
			);
			const result = applyTemplateRuleForward('Projects/📁 Web', rule);
			expect(result.lossy).toBe(true);
			expect(result.tags).toEqual(['#projects/Web']);
		});
	});

	describe('config errors', () => {
		test('tag-only slot (unsourced) → empty emission with lossy flag', () => {
			const rule = ruleWithTemplates('Projects/{topic}', '#{owner}/projects/{topic}');
			const result = applyTemplateRuleForward('Projects/Web', rule);
			expect(result.tags).toEqual([]);
			expect(result.lossy).toBe(true);
		});

		test('parse-error in template → empty', () => {
			const rule = ruleWithTemplates('Projects/{topic', '#projects/{topic}');
			const result = applyTemplateRuleForward('Projects/Web', rule);
			expect(result.tags).toEqual([]);
		});
	});
});

describe('applyTemplateRuleInverse — F3 commit 2 witness-driven recovery', () => {
	test('witness with matching ruleId returns origin path directly (lossless)', () => {
		// Catch-all rule with lossy filter (strip-invalid-tag-chars). Forward
		// loses comma, but witness recovers it for the original file.
		const rule = ruleWithTemplates(
			'{num} - {name}/{deeper...}',
			'#{num}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		);
		rule.id = 'test-rule-id';
		const result = applyTemplateRuleInverse('#0-tasks-planning/Q1', rule, {
			witness: {
				origin: '0 - Tasks, Planning/Q1', // ← original folder with comma intact
				ruleId: 'test-rule-id',
				tags: ['0-tasks-planning/Q1'],
			},
		});
		// Witness origin returned directly — comma preserved
		expect(result.folder).toBe('0 - Tasks, Planning/Q1');
		expect(result.lossy).toBe(false); // witness makes it bijective
	});

	test('witness from DIFFERENT rule is ignored — falls back to filter inverse', () => {
		const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
		rule.id = 'rule-A';
		const result = applyTemplateRuleInverse('#projects/Web', rule, {
			witness: {
				origin: 'SomeOtherFolder',
				ruleId: 'rule-B', // ← different rule!
				tags: [],
			},
		});
		// Falls through to standard inverse (witness ignored)
		expect(result.folder).toBe('Projects/Web');
	});

	test('no witness → standard filter inverse', () => {
		const rule = ruleWithTemplates(
			'{num} - {name}/{deeper...}',
			'#{num}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		);
		const result = applyTemplateRuleInverse('#0-tasks-planning/Q1', rule);
		// Without witness: filter inverse runs, comma lost
		// (Note: catch-all greedy-match also kicks in here — documented elsewhere)
		expect(result.lossy).toBe(true);
	});

	test('empty witness origin falls through to filter inverse', () => {
		const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
		const result = applyTemplateRuleInverse('#projects/Web', rule, {
			witness: { origin: '', ruleId: rule.id, tags: [] },
		});
		// Empty origin treated as "no witness data" — filter inverse runs
		expect(result.folder).toBe('Projects/Web');
	});
});

describe('applyTemplateRuleInverse', () => {
	describe('canonical round-trips (total bijection)', () => {
		test('PARA identity: #projects/Web → Projects/Web', () => {
			const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
			const result = applyTemplateRuleInverse('#projects/Web', rule);
			expect(result.folder).toBe('Projects/Web');
			expect(result.lossy).toBe(false);
		});

		test('forward then inverse round-trips', () => {
			const rule = ruleWithTemplates(
				'Entity/{owner}/Projects/{project}',
				'#--{owner}/projects/{project}',
			);
			const original = 'Entity/Cybersader/Projects/folder-tag-sync';
			const forward = applyTemplateRuleForward(original, rule);
			expect(forward.tags).toEqual(['#--Cybersader/projects/folder-tag-sync']);
			const inverse = applyTemplateRuleInverse(forward.tags[0], rule);
			expect(inverse.folder).toBe(original);
		});

		test('glob slot inverse preserves structure (matching glob kinds both sides)', () => {
			const rule = ruleWithTemplates(
				'Projects/{topic}/{deeper...}',
				'#projects/{topic}/{deeper...}',
			);
			const result = applyTemplateRuleInverse('#projects/Web/Auth/oauth.md', rule);
			expect(result.folder).toBe('Projects/Web/Auth/oauth.md');
		});

		test('kind mismatch (glob folder side, segment tag side) → forward works but inverse fails on multi-segment', () => {
			// Documents the kind-mismatch behavior: forward emits a tag with `/`
			// in the slot value, but inverse can't extract because the tag-side
			// {deeper} is segment-kind. The bijectivity verdict won't catch
			// this in Layer 1 (slot names match), only at runtime. Future Layer-3
			// validation should reject kind mismatches at rule-save time.
			const rule = ruleWithTemplates(
				'Projects/{topic}/{deeper...}',
				'#projects/{topic}/{deeper}',
			);
			// Single-segment input: forward + inverse both work
			expect(applyTemplateRuleForward('Projects/Web/oauth.md', rule).tags)
				.toEqual(['#projects/Web/oauth.md']);
			expect(applyTemplateRuleInverse('#projects/Web/oauth.md', rule).folder)
				.toBe('Projects/Web/oauth.md');
			// Multi-segment input: forward emits, inverse fails
			expect(applyTemplateRuleForward('Projects/Web/Auth/oauth.md', rule).tags)
				.toEqual(['#projects/Web/Auth/oauth.md']);
			expect(applyTemplateRuleInverse('#projects/Web/Auth/oauth.md', rule).folder)
				.toBeNull();
		});
	});

	describe('inverse with conditional filters', () => {
		test('kebab-case inverse goes through metadata.inverse → Title Case approximation', () => {
			const rule = ruleWithTemplates(
				'Projects/{topic}',
				'#projects/{topic | kebab-case}',
			);
			const result = applyTemplateRuleInverse('#projects/web-auth', rule);
			// Metadata's inverse for kebab-case → Title Case
			expect(result.folder).toBe('Projects/Web Auth');
			expect(result.lossy).toBe(true); // conditional → flagged
		});

		test('lossy filter (strip-emoji) inverse is identity → cannot recover original', () => {
			const rule = ruleWithTemplates(
				'Projects/{topic}',
				'#projects/{topic | strip-emoji}',
			);
			// Forward: "📁 Web" → strip-emoji → "Web"
			// Inverse: "Web" stays "Web" (no inverse for strip-emoji)
			const result = applyTemplateRuleInverse('#projects/Web', rule);
			expect(result.folder).toBe('Projects/Web');
			expect(result.lossy).toBe(true);
		});
	});

	describe('non-matching tags', () => {
		test('returns null when tag does not match template', () => {
			const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
			const result = applyTemplateRuleInverse('#areas/health', rule);
			expect(result.folder).toBeNull();
		});

		test('tolerant of missing # prefix', () => {
			const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
			const result = applyTemplateRuleInverse('projects/Web', rule);
			expect(result.folder).toBe('Projects/Web');
		});
	});

	describe('config errors', () => {
		test('folder-only trailing-glob slot → partial recovery with lossy flag', () => {
			// Post trailing-optional-glob relaxation: when the folder-only slot
			// is a trailing glob, the inverse partially recovers — produces the
			// bare prefix without the discarded segments. Lossy flag stays true
			// because the original deeper path is unrecoverable.
			const rule = ruleWithTemplates('Projects/{topic}/{discarded...}', '#projects/{topic}');
			const result = applyTemplateRuleInverse('#projects/Web', rule);
			expect(result.folder).toBe('Projects/Web');
			expect(result.lossy).toBe(true);
		});
	});
});

describe('end-to-end realistic scenarios', () => {
	describe('Gap 1 — multi-filter chains forward + inverse', () => {
		test('chain on tag side only: kebab-case round-trips for in-domain inputs', () => {
			const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic | kebab-case}');
			const forward = applyTemplateRuleForward('Projects/Web Auth', rule);
			expect(forward.tags).toEqual(['#projects/web-auth']);
			const inverse = applyTemplateRuleInverse(forward.tags[0], rule);
			// Conditional inverse: kebab-case → Title Case approximation. For the
			// well-behaved input "Web Auth", the inverse recovers it exactly.
			expect(inverse.folder).toBe('Projects/Web Auth');
			expect(forward.lossy).toBe(true); // conditional flag (Layer 2 verdict)
			expect(inverse.lossy).toBe(true);
		});

		test('chain with lossy filter: forward produces tag, inverse cannot recover', () => {
			// `strip-emoji` is lossy → no inverse exists. The full chain
			// `strip-emoji | kebab-case` cannot round-trip.
			const rule = ruleWithTemplates(
				'Projects/{topic}',
				'#projects/{topic | strip-emoji | kebab-case}',
			);
			const forward = applyTemplateRuleForward('Projects/📁 Web Auth', rule);
			expect(forward.tags).toEqual(['#projects/web-auth']);
			expect(forward.lossy).toBe(true);
			const inverse = applyTemplateRuleInverse(forward.tags[0], rule);
			// Inverse walks chain in reverse: kebab-case^-1 ("Web Auth") then
			// strip-emoji^-1 (identity — no inverse). Result: "Web Auth", emoji
			// permanently lost.
			expect(inverse.folder).toBe('Projects/Web Auth');
			expect(inverse.lossy).toBe(true);
		});

		test('chain on both sides combines into a 4-step pipeline', () => {
			// Folder side: kebab-case (writes lowercase folder names)
			// Tag side: strip-num-prefix
			// Forward: "01-projects" → kebab-case (idempotent: stays "01-projects")
			//          → strip-num-prefix → "projects"
			// Each filter contributes to the chain; lossy filter on tag side
			// dominates the verdict.
			const rule = ruleWithTemplates(
				'{area | kebab-case}/{topic}',
				'#{area | strip-num-prefix}/{topic}',
			);
			const forward = applyTemplateRuleForward('01-projects/Web', rule);
			expect(forward.tags).toEqual(['#projects/Web']);
			expect(forward.lossy).toBe(true); // strip-num-prefix is lossy
		});
	});

	describe('Gap 4 — JD scenario end-to-end', () => {
		test('JD with kebab-case: lossy round-trip through approximation', () => {
			const rule = ruleWithTemplates(
				'{area}/{topic}',
				'#{area | kebab-case}/{topic | kebab-case}',
			);
			// Forward: JD-prefixed area name normalizes through kebab-case
			const forward = applyTemplateRuleForward('01 - Projects/Web Auth', rule);
			expect(forward.tags).toEqual(['#01-projects/web-auth']);
			expect(forward.lossy).toBe(true); // conditional verdict from Layer 2

			// Inverse: kebab-case → Title Case approximation. Loses the original
			// space-dash spacing convention.
			const inverse = applyTemplateRuleInverse(forward.tags[0], rule);
			expect(inverse.folder).toBe('01 Projects/Web Auth');
			// Round-trip is NOT exact — documents the conditional reversibility.
			expect(inverse.folder).not.toBe('01 - Projects/Web Auth');
		});

		test('JD with strip-num-prefix: provably lossy, prefix unrecoverable', () => {
			const rule = ruleWithTemplates(
				'{area}/{topic}',
				'#{area | strip-num-prefix}/{topic}',
			);
			const forward = applyTemplateRuleForward('01 - Projects/Web Auth', rule);
			expect(forward.tags).toEqual(['#Projects/Web Auth']);
			expect(forward.lossy).toBe(true);

			const inverse = applyTemplateRuleInverse(forward.tags[0], rule);
			// Inverse: strip-num-prefix has no inverse → identity → "Projects"
			// (prefix is permanently gone).
			expect(inverse.folder).toBe('Projects/Web Auth');
			expect(inverse.lossy).toBe(true);
		});
	});

	describe('Gap 5 — aggregation via join filter end-to-end', () => {
		test("glob slot + join('-') aggregates path segments into single tag segment", () => {
			const rule = ruleWithTemplates(
				'Capture/Clips/{deeper...}',
				"#-clip/{deeper | join('-')}",
			);
			const forward = applyTemplateRuleForward(
				'Capture/Clips/2026/04/notes.md',
				rule,
			);
			expect(forward.tags).toEqual(['#-clip/2026-04-notes.md']);
			expect(forward.lossy).toBe(true); // join('-') is lossy (separator collision)
		});

		test("aggregation inverse: cannot reconstruct path separators", () => {
			const rule = ruleWithTemplates(
				'Capture/Clips/{deeper...}',
				"#-clip/{deeper | join('-')}",
			);
			const inverse = applyTemplateRuleInverse(
				'#-clip/2026-04-notes.md',
				rule,
			);
			// join('-') has no inverse — value passes through unchanged. The
			// reconstructed folder path now has "-" where "/" should be — visible
			// data corruption that the lossy flag warns about.
			expect(inverse.folder).toBe('Capture/Clips/2026-04-notes.md');
			expect(inverse.lossy).toBe(true);
			// THIS is the point of the lossy flag — engines should refuse to
			// move files based on a lossy-inverse result without user confirmation.
		});

		test("identity glob (no join) preserves separators perfectly", () => {
			// Sanity check: when no join filter is applied, glob round-trips exactly.
			const rule = ruleWithTemplates(
				'Capture/Clips/{deeper...}',
				'#-clip/{deeper...}',
			);
			const original = 'Capture/Clips/2026/04/notes.md';
			const forward = applyTemplateRuleForward(original, rule);
			expect(forward.tags).toEqual(['#-clip/2026/04/notes.md']);
			expect(forward.lossy).toBe(false);
			const inverse = applyTemplateRuleInverse(forward.tags[0], rule);
			expect(inverse.folder).toBe(original);
			expect(inverse.lossy).toBe(false);
		});
	});
});

describe('engine dispatch — applyRuleForward / applyRuleInverse honor template-shape', () => {
	test('template rule routes through template runtime', () => {
		const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
		const result = applyRuleForward('Projects/Web', rule);
		expect(result.tags).toEqual(['#projects/Web']);
	});

	test('template rule inverse routes through template runtime', () => {
		const rule = ruleWithTemplates('Projects/{topic}', '#projects/{topic}');
		const result = applyRuleInverse('#projects/Web', rule);
		expect(result.folder).toBe('Projects/Web');
	});

	test('legacy regex+typed rule still works through typed runtime', () => {
		// No templates → falls through to typed-op path
		const rule: MappingRule = {
			id: 'l',
			name: 'legacy',
			enabled: true,
			priority: 0,
			direction: 'folder-to-tag',
			folderPattern: '^Projects/',
			folderEntryPoint: 'Projects',
			tagEntryPoint: '#projects',
			transfer: { op: 'identity' },
			options: {} as MappingRule['options'],
		};
		const result = applyRuleForward('Projects/Web', rule);
		expect(result.tags.length).toBe(1);
		expect(result.tags[0]).toMatch(/^#projects\//);
	});
});
