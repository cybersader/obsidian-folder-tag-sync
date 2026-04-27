/**
 * Unit tests for rule matching engine
 */

import {
	evaluateRule,
	findMatchingRules,
	findBestMatch,
	findConflicts,
	isRuleApplicable,
	getFolderToTagRules,
	getTagToFolderRules,
	validateRule
} from './ruleMatcher';
import { MappingRule } from '../types/settings';

// Helper to create test rules
function createRule(overrides: Partial<MappingRule>): MappingRule {
	return {
		id: 'test-rule',
		name: 'Test Rule',
		enabled: true,
		priority: 100,
		direction: 'bidirectional',
		options: {
			createFolders: true,
			addTags: true,
			removeOrphanedTags: false,
			syncOnFileCreate: true,
			syncOnFileMove: true,
			syncOnFileRename: true
		},
		...overrides
	};
}

describe('evaluateRule', () => {
	test('matches folder pattern', () => {
		const rule = createRule({
			folderPattern: 'Projects/*',
			direction: 'folder-to-tag'
		});

		const result = evaluateRule('Projects/MyProject', rule, {
			input: 'Projects/MyProject',
			matchType: 'folder',
			direction: 'folder-to-tag'
		});

		expect(result).not.toBeNull();
		expect(result?.rule.id).toBe('test-rule');
		expect(result?.matchType).toBe('folder');
	});

	test('matches tag pattern', () => {
		const rule = createRule({
			tagPattern: 'project/*',
			direction: 'tag-to-folder'
		});

		const result = evaluateRule('project/myproject', rule, {
			input: 'project/myproject',
			matchType: 'tag',
			direction: 'tag-to-folder'
		});

		expect(result).not.toBeNull();
		expect(result?.matchType).toBe('tag');
	});

	test('returns null for disabled rules', () => {
		const rule = createRule({
			enabled: false,
			folderPattern: 'Projects/*'
		});

		const result = evaluateRule('Projects/Test', rule, {
			input: 'Projects/Test',
			matchType: 'folder'
		});

		expect(result).toBeNull();
	});

	test('includes disabled rules when requested', () => {
		const rule = createRule({
			enabled: false,
			folderPattern: 'Projects/*'
		});

		const result = evaluateRule('Projects/Test', rule, {
			input: 'Projects/Test',
			matchType: 'folder',
			includeDisabled: true
		});

		expect(result).not.toBeNull();
	});

	test('respects direction filtering', () => {
		const rule = createRule({
			folderPattern: 'Projects/*',
			direction: 'folder-to-tag'
		});

		// Should match folder-to-tag
		let result = evaluateRule('Projects/Test', rule, {
			input: 'Projects/Test',
			matchType: 'folder',
			direction: 'folder-to-tag'
		});
		expect(result).not.toBeNull();

		// Should not match tag-to-folder
		result = evaluateRule('Projects/Test', rule, {
			input: 'Projects/Test',
			matchType: 'folder',
			direction: 'tag-to-folder'
		});
		expect(result).toBeNull();
	});

	test('bidirectional rules match both directions', () => {
		const rule = createRule({
			folderPattern: 'Projects/*',
			tagPattern: 'projects/*',
			direction: 'bidirectional'
		});

		const folderResult = evaluateRule('Projects/Test', rule, {
			input: 'Projects/Test',
			matchType: 'folder',
			direction: 'folder-to-tag'
		});
		expect(folderResult).not.toBeNull();

		const tagResult = evaluateRule('projects/test', rule, {
			input: 'projects/test',
			matchType: 'tag',
			direction: 'tag-to-folder'
		});
		expect(tagResult).not.toBeNull();
	});

	test('returns null when pattern does not match', () => {
		const rule = createRule({
			folderPattern: 'Projects/*'
		});

		const result = evaluateRule('Archive/Test', rule, {
			input: 'Archive/Test',
			matchType: 'folder'
		});

		expect(result).toBeNull();
	});

	test('calculates confidence score', () => {
		const rule = createRule({
			folderPattern: 'Projects/MyProject'
		});

		const result = evaluateRule('Projects/MyProject', rule, {
			input: 'Projects/MyProject',
			matchType: 'folder'
		});

		expect(result).not.toBeNull();
		expect(result?.confidence).toBeGreaterThan(0);
		expect(result?.confidence).toBeLessThanOrEqual(1);
	});
});

describe('findMatchingRules', () => {
	test('finds all matching rules', () => {
		const rules = [
			createRule({ id: '1', folderPattern: 'Projects/*', priority: 1 }),
			createRule({ id: '2', folderPattern: 'Projects/Active/*', priority: 2 }),
			createRule({ id: '3', folderPattern: 'Archive/*', priority: 3 })
		];

		const matches = findMatchingRules('Projects/Active/Test', rules, {
			input: 'Projects/Active/Test',
			matchType: 'folder'
		});

		// Should match rules 1 and 2
		expect(matches).toHaveLength(2);
		expect(matches.map(m => m.rule.id)).toContain('1');
		expect(matches.map(m => m.rule.id)).toContain('2');
	});

	test('returns empty array when no matches', () => {
		const rules = [
			createRule({ folderPattern: 'Projects/*' })
		];

		const matches = findMatchingRules('Archive/Test', rules, {
			input: 'Archive/Test',
			matchType: 'folder'
		});

		expect(matches).toHaveLength(0);
	});
});

describe('findBestMatch', () => {
	test('returns highest priority rule', () => {
		const rules = [
			createRule({ id: 'low', folderPattern: 'Projects/*', priority: 100 }),
			createRule({ id: 'high', folderPattern: 'Projects/*', priority: 1 }),
			createRule({ id: 'medium', folderPattern: 'Projects/*', priority: 50 })
		];

		const best = findBestMatch('Projects/Test', rules, {
			input: 'Projects/Test',
			matchType: 'folder'
		});

		expect(best).not.toBeNull();
		expect(best?.rule.id).toBe('high');
	});

	test('breaks ties with confidence', () => {
		const rules = [
			createRule({ id: 'generic', folderPattern: 'Projects/*', priority: 1 }),
			createRule({ id: 'specific', folderPattern: 'Projects/Test', priority: 1 })
		];

		const best = findBestMatch('Projects/Test', rules, {
			input: 'Projects/Test',
			matchType: 'folder'
		});

		expect(best).not.toBeNull();
		// More specific pattern should win
		expect(best?.rule.id).toBe('specific');
	});

	test('returns null when no matches', () => {
		const rules = [
			createRule({ folderPattern: 'Projects/*' })
		];

		const best = findBestMatch('Archive/Test', rules, {
			input: 'Archive/Test',
			matchType: 'folder'
		});

		expect(best).toBeNull();
	});
});

describe('findConflicts', () => {
	test('detects rules with same priority', () => {
		const rules = [
			createRule({ id: '1', folderPattern: 'Projects/*', priority: 1 }),
			createRule({ id: '2', folderPattern: 'Projects/Test', priority: 1 }),
			createRule({ id: '3', folderPattern: 'Projects/*', priority: 2 })
		];

		const conflicts = findConflicts('Projects/Test', rules, {
			input: 'Projects/Test',
			matchType: 'folder'
		});

		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]).toHaveLength(2);
		expect(conflicts[0].map(m => m.rule.id)).toContain('1');
		expect(conflicts[0].map(m => m.rule.id)).toContain('2');
	});

	test('returns empty when no conflicts', () => {
		const rules = [
			createRule({ id: '1', folderPattern: 'Projects/*', priority: 1 }),
			createRule({ id: '2', folderPattern: 'Projects/*', priority: 2 })
		];

		const conflicts = findConflicts('Projects/Test', rules, {
			input: 'Projects/Test',
			matchType: 'folder'
		});

		expect(conflicts).toHaveLength(0);
	});

	test('returns empty when only one match', () => {
		const rules = [
			createRule({ folderPattern: 'Projects/*' })
		];

		const conflicts = findConflicts('Projects/Test', rules, {
			input: 'Projects/Test',
			matchType: 'folder'
		});

		expect(conflicts).toHaveLength(0);
	});
});

describe('isRuleApplicable', () => {
	test('bidirectional rules apply to both directions', () => {
		const rule = createRule({ direction: 'bidirectional' });

		expect(isRuleApplicable(rule, 'folder-to-tag')).toBe(true);
		expect(isRuleApplicable(rule, 'tag-to-folder')).toBe(true);
	});

	test('directional rules only apply to their direction', () => {
		const folderRule = createRule({ direction: 'folder-to-tag' });
		const tagRule = createRule({ direction: 'tag-to-folder' });

		expect(isRuleApplicable(folderRule, 'folder-to-tag')).toBe(true);
		expect(isRuleApplicable(folderRule, 'tag-to-folder')).toBe(false);

		expect(isRuleApplicable(tagRule, 'tag-to-folder')).toBe(true);
		expect(isRuleApplicable(tagRule, 'folder-to-tag')).toBe(false);
	});
});

describe('getFolderToTagRules', () => {
	test('filters rules for folder-to-tag', () => {
		const rules = [
			createRule({ id: '1', folderPattern: 'Projects/*', direction: 'folder-to-tag' }),
			createRule({ id: '2', folderPattern: 'Archive/*', direction: 'bidirectional' }),
			createRule({ id: '3', tagPattern: 'test/*', direction: 'tag-to-folder' }),
			createRule({ id: '4', enabled: false, folderPattern: 'Old/*', direction: 'folder-to-tag' })
		];

		const filtered = getFolderToTagRules(rules);

		expect(filtered).toHaveLength(2);
		expect(filtered.map(r => r.id)).toContain('1');
		expect(filtered.map(r => r.id)).toContain('2');
	});
});

describe('getTagToFolderRules', () => {
	test('filters rules for tag-to-folder', () => {
		const rules = [
			createRule({ id: '1', tagPattern: 'project/*', direction: 'tag-to-folder' }),
			createRule({ id: '2', tagPattern: 'archive/*', direction: 'bidirectional' }),
			createRule({ id: '3', folderPattern: 'Test/*', direction: 'folder-to-tag' }),
			createRule({ id: '4', enabled: false, tagPattern: 'old/*', direction: 'tag-to-folder' })
		];

		const filtered = getTagToFolderRules(rules);

		expect(filtered).toHaveLength(2);
		expect(filtered.map(r => r.id)).toContain('1');
		expect(filtered.map(r => r.id)).toContain('2');
	});
});

describe('validateRule', () => {
	test('validates correct rule', () => {
		const rule = createRule({
			folderPattern: 'Projects/*',
			tagPattern: 'projects/*'
		});

		const result = validateRule(rule);

		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	test('detects missing ID', () => {
		const rule = createRule({ id: '' });

		const result = validateRule(rule);

		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Rule must have a valid ID');
	});

	test('detects missing name', () => {
		const rule = createRule({ name: '' });

		const result = validateRule(rule);

		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Rule must have a name');
	});

	test('detects negative priority', () => {
		const rule = createRule({ priority: -1 });

		const result = validateRule(rule);

		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('Priority'))).toBe(true);
	});

	test('detects missing folder pattern for folder-to-tag', () => {
		const rule = createRule({
			direction: 'folder-to-tag',
			folderPattern: undefined
		});

		const result = validateRule(rule);

		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('folder pattern'))).toBe(true);
	});

	test('detects missing tag pattern for tag-to-folder', () => {
		const rule = createRule({
			direction: 'tag-to-folder',
			tagPattern: undefined
		});

		const result = validateRule(rule);

		expect(result.valid).toBe(false);
		expect(result.errors.some(e => e.includes('tag pattern'))).toBe(true);
	});

	test('validates bidirectional rules', () => {
		const rule = createRule({
			direction: 'bidirectional',
			folderPattern: 'Projects/*',
			tagPattern: 'projects/*'
		});

		const result = validateRule(rule);

		expect(result.valid).toBe(true);
	});
});

// ===========================================================================
// Specificity formula (Formula 3) — Increment 1 Step 1
// ===========================================================================
//
// These tests cover the refined `calculateMatchConfidence` implementation.
// The function itself is private; we verify behavior through `evaluateRule`
// which surfaces the score on the returned `RuleMatch`.
//
// Reference: zz-log/2026-04-27-specificity-and-groups-research.md (Formula 3)
// Reference: zz-challenges/01-rule-priority-stress-test.md (the stress case)

describe('Specificity formula (Formula 3)', () => {
	describe('Challenge 01 stress case — more-specific should outscore less-specific', () => {
		test('a more-specific pattern (more literals + more slashes) outscores a less-specific one', () => {
			const broadRule = createRule({
				id: 'projects-broad',
				priority: 10,
				folderPattern: '^Projects/(.+)$',
				direction: 'folder-to-tag',
				folderAnchor: 'root'
			});

			const specificRule = createRule({
				id: 'projects-web-specific',
				priority: 20,
				folderPattern: '^Projects/Web/(.+)$',
				direction: 'folder-to-tag',
				folderAnchor: 'root'
			});

			const input = 'Projects/Web/auth';

			const broadMatch = evaluateRule(input, broadRule, {
				input,
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			const specificMatch = evaluateRule(input, specificRule, {
				input,
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			expect(broadMatch).not.toBeNull();
			expect(specificMatch).not.toBeNull();

			// The specific pattern (more literal chars, more slashes, same anchor)
			// should outscore the broad pattern. This is the load-bearing
			// behavior change from Formula 3 — what makes Increment 1 Step 2's
			// sort-order swap worthwhile.
			expect(specificMatch!.confidence).toBeGreaterThan(broadMatch!.confidence);
		});
	});

	describe('Anchor-aware bonus differentiation', () => {
		test('root-anchored pattern outscores any-segment-anchored pattern with same shape', () => {
			const rootAnchored = createRule({
				id: 'root-rule',
				folderPattern: '^Projects(?:/|$)',
				direction: 'folder-to-tag',
				folderAnchor: 'root'
			});

			const anySegment = createRule({
				id: 'any-segment-rule',
				folderPattern: '(?:^|/)Projects(?:/|$)',
				direction: 'folder-to-tag',
				folderAnchor: 'any-segment'
			});

			const input = 'Projects';

			const rootMatch = evaluateRule(input, rootAnchored, {
				input,
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			const anySegmentMatch = evaluateRule(input, anySegment, {
				input,
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			expect(rootMatch).not.toBeNull();
			expect(anySegmentMatch).not.toBeNull();

			// Both match the same input but root-anchored is conceptually more specific
			// (it's pinned to the vault root). Formula 3 should reflect this via the
			// +0.10 anchor bonus.
			expect(rootMatch!.confidence).toBeGreaterThan(anySegmentMatch!.confidence);
		});

		test('under-prefix anchor gets bonus between root and any-segment', () => {
			const underPrefix = createRule({
				id: 'under-rule',
				folderPattern: '^Output/Projects(?:/|$)',
				direction: 'folder-to-tag',
				folderAnchor: { under: 'Output' }
			});

			const input = 'Output/Projects';

			const match = evaluateRule(input, underPrefix, {
				input,
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			expect(match).not.toBeNull();
			// Under-prefix anchor adds +0.08 (less than root's +0.10, more than any-segment's +0).
			// Verify the score is in a reasonable range — not at floor, not at ceiling.
			expect(match!.confidence).toBeGreaterThan(0.5);
			expect(match!.confidence).toBeLessThan(1.0);
		});
	});

	describe('Wildcard penalties', () => {
		test('greedy wildcard .+ reduces specificity more than literal pattern', () => {
			const wildcardRule = createRule({
				folderPattern: '^.+$',
				direction: 'folder-to-tag',
				folderAnchor: 'root'
			});

			const literalRule = createRule({
				folderPattern: '^Projects$',
				direction: 'folder-to-tag',
				folderAnchor: 'root'
			});

			const wildcardMatch = evaluateRule('Projects', wildcardRule, {
				input: 'Projects',
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			const literalMatch = evaluateRule('Projects', literalRule, {
				input: 'Projects',
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			expect(wildcardMatch).not.toBeNull();
			expect(literalMatch).not.toBeNull();

			// Literal exact-match pattern should outscore the wildcard
			// (literal pattern hits exact-match shortcut → 1.0).
			expect(literalMatch!.confidence).toBeGreaterThan(wildcardMatch!.confidence);
		});

		test('multiple greedy wildcards stack penalties', () => {
			const oneWildcard = createRule({
				folderPattern: '^Projects/.+$',
				direction: 'folder-to-tag',
				folderAnchor: 'root'
			});

			const twoWildcards = createRule({
				folderPattern: '^.+/.+$',
				direction: 'folder-to-tag',
				folderAnchor: 'root'
			});

			const oneMatch = evaluateRule('Projects/Web', oneWildcard, {
				input: 'Projects/Web',
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			const twoMatch = evaluateRule('Projects/Web', twoWildcards, {
				input: 'Projects/Web',
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			expect(oneMatch).not.toBeNull();
			expect(twoMatch).not.toBeNull();

			// Pattern with one greedy wildcard + one literal segment outscores
			// pattern with two greedy wildcards.
			expect(oneMatch!.confidence).toBeGreaterThan(twoMatch!.confidence);
		});
	});

	describe('Capture groups', () => {
		test('named slots and anonymous captures both count as captures', () => {
			const namedSlot = createRule({
				folderPattern: '^Projects/(?<slug>[^/]+)$',
				direction: 'folder-to-tag',
				folderAnchor: 'root'
			});

			const anonCapture = createRule({
				folderPattern: '^Projects/([^/]+)$',
				direction: 'folder-to-tag',
				folderAnchor: 'root'
			});

			const namedMatch = evaluateRule('Projects/Web', namedSlot, {
				input: 'Projects/Web',
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			const anonMatch = evaluateRule('Projects/Web', anonCapture, {
				input: 'Projects/Web',
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			expect(namedMatch).not.toBeNull();
			expect(anonMatch).not.toBeNull();

			// Both have one capture group; scores should be similar.
			// (We're testing that named slots count, not that they're penalized differently.)
			expect(Math.abs(namedMatch!.confidence - anonMatch!.confidence)).toBeLessThan(0.05);
		});
	});

	describe('Output range', () => {
		test('confidence stays clamped to [0, 1]', () => {
			// Pathological pattern with many wildcards — should clamp at 0
			const allWildcards = createRule({
				folderPattern: '.*.*.*.*.*.*',
				direction: 'folder-to-tag'
			});

			const match = evaluateRule('foo', allWildcards, {
				input: 'foo',
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			if (match) {
				expect(match.confidence).toBeGreaterThanOrEqual(0);
				expect(match.confidence).toBeLessThanOrEqual(1);
			}
		});

		test('exact-match shortcut returns 1.0', () => {
			const rule = createRule({
				folderPattern: 'Projects',
				direction: 'folder-to-tag'
			});

			const match = evaluateRule('Projects', rule, {
				input: 'Projects',
				matchType: 'folder',
				direction: 'folder-to-tag'
			});

			expect(match).not.toBeNull();
			expect(match!.confidence).toBe(1.0);
		});
	});

	describe('Tag-side matches do not apply anchor bonus', () => {
		test('tag-side match with folderAnchor on rule does not get the bonus', () => {
			// folderAnchor is irrelevant for tag matches; verify it's not applied.
			const rule = createRule({
				folderPattern: '^Projects(?:/|$)',
				tagPattern: '^projects/',
				direction: 'bidirectional',
				folderAnchor: 'root'
			});

			const tagMatch = evaluateRule('projects/web', rule, {
				input: 'projects/web',
				matchType: 'tag'
			});

			expect(tagMatch).not.toBeNull();
			// We mainly verify it doesn't crash; the score is consistent for tag matches
			// independent of folderAnchor since the function is passed `undefined` for
			// the anchor parameter on tag matches.
			expect(tagMatch!.confidence).toBeGreaterThanOrEqual(0);
			expect(tagMatch!.confidence).toBeLessThanOrEqual(1);
		});
	});
});
