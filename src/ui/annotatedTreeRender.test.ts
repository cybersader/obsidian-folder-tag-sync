/**
 * Unit tests for `analyzeSystemStacks` — the pure pre-pass that turns the
 * cross-pack annotated tree into per-folder OUTER→INNER system rail stacks.
 *
 * This is the math behind the Map's swimlane rails (which organizational
 * systems apply to a folder, and in what nesting order). It is DOM-free, so
 * we exercise it directly against hand-built `AnnotatedTreeNode` trees.
 */

import { describe, expect, test } from 'bun:test';
import { analyzeSystemStacks } from './annotatedTreeRender';
import { colorForSignalIndex, type AnnotatedHit, type AnnotatedTreeNode } from '../engine/detectionTree';

let globalIdx = 0;
function hit(packId: string, packName: string, folderPath: string): AnnotatedHit {
	const idx = globalIdx++;
	return {
		folderPath,
		signal: {
			packId,
			packName,
			signalIndex: 0,
			globalIndex: idx,
			label: `${packName} signal`,
			regex: '.*',
			scope: 'name',
		},
	};
}

function node(name: string, fullPath: string, hits: AnnotatedHit[]): AnnotatedTreeNode {
	return { name, fullPath, children: new Map(), hits, elidedChildCount: 0 };
}

function child(parent: AnnotatedTreeNode, n: AnnotatedTreeNode): AnnotatedTreeNode {
	parent.children.set(n.name, n);
	return n;
}

function root(): AnnotatedTreeNode {
	return node('', '', []);
}

describe('analyzeSystemStacks', () => {
	test('PARA nested inside JD: child stack is [JD, PARA], parent is [JD]', () => {
		globalIdx = 0;
		const r = root();
		// 10 - Work matched JD only; Projects (under it) matched PARA.
		const work = child(r, node('10 - Work', '10 - Work', [hit('jd', 'Johnny Decimal', '10 - Work')]));
		child(work, node('Projects', '10 - Work/Projects', [hit('para', 'PARA', '10 - Work/Projects')]));

		const { stacksByPath, maxDepth } = analyzeSystemStacks(r);

		const workStack = stacksByPath.get('10 - Work')!.map((s) => s.packId);
		const projStack = stacksByPath.get('10 - Work/Projects')!.map((s) => s.packId);
		expect(workStack).toEqual(['jd']);
		// Outer (ancestor JD) first, inner (this folder's PARA) last.
		expect(projStack).toEqual(['jd', 'para']);
		expect(maxDepth).toBe(2);
	});

	test('a system de-dupes to its OUTERMOST matching depth', () => {
		globalIdx = 0;
		const r = root();
		// JD matches at the root folder AND again on a descendant.
		const a = child(r, node('A', 'A', [hit('jd', 'Johnny Decimal', 'A')]));
		const b = child(a, node('B', 'A/B', []));
		child(b, node('C', 'A/B/C', [hit('jd', 'Johnny Decimal', 'A/B/C')]));

		const { stacksByPath, maxDepth } = analyzeSystemStacks(r);

		// JD appears once on every node in the lane — never stacked twice.
		expect(stacksByPath.get('A')!.map((s) => s.packId)).toEqual(['jd']);
		expect(stacksByPath.get('A/B')!.map((s) => s.packId)).toEqual(['jd']); // inherited through B
		expect(stacksByPath.get('A/B/C')!.map((s) => s.packId)).toEqual(['jd']);
		expect(maxDepth).toBe(1);
	});

	test('two systems matched on the same folder both rail, ordered by index', () => {
		globalIdx = 0;
		const r = root();
		// Folder matches PARA (idx 0) then JD (idx 1) — order by representative index.
		child(r, node('01 - Projects', '01 - Projects', [
			hit('para', 'PARA', '01 - Projects'),
			hit('jd', 'Johnny Decimal', '01 - Projects'),
		]));

		const { stacksByPath, maxDepth } = analyzeSystemStacks(r);
		expect(stacksByPath.get('01 - Projects')!.map((s) => s.packId)).toEqual(['para', 'jd']);
		expect(maxDepth).toBe(2);
	});

	test('colour is stable per pack across rows (lowest signal index wins)', () => {
		globalIdx = 0;
		const r = root();
		const a = child(r, node('A', 'A', [hit('jd', 'Johnny Decimal', 'A')]));
		child(a, node('B', 'A/B', [hit('jd', 'Johnny Decimal', 'A/B')]));

		const { stacksByPath, colorByPackId } = analyzeSystemStacks(r);
		const aColor = stacksByPath.get('A')![0].color;
		const bColor = stacksByPath.get('A/B')![0].color;
		expect(aColor).toBe(bColor);
		// JD's representative index is 0 (its lowest globalIndex).
		expect(colorByPackId.get('jd')).toBe(colorForSignalIndex(0));
	});

	test('ancestor-only structure inherits the lane but adds nothing', () => {
		globalIdx = 0;
		const r = root();
		const work = child(r, node('Work', 'Work', [hit('jd', 'Johnny Decimal', 'Work')]));
		const mid = child(work, node('Mid', 'Work/Mid', [])); // no hits of its own
		child(mid, node('Projects', 'Work/Mid/Projects', [hit('para', 'PARA', 'Work/Mid/Projects')]));

		const { stacksByPath } = analyzeSystemStacks(r);
		expect(stacksByPath.get('Work/Mid')!.map((s) => s.packId)).toEqual(['jd']);
		expect(stacksByPath.get('Work/Mid/Projects')!.map((s) => s.packId)).toEqual(['jd', 'para']);
	});

	test('no hits anywhere yields empty stacks and zero depth', () => {
		globalIdx = 0;
		const r = root();
		const a = child(r, node('A', 'A', []));
		child(a, node('B', 'A/B', []));

		const { stacksByPath, maxDepth } = analyzeSystemStacks(r);
		// Nodes with no applicable system get no stack entry (or an empty one).
		expect(stacksByPath.get('A') ?? []).toEqual([]);
		expect(maxDepth).toBe(0);
	});
});
