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
import {
	buildAnnotatedTree,
	buildDetectionTree,
	buildInstanceTree,
	collectAnnotatedTreeFolders,
	collectCrossPackHits,
	colorForSignalIndex,
	extractInstances,
} from './detectionTree';
import {
	detectPacks,
	detectionOccurrenceKey,
	type DetectionResult,
	type ManifestPackEntry,
} from './detectPacks';

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

describe('extractInstances — anchored cluster grouping', () => {
	test('hits at root group into a single instance', () => {
		const folders = [
			'01 - Projects',
			'02 - Areas',
			'03 - Resources',
			'Templates',
		];
		const result = makeResult([{ folderRegex: '^\\d+\\s*-', label: 'jd-prefix' }]);
		const instances = extractInstances(folders, result);
		expect(instances.length).toBe(1);
		expect(instances[0].anchorPath).toBe('');
		expect(instances[0].hits.length).toBe(3);
	});

	test('JD at root + JD nested under entity → two instances', () => {
		// Realistic cyberbase vault: top-level JD numbering, plus another
		// JD numbering nested inside an entity-scoped subfolder.
		const folders = [
			'01 - Projects',
			'01 - Projects/Cybersader',
			'01 - Projects/Cybersader/01 - Active',
			'01 - Projects/Cybersader/02 - Archive',
			'01 - Projects/Cybersader/03 - Reference',
			'02 - Areas',
			'03 - Resources',
		];
		const result = makeResult([{ folderRegex: '^\\d+\\s*-', label: 'jd' }]);
		const instances = extractInstances(folders, result);
		// Two anchors: root (3 hits) and 01-Projects/Cybersader (3 hits)
		expect(instances.length).toBe(2);
		// Root instance first (depth ascending)
		expect(instances[0].anchorPath).toBe('');
		expect(instances[0].hits.length).toBe(3);
		expect(instances[1].anchorPath).toBe('01 - Projects/Cybersader');
		expect(instances[1].hits.length).toBe(3);
	});

	test('siblings under different parents → multiple instances', () => {
		const folders = [
			'A',
			'A/Projects',
			'B',
			'B/Projects',
		];
		const result = makeResult([{ folderRegex: '^Projects$', label: 'p' }]);
		const instances = extractInstances(folders, result);
		expect(instances.length).toBe(2);
		expect(instances.map((i) => i.anchorPath).sort()).toEqual(['A', 'B']);
	});

	test('signalIndices on instance reflects which signals fired there', () => {
		const folders = ['01 - Projects', '02 - Areas'];
		const result = makeResult([
			{ folderRegex: '^\\d', label: 'starts-with-digit' },
			{ folderRegex: 'Projects', label: 'projects' },
		]);
		const instances = extractInstances(folders, result);
		expect(instances.length).toBe(1);
		// Both signals fired (sig 0 on both folders, sig 1 only on Projects)
		expect(instances[0].signalIndices.sort()).toEqual([0, 1]);
	});

	test('zero hits → empty instance list', () => {
		const folders = ['Projects', 'Areas'];
		const result = makeResult([{ folderRegex: '^Nope$', label: 'nope' }]);
		const instances = extractInstances(folders, result);
		expect(instances).toEqual([]);
	});
});

describe('buildInstanceTree — nested-instance forest', () => {
	test('flat instances at same level → all at root of forest', () => {
		const folders = ['A', 'A/Projects', 'B', 'B/Projects'];
		const result = makeResult([{ folderRegex: '^Projects$', label: 'p' }]);
		const instances = extractInstances(folders, result);
		const tree = buildInstanceTree(instances);
		expect(tree.length).toBe(2); // both at top of forest
		expect(tree.every((n) => n.children.length === 0)).toBe(true);
	});

	test('JD-at-root + JD-nested → nested tree', () => {
		const folders = [
			'01 - Projects',
			'01 - Projects/Cybersader',
			'01 - Projects/Cybersader/01 - Active',
			'01 - Projects/Cybersader/02 - Archive',
			'02 - Areas',
		];
		const result = makeResult([{ folderRegex: '^\\d+\\s*-', label: 'jd' }]);
		const instances = extractInstances(folders, result);
		const tree = buildInstanceTree(instances);
		// Forest root has 1 outermost instance (root anchor) with 1 nested
		// instance underneath (under 01-Projects/Cybersader).
		expect(tree.length).toBe(1);
		expect(tree[0].instance.anchorPath).toBe('');
		expect(tree[0].children.length).toBe(1);
		expect(tree[0].children[0].instance.anchorPath).toBe('01 - Projects/Cybersader');
	});

	test('three-level nesting picks closest ancestor as parent', () => {
		// JD at root, JD at A, JD at A/B/C (where B/C don't have JD themselves)
		const folders = [
			'01 - One',
			'A',
			'A/01 - Sub',
			'A/02 - Sub',
			'A/B',
			'A/B/C',
			'A/B/C/01 - Deep',
			'A/B/C/02 - Deep',
		];
		const result = makeResult([{ folderRegex: '^\\d+\\s*-', label: 'jd' }]);
		const instances = extractInstances(folders, result);
		// 3 instances: root (01-One), A (01-Sub, 02-Sub), A/B/C (01-Deep, 02-Deep)
		expect(instances.length).toBe(3);
		const tree = buildInstanceTree(instances);
		// Forest root: just the root anchor instance
		expect(tree.length).toBe(1);
		// Under root: instance at A
		expect(tree[0].children.length).toBe(1);
		expect(tree[0].children[0].instance.anchorPath).toBe('A');
		// Under A: instance at A/B/C — should attach to A, NOT to root
		expect(tree[0].children[0].children.length).toBe(1);
		expect(tree[0].children[0].children[0].instance.anchorPath).toBe('A/B/C');
	});

	test('partial-prefix names do not nest by accident', () => {
		// `Project` is a prefix of `Projects` lexically but they are different
		// folders. isAnchorPrefix must respect path-segment boundaries.
		const folders = [
			'Project',
			'Project/Sub',
			'Projects',
			'Projects/Sub',
		];
		const result = makeResult([{ folderRegex: '^Sub$', label: 'sub' }]);
		const instances = extractInstances(folders, result);
		expect(instances.length).toBe(2);
		const tree = buildInstanceTree(instances);
		// Both instances should be at the forest root (neither nests inside the other)
		expect(tree.length).toBe(2);
	});
});

describe('collectCrossPackHits — cross-pack signal aggregation', () => {
	function makeResultWithId(
		id: string,
		signals: Array<{ folderRegex: string; label?: string; scope?: 'name' | 'path' | 'leafName' }>,
	): DetectionResult {
		return {
			packId: id,
			score: 1,
			signalsHit: signals.length,
			minSignals: 1,
			matchedSignals: signals.map((s) => ({
				folderRegex: s.folderRegex,
				scope: s.scope ?? 'name',
				label: s.label,
				exampleMatches: [],
			})),
		};
	}

	test('aggregates hits across multiple packs into one map', () => {
		const folders = ['Projects', 'Areas', '01 - Notes'];
		const para = makeResultWithId('para', [
			{ folderRegex: '^Projects$', label: 'projects' },
			{ folderRegex: '^Areas$', label: 'areas' },
		]);
		const jd = makeResultWithId('jd', [
			{ folderRegex: '^\\d+\\s*-', label: 'jd-prefix' },
		]);
		const names = new Map([['para', 'PARA'], ['jd', 'JD']]);

		const map = collectCrossPackHits(folders, [para, jd], names);
		expect(map.allSignals.length).toBe(3); // 2 from PARA + 1 from JD
		// Each signal has unique global index
		const indices = map.allSignals.map((s) => s.globalIndex).sort();
		expect(indices).toEqual([0, 1, 2]);
		// Hits collected per folder
		expect(map.hitsByPath.size).toBe(3);
		const projectsHits = map.hitsByPath.get('Projects')!;
		expect(projectsHits.length).toBe(1);
		expect(projectsHits[0].signal.packName).toBe('PARA');
		expect(projectsHits[0].signal.label).toBe('projects');
	});

	test('one folder hitting signals from multiple packs gets all annotations', () => {
		const folders = ['01 - Projects'];
		const para = makeResultWithId('para', [{ folderRegex: 'Projects', label: 'projects' }]);
		const jd = makeResultWithId('jd', [{ folderRegex: '^\\d', label: 'jd' }]);
		const names = new Map([['para', 'PARA'], ['jd', 'JD']]);

		const map = collectCrossPackHits(folders, [para, jd], names);
		const hits = map.hitsByPath.get('01 - Projects')!;
		expect(hits.length).toBe(2);
		const sources = hits.map((h) => h.signal.packId).sort();
		expect(sources).toEqual(['jd', 'para']);
	});

	test('suppressed packs are excluded from cross-pack map', () => {
		const folders = ['Projects'];
		const para = makeResultWithId('para', [{ folderRegex: '^Projects$', label: 'projects' }]);
		para.suppressedByMissingParent = true;
		const names = new Map([['para', 'PARA']]);
		const map = collectCrossPackHits(folders, [para], names);
		expect(map.allSignals.length).toBe(0);
		expect(map.hitsByPath.size).toBe(0);
	});

	test('below-threshold packs are defensively excluded from cross-pack map', () => {
		const folders = ['Projects'];
		const para = makeResultWithId('para', [{ folderRegex: '^Projects$', label: 'projects' }]);
		para.score = 0.5;
		para.minSignals = 2;
		const names = new Map([['para', 'PARA']]);
		const map = collectCrossPackHits(folders, [para], names);
		expect(map.allSignals).toEqual([]);
		expect(map.hitsByPath.size).toBe(0);
	});

	test('pack name falls back to id if not in lookup', () => {
		const folders = ['Projects'];
		const result = makeResultWithId('mystery-pack', [{ folderRegex: '^Projects$', label: 'p' }]);
		const map = collectCrossPackHits(folders, [result], new Map());
		expect(map.allSignals[0].packName).toBe('mystery-pack');
	});
});

describe('collectCrossPackHits — occurrence-native evidence maps', () => {
	const OCCURRENCE_PACK: ManifestPackEntry = {
		id: 'local-system',
		name: 'Local system',
		detection: {
			anyOf: [
				{ folderRegex: '^Projects$', role: 'projects' },
				{ folderRegex: '^Areas$', role: 'areas' },
				{
					folderRegex: '(?:^|/)Projects/Detail$',
					scope: 'path',
					role: 'detail',
					relation: 'support',
				},
			],
			occurrence: { countBy: 'roles', minEvidence: 2 },
		},
	};

	test('exposes complete evidence separately from actionable occurrence hits', () => {
		const folders = [
			'Projects',
			'Areas',
			'Projects/Detail',
			'Clients/Acme/Projects',
		];
		const results = detectPacks(folders, [OCCURRENCE_PACK]);
		const map = collectCrossPackHits(folders, results, new Map());

		expect(new Set(map.allEvidenceHitsByPath.keys())).toEqual(new Set(folders));
		expect(new Set(map.actionableHitsByPath.keys())).toEqual(new Set([
			'Projects',
			'Areas',
			'Projects/Detail',
		]));
		expect(map.hitsByPath).toBe(map.actionableHitsByPath);

		const member = map.actionableHitsByPath.get('Projects')![0];
		expect(member.occurrenceKey).toBe(detectionOccurrenceKey('local-system', ''));
		expect(member.occurrenceAnchorPath).toBe('');
		expect(member.relation).toBe('member');
		expect(member.occurrenceStatus).toBe('actionable');

		const support = map.actionableHitsByPath.get('Projects/Detail')![0];
		expect(support.occurrenceKey).toBe(member.occurrenceKey);
		expect(support.relation).toBe('support');

		const incomplete = map.allEvidenceHitsByPath.get('Clients/Acme/Projects')![0];
		expect(incomplete.occurrenceKey).toBe(
			detectionOccurrenceKey('local-system', 'Clients/Acme'),
		);
		expect(incomplete.occurrenceStatus).toBe('incomplete');
	});

	test('preserves repeated local occurrences with distinct identities', () => {
		const folders = [
			'Teams/Acme/Projects',
			'Teams/Acme/Areas',
			'Teams/Beta/Projects',
			'Teams/Beta/Areas',
		];
		const results = detectPacks(folders, [OCCURRENCE_PACK]);
		const map = collectCrossPackHits(folders, results, new Map());
		const keys = new Set(
			[...map.actionableHitsByPath.values()].flat().map((hit) => hit.occurrenceKey),
		);

		expect(keys).toEqual(new Set([
			detectionOccurrenceKey('local-system', 'Teams/Acme'),
			detectionOccurrenceKey('local-system', 'Teams/Beta'),
		]));
	});
});

describe('buildAnnotatedTree — cross-pack hierarchy view', () => {
	function makeResultWithId(
		id: string,
		signals: Array<{ folderRegex: string; label?: string }>,
	): DetectionResult {
		return {
			packId: id,
			score: 1,
			signalsHit: signals.length,
			minSignals: 1,
			matchedSignals: signals.map((s) => ({
				folderRegex: s.folderRegex,
				scope: 'name',
				label: s.label,
				exampleMatches: [],
			})),
		};
	}

	test('builds sparse tree with cross-pack hits per folder', () => {
		const folders = [
			'Projects',
			'Projects/Web',
			'Areas',
			'Templates',
		];
		const para = makeResultWithId('para', [
			{ folderRegex: '^Projects$', label: 'p' },
			{ folderRegex: '^Areas$', label: 'a' },
		]);
		const map = collectCrossPackHits(folders, [para], new Map([['para', 'PARA']]));
		const tree = buildAnnotatedTree(folders, map);
		expect(tree.totalHitFolders).toBe(2); // Projects + Areas
		expect(tree.root.children.has('Projects')).toBe(true);
		expect(tree.root.children.has('Areas')).toBe(true);
		expect(tree.root.children.has('Templates')).toBe(false); // elided
		expect(tree.root.elidedChildCount).toBe(1); // Templates
		const projects = tree.root.children.get('Projects')!;
		expect(projects.hits.length).toBe(1);
		expect(projects.hits[0].signal.packName).toBe('PARA');
	});

	test('folder hit by multiple packs has multiple annotations on its node', () => {
		const folders = ['01 - Projects', '01 - Projects/Web'];
		const para = makeResultWithId('para', [{ folderRegex: 'Projects', label: 'p' }]);
		const jd = makeResultWithId('jd', [{ folderRegex: '^\\d', label: 'jd' }]);
		const names = new Map([['para', 'PARA'], ['jd', 'JD']]);
		const map = collectCrossPackHits(folders, [para, jd], names);
		const tree = buildAnnotatedTree(folders, map);
		const proj = tree.root.children.get('01 - Projects')!;
		expect(proj.hits.length).toBe(2);
		const packs = proj.hits.map((h) => h.signal.packId).sort();
		expect(packs).toEqual(['jd', 'para']);
	});

	test('collectAnnotatedTreeFolders walks all kept folders', () => {
		const folders = [
			'Projects',
			'Projects/Web',
			'Projects/Web/Auth',
			'Areas',
		];
		const para = makeResultWithId('para', [{ folderRegex: '^Auth$', label: 'a' }]);
		const map = collectCrossPackHits(folders, [para], new Map([['para', 'PARA']]));
		const tree = buildAnnotatedTree(folders, map);
		const all = collectAnnotatedTreeFolders(tree.root);
		expect(all.sort()).toEqual(['Projects', 'Projects/Web', 'Projects/Web/Auth']);
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
