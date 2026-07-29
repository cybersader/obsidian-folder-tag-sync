import { describe, expect, test } from 'bun:test';
import {
	detectionOccurrenceKey,
	type DetectionOccurrence,
	type DetectionResult,
} from '../engine/detectPacks';
import type { CandidateRow } from '../engine/scanAndSnapPlan';
import type { MappingRule } from '../types/settings';
import {
	UNGROUPED_RULE_LAYER_LABEL,
	buildOrganizationalSystemsProjection,
} from './organizationalSystemsProjection';

function options(): MappingRule['options'] {
	return {
		createFolders: true,
		addTags: true,
		removeOrphanedTags: false,
		syncOnFileCreate: true,
		syncOnFileMove: true,
		syncOnFileRename: true,
	};
}

function rule(
	id: string,
	group: string | undefined,
	priority = 10,
): MappingRule {
	return {
		id,
		name: `${id} name`,
		enabled: true,
		priority,
		...(group === undefined ? {} : { group }),
		direction: 'folder-to-tag',
		folderPattern: `^${id}(?:/|$)`,
		tagEntryPoint: id,
		options: options(),
	};
}

function occurrence(
	packId: string,
	packName: string,
	anchorPath: string,
	extra: Partial<DetectionOccurrence> = {},
): DetectionOccurrence {
	return {
		key: detectionOccurrenceKey(packId, anchorPath),
		packId,
		packName,
		anchorPath,
		status: 'actionable',
		score: 1,
		evidenceCount: 2,
		minEvidence: 2,
		countBy: 'roles',
		evidence: [],
		memberPaths: anchorPath ? [`${anchorPath}/Projects`, `${anchorPath}/Areas`] : ['Projects', 'Areas'],
		supportPaths: [],
		missingRoles: [],
		...extra,
	};
}

function detectionResult(
	packId: string,
	occurrences: DetectionOccurrence[],
): DetectionResult {
	return {
		packId,
		score: Math.max(...occurrences.map((item) => item.score)),
		signalsHit: 2,
		minSignals: 2,
		matchedSignals: [],
		occurrences,
	};
}

function candidate(
	id: string,
	occurrenceValue: DetectionOccurrence,
	config: {
		group?: string;
		matchCount?: number;
		conflicts?: boolean;
		collidesWithExisting?: boolean;
	} = {},
): CandidateRow {
	const candidateRule = rule(id, config.group);
	const matchCount = config.matchCount ?? 1;
	return {
		key: `candidate:${occurrenceValue.key}:${id}`,
		id,
		rule: candidateRule,
		sourcePackId: occurrenceValue.packId,
		sourcePackName: occurrenceValue.packName,
		occurrenceKey: occurrenceValue.key,
		anchorPath: occurrenceValue.anchorPath,
		coverage: {
			matchCount,
			sampleEmissions: matchCount > 0
				? [{ folder: `${occurrenceValue.anchorPath}/${id}`, tags: [`#${id}`] }]
				: [],
		},
		bijectivity: 'unknown',
		conflict: {
			conflicts: config.conflicts ?? false,
			collidesWithExisting: config.collidesWithExisting ?? false,
			overlappingFolderSample: [],
			predictedWinnerId: null,
		},
	};
}

describe('organizational systems projection — occurrence cards', () => {
	test('derives exactly one card per anchored occurrence across all statuses', () => {
		const root = occurrence('para', 'PARA', '');
		const nested = occurrence('para', 'PARA', 'Work', {
			status: 'incomplete',
			score: 0.5,
			evidenceCount: 1,
			missingRoles: ['areas'],
		});
		const suppressed = occurrence('child', 'Child system', 'Work/Nested', {
			status: 'suppressed',
			parentPackId: 'para',
			parentOccurrenceKey: nested.key,
			suppressionReason: 'missing-local-parent',
		});

		const projection = buildOrganizationalSystemsProjection({
			detectionResults: [
				detectionResult('child', [suppressed]),
				detectionResult('para', [nested, root, root]),
			],
			installedRules: [],
		});

		expect(projection.cards.map((card) => [card.occurrenceKey, card.status])).toEqual([
			[root.key, 'actionable'],
			[nested.key, 'incomplete'],
			[suppressed.key, 'suppressed'],
		]);
		expect(projection.cards).toHaveLength(3);
		expect(projection.relations).toContainEqual({
			kind: 'scoped-under',
			certainty: 'exact',
			childOccurrenceKey: suppressed.key,
			parentOccurrenceKey: nested.key,
		});
	});
});

describe('organizational systems projection — candidates', () => {
	test('groups candidate rows by exact occurrence and sorts within each group', () => {
		const root = occurrence('para', 'PARA', '');
		const nested = occurrence('para', 'PARA', 'Work');
		const inputCandidates = [
			candidate('root-live', root, { matchCount: 5 }),
			candidate('nested-live', nested, { matchCount: 4 }),
			candidate('root-dead', root, { matchCount: 0 }),
			candidate('nested-dead', nested, { matchCount: 0 }),
		];
		const inputOrder = inputCandidates.map((row) => row.key);

		const projection = buildOrganizationalSystemsProjection({
			detectionResults: [detectionResult('para', [nested, root])],
			candidates: inputCandidates,
			installedRules: [],
			candidateSort: 'noise',
		});

		expect(projection.candidateGroups.map((group) => group.occurrenceKey)).toEqual([
			root.key,
			nested.key,
		]);
		expect(projection.candidateGroups[0].rows.map((row) => row.id)).toEqual([
			'root-dead',
			'root-live',
		]);
		expect(projection.candidateGroups[1].rows.map((row) => row.id)).toEqual([
			'nested-dead',
			'nested-live',
		]);
		expect(projection.candidateGroups[1].provenance).toEqual({
			certainty: 'exact',
			occurrenceKey: nested.key,
			sourcePackId: 'para',
			sourcePackName: 'PARA',
			anchorPath: 'Work',
		});
		expect(projection.relations).toContainEqual({
			kind: 'candidate-source',
			certainty: 'exact',
			occurrenceKey: nested.key,
			candidateGroupKey: projection.candidateGroups[1].key,
			sourcePackId: 'para',
			anchorPath: 'Work',
		});
		expect(inputCandidates.map((row) => row.key)).toEqual(inputOrder);
	});

	test('applies conflict sorting independently inside each occurrence group', () => {
		const alpha = occurrence('alpha', 'Alpha', 'Alpha');
		const beta = occurrence('beta', 'Beta', 'Beta');
		const projection = buildOrganizationalSystemsProjection({
			detectionResults: [
				detectionResult('alpha', [alpha]),
				detectionResult('beta', [beta]),
			],
			candidates: [
				candidate('alpha-safe', alpha),
				candidate('beta-safe', beta),
				candidate('alpha-existing', alpha, {
					conflicts: true,
					collidesWithExisting: true,
				}),
				candidate('beta-candidate', beta, { conflicts: true }),
			],
			installedRules: [],
			candidateSort: 'conflict',
		});

		expect(projection.candidateGroups[0].rows.map((row) => row.id)).toEqual([
			'alpha-existing',
			'alpha-safe',
		]);
		expect(projection.candidateGroups[1].rows.map((row) => row.id)).toEqual([
			'beta-candidate',
			'beta-safe',
		]);
	});
});

describe('organizational systems projection — installed Rule layers', () => {
	test('groups by MappingRule.group, follows precedence, and keeps Ungrouped last', () => {
		const installed = [
			rule('ungrouped-later', undefined, 20),
			rule('zeta', 'zeta', 10),
			rule('entity-later', 'entity', 20),
			rule('alpha', 'alpha', 10),
			rule('entity-first', 'entity', 5),
			rule('explicit-default', '__default__', 1),
		];

		const projection = buildOrganizationalSystemsProjection({
			detectionResults: [],
			installedRules: installed,
			groupPrecedence: ['entity', 'entity'],
		});

		expect(projection.ruleLayers.map((layer) => layer.label)).toEqual([
			'entity',
			'alpha',
			'zeta',
			UNGROUPED_RULE_LAYER_LABEL,
		]);
		expect(projection.ruleLayers[0].precedenceIndex).toBe(0);
		expect(projection.ruleLayers[0].rules.map((item) => item.id)).toEqual([
			'entity-first',
			'entity-later',
		]);
		expect(projection.ruleLayers[3].group).toBeNull();
		expect(projection.ruleLayers[3].rules.map((item) => item.id)).toEqual([
			'explicit-default',
			'ungrouped-later',
		]);
	});

	test('marks installed associations inferred or unknown, never as ownership', () => {
		const para = occurrence('para', 'PARA', 'Work');
		const custom = occurrence('custom-pack', 'Custom pack', 'Reference');
		const installed = [
			rule('installed-para', 'para'),
			rule('installed-custom-layer', 'custom-layer'),
			rule('installed-ungrouped', undefined),
		];
		const candidateRows = [
			candidate('custom-candidate', custom, { group: 'custom-layer' }),
		];
		const installedBefore = JSON.stringify(installed);

		const projection = buildOrganizationalSystemsProjection({
			detectionResults: [
				detectionResult('para', [para]),
				detectionResult('custom-pack', [custom]),
			],
			candidates: candidateRows,
			installedRules: installed,
		});

		const paraLayer = projection.ruleLayers.find((layer) => layer.group === 'para')!;
		const customLayer = projection.ruleLayers.find((layer) => layer.group === 'custom-layer')!;
		const ungrouped = projection.ruleLayers.find((layer) => layer.group === null)!;

		expect(paraLayer.association).toEqual({
			certainty: 'inferred',
			occurrenceKeys: [para.key],
		});
		expect(customLayer.association).toEqual({
			certainty: 'inferred',
			occurrenceKeys: [custom.key],
		});
		expect(ungrouped.association).toEqual({
			certainty: 'unknown',
			occurrenceKeys: [],
			reason: 'no-durable-provenance',
		});
		expect(projection.relations).toContainEqual({
			kind: 'installed-association',
			certainty: 'inferred',
			occurrenceKey: para.key,
			ruleLayerKey: paraLayer.key,
			basis: 'group-matches-pack-id',
		});
		expect(projection.relations).toContainEqual({
			kind: 'installed-association',
			certainty: 'inferred',
			occurrenceKey: custom.key,
			ruleLayerKey: customLayer.key,
			basis: 'shared-rule-group',
		});
		expect(projection.relations).toContainEqual({
			kind: 'installed-association',
			certainty: 'unknown',
			occurrenceKey: null,
			ruleLayerKey: ungrouped.key,
			basis: 'no-durable-provenance',
		});

		const serialized = JSON.stringify(projection);
		expect(serialized.includes('owner')).toBe(false);
		expect(JSON.stringify(installed)).toBe(installedBefore);
		expect(Object.prototype.hasOwnProperty.call(installed[0], 'sourcePackId')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(installed[0], 'occurrenceKey')).toBe(false);
	});
});
