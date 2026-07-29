import { describe, expect, test } from 'bun:test';
import type { AnnotatedHit, CrossPackHitMap } from './detectionTree';
import { detectionOccurrenceKey } from './detectPacks';
import { buildScopePackPlan } from './scopePackPlan';

function annotatedHit(folderPath: string, packId: string, globalIndex: number): AnnotatedHit {
	return {
		folderPath,
		signal: {
			packId,
			packName: packId,
			signalIndex: 0,
			globalIndex,
			label: `${packId} signal`,
			regex: '.*',
			scope: 'path',
		},
	};
}

function hitMap(entries: Array<[string, string[]]>): CrossPackHitMap {
	let globalIndex = 0;
	const hitsByPath = new Map<string, AnnotatedHit[]>();
	for (const [folderPath, packIds] of entries) {
		hitsByPath.set(
			folderPath,
			packIds.map((packId) => annotatedHit(folderPath, packId, globalIndex++)),
		);
	}
	return {
		allSignals: [],
		hitsByPath,
		allEvidenceSignals: [],
		actionableSignals: [],
		allEvidenceHitsByPath: hitsByPath,
		actionableHitsByPath: hitsByPath,
	};
}

function occurrenceHit(
	folderPath: string,
	packId: string,
	anchorPath: string,
	status: 'actionable' | 'incomplete' | 'suppressed',
	globalIndex: number,
): AnnotatedHit {
	return {
		...annotatedHit(folderPath, packId, globalIndex),
		occurrenceKey: detectionOccurrenceKey(packId, anchorPath),
		occurrenceAnchorPath: anchorPath,
		occurrenceStatus: status,
		relation: 'member',
	};
}

function occurrenceHitMap(input: {
	actionable: AnnotatedHit[];
	other?: AnnotatedHit[];
}): CrossPackHitMap {
	const actionableHitsByPath = groupHits(input.actionable);
	const allEvidenceHitsByPath = groupHits([...input.actionable, ...(input.other ?? [])]);
	return {
		allSignals: [],
		hitsByPath: actionableHitsByPath,
		allEvidenceSignals: [],
		actionableSignals: [],
		actionableHitsByPath,
		allEvidenceHitsByPath,
	};
}

function groupHits(hits: AnnotatedHit[]): Map<string, AnnotatedHit[]> {
	const grouped = new Map<string, AnnotatedHit[]>();
	for (const hit of hits) {
		const existing = grouped.get(hit.folderPath);
		if (existing) existing.push(hit);
		else grouped.set(hit.folderPath, [hit]);
	}
	return grouped;
}

function deployment(packId: string, anchorPath: string) {
	return {
		packId,
		anchorPath,
		occurrenceKey: detectionOccurrenceKey(packId, anchorPath),
	};
}

describe('buildScopePackPlan', () => {
	test('preserves distinct explicit instance anchors and removes exact duplicates', () => {
		const input = [
			{ packId: 'jd', anchorPath: 'Projects/Web' },
			{ packId: 'para', anchorPath: 'Work/Projects' },
			{ packId: 'jd', anchorPath: 'Projects' },
			{ packId: 'para', anchorPath: 'Work' },
			{ packId: 'jd', anchorPath: 'Projects' },
		];

		const plan = buildScopePackPlan(input);

		expect(plan.scopePaths).toEqual([
			'Projects',
			'Work',
			'Projects/Web',
			'Work/Projects',
		]);
		expect(plan.deployments).toEqual([
			deployment('jd', 'Projects'),
			deployment('para', 'Work'),
			deployment('jd', 'Projects/Web'),
			deployment('para', 'Work/Projects'),
		]);
		// Pure: callers retain their original request order and objects.
		expect(input.map((request) => request.anchorPath)).toEqual([
			'Projects/Web',
			'Work/Projects',
			'Projects',
			'Work',
			'Projects',
		]);
	});

	test('root and nested explicit instances of the same pack remain independent', () => {
		const plan = buildScopePackPlan({
			placements: [
				{ packId: 'jd', anchorPath: 'Projects' },
				{ packId: 'jd', anchorPath: '' },
				{ packId: 'jd', anchorPath: 'Areas/Health' },
			],
		});

		expect(plan.scopePaths).toEqual(['', 'Projects', 'Areas/Health']);
		expect(plan.deployments).toEqual([
			deployment('jd', ''),
			deployment('jd', 'Projects'),
			deployment('jd', 'Areas/Health'),
		]);
	});

	test('keeps root placements independent across packs and removes duplicates', () => {
		const plan = buildScopePackPlan([
			{ packId: 'para', anchorPath: '' },
			{ packId: 'jd', anchorPath: '' },
			{ packId: 'para', anchorPath: '' },
		]);

		expect(plan.scopePaths).toEqual(['']);
		expect(plan.deployments).toEqual([
			deployment('jd', ''),
			deployment('para', ''),
		]);
	});

	test('resolves surfaced pack instances with hits at-or-under an ancestor scope', () => {
		const plan = buildScopePackPlan({
			selectedPaths: ['Projects'],
			hitMap: hitMap([
				['Projects/01 - Active', ['jd', 'para']],
				['Projects/Archive', ['para']],
				['Areas/Health', ['gtd']],
			]),
		});

		expect(plan.scopePaths).toEqual(['Projects']);
		expect(plan.deployments).toEqual([
			deployment('jd', 'Projects'),
			deployment('para', 'Projects'),
		]);
	});

	test('direct signal selection deploys at the detected instance parent', () => {
		const plan = buildScopePackPlan({
			selectedPaths: ['Projects'],
			hitMap: hitMap([
				['Projects', ['para']],
				['Areas', ['para']],
			]),
		});

		expect(plan.scopePaths).toEqual(['Projects']);
		expect(plan.deployments).toEqual([deployment('para', '')]);
	});

	test('reduces parent and child selections before resolving detected instances', () => {
		const plan = buildScopePackPlan({
			selectedPaths: ['Projects/Web', 'Projects', 'Areas'],
			hitMap: hitMap([
				['Projects/Web/01 - Active', ['jd']],
				['Areas/Projects', ['para']],
			]),
		});

		expect(plan.scopePaths).toEqual(['Areas', 'Projects']);
		expect(plan.deployments).toEqual([
			deployment('para', 'Areas'),
			deployment('jd', 'Projects/Web'),
		]);
	});

	test('vault root resolves every surfaced detected instance', () => {
		const plan = buildScopePackPlan({
			selectedPaths: ['', 'Projects'],
			hitMap: hitMap([
				['Projects/01 - Active', ['jd']],
				['Areas/Projects', ['para']],
				['Projects/Nested/01 - Again', ['jd']],
			]),
		});

		expect(plan.scopePaths).toEqual(['']);
		expect(plan.deployments).toEqual([
			deployment('para', 'Areas'),
			deployment('jd', 'Projects'),
			deployment('jd', 'Projects/Nested'),
		]);
	});

	test('keeps an empty selected branch but produces no deployment without hits', () => {
		const plan = buildScopePackPlan({
			selectedPaths: ['Unmatched'],
			hitMap: hitMap([['Projects', ['para']]]),
		});

		expect(plan.scopePaths).toEqual(['Unmatched']);
		expect(plan.deployments).toEqual([]);
	});

	test('uses occurrence anchors and identities instead of deriving placement from each hit', () => {
		const occurrenceKey = detectionOccurrenceKey('para', 'Work');
		const plan = buildScopePackPlan({
			selectedPaths: ['Work/Projects'],
			hitMap: occurrenceHitMap({
				actionable: [
					occurrenceHit('Work/Projects', 'para', 'Work', 'actionable', 0),
					occurrenceHit('Work/Areas', 'para', 'Work', 'actionable', 1),
				],
			}),
		});

		expect(plan.deployments).toEqual([{
			packId: 'para',
			anchorPath: 'Work',
			occurrenceKey,
		}]);
	});

	test('does not deploy incomplete or suppressed occurrence evidence', () => {
		const plan = buildScopePackPlan({
			selectedPaths: [''],
			hitMap: occurrenceHitMap({
				// Deliberately poison the actionable map to pin the planner's own
				// occurrence-status boundary rather than trusting upstream filtering.
				actionable: [
					occurrenceHit('Teams/Good/Projects', 'para', 'Teams/Good', 'actionable', 0),
					occurrenceHit('Teams/Partial/Projects', 'para', 'Teams/Partial', 'incomplete', 1),
					occurrenceHit('Teams/Blocked/Projects', 'para', 'Teams/Blocked', 'suppressed', 2),
				],
			}),
		});

		expect(plan.deployments).toEqual([{
			packId: 'para',
			anchorPath: 'Teams/Good',
			occurrenceKey: detectionOccurrenceKey('para', 'Teams/Good'),
		}]);
	});

	test('preserves repeated actionable occurrences of the same pack exactly', () => {
		const plan = buildScopePackPlan({
			selectedPaths: [''],
			hitMap: occurrenceHitMap({
				actionable: [
					occurrenceHit('Teams/Acme/Projects', 'para', 'Teams/Acme', 'actionable', 0),
					occurrenceHit('Teams/Beta/Projects', 'para', 'Teams/Beta', 'actionable', 1),
				],
			}),
		});

		expect(plan.deployments).toEqual([
			{
				packId: 'para',
				anchorPath: 'Teams/Acme',
				occurrenceKey: detectionOccurrenceKey('para', 'Teams/Acme'),
			},
			{
				packId: 'para',
				anchorPath: 'Teams/Beta',
				occurrenceKey: detectionOccurrenceKey('para', 'Teams/Beta'),
			},
		]);
	});
});
