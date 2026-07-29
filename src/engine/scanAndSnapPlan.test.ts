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
import {
	detectPacks,
	detectionOccurrenceKey,
	type DetectionResult,
	type ManifestPackEntry,
} from './detectPacks';
import { collectCrossPackHits } from './detectionTree';
import { buildScopePackPlan } from './scopePackPlan';
import { buildRuleInstallPlan } from './ruleInstallPlan';
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

function inverseOnlyRule(): MappingRule {
	return {
		id: 'capture-inbox',
		name: 'Capture inbox',
		enabled: true,
		priority: 10,
		direction: 'tag-to-folder',
		tagPattern: '^-inbox$',
		tagEntryPoint: '-inbox',
		folderEntryPoint: 'Capture/Inbox',
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

function occurrenceParaDetection(
	occurrences: Array<{
		anchorPath: string;
		status: 'actionable' | 'incomplete' | 'suppressed';
	}>,
): DetectionResult {
	return {
		packId: 'para',
		score: occurrences.some((occurrence) => occurrence.status === 'actionable') ? 1 : 0.5,
		signalsHit: 2,
		minSignals: 2,
		matchedSignals: [],
		occurrences: occurrences.map(({ anchorPath, status }) => ({
			key: detectionOccurrenceKey('para', anchorPath),
			packId: 'para',
			packName: 'PARA',
			anchorPath,
			status,
			score: status === 'actionable' ? 1 : 0.5,
			evidenceCount: status === 'actionable' ? 2 : 1,
			minEvidence: 2,
			countBy: 'roles',
			evidence: [],
			memberPaths: [],
			supportPaths: [],
			missingRoles: status === 'actionable' ? [] : ['areas'],
		})),
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
		expect(proj.rule.folderEntryPoint).toBe('Work/Projects');
		// It should match the nested folders without duplicating the literal
		// Projects segment in the emitted tag namespace.
		expect(proj.coverage.matchCount).toBeGreaterThan(0);
		expect(proj.coverage.sampleEmissions).toContainEqual({
			folder: 'Work/Projects/X',
			tags: ['#projects/x'],
		});
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

	test('below-threshold detections are not actionable candidate sources', () => {
		const detection = paraDetection({ exampleProjects: 'Projects', exampleAreas: 'Areas' });
		detection.score = 0.5;
		const plan = buildScanAndSnapPlan({
			folderPaths: ['Projects', 'Areas'],
			detectionResults: [detection],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [],
		});

		expect(plan.candidates).toEqual([]);
	});

	test('explicit deployments replace detected-instance inference and support root scopes', () => {
		const plan = buildScanAndSnapPlan({
			folderPaths: ['Projects', 'Projects/Web', 'Work', 'Work/Projects'],
			detectionResults: [
				paraDetection({ exampleProjects: 'Work/Projects', exampleAreas: 'Work/Areas' }),
			],
			deployments: [{ packId: 'para', anchorPath: '' }],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [],
		});

		expect(plan.candidates).toHaveLength(1);
		expect(plan.candidates[0].anchorPath).toBe('');
		expect(plan.candidates[0].rule.id).toBe('para-projects');
		expect(plan.candidates[0].coverage.matchCount).toBe(2);
	});

	test('explicit deployments can plan a pack without a detection result', () => {
		const plan = buildScanAndSnapPlan({
			folderPaths: ['Work', 'Work/Projects', 'Work/Projects/Web'],
			deployments: [{ packId: 'para', anchorPath: 'Work' }],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		});

		expect(plan.candidates).toHaveLength(1);
		expect(plan.candidates[0].anchorPath).toBe('Work');
		expect(plan.candidates[0].occurrenceKey).toBe(
			detectionOccurrenceKey('para', 'Work'),
		);
		expect(plan.candidates[0].rule.id).toBe('para-projects__work');
	});

	test('occurrence-native inference emits candidates only for actionable occurrences', () => {
		const result = occurrenceParaDetection([
			{ anchorPath: 'Teams/Acme', status: 'actionable' },
			{ anchorPath: 'Teams/Beta', status: 'incomplete' },
			{ anchorPath: 'Teams/Gamma', status: 'suppressed' },
		]);
		const plan = buildScanAndSnapPlan({
			folderPaths: [
				'Teams/Acme/Projects',
				'Teams/Beta/Projects',
				'Teams/Gamma/Projects',
			],
			detectionResults: [result],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [],
		});

		expect(plan.candidates).toHaveLength(1);
		expect(plan.candidates[0].anchorPath).toBe('Teams/Acme');
		expect(plan.candidates[0].occurrenceKey).toBe(
			detectionOccurrenceKey('para', 'Teams/Acme'),
		);
	});

	test('preserves repeated actionable occurrence identities through candidate production', () => {
		const result = occurrenceParaDetection([
			{ anchorPath: 'Teams/Acme', status: 'actionable' },
			{ anchorPath: 'Teams/Beta', status: 'actionable' },
		]);
		const plan = buildScanAndSnapPlan({
			folderPaths: ['Teams/Acme/Projects', 'Teams/Beta/Projects'],
			detectionResults: [result],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [],
		});

		expect(plan.candidates).toHaveLength(2);
		expect(plan.candidates.map((candidate) => candidate.occurrenceKey)).toEqual([
			detectionOccurrenceKey('para', 'Teams/Acme'),
			detectionOccurrenceKey('para', 'Teams/Beta'),
		]);
		expect(new Set(plan.candidates.map((candidate) => candidate.key)).size).toBe(2);
	});

	test('root scope deployments produce the same candidates as occurrence-native inference', () => {
		const manifest: ManifestPackEntry[] = [{
			id: 'para',
			name: 'PARA',
			detection: {
				anyOf: [
					{ folderRegex: '^Projects$', role: 'projects' },
					{ folderRegex: '^Areas$', role: 'areas' },
				],
				occurrence: { countBy: 'roles', minEvidence: 2 },
			},
		}];
		const folders = [
			'Projects',
			'Areas',
			'Teams/Acme/Projects',
			'Teams/Acme/Areas',
			'Teams/Beta/Projects',
		];
		const detectionResults = detectPacks(folders, manifest);
		const hits = collectCrossPackHits(folders, detectionResults, PACK_NAMES);
		const scopePlan = buildScopePackPlan({ selectedPaths: [''], hitMap: hits });
		const shared = {
			folderPaths: folders,
			packRulesById: new Map([['para', [paraRule('Projects'), paraRule('Areas')]]]),
			existingRules: [],
			packNamesById: PACK_NAMES,
		};

		const inferred = buildScanAndSnapPlan({ ...shared, detectionResults });
		const explicit = buildScanAndSnapPlan({ ...shared, deployments: scopePlan.deployments });
		const project = (plan: ReturnType<typeof buildScanAndSnapPlan>) => plan.candidates.map((candidate) => ({
			key: candidate.key,
			id: candidate.id,
			occurrenceKey: candidate.occurrenceKey,
			anchorPath: candidate.anchorPath,
			folderPattern: candidate.rule.folderPattern,
			matchCount: candidate.coverage.matchCount,
		}));

		expect(scopePlan.deployments.map((deployment) => deployment.anchorPath)).toEqual([
			'',
			'Teams/Acme',
		]);
		expect(project(explicit)).toEqual(project(inferred));
	});
});

describe('buildScanAndSnapPlan — candidate identity and source immutability', () => {
	test('candidate key is a stable composite placement key distinct from persisted rule id', () => {
		const sharedIdA = { ...paraRule('Projects'), id: 'shared-rule' };
		const sharedIdB = { ...paraRule('Projects'), id: 'shared-rule', name: 'Other projects' };
		const input = {
			folderPaths: ['Projects'],
			deployments: [
				{ packId: 'alpha', anchorPath: '' },
				{ packId: 'beta', anchorPath: '' },
			],
			packRulesById: new Map([
				['alpha', [sharedIdA]],
				['beta', [sharedIdB]],
			]),
			existingRules: [],
		};

		const first = buildScanAndSnapPlan(input);
		const second = buildScanAndSnapPlan(input);

		expect(new Set(first.candidates.map((candidate) => candidate.id)).size).toBe(2);
		expect(first.candidates.every((candidate) => candidate.id.startsWith('shared-rule__placement-')))
			.toBe(true);
		expect(new Set(first.candidates.map((candidate) => candidate.key)).size).toBe(2);
		expect(first.candidates.every((candidate) => candidate.key !== candidate.id)).toBe(true);
		expect(first.candidates.map((candidate) => candidate.id)).toEqual(
			second.candidates.map((candidate) => candidate.id),
		);
		expect(first.candidates.map((candidate) => candidate.key)).toEqual(
			second.candidates.map((candidate) => candidate.key),
		);
	});

	test('disambiguates scoped rule ids when distinct occurrence anchors slug identically', () => {
		const plan = buildScanAndSnapPlan({
			folderPaths: ['A+B/Projects', 'A B/Projects'],
			deployments: [
				{ packId: 'para', anchorPath: 'A+B' },
				{ packId: 'para', anchorPath: 'A B' },
			],
			packRulesById: new Map([['para', [paraRule('Projects')]]]),
			existingRules: [],
		});

		expect(plan.candidates).toHaveLength(2);
		expect(new Set(plan.candidates.map((candidate) => candidate.occurrenceKey)).size).toBe(2);
		expect(new Set(plan.candidates.map((candidate) => candidate.id)).size).toBe(2);
		expect(plan.candidates.every((candidate) => candidate.coverage.matchCount === 1)).toBe(true);
		const install = buildRuleInstallPlan(
			plan.candidates.map((candidate) => candidate.rule),
			[],
		);
		expect(install.addedRules).toHaveLength(2);
		expect(install.skippedDuplicateCount).toBe(0);
	});

	test('source-disabled pack rules are analyzed as enabled copies without mutation', () => {
		const sourceRule = { ...paraRule('Projects'), enabled: false };
		const plan = buildScanAndSnapPlan({
			folderPaths: ['Projects', 'Projects/Web'],
			deployments: [{ packId: 'para', anchorPath: '' }],
			packRulesById: new Map([['para', [sourceRule]]]),
			existingRules: [],
		});

		expect(sourceRule.enabled).toBe(false);
		expect(plan.candidates[0].rule).not.toBe(sourceRule);
		expect(plan.candidates[0].rule.enabled).toBe(true);
		expect(plan.candidates[0].coverage.matchCount).toBe(2);
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

	test('inverse-only candidates do not fabricate folder coverage or emissions', () => {
		const plan = buildScanAndSnapPlan({
			folderPaths: ['Capture', 'Output', 'Projects', 'System'],
			deployments: [{ packId: 'seacow', anchorPath: '' }],
			packRulesById: new Map([['seacow', [inverseOnlyRule()]]]),
			existingRules: [],
		});

		const candidate = plan.candidates[0];
		expect(candidate.coverage).toEqual({
			matchCount: 0,
			sampleEmissions: [],
			previewUnavailableReason: 'inverse-only',
		});
		expect(candidate.conflict.analysisUnavailableReason).toBe('inverse-only');
		expect(candidate.conflict.conflicts).toBe(false);
		expect(plan.summary.touchingCandidates).toBe(0);
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
			key: over.key ?? `test::${over.id}`,
			id: over.id,
			rule: { ...paraRule('Projects'), id: over.id },
			sourcePackId: 'para',
			sourcePackName: 'PARA',
			occurrenceKey: detectionOccurrenceKey('para', ''),
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
