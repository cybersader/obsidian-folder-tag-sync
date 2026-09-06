import { describe, expect, test } from 'bun:test';
import type { AnnotatedTree, AnnotatedTreeNode } from '../../engine/detectionTree';
import {
	createDefaultWorkbenchMapPresentationState,
	defaultExpandedPaths,
	reconcileWorkbenchMapPresentationState,
	setPathExpanded,
} from './workbenchMapPresentation';

function node(fullPath: string, children: AnnotatedTreeNode[] = []): AnnotatedTreeNode {
	return {
		name: fullPath.split('/').at(-1) ?? '',
		fullPath,
		children: new Map(children.map((child) => [child.name, child])),
		hits: [],
		elidedChildCount: 0,
	};
}

function tree(...children: AnnotatedTreeNode[]): AnnotatedTree {
	return {
		root: node('', children),
		totalHitFolders: 0,
		totalVaultFolders: children.length,
	};
}

describe('Workbench Map presentation state', () => {
	test('initializes without persisting geometry in Workbench domain state', () => {
		expect(createDefaultWorkbenchMapPresentationState()).toEqual({
			expandedPaths: null,
			expandedRelationPaths: [],
			scrollTop: 0,
			focusPath: null,
		});
	});

	test('derives the existing depth-based default exactly once', () => {
		const input = tree(
			node('A', [node('A/B', [node('A/B/C')])]),
			node('Z'),
		);
		expect(defaultExpandedPaths(input, 2)).toEqual(['A', 'A/B']);
		expect(defaultExpandedPaths(input, 1)).toEqual(['A']);
	});

	test('reconciles deleted paths and invalid scroll values', () => {
		expect(reconcileWorkbenchMapPresentationState({
			expandedPaths: ['kept', 'deleted', 'kept'],
			expandedRelationPaths: ['deleted', 'kept'],
			scrollTop: Number.NaN,
			focusPath: 'deleted',
		}, ['kept'])).toEqual({
			expandedPaths: ['kept'],
			expandedRelationPaths: ['kept'],
			scrollTop: 0,
			focusPath: null,
		});
	});

	test('adds and removes expansion paths without duplicates', () => {
		expect(setPathExpanded(['B', 'A'], 'C', true)).toEqual(['A', 'B', 'C']);
		expect(setPathExpanded(['A', 'B'], 'A', false)).toEqual(['B']);
	});
});
