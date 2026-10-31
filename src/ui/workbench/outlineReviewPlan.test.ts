import { describe, expect, test } from 'bun:test';
import type { CrossPackHitMap } from '../../engine/detectionTree';
import type { CandidateRow } from '../../engine/scanAndSnapPlan';
import type { MappingRule } from '../../types/settings';
import {
	buildOutlineReviewPlan,
	evaluateOutlineRuleSet,
	rulesEquivalentForInstall,
} from './outlineReviewPlan';

const OPTIONS: MappingRule['options'] = {
	createFolders: false,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: false,
	syncOnFileMove: false,
	syncOnFileRename: false,
};

function rule(
	id: string,
	pattern: string,
	tagEntryPoint: string | undefined,
	overrides: Partial<MappingRule> = {},
): MappingRule {
	return {
		id,
		name: id,
		enabled: true,
		priority: 10,
		direction: 'folder-to-tag',
		folderPattern: pattern,
		tagEntryPoint,
		options: { ...OPTIONS },
		...overrides,
	};
}

function candidate(occurrenceKey: string, sourcePackId: string, candidateRule: MappingRule): CandidateRow {
	return {
		key: `candidate:${occurrenceKey}:${candidateRule.id}`,
		id: candidateRule.id,
		rule: candidateRule,
		sourcePackId,
		sourcePackName: sourcePackId.toUpperCase(),
		occurrenceKey,
		anchorPath: occurrenceKey.includes('nested') ? 'Root/Nested' : 'Root',
		coverage: { matchCount: 0, sampleEmissions: [] },
		bijectivity: 'unknown',
		conflict: {
			conflicts: false,
			collidesWithExisting: false,
			overlappingFolderSample: [],
			candidateTargets: [],
			installedTargets: [],
			predictedWinnerId: null,
		},
	};
}

function hitMap(): CrossPackHitMap {
	const rootPara = {
		folderPath: 'Root/Projects',
		signal: { packId: 'para', packName: 'PARA', globalIndex: 0, signalIndex: 0, regex: '^Projects$', scope: 'leafName' as const },
		occurrenceKey: 'occ:para-root',
		occurrenceAnchorPath: 'Root',
		occurrenceStatus: 'actionable' as const,
	};
	const rootAlt = {
		...rootPara,
		signal: { ...rootPara.signal, packId: 'alt', packName: 'Alternative', globalIndex: 1 },
		occurrenceKey: 'occ:alt-root',
	};
	const nested = {
		...rootPara,
		folderPath: 'Root/Nested/Projects',
		occurrenceKey: 'occ:para-nested',
		occurrenceAnchorPath: 'Root/Nested',
	};
	const hits = new Map([
		['Root/Projects', [rootPara, rootAlt]],
		['Root/Nested/Projects', [nested]],
	]);
	return {
		allSignals: [],
		allEvidenceSignals: [],
		actionableSignals: [],
		hitsByPath: hits,
		allEvidenceHitsByPath: hits,
		actionableHitsByPath: hits,
	};
}

describe('outline reviewed selection', () => {
	test('filters exact occurrences after scope discovery and preserves multi-rule membership', () => {
		const paraA = candidate('occ:para-root', 'para', rule('para-a', '^Root/Projects(?:/|$)', '#projects'));
		const paraB = candidate('occ:para-root', 'para', rule('para-b', '^Root/Areas(?:/|$)', '#areas'));
		const alt = candidate('occ:alt-root', 'alt', rule('alt-a', '^Root/Projects(?:/|$)', '#alt'));
		const nested = candidate('occ:para-nested', 'para', rule('para-nested', '^Root/Nested/Projects(?:/|$)', '#nested'));

		const plan = buildOutlineReviewPlan({
			selectedPaths: ['Root'],
			hitMap: hitMap(),
			excludedOccurrenceKeys: ['occ:alt-root'],
			candidates: [paraA, paraB, alt, nested],
			installedRules: [],
			folderPaths: ['Root', 'Root/Projects', 'Root/Areas', 'Root/Nested', 'Root/Nested/Projects'],
			groupPrecedence: [],
		});

		expect(plan.scopePlan.deployments.map((deployment) => deployment.occurrenceKey)).toEqual([
			'occ:alt-root', 'occ:para-root', 'occ:para-nested',
		]);
		expect(plan.deployments.map((deployment) => deployment.occurrenceKey)).toEqual([
			'occ:para-root', 'occ:para-nested',
		]);
		expect(plan.occurrenceRules).toEqual([
			{ occurrenceKey: 'occ:para-root', ruleIds: ['para-a', 'para-b'] },
			{ occurrenceKey: 'occ:para-nested', ruleIds: ['para-nested'] },
		]);
		expect(plan.reviewedCandidates.map((row) => row.key)).toEqual([paraA.key, paraB.key, nested.key]);
		expect(plan.rulesForSave.map((saved) => saved.id)).toEqual(['para-a', 'para-b', 'para-nested']);
		expect(plan.reviewedRuleCount).toBe(3);
		expect(plan.reviewedSystemCount).toBe(2);
	});

	test('shows the parent rule anchor and complete current-folder coverage beyond the checked hit', () => {
		const rows = [
			candidate('occ:para-root', 'para', rule('para-a', '^Root/Projects(?:/|$)', '#projects')),
			candidate('occ:para-root', 'para', rule('para-b', '^Root/Areas(?:/|$)', '#areas')),
		];
		const plan = buildOutlineReviewPlan({
			selectedPaths: ['Root/Projects'],
			hitMap: hitMap(),
			excludedOccurrenceKeys: ['occ:alt-root'],
			candidates: rows,
			installedRules: [],
			folderPaths: ['Root/Projects', 'Root/Projects/Alpha', 'Root/Areas'],
			groupPrecedence: [],
		});
		expect(plan.deployments).toEqual([
			{ packId: 'para', occurrenceKey: 'occ:para-root', anchorPath: 'Root' },
		]);
		expect(plan.occurrenceCoverage).toEqual([{
			occurrenceKey: 'occ:para-root',
			anchorPath: 'Root',
			matchingFolders: ['Root/Projects', 'Root/Projects/Alpha', 'Root/Areas'],
			coverageKind: 'all-current-folders',
		}]);
	});

	test('keeps deterministic candidate IDs and preview/save membership identical', () => {
		const rows = [
			candidate('occ:para-root', 'para', rule('para-a', '^Root/Projects(?:/|$)', '#projects')),
			candidate('occ:para-root', 'para', rule('para-b', '^Root/Areas(?:/|$)', '#areas')),
		];
		const input = {
			selectedPaths: ['Root'],
			hitMap: hitMap(),
			excludedOccurrenceKeys: ['occ:alt-root', 'occ:para-nested'],
			candidates: rows,
			installedRules: [],
			folderPaths: ['Root/Projects', 'Root/Areas'],
			groupPrecedence: [],
		};
		const first = buildOutlineReviewPlan(input);
		const second = buildOutlineReviewPlan(input);
		expect(first.reviewedCandidates.map((row) => row.id)).toEqual(first.rulesForSave.map((saved) => saved.id));
		expect(second.rulesForSave.map((saved) => saved.id)).toEqual(first.rulesForSave.map((saved) => saved.id));
	});
});

describe('installed rule reconciliation', () => {
	test('distinguishes new, saved unchanged, and edited same-ID rules without duplicate competitors', () => {
		const saved = rule('saved', '^Root/Projects(?:/|$)', '#projects', { enabled: false });
		const editedInstalled = rule('edited', '^Root/Areas(?:/|$)', '#manual', { enabled: true });
		const changedDraft = rule('edited', '^Root/Areas(?:/|$)', '#pack');
		const rows = [
			candidate('occ:para-root', 'para', { ...saved, enabled: true }),
			candidate('occ:para-root', 'para', changedDraft),
			candidate('occ:para-root', 'para', rule('new', '^Root/Resources(?:/|$)', '#resources')),
		];
		const plan = buildOutlineReviewPlan({
			selectedPaths: ['Root'], hitMap: hitMap(), excludedOccurrenceKeys: ['occ:alt-root', 'occ:para-nested'],
			candidates: rows, installedRules: [saved, editedInstalled],
			folderPaths: ['Root/Projects', 'Root/Areas', 'Root/Resources'], groupPrecedence: [],
		});

		expect(plan.reviewedRules.map((entry) => [entry.rule.id, entry.installStatus])).toEqual([
			['saved', 'saved'], ['edited', 'changed'], ['new', 'new'],
		]);
		expect(plan.rulesForSave.map((entry) => entry.id)).toEqual(['new']);
		expect(plan.hypotheticalRules.filter((entry) => entry.id === 'edited')).toHaveLength(1);
		expect(plan.hypotheticalRules.find((entry) => entry.id === 'edited')?.tagEntryPoint).toBe('#manual');
	});

	test('treats forced-disabled saved drafts as equivalent and reopening produces no duplicate save', () => {
		const draft = rule('saved', '^Root/Projects(?:/|$)', '#projects');
		const installed = { ...draft, enabled: false };
		expect(rulesEquivalentForInstall(draft, installed)).toBe(true);
		const plan = buildOutlineReviewPlan({
			selectedPaths: ['Root'], hitMap: hitMap(), excludedOccurrenceKeys: ['occ:alt-root', 'occ:para-nested'],
			candidates: [candidate('occ:para-root', 'para', draft)], installedRules: [installed],
			folderPaths: ['Root/Projects'], groupPrecedence: [],
		});
		expect(plan.rulesForSave).toEqual([]);
		expect(plan.reviewedRules[0].installStatus).toBe('saved');
	});
});

describe('current and hypothetical behavior diagnostics', () => {
	test('uses enabled installed forward rules, exact new drafts, configured groups, and reverse filtering', () => {
		const installed = rule('installed', '^Root/Projects(?:/|$)', '#installed', { group: 'low', enabled: true });
		const disabled = rule('disabled', '^Root/Projects(?:/|$)', '#disabled', { group: 'top', enabled: false });
		const proposed = rule('proposed', '^Root/Projects(?:/|$)', '#proposed', { group: 'top' });
		const reverse = rule('reverse', '^Root/Projects(?:/|$)', '#reverse', { direction: 'tag-to-folder', group: 'top', priority: 0 });
		const evaluation = evaluateOutlineRuleSet(
			['Root/Projects'], [installed, disabled], [proposed, reverse], ['top', 'low'],
		);
		expect(evaluation[0].current).toMatchObject({ state: 'valid', ruleId: 'installed', origin: 'installed' });
		expect(evaluation[0].hypothetical).toMatchObject({ state: 'valid', ruleId: 'proposed', origin: 'proposed' });
		expect(evaluation[0].change).toBe('changed');
	});

	test('keeps invalid winners, distinguishes empty and no-match, and does not promote a valid loser', () => {
		const invalidWinner = rule('invalid', '^Root/Projects(?:/|$)', '#/', { group: 'top' });
		const validLoser = rule('valid', '^Root/Projects(?:/|$)', '#valid', { group: 'low' });
		const empty = rule('empty', '^Root/Empty$', undefined, { transfer: { op: 'opaque' } });
		const evaluation = evaluateOutlineRuleSet(
			['Root/Projects', 'Root/Empty', 'Root/Other'], [], [invalidWinner, validLoser, empty], ['top', 'low'],
		);
		expect(evaluation[0].hypothetical).toMatchObject({ state: 'invalid', ruleId: 'invalid', origin: 'proposed' });
		expect(evaluation[1].hypothetical).toMatchObject({ state: 'empty', ruleId: 'empty' });
		expect(evaluation.map((comparison) => comparison.folderPath)).toEqual([
			'Root/Projects', 'Root/Empty',
		]);
	});

	test('omits unrelated no-match rows while retaining unchanged installed behavior', () => {
		const installed = rule('installed', '^Root/Installed$', '#installed');
		const evaluation = evaluateOutlineRuleSet(
			['Root/Unrelated', 'Root/Installed'], [installed], [], [],
		);
		expect(evaluation).toHaveLength(1);
		expect(evaluation[0]).toMatchObject({
			folderPath: 'Root/Installed',
			change: 'unchanged',
			current: { state: 'valid', ruleId: 'installed', origin: 'installed' },
			hypothetical: { state: 'valid', ruleId: 'installed', origin: 'installed' },
		});
	});

	test('blocks known invalid proposed output even when it loses, but does not blame an invalid installed winner', () => {
		const invalidDraft = rule('draft-invalid', '^Root/Projects(?:/|$)', '#/', { group: 'low' });
		const validInstalled = rule('installed-valid', '^Root/Projects(?:/|$)', '#valid', { group: 'top' });
		const draftPlan = buildOutlineReviewPlan({
			selectedPaths: ['Root'], hitMap: hitMap(), excludedOccurrenceKeys: ['occ:alt-root', 'occ:para-nested'],
			candidates: [candidate('occ:para-root', 'para', invalidDraft)], installedRules: [validInstalled],
			folderPaths: ['Root/Projects'], groupPrecedence: ['top', 'low'],
		});
		expect(draftPlan.comparisons[0].hypothetical.ruleId).toBe('installed-valid');
		expect(draftPlan.invalidDraftOutputs).toEqual([
			{ ruleId: 'draft-invalid', ruleName: 'draft-invalid', folderPath: 'Root/Projects', tags: ['#/Root/Projects'], error: 'Matched rule produces unusable tag syntax.' },
		]);
		expect(draftPlan.canSave).toBe(false);

		const invalidInstalled = rule('installed-invalid', '^Root/Projects(?:/|$)', '#/', { enabled: true });
		const installedPlan = buildOutlineReviewPlan({
			selectedPaths: ['Root'], hitMap: hitMap(), excludedOccurrenceKeys: ['occ:alt-root', 'occ:para-nested'],
			candidates: [], installedRules: [invalidInstalled], folderPaths: ['Root/Projects'], groupPrecedence: [],
		});
		expect(installedPlan.comparisons[0].current).toMatchObject({ state: 'invalid', origin: 'installed' });
		expect(installedPlan.invalidDraftOutputs).toEqual([]);
	});
});
