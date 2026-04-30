/**
 * Tests for buildDetectionTree — the sparse hit-tree builder powering the
 * "show me where this pack detected things" UI.
 *
 * Coverage:
 *   - Hit folders + their ancestors survive the tree
 *   - Folders with no hits in their subtree get elided (counted, not rendered)
 *   - Multi-signal hits on the same folder collect all signals
 *   - Emoji + JD-prefix folders match against semantic signals
 *   - Path-scope vs leafName-scope signals
 *   - Empty / no-hit cases produce a tree-only-with-root
 */

import { describe, expect, test } from 'bun:test';
import { buildDetectionTree, colorForSignalIndex } from './detectionTree';
import type { DetectionResult } from './detectPacks';

function makeResult(signals: Array<{
	folderRegex: string;
	scope?: 'name' | 'path' | 'leafName';
	label?: string;
}>): DetectionResult {
	return {
		packId: 'test',
		score: 1,
		signalsHit: signals.length,
		minSignals: 1,
		matchedSignals: signals.map((s) => ({
			folderRegex: s.folderRegex,
			scope: s.scope ?? 'name',
			label: s.label,
			exampleMatches: [], // not used by tree builder
		})),
	};
}

describe('buildDetectionTree — basic hit + ancestor inclusion', () => {
	test('keeps hit folders and all their ancestors', () => {
		const folders = [
			'Projects',
			'Projects/Web',
			'Projects/Web/Auth',
			'Areas',
			'Areas/Health',
			'Templates',
		];
		const result = makeResult([{ folderRegex: '^Auth$', label: 'auth folder' }]);
		const tree = buildDetectionTree(folders, result);

		expect(tree.totalHitFolders).toBe(1);
		expect(tree.root.children.has('Projects')).toBe(true);
		// Areas + Templates do not contain hits → elided at root
		expect(tree.root.children.has('Areas')).toBe(false);
		expect(tree.root.children.has('Templates')).toBe(false);
		expect(tree.root.elidedChildCount).toBe(2); // Areas + Templates

		// Path back to hit is intact
		const projects = tree.root.children.get('Projects')!;
		expect(projects.hits.length).toBe(0); // ancestor only
		expect(projects.children.has('Web')).toBe(true);
		const web = projects.children.get('Web')!;
		expect(web.hits.length).toBe(0);
		const auth = web.children.get('Auth')!;
		expect(auth.hits.length).toBe(1);
		expect(auth.hits[0].signalLabel).toBe('auth folder');
	});

	test('multiple hits at different depths each surface', () => {
		const folders = [
			'Projects',
			'Projects/Web',
			'Projects/Mobile',
			'Areas',
			'Areas/Health',
		];
		const result = makeResult([
			{ folderRegex: '^Projects$', label: 'projects' },
			{ folderRegex: '^Areas$', label: 'areas' },
		]);
		const tree = buildDetectionTree(folders, result);

		expect(tree.totalHitFolders).toBe(2);
		const projects = tree.root.children.get('Projects')!;
		expect(projects.hits.length).toBe(1);
		expect(projects.hits[0].signalLabel).toBe('projects');
		// Web + Mobile have no hits and no descendants with hits → elided
		expect(projects.children.size).toBe(0);
		expect(projects.elidedChildCount).toBe(2);
	});

	test('multiple signals matching one folder collects all of them', () => {
		const folders = ['Projects'];
		const result = makeResult([
			{ folderRegex: '^Projects$', label: 'A' },
			{ folderRegex: '^P', label: 'B' },
		]);
		const tree = buildDetectionTree(folders, result);
		const projects = tree.root.children.get('Projects')!;
		expect(projects.hits.length).toBe(2);
		// signalIndex preserves position in matchedSignals — used for colour
		expect(projects.hits.map((h) => h.signalIndex).sort()).toEqual([0, 1]);
	});
});

describe('buildDetectionTree — elision', () => {
	test('siblings of a hit folder without their own hits are elided', () => {
		const folders = [
			'Projects',
			'Projects/Web',
			'Projects/Mobile',
			'Projects/Archive',
			'Projects/Archive/Old',
		];
		const result = makeResult([{ folderRegex: '^Web$', label: 'web' }]);
		const tree = buildDetectionTree(folders, result);
		const projects = tree.root.children.get('Projects')!;
		// Only Web survives; Mobile + Archive elided
		expect([...projects.children.keys()]).toEqual(['Web']);
		expect(projects.elidedChildCount).toBe(2); // Mobile + Archive
	});

	test('non-hit subtrees with no hit-descendants are elided', () => {
		// Realistic vault enumeration includes every intermediate folder. The
		// caller (collectVaultFolders) walks the tree and emits every TFolder.
		const folders = [
			'A',
			'A/B',
			'A/B/C',
			'A/B/C/D',
			'A/B/E',
			'A/B/E/F', // hit
			'A/B/E/G',
			'X',
			'X/Y',
			'X/Y/Z',
		];
		const result = makeResult([{ folderRegex: '^F$', label: 'f' }]);
		const tree = buildDetectionTree(folders, result);
		// Only A/B/E/F path survives
		const a = tree.root.children.get('A')!;
		expect(a.elidedChildCount).toBe(0); // A's only child B is kept
		const b = a.children.get('B')!;
		expect([...b.children.keys()]).toEqual(['E']);
		expect(b.elidedChildCount).toBe(1); // C elided (no hit in subtree)
		const e = b.children.get('E')!;
		expect([...e.children.keys()]).toEqual(['F']);
		expect(e.elidedChildCount).toBe(1); // G elided
		// X/Y/Z branch is fully gone
		expect(tree.root.children.has('X')).toBe(false);
		expect(tree.root.elidedChildCount).toBe(1); // X elided at root
	});

	test('elided count is per-node, not cumulative', () => {
		const folders = [
			'A',
			'A/B',
			'A/C',
			'A/D',
		];
		const result = makeResult([{ folderRegex: '^B$', label: 'b' }]);
		const tree = buildDetectionTree(folders, result);
		const a = tree.root.children.get('A')!;
		// A is kept (ancestor of hit B); C and D are elided
		expect(a.elidedChildCount).toBe(2);
	});
});

describe('buildDetectionTree — emoji + JD prefix normalization', () => {
	test('semantic regex matches emoji+JD-prefixed folders', () => {
		const folders = [
			'📁 01 - Projects',
			'📁 01 - Projects/Web',
			'⬇️ INBOX',
		];
		const result = makeResult([{ folderRegex: '^Projects$', label: 'projects' }]);
		const tree = buildDetectionTree(folders, result);
		expect(tree.totalHitFolders).toBe(1);
		const proj = tree.root.children.get('📁 01 - Projects')!;
		expect(proj.hits[0].signalLabel).toBe('projects');
	});

	test('inbox emoji folder matches `^INBOX$`', () => {
		const folders = ['⬇️ INBOX'];
		const result = makeResult([{ folderRegex: '^INBOX$', label: 'inbox' }]);
		const tree = buildDetectionTree(folders, result);
		expect(tree.totalHitFolders).toBe(1);
	});
});

describe('buildDetectionTree — scope handling', () => {
	test('path-scoped signal matches against full path', () => {
		const folders = [
			'Output/Projects',
			'Projects', // top-level should NOT match a path-scope `^Output/`
		];
		const result = makeResult([
			{ folderRegex: '^Output/', scope: 'path', label: 'output-path' },
		]);
		const tree = buildDetectionTree(folders, result);
		expect(tree.totalHitFolders).toBe(1);
		// The Output/Projects path should be in the tree
		const output = tree.root.children.get('Output')!;
		expect(output.children.has('Projects')).toBe(true);
		const op = output.children.get('Projects')!;
		expect(op.hits.length).toBe(1);
		// Top-level Projects has no path-scope match
		expect(tree.root.children.has('Projects')).toBe(false);
	});

	test('leafName-scoped signal matches against last segment only', () => {
		const folders = [
			'Output',
			'Output/Projects',
			'Areas',
			'Areas/Projects',
			'Areas/Projects/Subnotes',
		];
		const result = makeResult([
			{ folderRegex: '^Projects$', scope: 'leafName', label: 'leaf-projects' },
		]);
		const tree = buildDetectionTree(folders, result);
		// Output/Projects and Areas/Projects both have leaf "Projects" → 2 hits.
		// Areas/Projects/Subnotes has leaf "Subnotes" → not a hit.
		expect(tree.totalHitFolders).toBe(2);
	});
});

describe('buildDetectionTree — empty / no-hit cases', () => {
	test('zero hits returns root with elidedChildCount only', () => {
		const folders = ['Projects', 'Areas', 'Templates'];
		const result = makeResult([{ folderRegex: '^Nope$', label: 'nope' }]);
		const tree = buildDetectionTree(folders, result);
		expect(tree.totalHitFolders).toBe(0);
		expect(tree.root.children.size).toBe(0);
		expect(tree.root.elidedChildCount).toBe(3);
	});

	test('empty folder list produces empty tree', () => {
		const result = makeResult([{ folderRegex: '^X$', label: 'x' }]);
		const tree = buildDetectionTree([], result);
		expect(tree.totalHitFolders).toBe(0);
		expect(tree.totalVaultFolders).toBe(0);
		expect(tree.root.children.size).toBe(0);
	});
});

describe('colorForSignalIndex', () => {
	test('returns a CSS-parseable HSL string', () => {
		const c = colorForSignalIndex(0);
		expect(c).toMatch(/^hsl\(\d+, 65%, 55%\)$/);
	});

	test('different indices produce different colours', () => {
		const c0 = colorForSignalIndex(0);
		const c1 = colorForSignalIndex(1);
		const c2 = colorForSignalIndex(2);
		expect(c0).not.toBe(c1);
		expect(c1).not.toBe(c2);
		expect(c0).not.toBe(c2);
	});

	test('same index produces same colour (deterministic)', () => {
		expect(colorForSignalIndex(5)).toBe(colorForSignalIndex(5));
	});
});
