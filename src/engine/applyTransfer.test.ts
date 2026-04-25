import { describe, expect, test } from 'bun:test';
import { applyTransfer, splitSegments } from './applyTransfer';
import type { TransferOp } from '../types/typed';

describe('splitSegments', () => {
	test('splits a typical path', () => {
		expect(splitSegments('Web/Tutorials/React')).toEqual(['Web', 'Tutorials', 'React']);
	});
	test('drops leading and trailing slashes', () => {
		expect(splitSegments('/a/b/')).toEqual(['a', 'b']);
	});
	test('empty string → empty list', () => {
		expect(splitSegments('')).toEqual([]);
	});
	test('single segment', () => {
		expect(splitSegments('only')).toEqual(['only']);
	});
});

describe('applyTransfer — identity', () => {
	test('preserves segment list unchanged', () => {
		const r = applyTransfer(['a', 'b', 'c'], { op: 'identity' });
		expect(r.segmentLists).toEqual([['a', 'b', 'c']]);
		expect(r.lossy).toBe(false);
		expect(r.emptyByDesign).toBe(false);
	});
});

describe('applyTransfer — truncation', () => {
	const segments = ['Web', 'Tutorials', 'React', 'Hooks'];

	test("tailHandling: 'drop' truncates and discards tail", () => {
		const r = applyTransfer(segments, { op: 'truncation', depth: 2, tailHandling: 'drop' });
		expect(r.segmentLists).toEqual([['Web', 'Tutorials']]);
		expect(r.lossy).toBe(true); // deeper info was dropped
	});

	test("tailHandling: 'drop' is non-lossy when source is already at depth", () => {
		const r = applyTransfer(['Web', 'Tutorials'], { op: 'truncation', depth: 2, tailHandling: 'drop' });
		expect(r.segmentLists).toEqual([['Web', 'Tutorials']]);
		expect(r.lossy).toBe(false);
	});

	test("tailHandling: 'aggregate' joins tail with separator into (N+1)th segment", () => {
		const r = applyTransfer(segments, {
			op: 'truncation',
			depth: 2,
			tailHandling: 'aggregate',
			separator: '-',
		});
		expect(r.segmentLists).toEqual([['Web', 'Tutorials', 'React-Hooks']]);
		expect(r.lossy).toBe(true);
	});

	test("tailHandling: 'aggregate' — the user's documented compound case", () => {
		// File: Capture/Clips/Web/Tutorials/React/Hooks/intro.md
		// After entry-strip ("Capture/Clips/"): "Web/Tutorials/React/Hooks"
		const r = applyTransfer(['Web', 'Tutorials', 'React', 'Hooks'], {
			op: 'truncation',
			depth: 2,
			tailHandling: 'aggregate',
			separator: '-',
		});
		// Depth 2 preserved (Web, Tutorials), tail aggregated (React-Hooks)
		expect(r.segmentLists).toEqual([['Web', 'Tutorials', 'React-Hooks']]);
	});

	test("tailHandling: 'aggregate' uses '-' when separator omitted", () => {
		const r = applyTransfer(['a', 'b', 'c', 'd'], {
			op: 'truncation',
			depth: 1,
			tailHandling: 'aggregate',
		});
		expect(r.segmentLists).toEqual([['a', 'b-c-d']]);
	});

	test("tailHandling: 'flatten' replaces tail with leaf only", () => {
		const r = applyTransfer(segments, { op: 'truncation', depth: 2, tailHandling: 'flatten' });
		expect(r.segmentLists).toEqual([['Web', 'Tutorials', 'Hooks']]); // ancestry between 2 and leaf is dropped
		expect(r.lossy).toBe(true);
	});

	test('does not over-truncate when source has fewer than N segments', () => {
		const r = applyTransfer(['only'], { op: 'truncation', depth: 5, tailHandling: 'drop' });
		expect(r.segmentLists).toEqual([['only']]);
	});
});

describe('applyTransfer — marker-only', () => {
	test('emits the literal marker, ignoring source segments', () => {
		const r = applyTransfer(['Inbox', 'today'], { op: 'marker-only', marker: '-inbox' });
		expect(r.segmentLists).toEqual([['-inbox']]);
		expect(r.lossy).toBe(true);
	});

	test('still emits the marker when source is empty', () => {
		const r = applyTransfer([], { op: 'marker-only', marker: '/template' });
		expect(r.segmentLists).toEqual([['/template']]);
	});
});

describe('applyTransfer — promotion-to-root', () => {
	test('keeps only the first segment', () => {
		const r = applyTransfer(['Q4-Roadmap', 'kickoff', 'notes'], { op: 'promotion-to-root' });
		expect(r.segmentLists).toEqual([['Q4-Roadmap']]);
		expect(r.lossy).toBe(true);
	});
	test('empty source → empty segment list', () => {
		const r = applyTransfer([], { op: 'promotion-to-root' });
		expect(r.segmentLists).toEqual([[]]);
	});
});

describe('applyTransfer — flattening-to-leaf', () => {
	test('keeps only the last segment', () => {
		const r = applyTransfer(['a', 'b', 'leaf'], { op: 'flattening-to-leaf' });
		expect(r.segmentLists).toEqual([['leaf']]);
		expect(r.lossy).toBe(true);
	});
});

describe('applyTransfer — aggregation', () => {
	test('joins all segments with separator into one', () => {
		const r = applyTransfer(['Web', 'Tutorials', 'React'], { op: 'aggregation', separator: '-' });
		expect(r.segmentLists).toEqual([['Web-Tutorials-React']]);
		expect(r.lossy).toBe(true);
	});

	test('respects custom separator', () => {
		const r = applyTransfer(['a', 'b', 'c'], { op: 'aggregation', separator: '_' });
		expect(r.segmentLists).toEqual([['a_b_c']]);
	});
});

describe('applyTransfer — post-coordination', () => {
	test('emits N independent single-segment lists', () => {
		const r = applyTransfer(['Research', 'Attention', '2024-Q4'], { op: 'post-coordination' });
		expect(r.segmentLists).toEqual([['Research'], ['Attention'], ['2024-Q4']]);
		expect(r.lossy).toBe(true); // hierarchy lost
	});

	test('empty source → empty list of lists', () => {
		const r = applyTransfer([], { op: 'post-coordination' });
		expect(r.segmentLists).toEqual([]);
	});
});

describe('applyTransfer — opaque', () => {
	test('emits no segment lists', () => {
		const r = applyTransfer(['anything', 'here'], { op: 'opaque' });
		expect(r.segmentLists).toEqual([]);
		expect(r.emptyByDesign).toBe(true);
	});
});

describe('exhaustive: every TransferOp case is handled (no fallthrough)', () => {
	const cases: TransferOp[] = [
		{ op: 'identity' },
		{ op: 'truncation', depth: 1, tailHandling: 'drop' },
		{ op: 'truncation', depth: 1, tailHandling: 'aggregate', separator: '-' },
		{ op: 'truncation', depth: 1, tailHandling: 'flatten' },
		{ op: 'marker-only', marker: 'm' },
		{ op: 'promotion-to-root' },
		{ op: 'flattening-to-leaf' },
		{ op: 'aggregation', separator: '-' },
		{ op: 'post-coordination' },
		{ op: 'opaque' },
	];

	for (const op of cases) {
		test(`${op.op}${'tailHandling' in op ? `:${op.tailHandling}` : ''} returns a defined result`, () => {
			const r = applyTransfer(['a', 'b'], op);
			expect(r).toBeDefined();
			expect(Array.isArray(r.segmentLists)).toBe(true);
			expect(typeof r.lossy).toBe('boolean');
			expect(typeof r.emptyByDesign).toBe('boolean');
		});
	}
});
