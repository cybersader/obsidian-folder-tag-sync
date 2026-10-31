import { describe, expect, test } from 'bun:test';
import type { CandidateRow } from '../../engine/scanAndSnapPlan';
import type { MappingRule } from '../../types/settings';
import {
	getCandidateDirectionalStatus,
	type CandidateDirectionalStatus,
} from './candidateDirectionStatus';

const OPTIONS: MappingRule['options'] = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: false,
	syncOnFileMove: false,
	syncOnFileRename: false,
};

function candidate(
	rule: Partial<MappingRule>,
	bijectivity: CandidateRow['bijectivity'],
): Pick<CandidateRow, 'rule' | 'bijectivity'> {
	return {
		rule: {
			id: 'invented-rule',
			name: 'Invented rule',
			enabled: false,
			priority: 100,
			direction: 'bidirectional',
			options: OPTIONS,
			...rule,
		},
		bijectivity,
	};
}

function states(status: CandidateDirectionalStatus): [string, string] {
	return [status.folderToTag.status, status.tagToFolder.status];
}

describe('getCandidateDirectionalStatus', () => {
	test('marks a configured exact direction without implying the other direction runs', () => {
		const result = getCandidateDirectionalStatus(candidate({
			direction: 'folder-to-tag',
		}, 'total'));

		expect(states(result)).toEqual(['exact', 'unavailable']);
		expect(result.folderToTag).toEqual({
			status: 'exact',
			label: 'Exact',
			detail: 'Folders produce tags with an exact round trip.',
		});
		expect(result.tagToFolder.detail).toBe(
			'This proposed rule does not run from tags to folders.',
		);
	});

	test('uses template details to distinguish conditional forward conversion from an available inverse', () => {
		const result = getCandidateDirectionalStatus(candidate({
			folderTemplate: 'Projects/{topic}',
			tagTemplate: '#projects/{topic | kebab-case}',
		}, 'conditional'));

		expect(states(result)).toEqual(['conditional', 'available']);
		expect(result.folderToTag.detail).toBe(
			'Folders produce tags, but exact round trips depend on the input.',
		);
		expect(result.tagToFolder.detail).toBe(
			'Tags produce folders; current evidence does not identify this direction as lossy.',
		);
	});

	test('reports folder-only template data as forward loss and unavailable reconstruction', () => {
		const result = getCandidateDirectionalStatus(candidate({
			folderTemplate: 'Projects/{topic}/{detail}',
			tagTemplate: '#projects/{topic}',
		}, 'lossy'));

		expect(states(result)).toEqual(['lossy', 'unavailable']);
		expect(result.folderToTag.detail).toBe(
			'Folders produce tags, but folder-only information is dropped.',
		);
		expect(result.tagToFolder.detail).toBe(
			'Tags cannot reconstruct the folder-only information this rule requires.',
		);
	});

	test('reports tag-only template data as unavailable forward input and inverse loss', () => {
		const result = getCandidateDirectionalStatus(candidate({
			folderTemplate: 'Projects/{topic}',
			tagTemplate: '#{owner}/projects/{topic}',
		}, 'lossy'));

		expect(states(result)).toEqual(['unavailable', 'lossy']);
		expect(result.folderToTag.detail).toBe(
			'Folders cannot supply the tag-only information this rule requires.',
		);
		expect(result.tagToFolder.detail).toBe(
			'Tags produce folders, but tag-only information is dropped.',
		);
	});

	test('uses direction-specific typed transfers instead of applying one lossy verdict to both sides', () => {
		const result = getCandidateDirectionalStatus(candidate({
			transfer: { op: 'marker-only', marker: 'inbox' },
			inverseTransfer: { op: 'identity' },
			cardinality: 'many:1',
			bijective: false,
		}, 'lossy'));

		expect(states(result)).toEqual(['lossy', 'available']);
	});

	test('does not invent a loss direction from a bare non-bijective flag', () => {
		const result = getCandidateDirectionalStatus(candidate({
			bijective: false,
		}, 'lossy'));

		expect(states(result)).toEqual(['uncertain', 'uncertain']);
		expect(result.folderToTag.detail).toBe(
			'Folder to tag is available, but the current data does not identify whether this direction causes the lossy round trip.',
		);
		expect(result.tagToFolder.detail).toBe(
			'Tag to folder is available, but the current data does not identify whether this direction causes the lossy round trip.',
		);
	});

	test('keeps raw rules uncertain when no reversibility evidence exists', () => {
		const result = getCandidateDirectionalStatus(candidate({
			folderPattern: '^Projects(?:/|$)',
			tagPattern: '^#projects(?:/|$)',
		}, 'unknown'));

		expect(states(result)).toEqual(['uncertain', 'uncertain']);
	});
});
