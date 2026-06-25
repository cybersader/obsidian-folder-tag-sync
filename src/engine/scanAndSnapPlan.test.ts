/**
 * Tests for the Scan & Snap pure planner (Phase 1a).
 *
 * Fixtures are inlined: a small synthetic vault, hand-built DetectionResults
 * (shaped like detectPacks() output), and minimal pack rule sets (crib'd from
 * rule-packs/para.json + jd.json but trimmed). No file reads — the module is
 * pure and so are its tests.
 */

import { describe, test, expect } from 'bun:test';
import type { MappingRule } from '../types/settings';
import type { DetectionResult } from './detectPacks';
import {
	buildScanAndSnapPlan,
	bijectivityVerdictFor,
	sortCandidatesByNoise,
	sortCandidatesByConflict,
	type CandidateRow,
} from './scanAndSnapPlan';

// ─── Fixture helpers ────────────────────────────────────────────────────────

function ruleOptions(): MappingRule['options'] {
	return {
		createFolders: true,
		addTags: true,
		removeOrphanedTags: false,
		syncOnFileCreate: true,
		syncOnFileMove: true,
		syncOnFileRename: true,
	};
}

/** A minimal PARA-style identity rule for one bucket. */
function paraRule(bucket: string): MappingRule {
	return {
		id: `para-${bucket.toLowerCase()}`,
		name: `PARA: ${bucket}`,
		enabled: true,
		priority: 10,
		direction: 'bidirectional',
		folderPattern: `^${bucket}(?:/|$)`,
		folderEntryPoint: bucket,
		folderTransforms: { caseTransform: 'Title Case' },
		tagPattern: `^${bucket.toLowerCase()}/`,
		tagEntryPoint: bucket.toLowerCase(),
		tagTransforms: { caseTransform: 'kebab-case' },
		options: ruleOptions(),
	};
}

/** JD numbered-area rule (identity → keeps numeric prefix). */
function jdRule(): MappingRule {
	return {
		id: 'jd-numbered-area',
		name: 'JD: any numbered area',
		enabled: true,
		priority: 10,
		direction: 'bidirectional',
		folderPattern: '^\\d{1,2} - [^/]+(?:/|$)',
		folderEntryPoint: '',
		folderTransforms: { caseTransform: 'Title Case', numberPrefixHandling: 'keep' },
		tagPattern: '^\\d{1,2}-[a-z0-9-]+',
		tagEntryPoint: '',
		tagTransforms: { caseTransform: 'kebab-case', numberPrefixHandling: 'keep' },
		options: ruleOptions(),
	};
}

/** A PARA DetectionResult that fired on Projects + Areas at the given depth. */
function paraDetection(opts: {
	suppressed?: boolean;
	exampleProjects: string;
	exampleAreas: string;
}): DetectionResult {
	return {
		packId: 'para',
		score: 2,
		signalsHit: 2,
		minSignals: 2,
		suppressedByMissingParent: opts.suppressed,
		matchedSignals: [
			{ folderRegex: '^Projects$', scope: 'name', label: 'Projects/ root', exampleMatches: [opts.exampleProjects] },
			{ folderRegex: '^Areas$', scope: 'name', label: 'Areas/ root', exampleMatches: [opts.exampleAreas] },
		],
	};
}

function jdDetection(example: string): DetectionResult {
	return {
		packId: 'jd',
		score: 1,
		signalsHit: 1,
		minSignals: 1,
		matchedSignals: [
			{ folderRegex: '^\\d{1,2} - [A-Za-z]', scope: 'name', label: 'Numbered area', exampleMatches: [example] },
		],
	};
}

const PACK_NAMES = new Map([
	['para', 'PARA'],
	['jd', 'Johnny Decimal'],
]);

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('buildScanAndSnapPlan — candidate production + scoping', () => {
	test('one detected pack, one root instance → candidates scoped to root', () => {
		const folders = ['Projects', 'Projects/Web', 'Areas', 'Areas/Health'];
		const plan = buildScanAndSnapPlan({
			folderPaths: folders,
			detectionResults: [paraDetection({ exampleProjects: 'Projects', exampleAreas: 'Areas' })],
			packRulesById: new Map([['para', [paraRule('Projects'), paraRule('Areas')]]]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		});

		// Two pack rules × one instance = two candidates.
		expect(plan.candidates.length).toBe(2);
		const proj = plan.candidates.find((c) => c.id === 'para-projects')!;
		expect(proj).toBeDefined();
		expect(proj.sourcePackId).toBe('para');
		expect(proj.sourcePackName).toBe('PARA');
		// Root anchor ('') is a no-op scope → pattern/entry unchanged.
		expect(proj.anchorPath).toBe('');
		expect(proj.rule.folderPattern).toBe('^Projects(?:/|$)');
		expect(proj.rule.folderEntryPoint).toBe('Projects');
	});

	test('nested instance → folderPattern + folderEntryPoint reflect the anchor', () => {
		// PARA detected under Work/ — anchor should be "Work".
		const folders = ['Work', 'Work/Projects', 'Work/Projects/X', 'Work/Areas', 'Work/Areas/Y'];
		const plan = buildScanAndSnapPlan({
			folderPaths: folders,
			detectionResults: [
				paraDetection({ exampleProjects: 'Work/Projects', exampleAreas: 'Work/Areas' }),
			],
			packRulesById: new Map([['para', [paraRule('Projects'), paraRule('Areas')]]]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		});

		expect(plan.candidates.length).toBe(2);
		const proj = plan.candidates.find((c) => c.id === 'para-projects__work')!;
		expect(proj).toBeDefined();
		expect(proj.anchorPath).toBe('Work');
		// Scoped pattern: scope prepended after `^`.
		expect(proj.rule.folderPattern).toBe('^Work/Projects(?:/|$)');
		expect(proj.rule.folderEntryPoint).toBe('Work');
		// It should actually match the nested folders.
		expect(proj.coverage.matchCount).toBeGreaterThan(0);
	});

	test('suppressed packs produce no candidates', () => {
		const folders = ['Projects', 'Areas'];
		const plan = buildScanAndSnapPlan({
			folderPaths: folders,
			detectionResults: [
				paraDetection({ suppressed: true, exampleProjects: 'Projects', exampleAreas: 'Areas' }),
			],
			packRulesById: new Map([['para', [paraRule('Projects'), paraRule('Areas')]]]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		});
		expect(plan.candidates.length).toBe(0);
		expect(plan.summary.totalCandidates).toBe(0);
	});
});

describe('buildScanAndSnapPlan — coverage', () => {
	test('coverage.matchCount reflects previewRule against the folder list', () => {
		const folders = ['Projects', 'Projects/A', 'Projects/B', 'Unrelated', 'Unrelated/Deep'];
		const plan = buildScanAndSnapPlan({
			folderPaths: folders,
			detectionResults: [paraDetection({ exampleProjects: 'Projects', exampleAreas: 'Projects' })],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		});
		const proj = plan.candidates.find((c) => c.id === 'para-projects')!;
		// Matches Projects, Projects/A, Projects/B = 3. Not Unrelated*.
		expect(proj.coverage.matchCount).toBe(3);
		expect(proj.coverage.sampleEmissions.length).toBeGreaterThan(0);
	});

	test('a non-matching candidate has matchCount 0 (junk row)', () => {
		const folders = ['Areas', 'Areas/X']; // no Projects folder exists
		const plan = buildScanAndSnapPlan({
			folderPaths: folders,
			detectionResults: [paraDetection({ exampleProjects: 'Areas', exampleAreas: 'Areas' })],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		});
		const proj = plan.candidates.find((c) => c.id === 'para-projects')!;
		expect(proj.coverage.matchCount).toBe(0);
	});
});

describe('buildScanAndSnapPlan — conflict over the UNION', () => {
	test('candidate overlapping an EXISTING installed rule → collidesWithExisting + predicted winner', () => {
		const folders = ['Projects', 'Projects/Web'];

		// An already-installed rule that ALSO matches Projects/* — a broad
		// catch-all with low specificity and a worse (higher-number) priority.
		const existingBroad: MappingRule = {
			id: 'existing-catchall',
			name: 'Existing catch-all',
			enabled: true,
			priority: 50,
			direction: 'folder-to-tag',
			folderPattern: '^Projects(?:/.*)?$',
			folderEntryPoint: 'Projects',
			folderTransforms: { caseTransform: 'Title Case' },
			tagEntryPoint: 'misc',
			options: ruleOptions(),
		};

		const plan = buildScanAndSnapPlan({
			folderPaths: folders,
			detectionResults: [paraDetection({ exampleProjects: 'Projects', exampleAreas: 'Projects' })],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [existingBroad],
			packNamesById: PACK_NAMES,
		});

		const proj = plan.candidates.find((c) => c.id === 'para-projects')!;
		expect(proj.conflict.conflicts).toBe(true);
		expect(proj.conflict.collidesWithExisting).toBe(true);
		expect(proj.conflict.overlappingFolderSample.length).toBeGreaterThan(0);
		// The candidate `^Projects(?:/|$)` is more specific than the existing
		// catch-all `^Projects(?:/.*)?$`, so per group→confidence→priority the
		// candidate should be the predicted runtime winner.
		expect(proj.conflict.predictedWinnerId).toBe('para-projects');

		expect(plan.summary.collidingWithExistingCandidates).toBe(1);
	});

	test('two candidates overlapping each other (no existing) → conflicts but not collidesWithExisting', () => {
		// PARA and a second pack that ALSO claims Projects/* — both candidates,
		// neither installed yet.
		const folders = ['Projects', 'Projects/Web'];

		const overlapPackRule: MappingRule = {
			id: 'other-projects',
			name: 'Other: Projects',
			enabled: true,
			priority: 10,
			direction: 'folder-to-tag',
			folderPattern: '^Projects(?:/|$)',
			folderEntryPoint: 'Projects',
			folderTransforms: { caseTransform: 'Title Case' },
			tagEntryPoint: 'other',
			options: ruleOptions(),
		};

		const plan = buildScanAndSnapPlan({
			folderPaths: folders,
			detectionResults: [
				paraDetection({ exampleProjects: 'Projects', exampleAreas: 'Projects' }),
				{
					packId: 'other',
					score: 1,
					signalsHit: 1,
					minSignals: 1,
					matchedSignals: [
						{ folderRegex: '^Projects$', scope: 'name', label: 'Projects', exampleMatches: ['Projects'] },
					],
				},
			],
			packRulesById: new Map([
				['para', [paraRule('Projects')]],
				['other', [overlapPackRule]],
			]),
			existingRules: [],
			packNamesById: new Map([['para', 'PARA'], ['other', 'Other']]),
		});

		const proj = plan.candidates.find((c) => c.id === 'para-projects')!;
		const other = plan.candidates.find((c) => c.id === 'other-projects')!;
		expect(proj.conflict.conflicts).toBe(true);
		expect(other.conflict.conflicts).toBe(true);
		expect(proj.conflict.collidesWithExisting).toBe(false);
		expect(other.conflict.collidesWithExisting).toBe(false);
		// A winner is still named (deterministic resolution among candidates).
		expect(proj.conflict.predictedWinnerId).not.toBeNull();

		expect(plan.summary.conflictingCandidates).toBe(2);
		expect(plan.summary.collidingWithExistingCandidates).toBe(0);
	});

	test('non-overlapping candidate → no conflict, null predicted winner', () => {
		const folders = ['Projects', 'Areas'];
		const plan = buildScanAndSnapPlan({
			folderPaths: folders,
			detectionResults: [paraDetection({ exampleProjects: 'Projects', exampleAreas: 'Areas' })],
			packRulesById: new Map([['para', [paraRule('Projects'), paraRule('Areas')]]]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		});
		for (const c of plan.candidates) {
			expect(c.conflict.conflicts).toBe(false);
			expect(c.conflict.collidesWithExisting).toBe(false);
			expect(c.conflict.predictedWinnerId).toBeNull();
		}
	});
});

describe('bijectivity verdict', () => {
	test('identity transfer pair → total', () => {
		const rule: MappingRule = {
			...paraRule('Projects'),
			transfer: { op: 'identity' },
			inverseTransfer: { op: 'identity' },
		};
		expect(bijectivityVerdictFor(rule)).toBe('total');
	});

	test('lossy transfer (marker-only) → lossy', () => {
		const rule: MappingRule = {
			...paraRule('Projects'),
			transfer: { op: 'marker-only', marker: 'inbox' },
			inverseTransfer: { op: 'identity' },
		};
		expect(bijectivityVerdictFor(rule)).toBe('lossy');
	});

	test('precomputed bijective flag honored', () => {
		const t: MappingRule = { ...paraRule('Projects'), bijective: true };
		const f: MappingRule = { ...paraRule('Areas'), bijective: false };
		expect(bijectivityVerdictFor(t)).toBe('total');
		expect(bijectivityVerdictFor(f)).toBe('lossy');
	});

	test('no bijection info → unknown', () => {
		expect(bijectivityVerdictFor(paraRule('Projects'))).toBe('unknown');
	});

	test('template-shaped rule surfaces a 3-state verdict', () => {
		// Shared single slot, identity filters → total.
		const total: MappingRule = {
			...paraRule('Projects'),
			folderTemplate: 'Projects/{topic}',
			tagTemplate: 'projects/{topic}',
		};
		expect(bijectivityVerdictFor(total)).toBe('total');

		// Folder-only slot (discarded) → lossy.
		const lossy: MappingRule = {
			...paraRule('Projects'),
			folderTemplate: 'Projects/{topic}/{deeper...}',
			tagTemplate: 'projects/{topic}',
		};
		expect(bijectivityVerdictFor(lossy)).toBe('lossy');
	});

	test('verdict surfaces on candidate rows end-to-end', () => {
		const ruleWithTyped: MappingRule = {
			...paraRule('Projects'),
			transfer: { op: 'identity' },
			inverseTransfer: { op: 'identity' },
		};
		const plan = buildScanAndSnapPlan({
			folderPaths: ['Projects', 'Projects/Web'],
			detectionResults: [paraDetection({ exampleProjects: 'Projects', exampleAreas: 'Projects' })],
			packRulesById: new Map([['para', [ruleWithTyped]]]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		});
		expect(plan.candidates[0].bijectivity).toBe('total');
	});
});

describe('summary', () => {
	test('aggregates counts + distinct packs/systems', () => {
		const folders = ['Projects', 'Projects/Web', 'Areas', '10 - Tasks', '10 - Tasks/sub'];
		const plan = buildScanAndSnapPlan({
			folderPaths: folders,
			detectionResults: [
				paraDetection({ exampleProjects: 'Projects', exampleAreas: 'Areas' }),
				jdDetection('10 - Tasks'),
			],
			packRulesById: new Map([
				['para', [paraRule('Projects'), paraRule('Areas')]],
				['jd', [jdRule()]],
			]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		});

		expect(plan.summary.totalCandidates).toBe(3); // 2 PARA + 1 JD
		expect(plan.summary.touchingCandidates).toBeGreaterThan(0);
		expect(plan.summary.distinctSourcePacks.sort()).toEqual(['jd', 'para']);
		expect(plan.summary.distinctSourceSystems.sort()).toEqual(['Johnny Decimal', 'PARA']);
	});

	test('packNamesById missing → falls back to packId', () => {
		const plan = buildScanAndSnapPlan({
			folderPaths: ['Projects'],
			detectionResults: [paraDetection({ exampleProjects: 'Projects', exampleAreas: 'Projects' })],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [],
			// no packNamesById
		});
		expect(plan.candidates[0].sourcePackName).toBe('para');
	});
});

describe('triage sort helpers', () => {
	function row(over: Partial<CandidateRow> & { id: string }): CandidateRow {
		return {
			id: over.id,
			rule: { ...paraRule('Projects'), id: over.id },
			sourcePackId: 'para',
			sourcePackName: 'PARA',
			anchorPath: '',
			coverage: over.coverage ?? { matchCount: 5, sampleEmissions: [{ folder: 'Projects', tags: ['projects'] }] },
			bijectivity: over.bijectivity ?? 'unknown',
			conflict: over.conflict ?? {
				conflicts: false,
				collidesWithExisting: false,
				overlappingFolderSample: [],
				predictedWinnerId: null,
			},
		};
	}

	test('sortCandidatesByNoise puts zero-match rows first, then no-emit, then real', () => {
		const real = row({ id: 'real', coverage: { matchCount: 8, sampleEmissions: [{ folder: 'Projects', tags: ['projects'] }] } });
		const noEmit = row({ id: 'noemit', coverage: { matchCount: 3, sampleEmissions: [{ folder: 'X', tags: [] }] } });
		const zero = row({ id: 'zero', coverage: { matchCount: 0, sampleEmissions: [] } });

		const sorted = sortCandidatesByNoise([real, noEmit, zero]);
		expect(sorted.map((c) => c.id)).toEqual(['zero', 'noemit', 'real']);
		// pure: input not mutated
		expect([real, noEmit, zero].map((c) => c.id)).toEqual(['real', 'noemit', 'zero']);
	});

	test('sortCandidatesByNoise breaks ties on lower matchCount then id', () => {
		const a = row({ id: 'a', coverage: { matchCount: 9, sampleEmissions: [{ folder: 'P', tags: ['p'] }] } });
		const b = row({ id: 'b', coverage: { matchCount: 2, sampleEmissions: [{ folder: 'P', tags: ['p'] }] } });
		const sorted = sortCandidatesByNoise([a, b]);
		// both "real" (score 2), lower matchCount first → b before a
		expect(sorted.map((c) => c.id)).toEqual(['b', 'a']);
	});

	test('sortCandidatesByConflict clusters collide-with-existing first, then conflicts, then clean', () => {
		const clean = row({ id: 'clean' });
		const candConflict = row({
			id: 'candconflict',
			conflict: { conflicts: true, collidesWithExisting: false, overlappingFolderSample: ['Projects'], predictedWinnerId: 'x' },
		});
		const existingCollide = row({
			id: 'existingcollide',
			conflict: { conflicts: true, collidesWithExisting: true, overlappingFolderSample: ['Projects'], predictedWinnerId: 'x' },
		});

		const sorted = sortCandidatesByConflict([clean, candConflict, existingCollide]);
		expect(sorted.map((c) => c.id)).toEqual(['existingcollide', 'candconflict', 'clean']);
	});
});
