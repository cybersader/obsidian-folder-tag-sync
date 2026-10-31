import { describe, expect, test } from 'bun:test';
import type { AnnotatedHit } from '../engine/detectionTree';
import {
	collectOccurrenceRelations,
	compactOccurrenceRelations,
	type OccurrenceRelationDescriptor,
} from './annotatedTreeRender';

function hit(options: {
	occurrenceKey?: string;
	relation?: 'member' | 'support';
	packId?: string;
	packName?: string;
	anchorPath?: string;
	signalIndex?: number;
}): AnnotatedHit {
	const signalIndex = options.signalIndex ?? 0;
	return {
		folderPath: 'Work/Projects',
		occurrenceKey: options.occurrenceKey,
		occurrenceAnchorPath: options.anchorPath,
		relation: options.relation,
		signal: {
			packId: options.packId ?? 'para',
			packName: options.packName ?? 'PARA',
			signalIndex,
			globalIndex: signalIndex,
			label: 'Projects',
			regex: '^Projects$',
			scope: 'name',
		},
	};
}

describe('collectOccurrenceRelations', () => {
	test('deduplicates alternative signals for the same occurrence and relation', () => {
		const relations = collectOccurrenceRelations([
			hit({ occurrenceKey: 'para-at-work', signalIndex: 0, anchorPath: 'Work' }),
			hit({ occurrenceKey: 'para-at-work', signalIndex: 1, anchorPath: 'Work' }),
		]);

		expect(relations).toEqual([{
			occurrenceKey: 'para-at-work',
			relation: 'member',
			packName: 'PARA',
			anchorPath: 'Work',
		}]);
	});

	test('keeps member and support relations distinct for one occurrence', () => {
		const relations = collectOccurrenceRelations([
			hit({ occurrenceKey: 'seacow-at-root', relation: 'member', packName: 'SEACOW' }),
			hit({ occurrenceKey: 'seacow-at-root', relation: 'support', packName: 'SEACOW' }),
		]);

		expect(relations.map((relation) => relation.relation)).toEqual(['member', 'support']);
	});

	test('keeps overlapping organizational-system occurrences', () => {
		const relations = collectOccurrenceRelations([
			hit({ occurrenceKey: 'para-at-work', anchorPath: 'Work' }),
			hit({
				occurrenceKey: 'jd-at-work',
				packId: 'jd',
				packName: 'Johnny Decimal',
				anchorPath: 'Work',
			}),
		]);

		expect(relations.map((relation) => relation.occurrenceKey)).toEqual([
			'para-at-work',
			'jd-at-work',
		]);
	});

	test('omits legacy hits without occurrence identity', () => {
		expect(collectOccurrenceRelations([
			hit({}),
			hit({ occurrenceKey: 'para-at-work', anchorPath: 'Work' }),
		])).toHaveLength(1);
	});
});

describe('compactOccurrenceRelations', () => {
	const relations: OccurrenceRelationDescriptor[] = [
		{
			occurrenceKey: 'jd-at-root',
			relation: 'member',
			packName: 'Johnny Decimal',
			anchorPath: '',
		},
		{
			occurrenceKey: 'enterprise-at-root',
			relation: 'member',
			packName: 'Enterprise JD vault',
			anchorPath: '',
		},
		{
			occurrenceKey: 'seacow-at-root',
			relation: 'support',
			packName: 'SEACOW',
			anchorPath: '',
		},
	];

	test('shows one exact relation plus a hidden-system count when collapsed', () => {
		expect(compactOccurrenceRelations(relations, 1, false)).toEqual({
			visible: [relations[0]],
			hiddenCount: 2,
		});
	});

	test('reveals every exact occurrence without changing source order', () => {
		const display = compactOccurrenceRelations(relations, 1, true);
		expect(display.hiddenCount).toBe(0);
		expect(display.visible.map((relation) => relation.occurrenceKey)).toEqual([
			'jd-at-root',
			'enterprise-at-root',
			'seacow-at-root',
		]);
	});

	test('keeps the selected exact occurrence visible in a collapsed row', () => {
		const display = compactOccurrenceRelations(
			relations,
			1,
			false,
			'enterprise-at-root',
		);
		expect(display.visible[0]?.occurrenceKey).toBe('enterprise-at-root');
		expect(display.hiddenCount).toBe(2);
	});
});
